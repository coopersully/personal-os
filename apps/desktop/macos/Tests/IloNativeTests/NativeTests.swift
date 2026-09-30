import UserNotifications
import XCTest

@testable import IloNative

final class NativeTests: XCTestCase {
  let now = parseDate("2026-09-08T16:00:00Z")!
  func snapshot() -> NativeSnapshot {
    NativeSnapshot(
      schemaVersion: 1, serverUrl: "https://api.example.com", accountId: "a",
      generatedAt: "2026-09-08T16:00:00Z", timeZone: "America/New_York", tasks: [], reminders: [],
      events: [], financeSummary: "$100 remaining", stale: false)
  }
  func item(_ id: String, _ due: String?, completed: Bool = false) -> WorkItem {
    WorkItem(
      id: id, title: "Private title", dueAt: due, status: completed ? "completed" : "next",
      completedAt: completed ? "2026-09-08T10:00:00Z" : nil)
  }
  func testTodaySurvivesAmbientHistoryLimit() {
    var s = snapshot()
    s.tasks = (0..<150).map { item("old-\($0)", "2026-09-01T12:00:00Z") }
    s.tasks.append(item("today", "2026-09-08T18:00:00Z"))
    let filtered = s.filtered(workspaces: ["tasks"], now: now)
    XCTAssertEqual(filtered.tasks.count, 100)
    XCTAssertEqual(filtered.dueToday(filtered.tasks, now: now).map(\.id), ["today"])
  }
  func testCanonicalServerIsolation() throws {
    XCTAssertEqual(try canonicalOrigin("https://API.EXAMPLE.com:443/"), "https://api.example.com")
    XCTAssertEqual(try canonicalOrigin("http://localhost:8787"), "http://localhost:8787")
    for raw in [
      "http://example.com", "https://me:password@example.com", "https://example.com/v1",
      "https://example.com?q=x", "file:///tmp",
    ] { XCTAssertThrowsError(try canonicalOrigin(raw)) }
  }
  func testTodayIncludesEarlierTodaySeparatelyFromOverdue() {
    var s = snapshot()
    s.reminders = [
      item("early", "2026-09-08T10:00:00Z"), item("previous", "2026-09-08T02:00:00Z"),
      item("later", "2026-09-08T23:00:00Z"), item("done", "2026-09-08T15:00:00Z", completed: true),
    ]
    XCTAssertEqual(s.dueToday(s.reminders, now: now).map(\.id), ["early", "later"])
    XCTAssertEqual(s.overdue(s.reminders, now: now).map(\.id), ["previous"])
  }
  func testPlannerFiltersAndBounds() {
    var s = snapshot()
    var p = NotificationPreferences()
    p.enabled = true
    s.tasks =
      [
        item("none", nil), item("done", "2026-09-08T17:00:00Z", completed: true),
        item("overdue", "2026-09-07T17:00:00Z"),
      ] + (0..<100).map { item("t\($0)", "2026-09-08T17:00:00Z") }
    let plan = AlertPlanner.plan(snapshot: s, preferences: p, now: now)
    XCTAssertEqual(plan.count, 48)
    XCTAssertTrue(plan.contains { $0.kind == "summary" })
    XCTAssertFalse(plan.contains { $0.materialID == "done" || $0.materialID == "none" })
    XCTAssertFalse(plan.contains { $0.title == "Private title" })
    p.enabled = false
    XCTAssertEqual(AlertPlanner.plan(snapshot: s, preferences: p, now: now), [])
  }
  func testIdentityAndOccurrenceChangeRequestID() {
    var s = snapshot()
    var p = NotificationPreferences()
    p.enabled = true
    s.tasks = [item("t", "2026-09-08T17:00:00Z")]
    let first = AlertPlanner.plan(snapshot: s, preferences: p, now: now)[0].identifier
    s.accountId = "b"
    XCTAssertNotEqual(first, AlertPlanner.plan(snapshot: s, preferences: p, now: now)[0].identifier)
    s.accountId = "a"
    s.tasks[0].dueAt = "2026-09-08T18:00:00Z"
    XCTAssertNotEqual(first, AlertPlanner.plan(snapshot: s, preferences: p, now: now)[0].identifier)
  }
  func testQuietHoursCrossMidnightAndDST() {
    var p = NotificationPreferences()
    p.quietStart = "22:00"
    p.quietEnd = "07:00"
    let c = snapshot().calendar
    XCTAssertEqual(
      AlertPlanner.afterQuietHours(parseDate("2026-09-09T03:00:00Z")!, preferences: p, calendar: c),
      parseDate("2026-09-09T11:00:00Z"))
    p.quietEnd = "02:30"
    XCTAssertEqual(
      AlertPlanner.afterQuietHours(parseDate("2026-03-08T06:00:00Z")!, preferences: p, calendar: c),
      parseDate("2026-03-08T07:00:00Z"))
    p.quietStart = "bad"
    XCTAssertEqual(AlertPlanner.afterQuietHours(now, preferences: p, calendar: c), now)
  }
  func testCalendarFilteringAndQuietExpiry() {
    var s = snapshot()
    var p = NotificationPreferences()
    p.enabled = true
    p.quietStart = "11:00"
    p.quietEnd = "14:00"
    s.events = [
      CalendarItem(
        id: "e", title: "Meeting", startsAt: "2026-09-08T16:05:00Z", endsAt: "2026-09-08T17:00:00Z",
        allDay: false, conferenceUrl: "https://meet.example.com/a", calendarId: "c",
        status: "confirmed")
    ]
    XCTAssertEqual(AlertPlanner.plan(snapshot: s, preferences: p, now: now), [])
    p.quietStart = nil
    XCTAssertEqual(AlertPlanner.plan(snapshot: s, preferences: p, now: now).count, 1)
    p.calendarIds = ["other"]
    XCTAssertEqual(AlertPlanner.plan(snapshot: s, preferences: p, now: now), [])
    p.calendarIds = []
    s.events[0].allDay = true
    XCTAssertEqual(AlertPlanner.plan(snapshot: s, preferences: p, now: now), [])
  }
  func testPrivacyAndNoFabricatedFinance() throws {
    var s = snapshot()
    s.tasks = [item("t", "2026-09-08T17:00:00Z")]
    let filtered = s.filtered(workspaces: ["reminders"])
    XCTAssertNil(filtered.financeSummary)
    XCTAssertEqual(filtered.tasks.count, 0)
    let json = String(decoding: try JSONEncoder().encode(filtered), as: UTF8.self)
    XCTAssertFalse(json.contains("Private title"))
    XCTAssertFalse(json.contains("$100"))
    XCTAssertFalse(json.contains("token"))
  }
  func testStaleSnapshotAndInvalidMeetingURL() {
    var s = snapshot()
    s.stale = true
    s.tasks = [item("t", "2026-09-08T17:00:00Z")]
    var p = NotificationPreferences()
    p.enabled = true
    XCTAssertEqual(AlertPlanner.plan(snapshot: s, preferences: p, now: now), [])
    XCTAssertNil(validMeetingURL("javascript:alert(1)"))
    XCTAssertNil(validMeetingURL("https://user:pass@example.com"))
    XCTAssertNotNil(validMeetingURL("https://meet.example.com"))
  }
  func testDisplayPositionClamping() {
    let frame = NSRect(x: -1920, y: 0, width: 1920, height: 1080)
    XCTAssertEqual(
      PetController.clamped(
        NSPoint(x: 2000, y: -30), to: frame, size: NSSize(width: 72, height: 72)),
      NSPoint(x: -72, y: 0))
  }
  func testEnabledPetDoesNotRequireAnAuthenticatedSnapshot() {
    XCTAssertTrue(petShouldBeVisible(enabled: true, hasSnapshot: false))
    XCTAssertFalse(petShouldBeVisible(enabled: false, hasSnapshot: true))
  }
  func testEventDeduplicationAcrossGroups() {
    var s = snapshot()
    let e = CalendarItem(
      id: "e", title: "Meeting", startsAt: "2026-09-08T16:05:00Z", endsAt: "2026-09-08T17:00:00Z",
      allDay: false, conferenceUrl: nil, calendarId: "c", status: "confirmed")
    s.events = [e, e]
    XCTAssertEqual(s.todayEvents(now: now).count, 1)
  }
  func testStaleNotificationIdentityAndRescheduledOccurrence() {
    var s = snapshot()
    var p = NotificationPreferences()
    p.enabled = true
    s.tasks = [item("t", "2026-09-08T17:00:00Z")]
    var info: [AnyHashable: Any] = [
      "serverUrl": s.serverUrl, "accountId": s.accountId, "kind": "task", "id": "t",
      "occurrence": "2026-09-08T17:00:00Z",
    ]
    XCTAssertTrue(NotificationEligibility.isCurrent(info, snapshot: s, preferences: p, now: now))
    info["accountId"] = "other"
    XCTAssertFalse(NotificationEligibility.isCurrent(info, snapshot: s, preferences: p, now: now))
    info["accountId"] = s.accountId
    s.tasks[0].dueAt = "2026-09-08T18:00:00Z"
    XCTAssertFalse(NotificationEligibility.isCurrent(info, snapshot: s, preferences: p, now: now))
    s.tasks[0].dueAt = "2026-09-08T17:00:00Z"
    s.tasks[0].status = "cancelled"
    XCTAssertFalse(NotificationEligibility.isCurrent(info, snapshot: s, preferences: p, now: now))
  }
  func testWidgetSelectionIsIndependentAndBackwardsCompatible() throws {
    let json =
      ##"{"serverUrl":"https://api.example.com","launchAtLogin":false,"petEnabled":false,"petColor":"#00aabb","petWorkspaces":["finances"],"notifications":{"enabled":false,"tasks":true,"reminders":true,"calendar":true,"mail":false,"advanceMinutes":10,"sound":true,"preview":false,"mailAccountIds":[],"calendarIds":[]}}"##
    let settings = try JSONDecoder().decode(NativeSettings.self, from: Data(json.utf8))
    XCTAssertNil(settings.widgetWorkspaces)
    XCTAssertNil(
      snapshot().filtered(
        workspaces: settings.widgetWorkspaces ?? ["tasks", "reminders", "calendar"]
      ).financeSummary)
  }
}

