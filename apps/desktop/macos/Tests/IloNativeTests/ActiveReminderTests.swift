import AppKit
import XCTest

@testable import IloNative

final class ActiveReminderTests: XCTestCase {
  func testActiveAt119SecondsAndAwayAt120Seconds() {
    XCTAssertTrue(
      MacActivityState.evaluate(
        inputAge: 119, onConsole: true, loginDone: true, locked: false, displayAwake: true,
        frontmost: "app.fixture"
      ).isActive)
    XCTAssertFalse(
      MacActivityState.evaluate(
        inputAge: 120, onConsole: true, loginDone: true, locked: false, displayAwake: true,
        frontmost: "app.fixture"
      ).isActive)
  }
  func testUnknownOrLockedIsAwayEvenWithRecentInput() {
    for frontmost in [nil, "com.apple.loginwindow"] as [String?] {
      XCTAssertFalse(
        MacActivityState.evaluate(
          inputAge: 0, onConsole: true, loginDone: true, locked: false, displayAwake: true,
          frontmost: frontmost
        ).isActive)
    }
    XCTAssertFalse(
      MacActivityState.evaluate(
        inputAge: 0, onConsole: true, loginDone: true, locked: true, displayAwake: true,
        frontmost: "app.fixture"
      ).isActive)
    XCTAssertFalse(
      MacActivityState.evaluate(
        inputAge: 0, onConsole: true, loginDone: true, locked: false, displayAwake: false,
        frontmost: "app.fixture"
      ).isActive)
    XCTAssertFalse(
      MacActivityState.evaluate(
        inputAge: .infinity, onConsole: true, loginDone: true, locked: false, displayAwake: true,
        frontmost: "app.fixture"
      ).isActive)
  }
  @MainActor
  func testPeriodicRenderDoesNotClampAnInProgressCrossDisplayDrag() throws {
    var pressed = 0
    let presenter = ActiveReminderPanelController(mouseButtons: { pressed })
    defer { presenter.hide() }
    let item = ActiveReminderCandidate(id: "11111111-1111-4111-8111-111111111111",
      kind: "task", title: "Fixture", dueAt: "2026-10-22T12:00:00Z", activeReminder: true, revision: 1)
    try presenter.show([item], selected: nil, preview: true, pending: [], error: nil, stale: false)
    pressed = 1
    let draggedOrigin = CGPoint(x: 10000, y: 10000)
    presenter.panel.setFrameOrigin(draggedOrigin)
    try presenter.show([item], selected: nil, preview: true, pending: [], error: nil, stale: false)
    XCTAssertEqual(presenter.panel.frame.origin, draggedOrigin)
    pressed = 0
    try presenter.show([item], selected: nil, preview: true, pending: [], error: nil, stale: false)
    XCTAssertNotEqual(presenter.panel.frame.origin, draggedOrigin)
  }
  func testOccurrenceChangesWhenDueTimeChanges() throws {
    let a = try JSONDecoder().decode(
      ActiveReminderCandidate.self,
      from: Data(
        #"{"id":"11111111-1111-4111-8111-111111111111","kind":"task","title":"Private","activeReminder":true,"dueAt":"2026-10-22T12:00:00Z","revision":1}"#
          .utf8))
    var b = a
    b.dueAt = "2026-10-23T12:00:00Z"
    XCTAssertNotEqual(
      a.occurrenceID(identity: "server|owner"), b.occurrenceID(identity: "server|owner"))
    XCTAssertNotEqual(
      a.occurrenceID(identity: "server|owner"), a.occurrenceID(identity: "server|other"))
  }
  func testPlacementSnapsAt24PointsAndFitsMissingDisplays() {
    let area = CGRect(x: -1000, y: 0, width: 1000, height: 800)
    let frame = ActiveReminderPlacement.fit(
      CGRect(x: -980, y: 25, width: 360, height: 240), in: area, snap: true)
    XCTAssertEqual(frame.minX, area.minX)
    XCTAssertEqual(frame.minY, 25)
    let moved = ActiveReminderPlacement.fit(
      CGRect(x: 4000, y: 4000, width: 360, height: 240), in: area, snap: false)
    XCTAssertTrue(area.contains(moved))
  }
  func testReceiptsPersistWithoutTitlesAndStorageFailureThrows() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let url = root.appendingPathComponent("receipts.json")
    let store = try ActiveReminderStore(url: url, identity: "fixture")
    try store.markShown("occurrence", at: Date(timeIntervalSince1970: 100))
    XCTAssertTrue(try ActiveReminderStore(url: url, identity: "fixture").contains("occurrence"))
    XCTAssertFalse(try ActiveReminderStore(url: url, identity: "other").contains("occurrence"))
    try FileManager.default.removeItem(at: root)
    try Data().write(to: root)
    XCTAssertThrowsError(try store.markShown("another", at: Date()))
    XCTAssertFalse(store.contains("another"))
  }
}

