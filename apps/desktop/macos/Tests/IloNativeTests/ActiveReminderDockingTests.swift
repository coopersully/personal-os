import AppKit
import XCTest

@testable import IloNative

final class ActiveReminderDockingTests: XCTestCase {
  let layout = PetGeometry(bounds: CGRect(x: 0, y: 0, width: 1600, height: 1000), obstacles: [])
  func testOccupiedAnchorsAreExcludedAndNeighborSlotsAreAdded() throws {
    let occupied = CGRect(x: 12, y: 900, width: 320, height: 88)
    let slots = ActiveReminderDocking.slots(
      size: occupied.size, geometry: layout,
      occupied: ["one": occupied])
    XCTAssertFalse(slots.contains { ActiveReminderDocking.overlaps($0.frame, occupied) })
    let beside = try XCTUnwrap(
      slots.first { $0.frame.minX == occupied.maxX && $0.frame.minY == occupied.minY })
    XCTAssertEqual(beside.neighbor, "one")
    let near = beside.frame.offsetBy(dx: 12, dy: -8)
    XCTAssertEqual(ActiveReminderDocking.nearest(to: near, slots: slots)?.frame, beside.frame)
  }
  func testSlotsKeepGrabbedCardSizeAndNeverShiftThroughDockOrNeighbors() {
    let dock = CGRect(x: 400, y: 0, width: 800, height: 80)
    let geometry = PetGeometry(bounds: layout.bounds, obstacles: [dock])
    let occupied = [
      "a": CGRect(x: 12, y: 12, width: 320, height: 160),
      "b": CGRect(x: 332, y: 12, width: 400, height: 160),
    ]
    let size = CGSize(width: 280, height: 72)
    for slot in ActiveReminderDocking.slots(size: size, geometry: geometry, occupied: occupied) {
      XCTAssertEqual(slot.frame.size, size)
      XCTAssertFalse(slot.frame.intersects(dock))
      XCTAssertFalse(occupied.values.contains { ActiveReminderDocking.overlaps($0, slot.frame) })
    }
  }
  func testSeamsSquareOnlyTouchingCornersAndDrawOneDivider() {
    let left = CGRect(x: 100, y: 100, width: 320, height: 88)
    let right = left.offsetBy(dx: 320, dy: 0)
    let a = ActiveReminderDocking.seams(frame: left, occupied: ["right": right])
    let b = ActiveReminderDocking.seams(frame: right, occupied: ["left": left])
    XCTAssertEqual(a.corners, [.topRight, .bottomRight])
    XCTAssertEqual(b.corners, [.topLeft, .bottomLeft])
    XCTAssertEqual(a.dividers.count + b.dividers.count, 1)
    XCTAssertTrue(
      ActiveReminderDocking.seams(
        frame: right.offsetBy(dx: 8, dy: 0),
        occupied: ["left": left]
      ).corners.isEmpty)
    let short = CGRect(x: left.maxX, y: left.maxY - 40, width: 320, height: 40)
    XCTAssertEqual(
      ActiveReminderDocking.seams(frame: left, occupied: ["short": short]).corners, [.topRight])
  }
  func testCountdownUsesSecondsAndKeepsAbsoluteLocalTime() {
    let now = Date(timeIntervalSince1970: 1_792_670_400)
    XCTAssertEqual(
      ActiveReminderDueText.relative(now.addingTimeInterval(903), now: now), "Due in 15 min 3 sec")
    XCTAssertEqual(
      ActiveReminderDueText.relative(now.addingTimeInterval(-903), now: now),
      "Overdue by 15 min 3 sec")
    XCTAssertEqual(
      ActiveReminderDueText.relative(now.addingTimeInterval(3), now: now), "Due in 3 sec")
    XCTAssertEqual(ActiveReminderDueText.relative(now, now: now), "Due now")
    XCTAssertEqual(
      ActiveReminderDueText.relative(now.addingTimeInterval(43200), now: now), "Due in 12 hr")
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    let absolute = ActiveReminderDueText.absolute(
      now.addingTimeInterval(60), now: now,
      calendar: calendar, locale: Locale(identifier: "en_US"))
    XCTAssertFalse(absolute.isEmpty)
    XCTAssertTrue(absolute.contains(":"))
  }
}

