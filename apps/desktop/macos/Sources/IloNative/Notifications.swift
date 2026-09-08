import AppKit
import Darwin
import Foundation
import UserNotifications

/// Serializes OS additions across invalidation. A stale in-flight add is removed before
/// a newer replacement with the same identifier is allowed to reach the OS.
final class NotificationDeliveryQueue {
  private var generation = 0
  private var tail: Task<Void, Never>?
  private let submit: (UNNotificationRequest) async throws -> Void
  private let remove: ([String]) -> Void
  init(
    submit: @escaping (UNNotificationRequest) async throws -> Void,
    remove: @escaping ([String]) -> Void
  ) {
    self.submit = submit
    self.remove = remove
  }
  func invalidate() { generation += 1 }
  func enqueue(
    _ request: UNNotificationRequest, completion: @escaping (Result<Void, Error>) -> Void = { _ in }
  ) {
    let expected = generation
    let preceding = tail
    tail = Task { @MainActor in
      await preceding?.value
      guard expected == self.generation else { return }
      do {
        try await self.submit(request)
        guard expected == self.generation else {
          self.remove([request.identifier])
          return
        }
        completion(.success(()))
      } catch {
        // A failed old-generation submission must not erase the new generation's ledger or outbox.
        guard expected == self.generation else { return }
        completion(.failure(error))
      }
    }
  }
  func drain() async { await tail?.value }
}

struct DeferredNotificationResponses<Response> {
  private(set) var values: [Response] = []
  private(set) var acceptsColdResponses = true
  private(set) var generation = 0
  mutating func append(_ response: Response) -> Bool {
    guard acceptsColdResponses else { return false }
    values = Array((values + [response]).suffix(8))
    return true
  }
  mutating func clear(preservingColdResponses: Bool = false) {
    guard !preservingColdResponses else { return }
    values = []
    acceptsColdResponses = false
    generation += 1
  }
  mutating func takeAfterAuthentication() -> [Response] {
    let pending = values
    values = []
    acceptsColdResponses = true
    return pending
  }
}

struct PendingMailDelivery: Codable, Equatable {
  var arrivalID: String
  var requestID: String
  var server: String
  var userID: String
  var mailAccountID: String
  var title: String
  var path: String
  var fireAt: Date
  var createdAt: Date
  var scheduledAt: Date?
  var identity: String { "\(server)|\(userID)" }
}

