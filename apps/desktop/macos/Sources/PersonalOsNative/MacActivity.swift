import AppKit
import CoreGraphics

struct MacActivityState: Equatable {
  var isActive: Bool
  var isAvailable: Bool
  var shouldHide: Bool
  static func evaluate(
    inputAge: Double, onConsole: Bool, loginDone: Bool, locked: Bool,
    displayAwake: Bool, frontmost: String?
  ) -> MacActivityState {
    let known = inputAge.isFinite && inputAge >= 0 && frontmost != nil
    let hidden =
      locked || !displayAwake || !onConsole || !loginDone || frontmost == "com.apple.loginwindow"
    return MacActivityState(
      isActive: known && !hidden && inputAge < 120, isAvailable: known, shouldHide: hidden || !known
    )
  }
}
final class MacActivityMonitor {
  private var sleeping = false
  private var observers: [NSObjectProtocol] = []
  init() {
    let center = NSWorkspace.shared.notificationCenter
    for name in [NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification] {
      observers.append(
        center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          self?.sleeping = true
        })
    }
    for name in [NSWorkspace.didWakeNotification, NSWorkspace.screensDidWakeNotification] {
      observers.append(
        center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          self?.sleeping = false
        })
    }
  }
  deinit {
    for observer in observers { NSWorkspace.shared.notificationCenter.removeObserver(observer) }
  }
  func sample(now: Date = Date()) -> MacActivityState {
    guard let session = CGSessionCopyCurrentDictionary() as? [String: Any] else {
      return MacActivityState(isActive: false, isAvailable: false, shouldHide: true)
    }
    let age =
      [
        CGEventType.mouseMoved, .leftMouseDown, .rightMouseDown, .keyDown, .scrollWheel,
        .leftMouseDragged, .rightMouseDragged, .otherMouseDown, .otherMouseDragged,
      ]
      .map { CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: $0) }.min()
      ?? .infinity
    let awake =
      !sleeping
      && NSScreen.screens.contains { screen in
        guard
          let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
        else { return false }
        return CGDisplayIsAsleep(id.uint32Value) == 0
      }
    return MacActivityState.evaluate(
      inputAge: age,
      onConsole: session[kCGSessionOnConsoleKey as String] as? Bool ?? false,
      loginDone: session[kCGSessionLoginDoneKey as String] as? Bool ?? false,
      locked: session["CGSSessionScreenIsLocked"] as? Bool ?? false,
      displayAwake: awake, frontmost: NSWorkspace.shared.frontmostApplication?.bundleIdentifier)
  }
}
