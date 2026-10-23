import AppKit

enum ActiveReminderFeedback: Equatable {
  case arrival, completion, grab, slot, snap, dock, detach, release, resize, pending, failure, menu,
    open
  var asset: String {
    switch self {
    case .completion: return "active-reminder-soft-complete"
    case .grab, .pending, .menu, .open: return "notification-soft-click"
    case .snap, .dock: return "active-reminder-soft-snap"
    case .detach: return "active-reminder-soft-detach"
    case .resize, .release: return "active-reminder-soft-resize"
    case .failure: return "active-reminder-soft-error"
    case .slot: return "active-reminder-soft-slot"
    case .arrival: return "notification-soft-click"
    }
  }
}

/// Tiny cached samples, with bounded feedback on semantic transitions rather than pointer frames.
/// NSSound respects system output volume and mute; the router applies nohmi's sound preference.
enum ActiveReminderAudio {
  private static var cache: [String: NSSound] = [:]
  private static var playing: NSSound?
  private static var lastEvent = Date.distantPast
  private static var lastArrival = Date.distantPast
  static func play(_ event: ActiveReminderFeedback) {
    let now = Date()
    if event == .arrival {
      guard now.timeIntervalSince(lastArrival) > 0.15 else { return }
      lastArrival = now
    } else if [.slot, .grab, .menu, .resize].contains(event),
      now.timeIntervalSince(lastEvent) < 0.08
    {
      return
    }
    lastEvent = now
    if cache[event.asset] == nil {
      cache[event.asset] =
        Bundle.main.url(forResource: event.asset, withExtension: "wav", subdirectory: "sounds")
        .flatMap { NSSound(contentsOf: $0, byReference: false) }
        ?? NSSound(named: event == .completion ? "Pop" : "Tink")
    }
    playing?.stop()
    playing = cache[event.asset]
    playing?.volume = [.slot, .menu, .grab].contains(event) ? 0.35 : 0.7
    playing?.play()
  }
}