final class ActiveReminderRoutingTests: XCTestCase {
  func testPrepareOnlyWhenFreshActiveAndWithinTwoSeconds() {
    XCTAssertEqual(
      ActiveReminderDecision.resolve(
        secondsUntilFire: 2, active: true, fresh: true, allowed: true, claimed: false, shown: false),
      .prepare)
    XCTAssertEqual(
      ActiveReminderDecision.resolve(
        secondsUntilFire: 3, active: true, fresh: true, allowed: true, claimed: false, shown: false),
      .wait)
    XCTAssertEqual(
      ActiveReminderDecision.resolve(
        secondsUntilFire: 1, active: true, fresh: false, allowed: true, claimed: false, shown: false
      ), .wait)
  }
  func testReturnShowsOnlyEligibleDueItemsAndQuietHoursDeferReveal() {
    XCTAssertEqual(
      ActiveReminderDecision.resolve(
        secondsUntilFire: -3600, active: true, fresh: true, allowed: true, claimed: false,
        shown: false), .show)
    XCTAssertEqual(
      ActiveReminderDecision.resolve(
        secondsUntilFire: -3600, active: true, fresh: true, allowed: false, claimed: false,
        shown: false), .wait)
    XCTAssertEqual(
      ActiveReminderDecision.resolve(
        secondsUntilFire: -1, active: false, fresh: true, allowed: true, claimed: true, shown: false
      ), .restore)
  }
  func testAlreadyVisibleCardsDoNotDisappearBecauseOfIdleOrStaleFeed() {
    XCTAssertEqual(
      ActiveReminderDecision.resolve(
        secondsUntilFire: -1, active: false, fresh: false, allowed: false, claimed: false,
        shown: true), .wait)
  }
}