/// A bridge mail acknowledgment means its receipt is atomically persisted here.
/// Receipts become scheduled only after the OS accepts the request (or reports it already present).
final class MailDeliveryOutbox {
  let url: URL
  private(set) var receipts: [String: PendingMailDelivery]
  init(url: URL) throws {
    self.url = url
    if FileManager.default.fileExists(atPath: url.path) {
      let data = try Data(contentsOf: url)
      guard data.count <= 4 * 1024 * 1024 else {
        throw NativeError.message("Mail delivery outbox exceeds size limit")
      }
      receipts = try JSONDecoder().decode([String: PendingMailDelivery].self, from: data)
    } else {
      receipts = [:]
    }
  }
  private func save(_ next: [String: PendingMailDelivery]) throws {
    guard next != receipts else { return }
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    let data = try JSONEncoder().encode(next)
    guard data.count <= 4 * 1024 * 1024 else {
      throw NativeError.message("Mail delivery outbox is full")
    }
    try data.write(to: url, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    let descriptor = Darwin.open(url.path, O_RDONLY)
    guard descriptor >= 0 else {
      throw NativeError.message("Could not persist mail delivery receipt")
    }
    defer { Darwin.close(descriptor) }
    guard fsync(descriptor) == 0 else {
      throw NativeError.message("Could not persist mail delivery receipt")
    }
    receipts = next
  }
  func accept(_ receipt: PendingMailDelivery) throws {
    guard receipts[receipt.arrivalID] == nil else { return }
    var next = receipts.filter {
      $0.value.scheduledAt == nil
        || $0.value.createdAt > receipt.createdAt.addingTimeInterval(-30 * 86400)
    }
    if next.count >= 4096,
      let oldest = next.values.filter({ $0.scheduledAt != nil }).min(by: {
        $0.createdAt < $1.createdAt
      })
    {
      next.removeValue(forKey: oldest.arrivalID)
    }
    guard next.count < 4096 else {
      throw NativeError.message("Mail delivery outbox is full; retry after reconciliation")
    }
    next[receipt.arrivalID] = receipt
    try save(next)
  }
  func markScheduled(_ arrivalIDs: [String], at date: Date) throws {
    var next = receipts
    for id in arrivalIDs where next[id] != nil { next[id]?.scheduledAt = date }
    try save(next)
  }
  func prune(identity: String, accountIDs: [String], preview: Bool) throws {
    var next = receipts.filter {
      $0.value.identity == identity && accountIDs.contains($0.value.mailAccountID)
    }
    if !preview { for id in Array(next.keys) { next[id]?.title = "New mail" } }
    try save(next)
  }
  func clear() throws {
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
    receipts = [:]
  }
}

enum PendingNotificationPolicy {
  static func refreshed(
    _ request: UNNotificationRequest, snapshot s: NativeSnapshot,
    preferences p: NotificationPreferences, now: Date
  ) -> UNNotificationRequest? {
    let info = request.content.userInfo
    guard NotificationEligibility.isCurrent(info, snapshot: s, preferences: p, now: now),
      let c = request.content.mutableCopy() as? UNMutableNotificationContent
    else { return nil }
    let kind = info["kind"] as? String ?? ""
    let id = info["id"] as? String ?? ""
    var fire =
      (info["fireAt"] as? Double).map(Date.init(timeIntervalSince1970:))
      ?? (request.trigger as? UNTimeIntervalNotificationTrigger)?.nextTriggerDate()
      ?? (request.trigger as? UNCalendarNotificationTrigger)?.nextTriggerDate()
      ?? now.addingTimeInterval(1)
    if info["snoozed"] as? Bool != true {
      if kind == "event" {
        guard let event = s.events.first(where: { $0.id == id }), !event.allDay,
          let start = parseDate(event.startsAt)
        else { return nil }
        fire = start.addingTimeInterval(-Double(min(max(p.advanceMinutes, 0), 1440)) * 60)
      } else if kind == "task" || kind == "reminder" {
        guard let due = parseDate(info["occurrence"] as? String) else { return nil }
        fire = due
      }
    }
    fire = AlertPlanner.afterQuietHours(
      max(fire, now.addingTimeInterval(1)), preferences: p, calendar: s.calendar)
    if kind == "event", let event = s.events.first(where: { $0.id == id }),
      fire >= (parseDate(event.endsAt) ?? .distantPast)
    {
      return nil
    }
    c.userInfo["fireAt"] = fire.timeIntervalSince1970
    c.sound = p.sound ? .default : nil
    if !p.preview {
      c.title =
        kind == "mail" ? "New mail" : (kind == "event" ? "Upcoming event" : "Due item in ilo")
      c.body = "Open ilo to view details"
    }
    return UNNotificationRequest(
      identifier: request.identifier, content: c,
      trigger: UNTimeIntervalNotificationTrigger(
        timeInterval: max(1, fire.timeIntervalSince(now)), repeats: false))
  }
}

final class NotificationController: NSObject, UNUserNotificationCenterDelegate {
  private let center = UNUserNotificationCenter.current()
  private var revision = 0
  private lazy var deliveryQueue = NotificationDeliveryQueue(
    submit: { [center] request in try await center.add(request) },
    remove: { [center] ids in center.removePendingNotificationRequests(withIdentifiers: ids) })
  private var deferredResponses = DeferredNotificationResponses<UNNotificationResponse>()
  private var outbox: MailDeliveryOutbox?
  private var mailSubmissions = Set<String>()
  private static var outboxURL: URL {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("app.personal-os.desktop/notification-outbox-v1.json")
  }
  private func mailOutbox() throws -> MailDeliveryOutbox {
    if let outbox { return outbox }
    let loaded = try MailDeliveryOutbox(url: Self.outboxURL)
    outbox = loaded
    return loaded
  }
  private var ledger: [String: Double] =
    UserDefaults.standard.dictionary(forKey: "ilo.notificationLedger.v1") as? [String: Double]
    ?? [:]
  var permission = "notDetermined"
  var alertAvailable = false
  var soundAvailable = false
  var lastError: String?
  var snapshot: NativeSnapshot?
  var preferences = NotificationPreferences()
  var onAction: (([String: Any]) -> Void)?
  override init() {
    super.init()
    center.delegate = self
    let open = UNNotificationAction(identifier: "open", title: "Open ilo", options: .foreground)
    let complete = UNNotificationAction(identifier: "complete", title: "Complete", options: [])
    let snooze = UNNotificationAction(identifier: "snooze", title: "Snooze 10 minutes", options: [])
    let join = UNNotificationAction(identifier: "join", title: "Join meeting", options: .foreground)
    center.setNotificationCategories(
      Set([
        UNNotificationCategory(
          identifier: "ilo.task", actions: [open, complete, snooze], intentIdentifiers: []),
        UNNotificationCategory(
          identifier: "ilo.reminder", actions: [open, complete, snooze], intentIdentifiers: []),
        UNNotificationCategory(identifier: "ilo.event", actions: [open], intentIdentifiers: []),
        UNNotificationCategory(
          identifier: "ilo.meeting", actions: [open, join], intentIdentifiers: []),
        UNNotificationCategory(identifier: "ilo.mail", actions: [open], intentIdentifiers: []),
        UNNotificationCategory(identifier: "ilo.summary", actions: [open], intentIdentifiers: []),
      ]))
    refreshPermission()
  }
  func refreshPermission() {
    center.getNotificationSettings { settings in
      DispatchQueue.main.async {
        self.permission =
          settings.authorizationStatus == .notDetermined
          ? "notDetermined" : (settings.authorizationStatus == .denied ? "denied" : "authorized")
        self.alertAvailable = settings.alertSetting == .enabled
        self.soundAvailable = settings.soundSetting == .enabled
      }
    }
  }
  func requestPermission() {
    center.requestAuthorization(options: [.alert, .sound, .badge]) { _, error in
      DispatchQueue.main.async {
        self.lastError = error.map { _ in "macOS could not authorize notifications. Check System Settings → Notifications, or install the signed ilo release." }
        self.refreshPermission()
      }
    }
  }
  func persist() {
    let cutoff = Date().addingTimeInterval(-30 * 86400).timeIntervalSince1970
    ledger = ledger.filter { $0.value > cutoff }
    if ledger.count > 4096 {
      ledger = Dictionary(
        uniqueKeysWithValues: ledger.sorted { $0.value > $1.value }.prefix(4096).map {
          ($0.key, $0.value)
        })
    }
    UserDefaults.standard.set(ledger, forKey: "ilo.notificationLedger.v1")
  }
  func clear(preservingColdResponses: Bool = false) {
    revision += 1
    deliveryQueue.invalidate()
    deferredResponses.clear(preservingColdResponses: preservingColdResponses)
    mailSubmissions = []
    do {
      if let outbox {
        try outbox.clear()
      } else if FileManager.default.fileExists(atPath: Self.outboxURL.path) {
        try FileManager.default.removeItem(at: Self.outboxURL)
      }
    } catch { lastError = error.localizedDescription }
    snapshot = nil
    center.removeAllPendingNotificationRequests()
    center.removeAllDeliveredNotifications()
    ledger = [:]
    persist()
  }
  func reconcile(_ s: NativeSnapshot, preferences p: NotificationPreferences) {
    let privacyChanged = preferences.preview != p.preview
    snapshot = s
    preferences = p
    let responses = deferredResponses.takeAfterAuthentication()
    for response in responses {
      userNotificationCenter(center, didReceive: response, withCompletionHandler: {})
    }
    revision += 1
    deliveryQueue.invalidate()
    mailSubmissions = []
    let expected = revision
    if privacyChanged { center.removeAllDeliveredNotifications() }
    guard p.enabled else {
      clear()
      snapshot = s
      return
    }
    let plan = AlertPlanner.plan(snapshot: s, preferences: p, now: Date())
    center.getPendingNotificationRequests { pending in
      self.center.getDeliveredNotifications { delivered in
        DispatchQueue.main.async {
          guard expected == self.revision else { return }
          let desired = Set(plan.map(\.identifier))
          let preserved = Dictionary(
            uniqueKeysWithValues: pending.compactMap {
              request -> (String, UNNotificationRequest)? in
              guard
                s.stale || request.content.userInfo["snoozed"] as? Bool == true
                  || request.content.categoryIdentifier == "ilo.mail",
                let refreshed = PendingNotificationPolicy.refreshed(
                  request, snapshot: s, preferences: p, now: Date())
              else { return nil }
              return (request.identifier, refreshed)
            })
          let obsolete = pending.filter { request in
            if s.stale || request.content.userInfo["snoozed"] as? Bool == true
              || request.content.categoryIdentifier == "ilo.mail"
            {
              return preserved[request.identifier] == nil
            }
            return !desired.contains(request.identifier)
          }.map(\.identifier)
          self.center.removePendingNotificationRequests(withIdentifiers: obsolete)
          for request in preserved.values { self.enqueue(request) }
          self.center.removeDeliveredNotifications(
            withIdentifiers: delivered.filter { !self.isCurrent($0.request.content.userInfo) }.map {
              $0.request.identifier
            })
          for notification in delivered {
            self.ledger[notification.request.identifier] = notification.date.timeIntervalSince1970
          }
          let pendingByID = Dictionary(uniqueKeysWithValues: pending.map { ($0.identifier, $0) })
          for alert in plan {
            // Replacing an existing pending identifier updates content/sound and scheduling; the ledger only suppresses requests absent from the OS after their due time.
            if pendingByID[alert.identifier] == nil, let fire = self.ledger[alert.identifier],
              fire <= Date().timeIntervalSince1970
            {
              continue
            }
            self.add(alert, snapshot: s, preferences: p)
          }
          self.persist()
          self.retryMail(
            knownIDs: Set(pending.map(\.identifier) + delivered.map { $0.request.identifier }))
        }
      }
    }
  }
  func add(
    _ alert: PlannedAlert, snapshot s: NativeSnapshot, preferences p: NotificationPreferences
  ) {
    let content = UNMutableNotificationContent()
    content.title = alert.title
    content.body = alert.body
    content.categoryIdentifier = alert.conferenceURL == nil ? "ilo.\(alert.kind)" : "ilo.meeting"
    if p.sound { content.sound = .default }
    let occurrence =
      alert.kind == "event"
      ? s.events.first { $0.id == alert.materialID }?.startsAt
      : (alert.kind == "task" ? s.tasks : s.reminders).first { $0.id == alert.materialID }?.dueAt
    content.userInfo = [
      "kind": alert.kind, "id": alert.materialID, "path": alert.path, "serverUrl": s.serverUrl,
      "accountId": s.accountId, "conferenceUrl": alert.conferenceURL ?? "",
      "occurrence": occurrence ?? "", "fireAt": alert.fireAt.timeIntervalSince1970,
    ]
    let request = UNNotificationRequest(
      identifier: alert.identifier, content: content,
      trigger: UNTimeIntervalNotificationTrigger(
        timeInterval: max(1, alert.fireAt.timeIntervalSinceNow), repeats: false))
    enqueue(request, ledgerID: alert.identifier, fireAt: alert.fireAt)
  }
  private func enqueue(
    _ request: UNNotificationRequest, ledgerID: String? = nil, fireAt: Date? = nil,
    completion: @escaping (Result<Void, Error>) -> Void = { _ in }
  ) {
    deliveryQueue.enqueue(request) { result in
      switch result {
      case .success:
        if let ledgerID { self.ledger[ledgerID] = (fireAt ?? Date()).timeIntervalSince1970 }
      case .failure(let error): self.lastError = error.localizedDescription
      }
      self.persist()
      completion(result)
    }
  }

