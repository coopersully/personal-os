import Foundation
import Intents

/// Public, consent-gated signal. Unknown is never reported as Focus off.
enum ActiveReminderFocus {
  // The signed host has no Communication Notifications capability, which Apple's
  // Focus sample requires in addition to consent. SDK availability is insufficient.
  // Enable only after legitimate capability/profile configuration and signed-app
  // certification; task/reminder-only eligibility has not been established.
  static let isAvailable = false
  static let unavailableReason =
    "Focus status is unavailable in this build because the required macOS capability has not been configured and verified."
  static private(set) var requestPending = false
  static var permission: String {
    guard isAvailable else { return "unknown" }
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
  static func requestAuthorization() throws {
    guard isAvailable else { throw NativeError.message(unavailableReason) }
    guard !requestPending else { return }
    requestPending = true
    INFocusStatusCenter.default.requestAuthorization { _ in
      DispatchQueue.main.async { requestPending = false }
    }
  }
}
