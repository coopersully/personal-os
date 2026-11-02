import Foundation
import Intents

/// Public, consent-gated signal. Unknown is never reported as Focus off.
enum ActiveReminderFocus {
  static var requestPending = false
  static var permission: String {
    switch INFocusStatusCenter.default.authorizationStatus {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
    }
  }
  static var status: String {
    guard permission == "authorized",
      let focused = INFocusStatusCenter.default.focusStatus.isFocused
    else { return "unknown" }
    return focused ? "on" : "off"
  }
  static func blocksCards(respectFocus: Bool, status: String) -> Bool {
    respectFocus && status != "off"
  }
  static func requestAuthorization() {
    guard !requestPending else { return }
    requestPending = true
    INFocusStatusCenter.default.requestAuthorization { _ in
      DispatchQueue.main.async { requestPending = false }
    }
  }
}