extension ActiveReminderDockingTests {
  @MainActor
  func testCardsJoinSeparateAndNeverClaimOccupiedAnchor() throws {
    var feedback: [ActiveReminderFeedback] = []
    let presenter = ActiveReminderPanelController(
      feedback: { feedback.append($0) },
      geometry: { PetGeometry(bounds: $0.visibleFrame, obstacles: []) })
    defer { presenter.reset() }
    let items = (1...2).map { index in
      ActiveReminderCandidate(
        id: UUID().uuidString, kind: "task", title: "Dock \(index)",
        dueAt: "2026-10-23T10:00:00Z", activeReminder: true, revision: 1)
    }
    try presenter.show(items, preview: true, pending: [], errors: [:], stale: false)
    let first = try XCTUnwrap(presenter.panels[items[0].cardID])
    let second = try XCTUnwrap(presenter.panels[items[1].cardID])
    let area = try XCTUnwrap(first.screen).visibleFrame
    first.setFrameOrigin(CGPoint(x: area.minX + 60, y: area.midY))
    let surface = try XCTUnwrap(
      second.contentView?.subviews.compactMap { $0 as? ActiveReminderDragView }.first)
    let event = try XCTUnwrap(
      NSEvent.mouseEvent(
        with: .leftMouseDown, location: .zero,
        modifierFlags: [], timestamp: 0, windowNumber: second.windowNumber, context: nil,
        eventNumber: 1, clickCount: 1, pressure: 1))
    var pointer = CGPoint.zero
    surface.pointer = { _ in pointer }
    func drag(to origin: CGPoint) {
      pointer = .zero
      surface.mouseDown(with: event)
      pointer = CGPoint(x: origin.x - second.frame.minX, y: origin.y - second.frame.minY)
      surface.mouseDragged(with: event)
      surface.mouseUp(with: event)
    }
    drag(to: CGPoint(x: first.frame.maxX + 10, y: first.frame.minY + 8))
    XCTAssertEqual(second.frame.minX, first.frame.maxX)
    XCTAssertEqual(second.frame.minY, first.frame.minY)
    XCTAssertFalse(first.hasShadow)
    XCTAssertFalse(second.hasShadow)
    XCTAssertTrue(feedback.contains(.dock))
    drag(to: CGPoint(x: second.frame.minX + second.frame.width + 100, y: second.frame.minY - 150))
    XCTAssertFalse(ActiveReminderDocking.overlaps(first.frame, second.frame))
    XCTAssertEqual(ActiveReminderPlacement.fit(second.frame, geometry: PetGeometry(bounds: area, obstacles: [])), second.frame)
    XCTAssertTrue(first.hasShadow)
    XCTAssertTrue(second.hasShadow)
    XCTAssertTrue(feedback.contains(.detach))
    first.setFrameOrigin(
      ActiveReminderPlacement.anchors(in: area, size: first.frame.size)[0].origin)
    drag(to: first.frame.origin)
    XCTAssertFalse(ActiveReminderDocking.overlaps(first.frame, second.frame))
    let firstFrame = first.frame
    presenter.completed(items[1])
    XCTAssertEqual(first.frame, firstFrame)
    XCTAssertTrue(first.hasShadow)
  }
  @MainActor
  func testContextMenuUsesExistingActionsAndDisablesPendingCompletion() throws {
    let presenter = ActiveReminderPanelController(feedback: { _ in })
    defer { presenter.reset() }
    let item = ActiveReminderCandidate(
      id: UUID().uuidString, kind: "reminder", title: "Menu",
      dueAt: "2026-10-23T10:00:00Z", activeReminder: true, updatedAt: "2026-10-23T09:00:00Z")
    var completed = 0
    var opened = 0
    presenter.complete = { _ in completed += 1 }
    presenter.open = { _ in opened += 1 }
    try presenter.show([item], preview: true, pending: [], errors: [:], stale: false)
    let panel = try XCTUnwrap(presenter.panels[item.cardID])
    let event = try XCTUnwrap(
      NSEvent.mouseEvent(
        with: .rightMouseDown, location: .zero,
        modifierFlags: [], timestamp: 0, windowNumber: panel.windowNumber, context: nil,
        eventNumber: 1, clickCount: 1, pressure: 1))
    func menu() throws -> NSMenu {
      let surface = try XCTUnwrap(
        panel.contentView?.subviews.compactMap { $0 as? ActiveReminderDragView }.first)
      return try XCTUnwrap(surface.menu(for: event))
    }
    let initial = try menu()
    XCTAssertEqual(initial.items.filter { !$0.isAlternate && !$0.isSeparatorItem }.map(\.title), [
      "Complete", "View in nohmi", "Snooze 15m", "Separate this card", "Move to edge",
      "Reset to smallest", "Gather all into stack", "Active card settings"])
    XCTAssertEqual(initial.items.filter(\.isAlternate).count, 5)
    XCTAssertTrue(initial.items.filter(\.isAlternate).allSatisfy { $0.keyEquivalentModifierMask == [.shift] })
    NSApp.sendAction(initial.items[0].action!, to: initial.items[0].target, from: initial.items[0])
    let openItem = try XCTUnwrap(initial.items.first { $0.title == "View in nohmi" })
    NSApp.sendAction(openItem.action!, to: openItem.target, from: openItem)
    XCTAssertEqual(completed, 1)
    XCTAssertEqual(opened, 1)
    try presenter.show([item], preview: true, pending: [item.cardID], errors: [:], stale: false)
    let pending = try menu()
    XCTAssertFalse(pending.items[0].isEnabled)
    NSApp.sendAction(pending.items[0].action!, to: pending.items[0].target, from: pending.items[0])
    XCTAssertEqual(completed, 1)
  }
}

