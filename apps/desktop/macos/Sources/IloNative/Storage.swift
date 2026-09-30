import Darwin
import Foundation
import Security
import WidgetKit

enum SessionKeychain {
  static let service = "app.personal-os.desktop.session"
  static var accessGroup: String? {
    Bundle.main.object(forInfoDictionaryKey: "IloKeychainAccessGroup") as? String
  }
  static func query(_ server: String) throws -> [String: Any] {
    var q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: try canonicalOrigin(server),
    ]
    if let group = accessGroup, !group.isEmpty, !group.contains("$(") {
      q[kSecAttrAccessGroup as String] = group
    }
    return q
  }
  static func get(_ server: String) throws -> String? {
    var q = try query(server)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    try check(status)
    guard let data = result as? Data, let token = String(data: data, encoding: .utf8) else {
      throw NativeError.message("Invalid Keychain session data")
    }
    return token
  }
  static func set(_ server: String, value: String) throws {
    try SharedSnapshotStore.credentialLock { try setUnlocked(server, value: value) }
  }
  private static func setUnlocked(_ server: String, value: String) throws {
    guard !value.isEmpty, value.utf8.count <= 16384 else {
      throw NativeError.message("Invalid session value")
    }
    let q = try query(server)
    let data = Data(value.utf8)
    let status = SecItemUpdate(q as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
      var insert = q
      insert[kSecValueData as String] = data
      insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      try check(SecItemAdd(insert as CFDictionary, nil))
    } else {
      try check(status)
    }
  }
  static func delete(_ server: String) throws {
    try SharedSnapshotStore.credentialLock { try deleteUnlocked(server) }
  }
  static func deleteUnlocked(_ server: String) throws {
    let status = SecItemDelete(try query(server) as CFDictionary)
    if status != errSecItemNotFound { try check(status) }
  }
  static func check(_ status: OSStatus) throws {
    if status != errSecSuccess {
      throw NativeError.message("Keychain operation failed (\(status))")
    }
  }
}
enum SharedSnapshotStore {
  static var group: String {
    Bundle.main.object(forInfoDictionaryKey: "IloAppGroup") as? String
      ?? "group.app.personal-os.desktop"
  }
  static var container: URL? {
    // containerURL can fabricate a path for unsandboxed callers. Check the actual signed entitlement first.
    guard let task = SecTaskCreateFromSelf(nil),
      let groups = SecTaskCopyValueForEntitlement(
        task, "com.apple.security.application-groups" as CFString, nil) as? [String],
      groups.contains(group)
    else { return nil }
    return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
  }
  static var fileStore: WidgetSnapshotFileStore? { container.map(WidgetSnapshotFileStore.init) }
  static var url: URL? { fileStore?.url }
  static func credentialLock<T>(_ operation: () throws -> T) throws -> T {
    // Unsandboxed development has no shared widget container. Production keychain writers
    // join the widget lock so revoked-token cleanup cannot race a replacement sign-in.
    guard let fileStore else { return try operation() }
    return try fileStore.locked(operation)
  }
  static func write(_ snapshot: NativeSnapshot, workspaces: [String]) throws {
    guard let fileStore else {
      throw NativeError.message("Widgets require a signed App Group entitlement")
    }
    try fileStore.write(snapshot.filtered(workspaces: workspaces))
    WidgetCenter.shared.reloadAllTimelines()
  }
  static func read() -> NativeSnapshot? { fileStore?.read() }
  static func removeCompleted(id: String, kind: String, identity: String) throws {
    guard let fileStore else { throw NativeError.message("Widgets require App Group access") }
    try fileStore.removeCompleted(id: id, kind: kind, identity: identity)
    WidgetCenter.shared.reloadAllTimelines()
  }
  static func invalidateRevokedSession(server: String, account: String, rejectedToken: String)
    throws
  {
    guard let fileStore else { return }
    let cleared = try fileStore.invalidateRevokedSession(
      identity: "\(server)|\(account)", rejectedToken: rejectedToken,
      readCredential: { try SessionKeychain.get(server) },
      deleteCredential: { try SessionKeychain.deleteUnlocked(server) })
    if cleared { WidgetCenter.shared.reloadAllTimelines() }
  }
  static func clear() {
    try? fileStore?.clear()
    WidgetCenter.shared.reloadAllTimelines()
  }
}

/// The same file-locking implementation is used by the app, extension and filesystem regression tests.
struct WidgetSnapshotFileStore {
  let container: URL
  var url: URL { container.appendingPathComponent("ilo-widget-v1.json") }
  func locked<T>(_ operation: () throws -> T) throws -> T {
    let descriptor = Darwin.open(
      container.appendingPathComponent("ilo-widget.lock").path, O_CREAT | O_RDWR, 0o600)
    guard descriptor >= 0 else { throw NativeError.message("Could not lock widget storage") }
    defer { Darwin.close(descriptor) }
    guard flock(descriptor, LOCK_EX) == 0 else {
      throw NativeError.message("Could not lock widget storage")
    }
    defer { flock(descriptor, LOCK_UN) }
    return try operation()
  }
  func write(_ snapshot: NativeSnapshot) throws { try locked { try writeUnlocked(snapshot) } }
  private func writeUnlocked(_ snapshot: NativeSnapshot) throws {
    let data = try JSONEncoder().encode(snapshot)
    guard data.count <= 256 * 1024 else {
      throw NativeError.message("Widget snapshot exceeds size limit")
    }
    try data.write(to: url, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
  }
  func read() -> NativeSnapshot? {
    guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
      size <= 256 * 1024, let data = try? Data(contentsOf: url),
      let s = try? JSONDecoder().decode(NativeSnapshot.self, from: data), s.schemaVersion == 1
    else { return nil }
    return s
  }
  func removeCompleted(id: String, kind: String, identity: String) throws {
    try locked {
      guard var latest = read(), latest.identity == identity else { return }
      if kind == "task" {
        latest.tasks.removeAll { $0.id == id }
      } else if kind == "reminder" {
        latest.reminders.removeAll { $0.id == id }
      } else {
        throw NativeError.message("Invalid completed widget item")
      }
      try writeUnlocked(latest)
    }
  }
  @discardableResult
  func invalidateRevokedSession(
    identity: String, rejectedToken: String,
    readCredential: () throws -> String?, deleteCredential: () throws -> Void
  ) throws -> Bool {
    try locked {
      guard read()?.identity == identity, try readCredential() == rejectedToken else {
        return false
      }
      // Both checks and deletion occur under the same lock as host login writes.
      // Even a replacement login for the same account keeps its new credential and snapshot.
      try deleteCredential()
      if FileManager.default.fileExists(atPath: url.path) {
        try FileManager.default.removeItem(at: url)
      }
      return true
    }
  }
  func clear() throws {
    try locked {
      if FileManager.default.fileExists(atPath: url.path) {
        try FileManager.default.removeItem(at: url)
      }
    }
  }
}
