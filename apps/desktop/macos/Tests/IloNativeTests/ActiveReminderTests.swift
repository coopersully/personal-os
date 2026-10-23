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
    let item = ActiveReminderCandidate(
      id: "11111111-1111-4111-8111-111111111111",
      kind: "task", title: "Fixture", dueAt: "2026-10-22T12:00:00Z", activeReminder: true,
      revision: 1)
    try presenter.show([item], preview: true, pending: [], errors: [:], stale: false)
    pressed = 1
    let draggedOrigin = CGPoint(x: 10000, y: 10000)
    presenter.panels[item.cardID]!.setFrameOrigin(draggedOrigin)
    try presenter.show([item], preview: true, pending: [], errors: [:], stale: false)
    XCTAssertEqual(presenter.panels[item.cardID]!.frame.origin, draggedOrigin)
    pressed = 0
    try presenter.show([item], preview: true, pending: [], errors: [:], stale: false)
    XCTAssertNotEqual(presenter.panels[item.cardID]!.frame.origin, draggedOrigin)
  }
  @MainActor
  func testEveryItemHasItsOwnVisibleMovableResizablePanel() throws {
    let presenter = ActiveReminderPanelController()
    defer { presenter.reset() }
    let items = (1...3).map { index in
      ActiveReminderCandidate(
        id: "00000000-0000-4000-8000-00000000000\(index)", kind: index == 2 ? "reminder" : "task",
        title: "Item \(index)", dueAt: "2026-10-22T12:00:00Z", activeReminder: true,
        revision: index == 2 ? nil : 1, updatedAt: index == 2 ? "2026-10-22T11:00:00Z" : nil)
    }
    try presenter.show(items, preview: true, pending: [], errors: [:], stale: false)
    XCTAssertEqual(presenter.panels.count, 3)
    let first = try XCTUnwrap(presenter.panels[items[0].cardID])
    let second = try XCTUnwrap(presenter.panels[items[1].cardID])
    XCTAssertTrue(
      presenter.panels.values.allSatisfy { $0.isVisible && $0.styleMask.contains(.resizable) })
    XCTAssertFalse(first.frame.intersects(second.frame))
    let content = try XCTUnwrap(first.contentView)
    content.layoutSubtreeIfNeeded()
    let gripPoint = CGPoint(
      x: content.bounds.maxX - 8,
      y: content.isFlipped ? content.bounds.maxY - 8 : 8)
    XCTAssertTrue(content.hitTest(gripPoint) is ActiveReminderResizeView)
    let innerGrip = CGPoint(
      x: content.bounds.maxX - 22,
      y: content.isFlipped ? content.bounds.maxY - 22 : 22)
    XCTAssertTrue(content.hitTest(innerGrip) is ActiveReminderResizeView)
    let headerPoint = CGPoint(
      x: content.bounds.midX,
      y: content.isFlipped ? 4 : content.bounds.maxY - 4)
    XCTAssertTrue(content.hitTest(headerPoint) is ActiveReminderDragView)
    XCTAssertTrue(
      content.hitTest(CGPoint(x: content.bounds.midX, y: content.bounds.midY))
        is ActiveReminderDragView)
    XCTAssertTrue(
      content.hitTest(CGPoint(x: 18, y: content.bounds.maxY - 18))
        is ActiveReminderDragView, "Checkbox accepts drag without completing")
    let secondFrame = second.frame
    first.setContentSize(NSSize(width: 370, height: 130))
    let resized = first.frame
    try presenter.show(
      Array(items.reversed()), preview: true, pending: [], errors: [:], stale: false)
    XCTAssertEqual(first.frame.size, resized.size)
    XCTAssertEqual(second.frame, secondFrame)
    try presenter.show(
      Array(items.dropFirst()), preview: true, pending: [], errors: [:], stale: false)
    XCTAssertNil(presenter.panels[items[0].cardID])
    XCTAssertTrue(presenter.panels[items[1].cardID] === second)
    XCTAssertEqual(second.frame, secondFrame)
    presenter.hide()
    XCTAssertTrue(presenter.panels.values.allSatisfy { !$0.isVisible })
  }
  func testCardGeometryPersistsIndependentlyAndReadsLegacyStore() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let url = root.appendingPathComponent("store.json")
    try Data(#"{"identity":"owner","receipts":{},"placements":{"display":{"x":0.2,"y":0.3}}}"#.utf8)
      .write(to: url)
    let store = try ActiveReminderStore(url: url, identity: "owner")
    try store.saveCardPlacement(
      card: "task:one", display: "display",
      geometry: ActiveReminderCardGeometry(x: 0.1, y: 0.2, width: 310, height: 100))
    try store.saveCardPlacement(
      card: "reminder:two", display: "display",
      geometry: ActiveReminderCardGeometry(x: 0.8, y: 0.9, width: 400, height: 160))
    let loaded = try ActiveReminderStore(url: url, identity: "owner")
    XCTAssertEqual(loaded.cardDisplay(card: "task:one"), "display")
    XCTAssertEqual(loaded.cardPlacement(card: "task:one", display: "display")?.width, 310)
    XCTAssertEqual(loaded.cardPlacement(card: "reminder:two", display: "display")?.height, 160)
    XCTAssertNil(
      try ActiveReminderStore(url: url, identity: "other").cardPlacement(
        card: "task:one", display: "display"))
  }
  @MainActor
  func testResizeGripKeepsTopLeftAndHonorsMinimumSize() throws {
    _ = NSApplication.shared
    let window = NSPanel(
      contentRect: CGRect(x: 100, y: 100, width: 320, height: 88),
      styleMask: [.borderless, .nonactivatingPanel, .resizable], backing: .buffered, defer: false)
    defer { window.close() }
    window.contentMinSize = NSSize(width: 240, height: 72)
    let grip = ActiveReminderResizeView(frame: CGRect(x: 300, y: 0, width: 16, height: 16))
    window.contentView?.addSubview(grip)
    var point = CGPoint(x: 400, y: 100)
    grip.pointer = { _ in point }
    let event = try XCTUnwrap(
      NSEvent.mouseEvent(
        with: .leftMouseDown, location: .zero,
        modifierFlags: [], timestamp: 0, windowNumber: window.windowNumber, context: nil,
        eventNumber: 1, clickCount: 1, pressure: 1))
    grip.mouseDown(with: event)
    point = CGPoint(x: 450, y: 50)
    grip.mouseDragged(with: event)
    XCTAssertEqual(window.frame, CGRect(x: 100, y: 50, width: 370, height: 138))
    point = CGPoint(x: 0, y: 400)
    grip.mouseDragged(with: event)
    XCTAssertEqual(window.frame.width, 240)
    XCTAssertEqual(window.frame.height, 72)
    XCTAssertEqual(window.frame.maxY, 188)
    grip.mouseUp(with: event)
    point = .zero
    grip.mouseDragged(with: event)
    XCTAssertEqual(window.frame.width, 240)
  }
  @MainActor
  func testResizeUsesEventCoordinatesRatherThanTheLaterGlobalCursor() throws {
    _ = NSApplication.shared
    let window = NSPanel(
      contentRect: CGRect(x: 100, y: 100, width: 320, height: 88),
      styleMask: [.borderless, .nonactivatingPanel, .resizable], backing: .buffered, defer: false)
    defer { window.close() }
    window.contentMinSize = NSSize(width: 240, height: 72)
    let grip = ActiveReminderResizeView(frame: CGRect(x: 300, y: 0, width: 16, height: 16))
    window.contentView?.addSubview(grip)
    func event(_ point: CGPoint) throws -> NSEvent {
      try XCTUnwrap(
        NSEvent.mouseEvent(
          with: .leftMouseDown, location: point,
          modifierFlags: [], timestamp: 0, windowNumber: window.windowNumber, context: nil,
          eventNumber: 1, clickCount: 1, pressure: 1))
    }
    grip.mouseDown(with: try event(CGPoint(x: 310, y: 8)))
    grip.mouseDragged(with: try event(CGPoint(x: 350, y: -22)))
    XCTAssertEqual(window.frame, CGRect(x: 100, y: 70, width: 360, height: 118))
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
  func testPlacementFitsMissingDisplaysInsideSafeGeometry() {
    let area = CGRect(x: -1000, y: 0, width: 1000, height: 800)
    let frame = ActiveReminderPlacement.fit(
      CGRect(x: -980, y: 25, width: 360, height: 240),
      geometry: PetGeometry(bounds: area, obstacles: []))
    XCTAssertEqual(frame.minX, -980)
    XCTAssertEqual(frame.minY, 25)
    let moved = ActiveReminderPlacement.fit(
      CGRect(x: 4000, y: 4000, width: 360, height: 240),
      geometry: PetGeometry(bounds: area, obstacles: []))
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
  func handoffActiveOrdinary(
    _ alert: PlannedAlert, item: ActiveReminderCandidate,
    inventory: ActiveReminderInventory, preferences: NotificationPreferences
  ) { handedOff.append(item) }
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
  var completedIDs: [String] = []
  var soundEnabled = true
  func setSoundEnabled(_ enabled: Bool) { soundEnabled = enabled }
  func completed(_ item: ActiveReminderCandidate) { completedIDs.append(item.cardID) }
  var items: [ActiveReminderCandidate] = []
  var pending = Set<String>()
  var error: String?
  var errors: [String: String] = [:]
  var stale = false
  func show(
    _ items: [ActiveReminderCandidate], preview: Bool, pending: Set<String>,
    errors: [String: String], stale: Bool
  ) throws {
    self.items = items
    self.pending = pending
    self.errors = errors
    self.error = items.compactMap { errors[$0.cardID] }.first
    self.stale = stale
    isVisible = !items.isEmpty
  }
  func hide() { isVisible = false }
}
final class ActiveReminderLifecycleTests: XCTestCase {
  @MainActor
  func testTwoCardsKeepCompletionAndFailureOnTheirOwnItem() throws {
    let time = Date(timeIntervalSince1970: 1_792_670_400)
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let sink = ActiveTestSink()
    let presenter = ActiveTestPresenter()
    let router = ActiveReminderRouter(
      notifications: sink, presenter: presenter,
      activity: { MacActivityState(isActive: true, isAvailable: true, shouldHide: false) },
      now: { time },
      makeStore: {
        try ActiveReminderStore(url: root.appendingPathComponent("store"), identity: $0)
      },
      startTimer: false)
    var preferences = NotificationPreferences()
    preferences.enabled = true
    preferences.sound = false
    router.configure(preferences: preferences, calendar: .current, enabled: true)
    XCTAssertFalse(presenter.soundEnabled)
    let items = (1...2).map { index in
      ActiveReminderCandidate(
        id: "00000000-0000-4000-8000-00000000000\(index)", kind: index == 1 ? "task" : "reminder",
        title: "Item \(index)", dueAt: ISO8601DateFormatter().string(from: time),
        activeReminder: true,
        revision: index == 1 ? 1 : nil,
        updatedAt: index == 2 ? ISO8601DateFormatter().string(from: time) : nil)
    }
    try router.ingest(
      ActiveReminderInventory(
        serverUrl: "https://fixture.test", accountId: "owner",
        generation: 1, generatedAt: ISO8601DateFormatter().string(from: time), items: items))
    var requests: [[String: Any]] = []
    router.action = {
      if $0["action"] as? String == "active_reminder_complete" { requests.append($0) }
    }
    router.complete(items[0])
    XCTAssertEqual(presenter.pending, [items[0].cardID])
    var result = try XCTUnwrap(requests.last)
    result["outcome"] = "failed"
    router.actionResult(result)
    XCTAssertTrue(presenter.completedIDs.isEmpty)
    XCTAssertNotNil(presenter.errors[items[0].cardID])
    XCTAssertNil(presenter.errors[items[1].cardID])
    router.complete(items[1])
    XCTAssertEqual(presenter.pending, [items[1].cardID])
    result = try XCTUnwrap(requests.last)
    result["outcome"] = "completed"
    router.actionResult(result)
    XCTAssertEqual(presenter.completedIDs, [items[1].cardID])
    XCTAssertEqual(presenter.items.map(\.cardID), [items[0].cardID])
    XCTAssertNotNil(presenter.errors[items[0].cardID])
  }
  @MainActor
  func testFlagOffHandsCurrentSourceToOrdinaryWithoutCancellingItsPendingRequest() throws {
    let time = Date(timeIntervalSince1970: 1_792_670_400)
    let sink = ActiveTestSink()
    let panel = ActiveTestPresenter()
    let router = ActiveReminderRouter(
      notifications: sink, presenter: panel,
      activity: {
        MacActivityState.evaluate(
          inputAge: 200, onConsole: true, loginDone: true, locked: false, displayAwake: true,
          frontmost: "fixture")
      },
      now: { time },
      makeStore: {
        try ActiveReminderStore(
          url:
            FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString),
          identity: $0)
      },
      startTimer: false)
    var item = ActiveReminderCandidate(
      id: "11111111-1111-4111-8111-111111111111", kind: "task",
      title: "Old title", dueAt: ISO8601DateFormatter().string(from: time.addingTimeInterval(2)),
      activeReminder: true, revision: 1)
    var inventory = ActiveReminderInventory(
      serverUrl: "https://app.test", accountId: "a",
      generation: 1, generatedAt: ISO8601DateFormatter().string(from: time), items: [item])
    var preferences = NotificationPreferences()
    preferences.enabled = true
    router.configure(preferences: preferences, calendar: .current, enabled: true)
    try router.ingest(inventory)
    item.activeReminder = false
    item.revision = 2
    item.title = "Current title"
    inventory.items = []
    inventory.ordinaryItems = [item]
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
    XCTAssertTrue(panel.pending.contains(item.cardID))
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
    header.pointer = { _ in point }
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

extension ActiveReminderTests {
  func testCardsUseSixteenAnchorsOnOffsetDisplays() {
    let area = CGRect(x: -1500, y: 40, width: 1400, height: 900)
    let size = CGSize(width: 320, height: 88)
    let anchors = ActiveReminderPlacement.anchors(in: area, size: size)
    XCTAssertEqual(
      Array(anchors.prefix(8)), PetGeometry(bounds: area, obstacles: []).anchors(size: size))
    XCTAssertEqual(anchors.count, 16)
    for (index, frame) in anchors.enumerated() {
      XCTAssertTrue(area.contains(frame))
      XCTAssertEqual(ActiveReminderPlacement.anchor(for: frame, in: area), index)
    }
    XCTAssertNil(
      ActiveReminderPlacement.anchor(
        for: CGRect(x: area.midX - 160, y: area.midY - 44, width: 320, height: 88), in: area))
  }
  @MainActor
  func testFeedbackOnlyOnNewArrivalAndAcknowledgedCompletionAndRespectsMute() throws {
    var feedback: [ActiveReminderFeedback] = []
    let presenter = ActiveReminderPanelController(feedback: { feedback.append($0) })
    defer { presenter.reset() }
    let item = ActiveReminderCandidate(
      id: UUID().uuidString, kind: "task", title: "Sample", dueAt: "2026-10-22T12:00:00Z",
      activeReminder: true, revision: 1)
    try presenter.show([item], preview: true, pending: [], errors: [:], stale: false)
    XCTAssertEqual(feedback, [.arrival])
    presenter.hide()
    try presenter.show([item], preview: true, pending: [item.cardID], errors: [:], stale: false)
    XCTAssertEqual(feedback, [.arrival, .pending])
    presenter.completed(item)
    presenter.completed(item)
    XCTAssertEqual(feedback, [.arrival, .pending, .completion])
    XCTAssertTrue(presenter.panels.isEmpty)
    presenter.setSoundEnabled(false)
    try presenter.show([item], preview: true, pending: [], errors: [:], stale: false)
    presenter.completed(item)
    XCTAssertEqual(feedback, [.arrival, .pending, .completion])
  }
}

extension ActiveReminderTests {
  @MainActor
  func testDragSnapsToPetAnchorAndResizeKeepsThatAnchorWithoutMovingSibling() async throws {
    var dockVisible = false
    let presenter = ActiveReminderPanelController(
      feedback: { _ in },
      geometry: { screen in
        let area = screen.visibleFrame
        return PetGeometry(
          bounds: area,
          obstacles: dockVisible
            ? [CGRect(x: area.minX, y: area.minY, width: area.width, height: 80)] : [])
      })
    defer { presenter.reset() }
    let items = (1...2).map { index in
      ActiveReminderCandidate(
        id: UUID().uuidString, kind: "task", title: "Anchor \(index)",
        dueAt: "2026-10-22T12:00:00Z", activeReminder: true, revision: 1)
    }
    try presenter.show(items, preview: true, pending: [], errors: [:], stale: false)
    let panel = try XCTUnwrap(presenter.panels[items[0].cardID])
    let sibling = try XCTUnwrap(presenter.panels[items[1].cardID])
    let siblingFrame = sibling.frame
    let area = try XCTUnwrap(panel.screen).visibleFrame
    let target = ActiveReminderPlacement.anchors(in: area, size: panel.frame.size)[4]
    let header = try XCTUnwrap(
      panel.contentView?.subviews.compactMap { $0 as? ActiveReminderDragView }.first)
    let grip = try XCTUnwrap(
      panel.contentView?.subviews.compactMap { $0 as? ActiveReminderResizeView }.first)
    let event = try XCTUnwrap(
      NSEvent.mouseEvent(
        with: .leftMouseDown, location: .zero,
        modifierFlags: [], timestamp: 0, windowNumber: panel.windowNumber, context: nil,
        eventNumber: 1, clickCount: 1, pressure: 1))
    var point = CGPoint(x: panel.frame.midX, y: panel.frame.maxY - 4)
    header.pointer = { _ in point }
    header.mouseDown(with: event)
    point.x += target.minX - panel.frame.minX + 15
    point.y += target.minY - panel.frame.minY + 15
    header.mouseDragged(with: event)
    header.mouseUp(with: event)
    XCTAssertEqual(panel.frame, target)
    try await Task.sleep(nanoseconds: 300_000_000)
    XCTAssertEqual(panel.frame, target, "Saving must preserve the pet's 12-point inset")
    grip.pointer = { _ in point }
    grip.mouseDown(with: event)
    point.x -= 40
    point.y += 10
    grip.mouseDragged(with: event)
    grip.mouseUp(with: event)
    XCTAssertEqual(
      panel.frame, ActiveReminderPlacement.anchors(in: area, size: panel.frame.size)[4])
    XCTAssertEqual(sibling.frame, siblingFrame)
    dockVisible = true
    try presenter.show(items, preview: true, pending: [], errors: [:], stale: false)
    XCTAssertGreaterThanOrEqual(panel.frame.minY, area.minY + 88)
    dockVisible = false
    try presenter.show(items, preview: true, pending: [], errors: [:], stale: false)
    XCTAssertEqual(
      panel.frame, ActiveReminderPlacement.anchors(in: area, size: panel.frame.size)[4],
      "An attached card returns to its edge anchor when the Dock hides")
    header.mouseDown(with: event)
    point.x += 10
    header.mouseDragged(with: event)
    let guide = try XCTUnwrap(
      NSApp.windows.first {
        $0.isVisible && $0.contentView is ActiveReminderSlotView
      })
    presenter.hide()
    XCTAssertFalse(guide.isVisible, "Lock/policy hiding also removes in-progress drag guides")
    header.mouseUp(with: event)
  }
}

extension ActiveReminderTests {
  func testReminderAnchorsAndFittingUseMeasuredDockAndConservativeFallback() {
    let screen = CGRect(x: -1600, y: -100, width: 1600, height: 1000)
    let visible = CGRect(x: -1600, y: -30, width: 1600, height: 902)
    let dock = CGRect(x: -1000, y: -100, width: 400, height: 70)
    let measured = PetDisplays.resolvedGeometry(
      frame: screen, visible: visible,
      dockFrames: [dock], hiddenDock: false)
    let size = CGSize(width: 320, height: 88)
    let anchors = ActiveReminderPlacement.anchors(in: measured, size: size)
    XCTAssertEqual(anchors.count, 16)
    XCTAssertEqual(anchors[4].minY, screen.minY + 12, "Use the clear corner lane beside the Dock")
    for frame in anchors {
      XCTAssertFalse(frame.intersects(dock.insetBy(dx: -8, dy: -8)))
      XCTAssertEqual(ActiveReminderPlacement.fit(frame, geometry: measured), frame)
    }
    let fallback = PetDisplays.resolvedGeometry(
      frame: screen, visible: visible,
      dockFrames: [], hiddenDock: false)
    XCTAssertTrue(
      ActiveReminderPlacement.anchors(in: fallback, size: size)
        .allSatisfy { $0.minY >= visible.minY + 12 })
    let droppedOnDock = CGRect(x: -900, y: -88, width: 320, height: 88)
    XCTAssertFalse(ActiveReminderPlacement.fit(droppedOnDock, geometry: measured).intersects(dock))
  }
  @MainActor
  func testCardSurfaceDistinguishesClickFromDrag() throws {
    let panel = NSPanel(
      contentRect: CGRect(x: 100, y: 100, width: 320, height: 88),
      styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    defer { panel.close() }
    let surface = ActiveReminderDragView(frame: panel.contentView!.bounds)
    panel.contentView?.addSubview(surface)
    var point = CGPoint(x: 180, y: 140)
    surface.pointer = { _ in point }
    var clicks = 0
    surface.clicked = { _ in clicks += 1 }
    let event = try XCTUnwrap(
      NSEvent.mouseEvent(
        with: .leftMouseDown, location: .zero,
        modifierFlags: [], timestamp: 0, windowNumber: panel.windowNumber, context: nil,
        eventNumber: 1, clickCount: 1, pressure: 1))
    surface.mouseDown(with: event)
    point.x += 2
    surface.mouseDragged(with: event)
    surface.mouseUp(with: event)
    XCTAssertEqual(clicks, 1)
    XCTAssertEqual(panel.frame.origin, CGPoint(x: 100, y: 100))
    surface.mouseDown(with: event)
    point.x += 30
    surface.mouseDragged(with: event)
    surface.mouseUp(with: event)
    XCTAssertEqual(clicks, 1, "Dragging a checkbox must not complete it")
    XCTAssertEqual(panel.frame.origin, CGPoint(x: 130, y: 100))
  }
}

extension ActiveReminderTests {
  @MainActor
  func testWholeCardDragRetainsClickActionsAndPendingCompletionGuard() throws {
    let presenter = ActiveReminderPanelController(feedback: { _ in })
    defer { presenter.reset() }
    let item = ActiveReminderCandidate(
      id: UUID().uuidString, kind: "task", title: "Clickable",
      dueAt: "2026-10-22T12:00:00Z", activeReminder: true, revision: 1)
    var completed = 0
    var opened = 0
    presenter.complete = { _ in completed += 1 }
    presenter.open = { _ in opened += 1 }
    try presenter.show([item], preview: true, pending: [], errors: [:], stale: false)
    let panel = try XCTUnwrap(presenter.panels[item.cardID])
    let event = try XCTUnwrap(
      NSEvent.mouseEvent(
        with: .leftMouseDown, location: .zero,
        modifierFlags: [], timestamp: 0, windowNumber: panel.windowNumber, context: nil,
        eventNumber: 1, clickCount: 1, pressure: 1))
    func surface() throws -> ActiveReminderDragView {
      try XCTUnwrap(panel.contentView?.subviews.compactMap { $0 as? ActiveReminderDragView }.first)
    }
    var point = panel.convertPoint(toScreen: CGPoint(x: 18, y: panel.frame.height - 18))
    let drag = try surface()
    drag.pointer = { _ in point }
    drag.mouseDown(with: event)
    drag.mouseUp(with: event)
    XCTAssertEqual(completed, 1)
    drag.mouseDown(with: event)
    point.x += 40
    drag.mouseDragged(with: event)
    drag.mouseUp(with: event)
    XCTAssertEqual(completed, 1)
    XCTAssertEqual(opened, 0)
    point = panel.convertPoint(toScreen: CGPoint(x: 140, y: 30))
    drag.mouseDown(with: event)
    drag.mouseUp(with: event)
    XCTAssertEqual(opened, 1)
    try presenter.show([item], preview: true, pending: [item.cardID], errors: [:], stale: false)
    let pending = try surface()
    point = panel.convertPoint(toScreen: CGPoint(x: 18, y: panel.frame.height - 18))
    pending.pointer = { _ in point }
    pending.mouseDown(with: event)
    pending.mouseUp(with: event)
    XCTAssertEqual(completed, 1)
  }
}