extension ActiveReminderDockingTests {
  @MainActor
  func testSavedCardsCannotRestoreToSameAnchorAndKeepTheirSizes() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try ActiveReminderStore(
      url: root.appendingPathComponent("cards"), identity: "fixture")
    let screen = try XCTUnwrap(NSScreen.main)
    let items = (1...2).map { index in
      ActiveReminderCandidate(
        id: UUID().uuidString, kind: "task", title: "Saved \(index)",
        dueAt: "2026-10-23T10:00:00Z", activeReminder: true, revision: 1)
    }
    for item in items {
      try store.saveCardPlacement(
        card: item.cardID, display: PetDisplays.id(screen),
        geometry: ActiveReminderCardGeometry(x: 0, y: 1, width: 300, height: 120))
    }
    let presenter = ActiveReminderPanelController(
      feedback: { _ in },
      geometry: { PetGeometry(bounds: $0.visibleFrame, obstacles: []) })
    presenter.store = store
    defer { presenter.reset() }
    try presenter.show(items, preview: true, pending: [], errors: [:], stale: false)
    let frames = try items.map { try XCTUnwrap(presenter.panels[$0.cardID]).frame }
    XCTAssertTrue(frames.allSatisfy { $0.size == CGSize(width: 300, height: 120) })
    XCTAssertFalse(ActiveReminderDocking.overlaps(frames[0], frames[1]))
  }
}

extension ActiveReminderDockingTests {
  @MainActor
  func testDragSurfaceForwardsWheelEventsWithoutStartingMovement() throws {
    let surface = ActiveReminderDragView(frame: CGRect(x: 0, y: 0, width: 240, height: 72))
    var forwarded = 0
    var moved = 0
    surface.forwardScroll = { _ in forwarded += 1 }
    surface.dragChanged = { _ in moved += 1 }
    let cg = try XCTUnwrap(
      CGEvent(
        scrollWheelEvent2Source: nil, units: .pixel,
        wheelCount: 1, wheel1: -80, wheel2: 0, wheel3: 0))
    let event = try XCTUnwrap(NSEvent(cgEvent: cg))
    surface.scrollWheel(with: event)
    XCTAssertEqual(forwarded, 1)
    XCTAssertEqual(moved, 0)
  }
}
