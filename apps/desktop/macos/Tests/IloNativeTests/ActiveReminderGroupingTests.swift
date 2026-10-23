import AppKit
import SwiftUI
import XCTest

@testable import IloNative

final class ActiveReminderGroupingTests: XCTestCase {
  let layout = PetGeometry(bounds: CGRect(x: 0, y: 0, width: 1600, height: 1000), obstacles: [])
  func testPairLocksDistinguishGeometricComponentAndBranch() {
    let frames = [
      "a": CGRect(x: 100, y: 100, width: 240, height: 64),
      "b": CGRect(x: 340, y: 100, width: 240, height: 64),
      "c": CGRect(x: 340, y: 164, width: 240, height: 64),
    ]
    let edges = ActiveReminderGrouping.edges(frames)
    XCTAssertEqual(edges, [ActiveReminderEdge("a", "b"), ActiveReminderEdge("b", "c")])
    XCTAssertEqual(ActiveReminderGrouping.component("a", edges: edges), ["a", "b", "c"])
    XCTAssertEqual(
      ActiveReminderGrouping.component("a", edges: [ActiveReminderEdge("a", "b")]), ["a", "b"])
    XCTAssertEqual(ActiveReminderEdge("a", "b"), ActiveReminderEdge("b", "a"))
  }
  func testGroupFootprintCandidateExcludesMembersAndGuidesStayLimited() throws {
    let frames = [
      "a": CGRect(x: 100, y: 100, width: 240, height: 64),
      "b": CGRect(x: 100, y: 164, width: 240, height: 64),
    ]
    let occupied = ["c": CGRect(x: 900, y: 100, width: 240, height: 64)]
    let slots = ActiveReminderDocking.slots(
      size: ActiveReminderGrouping.bounds(frames).size, geometry: layout, occupied: occupied)
    XCTAssertTrue(slots.allSatisfy { !ActiveReminderDocking.overlaps($0.frame, occupied["c"]!) })
    let candidate = try XCTUnwrap(ActiveReminderGrouping.candidate(frames, slots: slots))
    XCTAssertEqual(candidate.frame.size, CGSize(width: 240, height: 128))
    let guides = ActiveReminderGrouping.guideSlots(
      slots, frame: ActiveReminderGrouping.bounds(frames), selected: candidate)
    XCTAssertLessThanOrEqual(guides.count, 3)
    for (i, slot) in guides.enumerated() {
      XCTAssertFalse(guides.dropFirst(i + 1).contains { $0.frame.intersects(slot.frame) })
    }
  }
  func testStackFitsAndLocksAllCardsWithoutDockCollision() throws {
    let dock = CGRect(x: 500, y: 0, width: 500, height: 80)
    let geometry = PetGeometry(bounds: layout.bounds, obstacles: [dock])
    let frames = try XCTUnwrap(
      ActiveReminderGrouping.stack(
        (1...18).map(String.init), near: CGRect(x: 700, y: 20, width: 240, height: 64),
        geometry: geometry))
    XCTAssertEqual(frames.count, 18)
    XCTAssertTrue(ActiveReminderGrouping.valid(frames, geometry: geometry, occupied: [:]))
    XCTAssertEqual(
      ActiveReminderGrouping.component("1", edges: ActiveReminderGrouping.edges(frames)).count, 18)
    XCTAssertNil(
      ActiveReminderGrouping.stack((1...1000).map(String.init), near: .zero, geometry: geometry))
  }
  func testResetRetainsPartialJoinGraphAndRightTopDocking() throws {
    let frames = [
      "a": CGRect(x: 988, y: 788, width: 300, height: 200),
      "b": CGRect(x: 1288, y: 868, width: 300, height: 120),
    ]
    for targets: Set<String> in [["a"], ["a", "b"]] {
      let next = try XCTUnwrap(
        ActiveReminderGrouping.reset(frames, targets: targets, geometry: layout, occupied: [:]))
      XCTAssertEqual(ActiveReminderGrouping.edges(next), ActiveReminderGrouping.edges(frames))
      XCTAssertEqual(ActiveReminderGrouping.bounds(next).maxX, 1588)
      XCTAssertEqual(ActiveReminderGrouping.bounds(next).maxY, 988)
      XCTAssertTrue(ActiveReminderGrouping.valid(next, geometry: layout, occupied: [:]))
      for id in targets { XCTAssertEqual(next[id]?.size, ActiveReminderGrouping.minimum) }
    }
  }
  func testSnoozeAndPairEdgesPersistAndStayAccountScoped() throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      .appendingPathComponent("state")
    defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let store = try ActiveReminderStore(url: url, identity: "first")
    let until = Date().addingTimeInterval(900)
    try store.snooze("occurrence", until: until)
    try store.saveLockEdges([ActiveReminderEdge("a", "b")])
    let loaded = try ActiveReminderStore(url: url, identity: "first")
    XCTAssertEqual(
      try XCTUnwrap(loaded.snoozedUntil("occurrence")).timeIntervalSince1970,
      until.timeIntervalSince1970, accuracy: 0.000001)
    XCTAssertEqual(loaded.lockEdges, [ActiveReminderEdge("a", "b")])
    let other = try ActiveReminderStore(url: url, identity: "other")
    XCTAssertNil(other.snoozedUntil("occurrence"))
    XCTAssertTrue(other.lockEdges.isEmpty)
  }
  func testCompactCountdownAndSemanticSounds() {
    let now = Date()
    XCTAssertEqual(
      ActiveReminderDueText.compact(now.addingTimeInterval(903), now: now), "in 15m 03s")
    XCTAssertEqual(
      ActiveReminderDueText.compact(now.addingTimeInterval(-903), now: now), "15m 03s late")
    XCTAssertEqual(ActiveReminderFeedback.lock.asset, "earshot-lock")
    XCTAssertEqual(ActiveReminderFeedback.unlock.asset, "earshot-unlock")
    XCTAssertEqual(ActiveReminderFeedback.gather.asset, "earshot-gather")
    XCTAssertEqual(ActiveReminderFeedback.completion.asset, "earshot-complete")
  }
  @MainActor
  func testControllerPairLockMenuGroupCommandsAndLifecycle() throws {
    let presenter = ActiveReminderPanelController(
      feedback: { _ in }, geometry: { PetGeometry(bounds: $0.visibleFrame, obstacles: []) })
    defer { presenter.reset() }
    let items = (0..<3).map { i in
      ActiveReminderCandidate(
        id: UUID().uuidString, kind: "task", title: "Fixture \(i)", dueAt: "2026-10-23T10:00:00Z",
        activeReminder: true, revision: 1)
    }
    try presenter.show(items, preview: true, pending: [], errors: [:], stale: false)
    XCTAssertTrue(
      presenter.panels.values.allSatisfy { $0.frame.size == ActiveReminderGrouping.minimum })
    let first = items[0].cardID
    let second = items[1].cardID
    let third = items[2].cardID
    XCTAssertTrue(presenter.gather(first))
    XCTAssertEqual(presenter.component(first).count, 3)
    let edge = try XCTUnwrap(presenter.locks.first)
    presenter.toggleJoin(edge.a, peer: edge.b, all: true)
    XCTAssertTrue(presenter.locks.isEmpty)
    XCTAssertEqual(presenter.component(first), [first])
    XCTAssertEqual(presenter.component(first, geometric: true).count, 3)
    presenter.toggleJoin(edge.a, peer: edge.b, all: false)
    XCTAssertEqual(presenter.locks, [edge])
    var completed: [String] = []
    var snoozed: [String] = []
    presenter.complete = { completed.append($0.cardID) }
    presenter.snooze = { snoozed.append($0.cardID) }
    let menu = presenter.menu(for: first)
    let visible = menu.items.filter { !$0.isAlternate && !$0.isSeparatorItem }
    XCTAssertEqual(visible.count, 8)
    let groupComplete = try XCTUnwrap(menu.items.first { $0.title == "Complete group" })
    XCTAssertTrue(groupComplete.isAlternate)
    XCTAssertEqual(groupComplete.keyEquivalentModifierMask, [.shift])
    NSApp.sendAction(groupComplete.action!, to: groupComplete.target, from: groupComplete)
    XCTAssertEqual(Set(completed), [first, second, third])
    let groupSnooze = try XCTUnwrap(menu.items.first { $0.title == "Snooze group 15m" })
    NSApp.sendAction(groupSnooze.action!, to: groupSnooze.target, from: groupSnooze)
    XCTAssertEqual(Set(snoozed), [first, second, third])
    presenter.hide()
    try presenter.show(items, preview: true, pending: [], errors: [:], stale: false)
    XCTAssertEqual(presenter.locks, [edge], "Hiding cards keeps pair lock intent")
    presenter.completed(items[1])
    XCTAssertFalse(presenter.locks.contains { $0.contains(second) })
    XCTAssertEqual(presenter.panels.count, 2)
  }
}

