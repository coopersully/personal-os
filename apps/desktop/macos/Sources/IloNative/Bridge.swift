import AppKit
import Carbon
import Foundation
import ServiceManagement

private var hostCallback: (@convention(c) (UnsafePointer<CChar>?) -> Void)?
func petShouldBeVisible(enabled: Bool, hasSnapshot _: Bool) -> Bool { enabled }
@_cdecl("ilo_native_set_callback")
public func iloNativeSetCallback(
  _ callback: @escaping @convention(c) (UnsafePointer<CChar>?) -> Void
) { hostCallback = callback }
@_cdecl("ilo_native_dispatch")
public func iloNativeDispatch(_ request: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>? {
  guard Thread.isMainThread else {
    return strdup("{\"ok\":false,\"error\":\"Native dispatch requires the main thread\"}")
  }
  do {
    let data = Data(String(cString: request).utf8)
    guard data.count <= 1024 * 1024,
      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw NativeError.message("Invalid native request") }
    let result = try NativeCompanion.shared.dispatch(object)
    return strdup(
      String(decoding: try JSONSerialization.data(withJSONObject: result), as: UTF8.self))
  } catch {
    let result: [String: Any] = ["ok": false, "error": error.localizedDescription]
    return strdup(
      String(
        decoding: (try? JSONSerialization.data(withJSONObject: result))
          ?? Data("{\"ok\":false}".utf8), as: UTF8.self))
  }
}
final class NativeCompanion {
  static let shared = NativeCompanion()
  private let notifications = NotificationController()
  private let pet = PetController()
  private var settings: NativeSettings?
  private var snapshot: NativeSnapshot?
  private var loginError: String?
  private var widgetError: String?
  private let launchedAtLogin =
    NSAppleEventManager.shared().currentAppleEvent?
    .paramDescriptor(forKeyword: keyAEPropData)?.enumCodeValue == keyAELaunchedAsLogInItem
  private var wakeObservers: [NSObjectProtocol] = []
  init() {
    notifications.onAction = Self.emit
    pet.model.action = Self.emit
    for name in [NSWorkspace.didWakeNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
      wakeObservers.append(
        NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main)
        { _ in
          Self.emit(["action": "refresh"])
        })
    }
    if launchedAtLogin { DispatchQueue.main.async { Self.emit(["action": "hide"]) } }
  }
  static func emit(_ action: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: action),
      let string = String(data: data, encoding: .utf8)
    else { return }
    string.withCString { hostCallback?($0) }
  }
  func status() -> [String: Any] {
    notifications.refreshPermission()
    let registration = SMAppService.mainApp.status
    let state: String
    switch registration {
    case .enabled: state = "enabled"
    case .requiresApproval: state = "requiresApproval"
    case .notRegistered: state = "notRegistered"
    case .notFound: state = "notFound"
    @unknown default: state = "unknown"
    }
    var result: [String: Any] = [
      "ok": true, "notificationPermission": notifications.permission,
      "notificationAlertsAvailable": notifications.alertAvailable,
      "notificationSoundsAvailable": notifications.soundAvailable,
      "launchAtLogin": registration == .enabled, "loginStatus": state,
      "widgetsAvailable": SharedSnapshotStore.container != nil,
      "launchedAtLogin": launchedAtLogin,
    ]
    if let error = loginError ?? notifications.lastError { result["error"] = error }
    if let widgetError { result["widgetError"] = widgetError }
    return result
  }
  func clear(preservingColdResponses: Bool = false) {
    snapshot = nil
    pet.model.update(nil)
    notifications.clear(preservingColdResponses: preservingColdResponses)
    SharedSnapshotStore.clear()
    UserDefaults.standard.removeObject(forKey: "ilo.native.identityFingerprint")
    if let settings { pet.configure(settings) }
  }
  func dispatch(_ object: [String: Any]) throws -> [String: Any] {
    guard let op = object["op"] as? String else {
      throw NativeError.message("Missing native operation")
    }
    func string(_ key: String) throws -> String {
      guard let value = object[key] as? String else { throw NativeError.message("Missing \(key)") }
      return value
    }
    switch op {
    case "wallpaper_prepare": return try WallpaperController.prepare(object)
    case "wallpaper_apply": return try WallpaperController.apply(object)
    case "configure":
      guard let raw = object["settings"] else { throw NativeError.message("Missing settings") }
      var s = try JSONDecoder().decode(
        NativeSettings.self, from: JSONSerialization.data(withJSONObject: raw))
      s.serverUrl = try canonicalOrigin(s.serverUrl)
      let serverFingerprint = stableID(s.serverUrl)
      if UserDefaults.standard.string(forKey: "ilo.native.serverFingerprint") != serverFingerprint {
        clear(preservingColdResponses: settings == nil && snapshot == nil)
      }
      UserDefaults.standard.set(serverFingerprint, forKey: "ilo.native.serverFingerprint")
      settings = s
      let actual = SMAppService.mainApp.status
      do {
        if s.launchAtLogin, actual != .enabled && actual != .requiresApproval {
          try SMAppService.mainApp.register()
        }
        if !s.launchAtLogin, actual == .enabled || actual == .requiresApproval {
          try SMAppService.mainApp.unregister()
        }
        loginError = nil
      } catch { loginError = error.localizedDescription }
      var visibleSettings = s
      visibleSettings.petEnabled = petShouldBeVisible(
        enabled: s.petEnabled, hasSnapshot: snapshot != nil)
      pet.configure(visibleSettings)
      if let snapshot { publish(snapshot) }
      return status()
    case "snapshot":
      guard let raw = object["snapshot"], let settings else {
        throw NativeError.message("Configure before publishing a snapshot")
      }
      var s = try JSONDecoder().decode(
        NativeSnapshot.self, from: JSONSerialization.data(withJSONObject: raw))
      s.serverUrl = try canonicalOrigin(s.serverUrl)
      guard s.schemaVersion == 1, s.serverUrl == settings.serverUrl, !s.accountId.isEmpty,
        TimeZone(identifier: s.timeZone) != nil
      else { throw NativeError.message("Invalid snapshot identity, version or timezone") }
      let identityFingerprint = stableID(s.identity)
      if UserDefaults.standard.string(forKey: "ilo.native.identityFingerprint")
        != identityFingerprint
      {
        clear(preservingColdResponses: snapshot == nil)
      }
      UserDefaults.standard.set(identityFingerprint, forKey: "ilo.native.identityFingerprint")
      snapshot = s
      pet.configure(settings)
      publish(s)
      return ["ok": true, "widgetsAvailable": SharedSnapshotStore.container != nil]
    case "clear":
      clear()
      return ["ok": true]
    case "status": return status()
    case "request_notification_permission":
      notifications.requestPermission()
      return ["ok": true, "requestPending": true]
    case "test_notification":
      try notifications.test()
      return ["ok": true, "scheduled": true]
    case "reset_pet_position":
      pet.resetPosition()
      return ["ok": true]
    case "quick_access":
      pet.quickAccess()
      return ["ok": true]
    case "open_notification_settings":
      guard
        let url = URL(
          string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension"),
        NSWorkspace.shared.open(url)
      else { throw NativeError.message("Could not open macOS notification settings") }
      return ["ok": true]
    case "mail":
      let path = try string("path")
      guard path.hasPrefix("/mail"), !path.hasPrefix("//"), !path.contains("\\") else {
        throw NativeError.message("Invalid mail route")
      }
      try notifications.mail(
        id: string("id"), title: string("title"), path: path, accountID: string("accountId"),
        userID: string("userId"), server: canonicalOrigin(string("serverUrl")))
      return ["ok": true]
    case "keychain_get":
      return [
        "ok": true, "value": try SessionKeychain.get(string("serverUrl")) as Any? ?? NSNull(),
      ]
    case "keychain_set":
      try SessionKeychain.set(string("serverUrl"), value: string("value"))
      return ["ok": true]
    case "keychain_delete":
      try SessionKeychain.delete(string("serverUrl"))
      return ["ok": true]
    default: throw NativeError.message("Unknown native operation")
    }
  }
  private func publish(_ s: NativeSnapshot) {
    guard let settings else { return }
    pet.model.update(s.filtered(workspaces: settings.petWorkspaces))
    notifications.reconcile(s, preferences: settings.notifications)
    do {
      try SharedSnapshotStore.write(
        s, workspaces: settings.widgetWorkspaces ?? ["tasks", "reminders", "calendar"])
      widgetError = nil
    } catch { widgetError = error.localizedDescription }
  }
}