// These tests use the production queue and filesystem lock; only the OS scheduler and
// Keychain calls are injected, allowing failures to land at exact suspension points.
@MainActor
private final class ControlledNotificationScheduler {
  var pending: [String: String] = [:]
  var continuations: [String: CheckedContinuation<Void, Error>] = [:]
  var started: ((String) -> Void)?
  var log: [String] = []
  func submit(_ request: UNNotificationRequest) async throws {
    let title = request.content.title
    log.append("start:\(title)")
    try await withCheckedThrowingContinuation { continuation in
      continuations[title] = continuation
      started?(title)
    }
    pending[request.identifier] = title
    log.append("accepted:\(title)")
  }
  func finish(_ title: String, failure: Bool = false) {
    let continuation = continuations.removeValue(forKey: title)!
    if failure {
      continuation.resume(throwing: NativeError.message("Injected scheduling failure"))
    } else {
      continuation.resume()
    }
  }
  func remove(_ ids: [String]) {
    for id in ids {
      pending.removeValue(forKey: id)
      log.append("remove:\(id)")
    }
  }
}

extension NativeTests {
  private func temporaryStore() throws -> (URL, WidgetSnapshotFileStore) {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    addTeardownBlock { try FileManager.default.removeItem(at: directory) }
    return (directory, WidgetSnapshotFileStore(container: directory))
  }
  private func request(_ title: String, id: String = "same") -> UNNotificationRequest {
    let c = UNMutableNotificationContent()
    c.title = title
    return UNNotificationRequest(
      identifier: id, content: c,
      trigger: UNTimeIntervalNotificationTrigger(timeInterval: 60, repeats: false))
  }
  @MainActor
  func testInFlightOldAddCannotDeleteSameIDReplacementAfterClear() async {
    let scheduler = ControlledNotificationScheduler()
    let queue = NotificationDeliveryQueue(submit: scheduler.submit, remove: scheduler.remove)
    let oldStarted = expectation(description: "Old OS submission is in flight")
    let newStarted = expectation(description: "Replacement starts after stale cleanup")
    scheduler.started = { title in (title == "old" ? oldStarted : newStarted).fulfill() }
    var oldCompletionRan = false
    queue.enqueue(request("old")) { _ in oldCompletionRan = true }
    await fulfillment(of: [oldStarted], timeout: 2)
    queue.invalidate()
    scheduler.remove(["same"])
    queue.enqueue(request("new"))
    scheduler.finish("old")
    await fulfillment(of: [newStarted], timeout: 2)
    XCTAssertNil(scheduler.pending["same"])
    scheduler.finish("new")
    await queue.drain()
    XCTAssertEqual(scheduler.pending["same"], "new")
    XCTAssertFalse(oldCompletionRan)
    XCTAssertEqual(
      scheduler.log,
      ["start:old", "remove:same", "accepted:old", "remove:same", "start:new", "accepted:new"])
  }
  @MainActor
  func testStaleFailureAndSkippedSubmissionCannotEraseNewReceipt() async {
    let scheduler = ControlledNotificationScheduler()
    let queue = NotificationDeliveryQueue(submit: scheduler.submit, remove: scheduler.remove)
    let oldStarted = expectation(description: "Old submit")
    let replacementStarted = expectation(description: "Current submit")
    scheduler.started = { title in (title == "old" ? oldStarted : replacementStarted).fulfill() }
    var receipt = "new"
    queue.enqueue(request("old")) { _ in receipt = "erased by old failure" }
    await fulfillment(of: [oldStarted], timeout: 2)
    queue.enqueue(request("skipped")) { _ in receipt = "erased by skipped generation" }
    queue.invalidate()
    queue.enqueue(request("replacement"))
    scheduler.finish("old", failure: true)
    await fulfillment(of: [replacementStarted], timeout: 2)
    scheduler.finish("replacement")
    await queue.drain()
    XCTAssertEqual(receipt, "new")
    XCTAssertFalse(scheduler.log.contains("start:skipped"))
    XCTAssertEqual(scheduler.pending["same"], "replacement")
  }
  @MainActor
  func testQuietMailOutboxSurvivesFailedSummaryAndRetriesAfterReload() async throws {
    let (directory, _) = try temporaryStore()
    let url = directory.appendingPathComponent("outbox.json")
    let outbox = try MailDeliveryOutbox(url: url)
    for id in ["arrival-1", "arrival-2"] {
      try outbox.accept(
        PendingMailDelivery(
          arrivalID: id, requestID: "summary", server: "https://api.example.com",
          userID: "a", mailAccountID: "inbox", title: "New mail", path: "/mail", fireAt: now,
          createdAt: now, scheduledAt: nil))
    }
    let scheduler = ControlledNotificationScheduler()
    let queue = NotificationDeliveryQueue(submit: scheduler.submit, remove: scheduler.remove)
    let failedStart = expectation(description: "Summary scheduling attempt")
    scheduler.started = { _ in failedStart.fulfill() }
    queue.enqueue(request("attempt", id: "summary")) { result in
      if case .success = result {
        try! outbox.markScheduled(["arrival-1", "arrival-2"], at: self.now)
      }
    }
    await fulfillment(of: [failedStart], timeout: 2)
    scheduler.finish("attempt", failure: true)
    await queue.drain()
    let reloaded = try MailDeliveryOutbox(url: url)
    XCTAssertEqual(reloaded.receipts.count, 2)
    XCTAssertTrue(reloaded.receipts.values.allSatisfy { $0.scheduledAt == nil })
    let retryStart = expectation(description: "Durable summary retry")
    scheduler.started = { _ in retryStart.fulfill() }
    queue.enqueue(request("retry", id: "summary")) { result in
      if case .success = result {
        try! reloaded.markScheduled(["arrival-1", "arrival-2"], at: self.now)
      }
    }
    await fulfillment(of: [retryStart], timeout: 2)
    scheduler.finish("retry")
    await queue.drain()
    XCTAssertTrue(
      try MailDeliveryOutbox(url: url).receipts.values.allSatisfy { $0.scheduledAt != nil })
    XCTAssertEqual(scheduler.pending["summary"], "retry")
  }
  func testOutboxPrunesOtherIdentityAndScrubsDisabledPreviews() throws {
    let (directory, _) = try temporaryStore()
    let url = directory.appendingPathComponent("outbox.json")
    let outbox = try MailDeliveryOutbox(url: url)
    for (id, user, mailbox) in [
      ("keep", "a", "selected"), ("old-user", "b", "selected"), ("disabled", "a", "disabled"),
    ] {
      try outbox.accept(
        PendingMailDelivery(
          arrivalID: id, requestID: id, server: "https://api.example.com", userID: user,
          mailAccountID: mailbox, title: "Private subject", path: "/mail", fireAt: now,
          createdAt: now, scheduledAt: nil))
    }
    try outbox.prune(identity: snapshot().identity, accountIDs: ["selected"], preview: false)
    let restored = try MailDeliveryOutbox(url: url)
    XCTAssertEqual(Set(restored.receipts.keys), ["keep"])
    XCTAssertEqual(restored.receipts["keep"]?.title, "New mail")
    XCTAssertNil(restored.receipts["keep"]?.scheduledAt)
  }
  func testOutboxPersistenceFailureDoesNotAcknowledgeArrival() throws {
    let (directory, _) = try temporaryStore()
    let notDirectory = directory.appendingPathComponent("file")
    try Data("block".utf8).write(to: notDirectory)
    let outbox = try MailDeliveryOutbox(url: notDirectory.appendingPathComponent("outbox.json"))
    let receipt = PendingMailDelivery(
      arrivalID: "a", requestID: "r", server: "https://api.example.com",
      userID: "u", mailAccountID: "m", title: "New mail", path: "/mail", fireAt: now,
      createdAt: now, scheduledAt: nil)
    XCTAssertThrowsError(try outbox.accept(receipt))
    XCTAssertTrue(outbox.receipts.isEmpty)
  }
  func testRevokedWidgetSessionDoesNotClearReplacementAccountOrToken() throws {
    let (_, store) = try temporaryStore()
    let original = snapshot()
    var replacement = original
    replacement.accountId = "new-account"
    try store.write(replacement)
    var credential = "new-token"
    XCTAssertFalse(
      try store.invalidateRevokedSession(
        identity: original.identity, rejectedToken: "old-token",
        readCredential: { credential }, deleteCredential: { credential = "" }))
    XCTAssertEqual(store.read()?.identity, replacement.identity)
    try store.write(original)
    XCTAssertFalse(
      try store.invalidateRevokedSession(
        identity: original.identity, rejectedToken: "old-token",
        readCredential: { credential }, deleteCredential: { credential = "" }))
    XCTAssertEqual(store.read()?.identity, original.identity)
    credential = "old-token"
    XCTAssertTrue(
      try store.invalidateRevokedSession(
        identity: original.identity, rejectedToken: "old-token",
        readCredential: { credential }, deleteCredential: { credential = "" }))
    XCTAssertNil(store.read())
    XCTAssertEqual(credential, "")
  }
  func testSharedLockSerializesRevocationBeforeNewLoginAndSnapshot() async throws {
    let (_, store) = try temporaryStore()
    let original = snapshot()
    var replacement = original
    replacement.accountId = "replacement"
    try store.write(original)
    let revocationLocked = expectation(description: "Revocation owns shared lock")
    let revocationDone = expectation(description: "Revocation finished")
    let loginDone = expectation(description: "New login writes after revocation")
    let loginAttempted = expectation(description: "New login attempts the occupied lock")
    let writerEnteredLock = DispatchSemaphore(value: 0)
    let resumeRevocation = DispatchSemaphore(value: 0)
    var token = "old"
    DispatchQueue.global().async {
      do {
        try store.invalidateRevokedSession(
          identity: original.identity, rejectedToken: "old",
          readCredential: {
            revocationLocked.fulfill()
            _ = resumeRevocation.wait(timeout: .now() + 3)
            return token
          }, deleteCredential: { token = "" })
      } catch { XCTFail("Revocation failed: \(error)") }
      revocationDone.fulfill()
    }
    await fulfillment(of: [revocationLocked], timeout: 2)
    DispatchQueue.global().async {
      loginAttempted.fulfill()
      do {
        try store.locked {
          writerEnteredLock.signal()
          token = "new"
        }
        try store.write(replacement)
      } catch { XCTFail("Replacement login failed: \(error)") }
      loginDone.fulfill()
    }
    await fulfillment(of: [loginAttempted], timeout: 2)
    XCTAssertEqual(writerEnteredLock.wait(timeout: .now() + 0.05), .timedOut)
    resumeRevocation.signal()
    await fulfillment(of: [revocationDone, loginDone], timeout: 3)
    XCTAssertEqual(token, "new")
    XCTAssertEqual(store.read()?.identity, replacement.identity)
  }
  func testColdResponseQueueCannotResurrectAfterLogoutAndSameAccountLogin() {
    var queue = DeferredNotificationResponses<String>()
    let oldGeneration = queue.generation
    XCTAssertTrue(queue.append("complete task"))
    queue.clear(preservingColdResponses: true)
    XCTAssertEqual(queue.values, ["complete task"])
    XCTAssertEqual(queue.generation, oldGeneration)
    queue.clear()
    XCTAssertFalse(queue.append("late old callback"))
    XCTAssertEqual(queue.takeAfterAuthentication(), [])
    XCTAssertNotEqual(oldGeneration, queue.generation)
    XCTAssertTrue(queue.append("new authenticated action"))
    XCTAssertEqual(queue.takeAfterAuthentication(), ["new authenticated action"])
  }
  func testStalePendingRequestsHonorSelectionPrivacyAndQuietHourChanges() {
    var s = snapshot()
    s.stale = true
    s.tasks = [item("t", "2026-09-08T17:00:00Z")]
    var p = NotificationPreferences()
    p.enabled = true
    p.sound = false
    p.quietStart = "12:00"
    p.quietEnd = "14:00"
    let content = UNMutableNotificationContent()
    content.title = "Private title"
    content.sound = .default
    content.userInfo = [
      "serverUrl": s.serverUrl, "accountId": s.accountId, "kind": "task", "id": "t",
      "occurrence": "2026-09-08T17:00:00Z",
    ]
    let request = UNNotificationRequest(
      identifier: "task", content: content,
      trigger: UNTimeIntervalNotificationTrigger(timeInterval: 60, repeats: false))
    let refreshed = PendingNotificationPolicy.refreshed(
      request, snapshot: s, preferences: p, now: now)
    XCTAssertNil(refreshed?.content.sound)
    XCTAssertEqual(refreshed?.content.title, "Due item in nohmi")
    XCTAssertEqual((refreshed?.trigger as? UNTimeIntervalNotificationTrigger)?.timeInterval, 7200)
    p.tasks = false
    XCTAssertNil(
      PendingNotificationPolicy.refreshed(request, snapshot: s, preferences: p, now: now))
    p.tasks = true
    s.accountId = "other"
    XCTAssertNil(
      PendingNotificationPolicy.refreshed(request, snapshot: s, preferences: p, now: now))
  }
  func testStaleMeetingPendingIsRemovedWhenQuietHoursOutlastMeeting() {
    var s = snapshot()
    s.stale = true
    s.events = [
      CalendarItem(
        id: "e", title: "Meeting", startsAt: "2026-09-08T16:30:00Z", endsAt: "2026-09-08T17:00:00Z",
        allDay: false, conferenceUrl: nil, calendarId: "selected", status: "confirmed")
    ]
    var p = NotificationPreferences()
    p.enabled = true
    let c = UNMutableNotificationContent()
    c.userInfo = [
      "serverUrl": s.serverUrl, "accountId": s.accountId,
      "kind": "event", "id": "e", "occurrence": "2026-09-08T16:30:00Z",
    ]
    let request = UNNotificationRequest(identifier: "e", content: c, trigger: nil)
    XCTAssertNotNil(
      PendingNotificationPolicy.refreshed(request, snapshot: s, preferences: p, now: now))
    p.calendarIds = ["other"]
    XCTAssertNil(
      PendingNotificationPolicy.refreshed(request, snapshot: s, preferences: p, now: now))
    p.calendarIds = []
    p.quietStart = "12:00"
    p.quietEnd = "14:00"
    XCTAssertNil(
      PendingNotificationPolicy.refreshed(request, snapshot: s, preferences: p, now: now))
  }
}
