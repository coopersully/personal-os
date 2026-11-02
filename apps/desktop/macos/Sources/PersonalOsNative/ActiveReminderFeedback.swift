import AppKit

enum ActiveReminderFeedback: Equatable {
  case arrival, completion, grab, slot, snap, dock, detach, release, resize, pending, failure, menu,
    open, lock, unlock, gather
  var asset: String {
    switch self {
    case .completion: return "earshot-complete"
    case .grab, .pending, .menu, .open: return "earshot-grab"
    case .snap, .dock: return "earshot-snap"
    case .lock: return "earshot-lock"
    case .unlock: return "earshot-unlock"
    case .gather: return "earshot-gather"
    case .detach: return "earshot-unlock"
    case .resize, .release: return "earshot-resize"
    case .failure: return "earshot-error"
    case .slot: return "earshot-slot"
    case .arrival: return "earshot-arrive"
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
  static var volume: Float = 0.35
  static func preload() {
    for event in [
      ActiveReminderFeedback.arrival, .completion, .grab, .slot, .snap, .detach, .resize, .failure,
      .lock, .unlock, .gather,
    ] {
      if cache[event.asset] == nil {
        cache[event.asset] = Bundle.main.url(
          forResource: event.asset, withExtension: "wav", subdirectory: "sounds"
        )
        .flatMap { NSSound(contentsOf: $0, byReference: false) }
      }
    }
  }
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

    }
    playing?.stop()
    playing = cache[event.asset]
    playing?.volume = min(1, max(0, volume))
    playing?.play()
  }
}