private final class ActiveTestSink: ActiveReminderNotificationSink {
  var permission = "authorized"
  var finished: [String] = []
  var retired: [String] = []
  var prepared: [String] = []
  var restores = 0
  var handedOff: [ActiveReminderCandidate] = []
  var holdPreparation = false
  var preparation: ((Result<Void, Error>) -> Void)?
  func ensureActiveOrdinary(
    _ alert: PlannedAlert, item: ActiveReminderCandidate, inventory: ActiveReminderInventory,
    preferences: NotificationPreferences
  ) {}
  func handoffActiveOrdinary(_ alert: PlannedAlert, item: ActiveReminderCandidate,
    inventory: ActiveReminderInventory, preferences: NotificationPreferences) { handedOff.append(item) }
  func takeActiveOwnership(_ id: String) {}
  func prepareActiveFallback(
    _ alert: PlannedAlert, item: ActiveReminderCandidate, inventory: ActiveReminderInventory,
    preferences: NotificationPreferences, completion: @escaping (Result<Void, Error>) -> Void
  ) {
    prepared.append(alert.identifier)
    if holdPreparation { preparation = completion } else { completion(.success(())) }
  }
  func finishActivePresentation(_ id: String) { finished.append(id) }
  func retireActiveOccurrence(_ id: String) { retired.append(id) }
  func restoreActiveOrdinary(
    _ alert: PlannedAlert, item: ActiveReminderCandidate, inventory: ActiveReminderInventory,
    preferences: NotificationPreferences
  ) { restores += 1 }
}
private final class ActiveTestPresenter: ActiveReminderPresenting {
  var isVisible = false
  var items: [ActiveReminderCandidate] = []
  var pending = Set<String>()
  var error: String?
  var stale = false
  func show(
    _ items: [ActiveReminderCandidate], selected: String?, preview: Bool, pending: Set<String>,
    error: String?, stale: Bool
  ) throws {
    self.items = items
    self.pending = pending
    self.error = error
    self.stale = stale
    isVisible = true
  }
  func hide() { isVisible = false }
}
final class ActiveReminderLifecycleTests: XCTestCase {
  @MainActor
  func testFlagOffHandsCurrentSourceToOrdinaryWithoutCancellingItsPendingRequest() throws {
    let time = Date(timeIntervalSince1970: 1_792_670_400)
    let sink = ActiveTestSink(); let panel = ActiveTestPresenter()
    let router = ActiveReminderRouter(notifications: sink, presenter: panel,
      activity: { MacActivityState.evaluate(inputAge: 200, onConsole: true, loginDone: true, locked: false, displayAwake: true, frontmost: "fixture") },
      now: { time }, makeStore: { try ActiveReminderStore(url:
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), identity: $0) },
      startTimer: false)
    var item = ActiveReminderCandidate(id: "11111111-1111-4111-8111-111111111111", kind: "task",
      title: "Old title", dueAt: ISO8601DateFormatter().string(from: time.addingTimeInterval(2)),
      activeReminder: true, revision: 1)
    var inventory = ActiveReminderInventory(serverUrl: "https://app.test", accountId: "a",
      generation: 1, generatedAt: ISO8601DateFormatter().string(from: time), items: [item])
    var preferences = NotificationPreferences(); preferences.enabled = true
    router.configure(preferences: preferences, calendar: .current, enabled: true)
    try router.ingest(inventory)
    item.activeReminder = false; item.revision = 2; item.title = "Current title"
    inventory.items = []; inventory.ordinaryItems = [item]
    try router.ingest(inventory)
    XCTAssertEqual(sink.handedOff, [item])
    XCTAssertTrue(sink.retired.isEmpty)
    XCTAssertFalse(panel.isVisible)
    inventory.ordinaryItems = nil
    try router.ingest(inventory)
    XCTAssertTrue(sink.retired.isEmpty)
  }
  @MainActor
  func testLockAndStaleReturnCannotRevealUntilFreshRefresh() throws {
    var clock = Date(timeIntervalSince1970: 1_792_670_400)
    var state = MacActivityState(isActive: true, isAvailable: true, shouldHide: false)
    let sink = ActiveTestSink()
    let panel = ActiveTestPresenter()
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let router = ActiveReminderRouter(
      notifications: sink, presenter: panel, activity: { state }, now: { clock },
      makeStore: {
        try ActiveReminderStore(url: root.appendingPathComponent("store"), identity: $0)
      }, startTimer: false)
    var preferences = NotificationPreferences()
    preferences.enabled = true
    router.configure(preferences: preferences, calendar: .current, enabled: true)
    let item = ActiveReminderCandidate(
      id: UUID().uuidString, kind: "task", title: "Private",
      dueAt: ISO8601DateFormatter().string(from: clock), activeReminder: true, revision: 1)
    var inventory = ActiveReminderInventory(
      serverUrl: "https://fixture.test", accountId: "owner", generation: 1,
      generatedAt: ISO8601DateFormatter().string(from: clock), items: [item])
    try router.ingest(inventory)
    XCTAssertTrue(panel.isVisible)
    state.shouldHide = true
    state.isActive = false
    router.tick()
    XCTAssertFalse(panel.isVisible)
    clock = clock.addingTimeInterval(21)
    state.shouldHide = false
    state.isActive = true
    router.tick()
    XCTAssertFalse(panel.isVisible)
    inventory.generatedAt = ISO8601DateFormatter().string(from: clock)
    try router.ingest(inventory)
    XCTAssertTrue(panel.isVisible)
    inventory.items = []
    try router.ingest(inventory)
    XCTAssertFalse(panel.isVisible)
    XCTAssertEqual(sink.retired.count, 1)
  }
  @MainActor
  func testCompletionRequiresAcknowledgementAndFencesForeignOrChangedSources() throws {
    let clock = Date()
    let sink = ActiveTestSink()
    let panel = ActiveTestPresenter()
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let router = ActiveReminderRouter(
      notifications: sink, presenter: panel,
      activity: { MacActivityState(isActive: true, isAvailable: true, shouldHide: false) },
      now: { clock },
      makeStore: {
        try ActiveReminderStore(url: root.appendingPathComponent("store"), identity: $0)
      }, startTimer: false)
    var preferences = NotificationPreferences()
    preferences.enabled = true
    router.configure(preferences: preferences, calendar: .current, enabled: true)
    var actions: [[String: Any]] = []
    router.action = { actions.append($0) }
    let item = ActiveReminderCandidate(
      id: UUID().uuidString, kind: "task", title: "Complete",
      dueAt: ISO8601DateFormatter().string(from: clock.addingTimeInterval(-1)),
      activeReminder: true, revision: 2)
    let inventory = ActiveReminderInventory(
      serverUrl: "https://fixture.test", accountId: "owner", generation: 1,
      generatedAt: ISO8601DateFormatter().string(from: clock), items: [item])
    try router.ingest(inventory)
    router.complete(item)
    router.complete(item)
    let submitted = try XCTUnwrap(
      actions.first { $0["action"] as? String == "active_reminder_complete" })
    XCTAssertEqual(
      actions.filter { $0["action"] as? String == "active_reminder_complete" }.count, 1)
    XCTAssertTrue(panel.isVisible)
    XCTAssertTrue(panel.pending.contains(item.id))
    var result = submitted
    result["accountId"] = "other"
    result["outcome"] = "completed"
    router.actionResult(result)
    XCTAssertTrue(panel.isVisible)
    result["accountId"] = "owner"
    result["outcome"] = "failed"
    router.actionResult(result)
    XCTAssertTrue(panel.isVisible)
    XCTAssertNotNil(panel.error)
    router.complete(item)
    var success = try XCTUnwrap(
      actions.last { $0["action"] as? String == "active_reminder_complete" })
    success["outcome"] = "completed"
    router.actionResult(success)
    XCTAssertFalse(panel.isVisible)
    try router.ingest(inventory)
    XCTAssertFalse(panel.isVisible)
  }
}