extension ActiveReminderGroupingTests {
  @MainActor
  func testHeldDragMovesOnlyLockedPairThenShakeGathersAndContinues() throws {
    let presenter = ActiveReminderPanelController(
      feedback: { _ in }, geometry: { PetGeometry(bounds: $0.visibleFrame, obstacles: []) })
    presenter.interactions.snapping = false
    defer { presenter.reset() }
    let items = (0..<3).map { i in
      ActiveReminderCandidate(
        id: UUID().uuidString, kind: "task", title: "Drag \(i)", dueAt: "2026-10-23T10:00:00Z",
        activeReminder: true, revision: 1)
    }
    try presenter.show(items, preview: true, pending: [], errors: [:], stale: false)
    let panels = try items.map { try XCTUnwrap(presenter.panels[$0.cardID]) }
    let area = try XCTUnwrap(panels[0].screen).visibleFrame
    panels[0].setFrameOrigin(CGPoint(x: area.minX + 150, y: area.minY + 350))
    panels[1].setFrameOrigin(CGPoint(x: area.minX + 150, y: area.minY + 414))
    panels[2].setFrameOrigin(CGPoint(x: area.minX + 700, y: area.minY + 500))
    presenter.toggleJoin(items[0].cardID, peer: items[1].cardID, all: false)
    XCTAssertEqual(presenter.component(items[0].cardID).count, 2)
    let initial = panels.map(\.frame)
    let surface = try XCTUnwrap(
      panels[0].contentView?.subviews.compactMap { $0 as? ActiveReminderDragView }.first)
    let event = try XCTUnwrap(
      NSEvent.mouseEvent(
        with: .leftMouseDown, location: .zero, modifierFlags: [], timestamp: 0,
        windowNumber: panels[0].windowNumber, context: nil, eventNumber: 1, clickCount: 1,
        pressure: 1))
    var point = CGPoint(x: initial[0].midX, y: initial[0].midY)
    surface.pointer = { _ in point }
    surface.mouseDown(with: event)
    point.x += 100
    point.y -= 100
    surface.mouseDragged(with: event)
    surface.mouseUp(with: event)
    XCTAssertEqual(
      panels[0].frame.origin, CGPoint(x: initial[0].minX + 100, y: initial[0].minY - 100))
    XCTAssertEqual(
      panels[1].frame.origin, CGPoint(x: initial[1].minX + 100, y: initial[1].minY - 100))
    XCTAssertEqual(panels[2].frame, initial[2])
    surface.mouseDown(with: event)
    let start = point
    for delta: CGFloat in [20, 50, -20, 50, -20, 50, -20] {
      point = CGPoint(x: start.x + delta, y: start.y)
      surface.mouseDragged(with: event)
    }
    XCTAssertEqual(
      presenter.component(items[0].cardID).count, 3,
      "The held pet gesture gathers the entire visible scene")
    let gathered = panels.map(\.frame)
    point.x += 60
    point.y -= 30
    surface.mouseDragged(with: event)
    surface.mouseUp(with: event)
    XCTAssertEqual(panels[2].frame.minX - gathered[2].minX, 60)
    XCTAssertEqual(panels[2].frame.minY - gathered[2].minY, -30)
    XCTAssertTrue(
      ActiveReminderGrouping.valid(
        presenter.visibleFrames, geometry: PetGeometry(bounds: area, obstacles: []), occupied: [:]))
  }
}