  func mail(
    id: String, title: String, path: String, accountID: String, userID: String, server: String
  ) throws {
    guard let s = snapshot, s.serverUrl == server, s.accountId == userID, preferences.enabled,
      preferences.mail, preferences.mailAccountIds.contains(accountID)
    else { return }
    let identifier = stableID(s.identity, "mail", id)
    guard ledger[identifier] == nil else { return }
    let fire = AlertPlanner.afterQuietHours(
      Date().addingTimeInterval(1), preferences: preferences, calendar: s.calendar)
    let summary = fire.timeIntervalSinceNow > 60
    try mailOutbox().accept(
      PendingMailDelivery(
        arrivalID: identifier,
        requestID: summary
          ? stableID(s.identity, "mail-summary", accountID, fire.timeIntervalSince1970.description)
          : identifier,
        server: server, userID: userID, mailAccountID: accountID,
        title: summary
          ? "New mail in ilo" : (preferences.preview ? String(title.prefix(240)) : "New mail"),
        path: summary ? "/mail" : path, fireAt: fire, createdAt: Date(), scheduledAt: nil))
    // Rust may now durably advance its cursor: retry material survives any scheduling failure or crash.
    refreshMailDelivery()
  }
  private func refreshMailDelivery() {
    let expected = revision
    center.getPendingNotificationRequests { pending in
      self.center.getDeliveredNotifications { delivered in
        DispatchQueue.main.async {
          guard expected == self.revision else { return }
          self.retryMail(
            knownIDs: Set(pending.map(\.identifier) + delivered.map { $0.request.identifier }))
        }
      }
    }
  }
  private func retryMail(knownIDs: Set<String>) {
    guard let s = snapshot, preferences.enabled, preferences.mail else { return }
    do {
      let outbox = try mailOutbox()
      try outbox.prune(
        identity: s.identity, accountIDs: preferences.mailAccountIds, preview: preferences.preview)
      let groups = Dictionary(
        grouping: outbox.receipts.values.filter { $0.scheduledAt == nil }, by: \.requestID)
      for (requestID, arrivals) in groups.sorted(by: { $0.key < $1.key }).prefix(16) {
        guard !mailSubmissions.contains(requestID), let first = arrivals.first else { continue }
        let ids = arrivals.map(\.arrivalID)
        if knownIDs.contains(requestID) {
          try outbox.markScheduled(ids, at: Date())
          continue
        }
        mailSubmissions.insert(requestID)
        let c = UNMutableNotificationContent()
        c.title = preferences.preview ? first.title : "New mail"
        c.body = "Open ilo to view your inbox"
        c.categoryIdentifier = "ilo.mail"
        if preferences.sound { c.sound = .default }
        c.userInfo = [
          "kind": "mail", "id": first.mailAccountID, "path": first.path,
          "serverUrl": first.server, "accountId": first.userID,
        ]
        let fire = AlertPlanner.afterQuietHours(
          max(first.fireAt, Date().addingTimeInterval(1)), preferences: preferences,
          calendar: s.calendar)
        c.userInfo["fireAt"] = fire.timeIntervalSince1970
        let request = UNNotificationRequest(
          identifier: requestID, content: c,
          trigger: UNTimeIntervalNotificationTrigger(
            timeInterval: max(1, fire.timeIntervalSinceNow), repeats: false))
        enqueue(request, ledgerID: requestID, fireAt: fire) { result in
          self.mailSubmissions.remove(requestID)
          if case .success = result {
            do { try outbox.markScheduled(ids, at: Date()) } catch {
              self.lastError = error.localizedDescription
            }
          }
        }
      }
    } catch { lastError = error.localizedDescription }
  }
  func test() throws {
    guard permission == "authorized" else {
      throw NativeError.message("Enable macOS notification permission first")
    }
    let c = UNMutableNotificationContent()
    c.title = "ilo notifications are ready"
    c.body = "Your notification settings are working."
    if preferences.sound { c.sound = .default }
    enqueue(
      UNNotificationRequest(
        identifier: "ilo.test", content: c,
        trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)))
  }
  func isCurrent(_ info: [AnyHashable: Any]) -> Bool {
    guard let snapshot else { return false }
    return NotificationEligibility.isCurrent(
      info, snapshot: snapshot, preferences: preferences, now: Date())
  }
  func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) { completionHandler([.banner, .list, .sound]) }
  func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let responseGeneration = deferredResponses.generation
    DispatchQueue.main.async {
      defer { completionHandler() }
      guard responseGeneration == self.deferredResponses.generation else { return }
      if self.snapshot == nil {
        if self.deferredResponses.append(response) { self.onAction?(["action": "refresh"]) }
        return
      }
      let info = response.notification.request.content.userInfo
      guard self.preferences.enabled, self.isCurrent(info), let s = self.snapshot else {
        self.onAction?(["action": "open", "path": "/today"])
        return
      }
      let kind = info["kind"] as? String ?? ""
      let id = info["id"] as? String ?? ""
      switch response.actionIdentifier {
      case "complete" where ["task", "reminder"].contains(kind):
        self.onAction?([
          "action": "complete", "kind": kind, "id": id, "serverUrl": s.serverUrl,
          "accountId": s.accountId,
        ])
      case "snooze" where ["task", "reminder"].contains(kind):
        guard
          let c = response.notification.request.content.mutableCopy()
            as? UNMutableNotificationContent
        else { return }
        c.userInfo["snoozed"] = true
        let fire = AlertPlanner.afterQuietHours(
          Date().addingTimeInterval(600), preferences: self.preferences, calendar: s.calendar)
        c.userInfo["fireAt"] = fire.timeIntervalSince1970
        self.enqueue(
          UNNotificationRequest(
            identifier: response.notification.request.identifier + ".snooze", content: c,
            trigger: UNTimeIntervalNotificationTrigger(
              timeInterval: max(1, fire.timeIntervalSinceNow), repeats: false))
        )
      case "join":
        guard let event = s.events.first(where: { $0.id == id }),
          let url = validMeetingURL(event.conferenceUrl)
        else { return }
        self.onAction?([
          "action": "join", "url": url.absoluteString, "serverUrl": s.serverUrl,
          "accountId": s.accountId,
        ])
      case UNNotificationDismissActionIdentifier: break
      default: self.onAction?(["action": "open", "path": info["path"] as? String ?? "/today"])
      }
    }
  }
}