extension ActiveReminderLifecycleTests {
  @MainActor
  func testCardWaitsForFallbackAcceptanceBeforeCancellingIt() throws {
    var clock = Date()
    let sink = ActiveTestSink()
    sink.holdPreparation = true
    let panel = ActiveTestPresenter()
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let router = ActiveReminderRouter(
      notifications: sink, presenter: panel,
      activity: { MacActivityState(isActive: true, isAvailable: true, shouldHide: false) },
      now: { clock },
      makeStore: {
        try ActiveReminderStore(url: root.appendingPathComponent("store"), identity: $0)
      }, startTimer: false)
    var preferences = NotificationPreferences()
    preferences.enabled = true
    router.configure(preferences: preferences, calendar: .current, enabled: true)
    let due = clock.addingTimeInterval(1)
    let item = ActiveReminderCandidate(
      id: UUID().uuidString, kind: "task", title: "Wait",
      dueAt: ISO8601DateFormatter().string(from: due), activeReminder: true, revision: 1)
    try router.ingest(
      ActiveReminderInventory(
        serverUrl: "https://fixture.test", accountId: "owner", generation: 1,
        generatedAt: ISO8601DateFormatter().string(from: clock), items: [item]))
    XCTAssertEqual(sink.prepared.count, 1)
    clock = clock.addingTimeInterval(2)
    router.tick()
    XCTAssertFalse(panel.isVisible)
    sink.preparation?(.success(()))
    XCTAssertTrue(panel.isVisible)
    XCTAssertEqual(sink.finished.count, 1)
  }
}

extension ActiveReminderLifecycleTests {
  @MainActor
  func testPolicyChangeRevokesPreparationAndRestoresNewQuietHourSchedule() throws {
    let clock = Date()
    let sink = ActiveTestSink()
    sink.holdPreparation = true
    let panel = ActiveTestPresenter()
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let router = ActiveReminderRouter(
      notifications: sink, presenter: panel,
      activity: { MacActivityState(isActive: true, isAvailable: true, shouldHide: false) },
      now: { clock },
      makeStore: {
        try ActiveReminderStore(url: root.appendingPathComponent("store"), identity: $0)
      }, startTimer: false)
    var preferences = NotificationPreferences()
    preferences.enabled = true
    router.configure(preferences: preferences, calendar: .current, enabled: true)
    let item = ActiveReminderCandidate(
      id: UUID().uuidString, kind: "task", title: "Policy",
      dueAt: ISO8601DateFormatter().string(from: clock.addingTimeInterval(1)), activeReminder: true,
      revision: 1)
    try router.ingest(
      ActiveReminderInventory(
        serverUrl: "https://fixture.test", accountId: "owner", generation: 1,
        generatedAt: ISO8601DateFormatter().string(from: clock), items: [item]))
    XCTAssertEqual(sink.prepared.count, 1)
    preferences.quietStart = "00:00"
    preferences.quietEnd = "23:59"
    router.configure(preferences: preferences, calendar: .current, enabled: true)
    XCTAssertEqual(sink.restores, 1)
    sink.preparation?(.success(()))
    XCTAssertFalse(panel.isVisible)
  }
}

extension ActiveReminderTests {
  @MainActor
  func testHeaderDragMovesOnlyItsOwnWindowAndStopsOnRelease() throws {
    _ = NSApplication.shared
    let window = NSPanel(
      contentRect: CGRect(x: 100, y: 100, width: 390, height: 240),
      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    let header = ActiveReminderDragView(frame: CGRect(x: 0, y: 200, width: 390, height: 40))
    XCTAssertTrue(header.acceptsFirstMouse(for: nil))
    window.contentView?.addSubview(header)
    var point = CGPoint(x: 200, y: 200)
    header.pointer = { point }
    let event = try XCTUnwrap(
      NSEvent.mouseEvent(
        with: .leftMouseDown, location: .zero, modifierFlags: [], timestamp: 0,
        windowNumber: window.windowNumber, context: nil, eventNumber: 1, clickCount: 1, pressure: 1)
    )
    header.mouseDown(with: event)
    point = CGPoint(x: 260, y: 230)
    header.mouseDragged(with: event)
    XCTAssertEqual(window.frame.origin, CGPoint(x: 160, y: 130))
    header.mouseUp(with: event)
    point = CGPoint(x: 300, y: 300)
    header.mouseDragged(with: event)
    XCTAssertEqual(window.frame.origin, CGPoint(x: 160, y: 130))
    window.close()
  }
}
