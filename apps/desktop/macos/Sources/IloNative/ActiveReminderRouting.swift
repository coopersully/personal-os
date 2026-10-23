import AppKit
import Foundation

enum ActiveReminderDecision: Equatable {
  case wait, prepare, show, restore
  static func resolve(
    secondsUntilFire: Double, active: Bool, fresh: Bool, allowed: Bool, claimed: Bool, shown: Bool
  ) -> ActiveReminderDecision {
    if shown { return .wait }
    if secondsUntilFire <= 0 && claimed && (!active || !fresh || !allowed) { return .restore }
    guard active && fresh && allowed else { return .wait }
    if secondsUntilFire <= 0 { return .show }
    return secondsUntilFire <= 2 && !claimed ? .prepare : .wait
  }
}
protocol ActiveReminderNotificationSink: AnyObject {
  var permission: String { get }
  func ensureActiveOrdinary(
    _ alert: PlannedAlert, item: ActiveReminderCandidate, inventory: ActiveReminderInventory,
    preferences: NotificationPreferences)
  func handoffActiveOrdinary(
    _ alert: PlannedAlert, item: ActiveReminderCandidate,
    inventory: ActiveReminderInventory, preferences: NotificationPreferences)
  func takeActiveOwnership(_ id: String)
  func prepareActiveFallback(
    _ alert: PlannedAlert, item: ActiveReminderCandidate, inventory: ActiveReminderInventory,
    preferences: NotificationPreferences, completion: @escaping (Result<Void, Error>) -> Void)
  func finishActivePresentation(_ id: String)
  func retireActiveOccurrence(_ id: String)
  func restoreActiveOrdinary(
    _ alert: PlannedAlert, item: ActiveReminderCandidate, inventory: ActiveReminderInventory,
    preferences: NotificationPreferences)
}
final class ActiveReminderRouter {
  private let notifications: ActiveReminderNotificationSink
  private let presenter: ActiveReminderPresenting
  private let activity: () -> MacActivityState
  private let now: () -> Date
  private let makeStore: (String) throws -> ActiveReminderStore
  private var store: ActiveReminderStore?
  private var inventory: ActiveReminderInventory?
  private var preferences = NotificationPreferences()
  private var calendar = Calendar.current
  private var enabled = true
  private var timer: Timer?
  private var claimed = Set<String>()
  private var preparing = Set<String>()
  private var failedPreparation = Set<String>()
  private var shown = Set<String>()
  private var acknowledged = Set<String>()
  private var errors: [String: String] = [:]
  private var pending: [String: ActiveReminderCandidate] = [:]
  private var routingEpoch = 0
  private var needsRevalidation = false
  private var previousActivity = false
  var action: (([String: Any]) -> Void)?
  var lastError: String?
  var isActive: Bool { activity().isActive }
  init(
    notifications: ActiveReminderNotificationSink, presenter: ActiveReminderPresenting,
    activity: @escaping () -> MacActivityState, now: @escaping () -> Date = Date.init,
    makeStore: @escaping (String) throws -> ActiveReminderStore, startTimer: Bool = true
  ) {
    self.notifications = notifications
    self.presenter = presenter
    self.activity = activity
    self.now = now
    self.makeStore = makeStore
    if let panel = presenter as? ActiveReminderPanelController {
      panel.complete = { [weak self] item in self?.complete(item) }
      panel.open = { [weak self] item in self?.open(item) }
    }
    if startTimer {
      timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
        self?.tick()
      }
    }
  }
  deinit { timer?.invalidate() }
  func configure(preferences: NotificationPreferences, calendar: Calendar, enabled: Bool) {
    let changed =
      self.preferences != preferences || self.calendar.timeZone != calendar.timeZone
      || self.enabled != enabled
    self.preferences = preferences
    presenter.setSoundEnabled(preferences.sound)
    self.calendar = calendar
    self.enabled = enabled
    if changed {
      routingEpoch += 1
      if let inventory {
        for item in inventory.items {
          let id = item.occurrenceID(identity: inventory.identity)
          if (claimed.contains(id) || preparing.contains(id)) && !shown.contains(id) {
            if preferences.enabled && sourceEnabled(item) {
              notifications.restoreActiveOrdinary(
                alert(item, inventory: inventory, at: now()), item: item, inventory: inventory,
                preferences: preferences)
            } else {
              notifications.retireActiveOccurrence(id)
            }
          }
        }
      }
      claimed = []
      preparing = []
      failedPreparation = []
    }
    if !preferences.enabled || !enabled {
      needsRevalidation = true
      presenter.hide()
    }
    tick()
  }
  func ingest(_ next: ActiveReminderInventory) throws {
    guard next.items.allSatisfy(\.valid),
      (next.ordinaryItems ?? []).allSatisfy(\.validSource),
      Set(next.items.map { "\($0.kind):\($0.id)" }).count == next.items.count,
      parseDate(next.generatedAt) != nil
    else { throw NativeError.message("Invalid active reminder inventory.") }
    if let current = inventory {
      guard current.identity == next.identity else {
        throw NativeError.message("Active reminder identity changed before clearing.")
      }
      guard next.generation >= current.generation,
        (parseDate(next.generatedAt) ?? .distantPast)
          >= (parseDate(current.generatedAt) ?? .distantPast)
      else { return }
    }
    if store == nil {
      store = try makeStore(next.identity)
      (presenter as? ActiveReminderPanelController)?.store = store
    }
    let validIDs = Set(next.items.map { $0.occurrenceID(identity: next.identity) })
    let ordinaryIDs = Set(
      (next.ordinaryItems ?? []).map { $0.occurrenceID(identity: next.identity) })
    if let previous = inventory {
      for item in previous.items {
        let id = item.occurrenceID(identity: previous.identity)
        if let replacement = next.items.first(where: { $0.id == item.id && $0.kind == item.kind }),
          replacement.dueAt == item.dueAt, replacement.sourceRevision != item.sourceRevision
        {
          notifications.retireActiveOccurrence(id)
          preparing.remove(id)
          failedPreparation.remove(id)
          claimed.remove(id)
          if shown.contains(id) {
            notifications.takeActiveOwnership(id)
            notifications.finishActivePresentation(id)
          }
        }
        if !validIDs.contains(id) {
          if !ordinaryIDs.contains(id) { notifications.retireActiveOccurrence(id) }
          claimed.remove(id)
          preparing.remove(id)
          shown.remove(id)
          errors[id] = nil
        }
      }
      if previous.generation != next.generation { pending = [:] }
    }
    for item in next.ordinaryItems ?? [] {
      if preferences.enabled && sourceEnabled(item) {
        notifications.handoffActiveOrdinary(
          alert(item, inventory: next, at: now()),
          item: item, inventory: next, preferences: preferences)
      } else {
        notifications.retireActiveOccurrence(item.occurrenceID(identity: next.identity))
      }
    }
    inventory = next
    lastError = nil
    tick()
  }
  func clear() {
    if let inventory {
      for item in inventory.items {
        notifications.retireActiveOccurrence(item.occurrenceID(identity: inventory.identity))
      }
    }
    routingEpoch += 1
    try? store?.erase()
    presenter.hide()
    (presenter as? ActiveReminderPanelController)?.reset()
    inventory = nil
    store = nil
    claimed = []
    preparing = []
    failedPreparation = []
    shown = []
    acknowledged = []
    pending = [:]
    errors = [:]
    lastError = nil
  }
  private func alert(
    _ item: ActiveReminderCandidate, inventory: ActiveReminderInventory, at time: Date
  ) -> PlannedAlert {
    let due = parseDate(item.dueAt) ?? .distantFuture
    let fire = AlertPlanner.afterQuietHours(due, preferences: preferences, calendar: calendar)
    return PlannedAlert(
      identifier: item.occurrenceID(identity: inventory.identity), kind: item.kind,
      materialID: item.id,
      title: preferences.preview ? item.title : "\(item.kind.capitalized) due",
      body: preferences.preview ? "Due now" : "Open nohmi to view details", fireAt: fire,
      path: item.kind == "task" ? "/tasks" : "/reminders", conferenceURL: nil)
  }
  private func sourceEnabled(_ item: ActiveReminderCandidate) -> Bool {
    item.kind == "task" ? preferences.tasks : preferences.reminders
  }
  private func current(_ item: ActiveReminderCandidate, inventory original: ActiveReminderInventory)
    -> Bool
  {
    guard let inventory, inventory.identity == original.identity,
      inventory.generation == original.generation
    else { return false }
    return inventory.items.contains {
      $0.id == item.id && $0.kind == item.kind && $0.dueAt == item.dueAt
        && $0.sourceRevision == item.sourceRevision
    }
  }
  func tick() {
    let state = activity()
    if state.shouldHide { needsRevalidation = true }
    if state.isActive && !previousActivity { action?(["action": "active_reminders_refresh"]) }
    previousActivity = state.isActive
    guard let inventory else {
      presenter.hide()
      return
    }
    let time = now()
    let fresh = inventory.isFresh(at: time)
    let quiet =
      AlertPlanner.afterQuietHours(time, preferences: preferences, calendar: calendar)
      .timeIntervalSince(time) > 0.5
    for item in inventory.items {
      let planned = alert(item, inventory: inventory, at: time)
      let id = planned.identifier
      let allowed =
        enabled && preferences.enabled && sourceEnabled(item)
        && notifications.permission == "authorized" && !state.shouldHide
      if !preferences.enabled || !sourceEnabled(item) {
        notifications.retireActiveOccurrence(id)
        claimed.remove(id)
        shown.remove(id)
        continue
      }
      if fresh && planned.fireAt > time {
        notifications.ensureActiveOrdinary(
          planned, item: item, inventory: inventory, preferences: preferences)
      }
      if acknowledged.contains("\(id)|\(item.sourceRevision)") { continue }
      switch ActiveReminderDecision.resolve(
        secondsUntilFire: planned.fireAt.timeIntervalSince(time), active: state.isActive,
        fresh: fresh, allowed: allowed && !quiet, claimed: claimed.contains(id),
        shown: shown.contains(id))
      {
      case .prepare:
        guard !preparing.contains(id), !failedPreparation.contains(id) else { continue }
        preparing.insert(id)
        let epoch = routingEpoch
        notifications.prepareActiveFallback(
          planned, item: item, inventory: inventory, preferences: preferences
        ) { [weak self] result in
          guard let self, self.routingEpoch == epoch else { return }
          self.preparing.remove(id)
          guard self.current(item, inventory: inventory) else { return }
          switch result {
          case .success: self.claimed.insert(id)
          case .failure:
            self.failedPreparation.insert(id)
            self.lastError =
              "Card delivery could not prepare. System notification delivery remains enabled."
          }
          self.tick()
        }
      case .show:
        guard !preparing.contains(id), store != nil else { continue }
        notifications.takeActiveOwnership(id)
        shown.insert(id)
        do {
          try renderThrowing()
          try store?.markShown(id, at: time)
          notifications.finishActivePresentation(id)
        } catch {
          lastError = "The card could not be saved. System fallback remains enabled."
          shown.remove(id)
        }
      case .restore:
        notifications.restoreActiveOrdinary(
          planned, item: item, inventory: inventory, preferences: preferences)
        claimed.remove(id)
      case .wait: break
      }
    }
    if !enabled || !preferences.enabled || state.shouldHide {
      presenter.hide()
    } else if !needsRevalidation || (state.isActive && fresh && !quiet) {
      needsRevalidation = false
      render()
    } else {
      presenter.hide()
    }
  }
  private func visible() -> [ActiveReminderCandidate] {
    guard let inventory else { return [] }
    return inventory.items.filter {
      shown.contains($0.occurrenceID(identity: inventory.identity)) && sourceEnabled($0)
    }
    .sorted { ($0.dueAt, $0.kind, $0.id) < ($1.dueAt, $1.kind, $1.id) }
  }
  private func renderThrowing() throws {
    guard let inventory else { return }
    let items = visible()
    let cardErrors = Dictionary(
      uniqueKeysWithValues: items.compactMap { item -> (String, String)? in
        guard let error = errors[item.occurrenceID(identity: inventory.identity)] else {
          return nil
        }
        return (item.cardID, error)
      })
    try presenter.show(
      items, preview: preferences.preview,
      pending: Set(pending.values.map(\.cardID)), errors: cardErrors,
      stale: !inventory.isFresh(at: now()))
  }
  private func render() {
    do { try renderThrowing() } catch { lastError = "The active reminder card could not appear." }
  }
  func complete(_ item: ActiveReminderCandidate) {
    guard let inventory, inventory.isFresh(at: now()), current(item, inventory: inventory),
      !pending.values.contains(where: { $0.id == item.id })
    else { return }
    let request = UUID().uuidString
    pending[request] = item
    errors[item.occurrenceID(identity: inventory.identity)] = nil
    var payload: [String: Any] = [
      "action": "active_reminder_complete", "requestId": request,
      "serverUrl": inventory.serverUrl, "accountId": inventory.accountId,
      "generation": inventory.generation,
      "kind": item.kind, "id": item.id, "dueAt": item.dueAt,
    ]
    if let revision = item.revision { payload["revision"] = revision }
    if let updatedAt = item.updatedAt { payload["updatedAt"] = updatedAt }
    action?(payload)
    render()
  }
  func actionResult(_ value: [String: Any]) {
    guard let inventory, value["serverUrl"] as? String == inventory.serverUrl,
      value["accountId"] as? String == inventory.accountId,
      (value["generation"] as? NSNumber)?.uint64Value == inventory.generation,
      let request = value["requestId"] as? String, let item = pending.removeValue(forKey: request)
    else { return }
    let id = item.occurrenceID(identity: inventory.identity)
    if current(item, inventory: inventory) {
      if value["outcome"] as? String == "completed" {
        presenter.completed(item)
        acknowledged.insert("\(id)|\(item.sourceRevision)")
        shown.remove(id)
        claimed.remove(id)
        notifications.retireActiveOccurrence(id)
      } else {
        errors[id] =
          value["outcome"] as? String == "conflict"
          ? "This item changed. Refresh it before trying again."
          : "Couldn’t complete this item. Try again."
      }
    }
    action?(["action": "active_reminders_refresh"])
    render()
  }
  func notificationComplete(_ info: [AnyHashable: Any]) {
    guard let inventory,
      let item = inventory.items.first(where: {
        $0.id == info["id"] as? String && $0.kind == info["kind"] as? String
          && $0.dueAt == info["occurrence"] as? String
          && $0.sourceRevision == info["activeSourceRevision"] as? String
      })
    else {
      action?(["action": "active_reminders_refresh"])
      return
    }
    if inventory.isFresh(at: now()) {
      complete(item)
    } else {
      action?(["action": "active_reminders_refresh"])
      open(item)
    }
  }
  private func open(_ item: ActiveReminderCandidate) {
    guard let inventory, current(item, inventory: inventory) else { return }
    action?([
      "action": "open",
      "path": item.kind == "task" ? "/tasks?task=\(item.id)" : "/reminders?reminder=\(item.id)",
    ])
  }
}
