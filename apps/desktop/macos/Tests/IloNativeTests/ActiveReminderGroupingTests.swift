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

extension ActiveReminderGroupingTests {
  private func fixture(_ index: Int, kind: String = "task") -> ActiveReminderCandidate {
    ActiveReminderCandidate(
      id: "00000000-0000-4000-8000-\(String(format: "%012d", index))", kind: kind,
      title: kind == "task" ? "Send the draft" : "Take a stretch break",
      dueAt: "2026-10-23T10:00:00Z",
      activeReminder: true, revision: kind == "task" ? 1 : nil,
      updatedAt: kind == "reminder" ? "2026-10-23T09:00:00Z" : nil)
  }
  @MainActor
  private func pointerEvent(_ panel: NSPanel) throws -> NSEvent {
    try XCTUnwrap(
      NSEvent.mouseEvent(
        with: .leftMouseDown, location: .zero, modifierFlags: [], timestamp: 0,
        windowNumber: panel.windowNumber, context: nil, eventNumber: 1, clickCount: 1, pressure: 1))
  }
  @MainActor
  func testRejectedResizeKeepsPairLockBeforeAndAfterRelease() throws {
    let presenter = ActiveReminderPanelController(
      feedback: { _ in }, geometry: { PetGeometry(bounds: $0.visibleFrame, obstacles: []) })
    defer { presenter.reset() }
    let items = [fixture(1), fixture(2)]
    try presenter.show(items, preview: true, pending: [], errors: [:], stale: false)
    let a = try XCTUnwrap(presenter.panels[items[0].cardID])
    let b = try XCTUnwrap(presenter.panels[items[1].cardID])
    let area = try XCTUnwrap(a.screen).visibleFrame
    a.setFrame(
      CGRect(x: area.minX + 100, y: area.minY + 150, width: 240, height: 100), display: true)
    b.setFrame(CGRect(x: a.frame.maxX, y: a.frame.minY, width: 240, height: 100), display: true)
    presenter.toggleJoin(items[0].cardID, peer: items[1].cardID, all: false)
    let frames = presenter.visibleFrames
    let edges = presenter.locks
    let resize = try XCTUnwrap(
      a.contentView?.subviews.compactMap { $0 as? ActiveReminderResizeView }.first {
        $0.edge == .east
      })
    var point = CGPoint(x: a.frame.maxX, y: a.frame.midY)
    resize.pointer = { _ in point }
    let event = try pointerEvent(a)
    resize.mouseDown(with: event)
    point.x += 30
    resize.mouseDragged(with: event)
    XCTAssertEqual(presenter.visibleFrames, frames)
    XCTAssertEqual(
      presenter.locks, edges, "A rejected proposal must never prune accepted lock intent")
    resize.mouseUp(with: event)
    XCTAssertEqual(presenter.visibleFrames, frames)
    XCTAssertEqual(presenter.locks, edges)
    XCTAssertEqual(presenter.component(items[0].cardID), Set(items.map(\.cardID)))
  }
  @MainActor
  func testHiddenLockedStackRefitsTogetherWhenDockSafeAreaChanges() throws {
    var bottomInset: CGFloat = 0
    let presenter = ActiveReminderPanelController(
      feedback: { _ in },
      geometry: { screen in
        let frame = screen.visibleFrame
        return PetGeometry(
          bounds: CGRect(
            x: frame.minX, y: frame.minY + bottomInset,
            width: frame.width, height: frame.height - bottomInset), obstacles: [])
      })
    presenter.interactions.snapping = false
    presenter.interactions.shake = false
    defer { presenter.reset() }
    let items = [fixture(1), fixture(2), fixture(3)]
    try presenter.show(items, preview: true, pending: [], errors: [:], stale: false)
    XCTAssertTrue(presenter.gather(items[0].cardID))
    let panel = try XCTUnwrap(presenter.panels[items[0].cardID])
    let area = try XCTUnwrap(panel.screen).visibleFrame
    let surface = try XCTUnwrap(
      panel.contentView?.subviews.compactMap { $0 as? ActiveReminderDragView }.first)
    var point = CGPoint(x: panel.frame.midX, y: panel.frame.midY)
    surface.pointer = { _ in point }
    let event = try pointerEvent(panel)
    surface.mouseDown(with: event)
    let box = ActiveReminderGrouping.bounds(presenter.visibleFrames)
    point.x += area.minX + 200 - box.minX
    point.y += area.minY + 12 - box.minY
    surface.mouseDragged(with: event)
    surface.mouseUp(with: event)
    let before = presenter.visibleFrames
    let edges = presenter.locks
    presenter.hide()
    bottomInset = 30
    try presenter.show(items, preview: true, pending: [], errors: [:], stale: false)
    for (id, frame) in before {
      XCTAssertEqual(presenter.panels[id]?.frame, frame.offsetBy(dx: 0, dy: 30))
    }
    XCTAssertEqual(presenter.locks, edges)
    XCTAssertEqual(presenter.component(items[0].cardID), Set(items.map(\.cardID)))
    XCTAssertTrue(
      ActiveReminderGrouping.valid(
        presenter.visibleFrames,
        geometry: PetGeometry(
          bounds: CGRect(
            x: area.minX, y: area.minY + 30, width: area.width, height: area.height - 30),
          obstacles: []), occupied: [:]))
  }
}

extension ActiveReminderGroupingTests {
  @MainActor
  func testHeldCardAndLockedGroupTransferToOffsetDisplayWithDockAndStayThere() async throws {
    let screen = try XCTUnwrap(NSScreen.main)
    let source = screen.visibleFrame
    let destination = CGRect(
      x: source.minX - source.width - 80, y: source.minY - 300,
      width: source.width, height: source.height)
    let dock = CGRect(x: destination.midX - 150, y: destination.minY, width: 300, height: 80)
    let sourceGeometry = PetGeometry(bounds: source, obstacles: [])
    let destinationGeometry = PetGeometry(
      bounds: CGRect(
        x: destination.minX, y: destination.minY,
        width: destination.width, height: destination.height - 22), obstacles: [dock])
    let displays = [
      ActiveReminderDisplay(frame: source, geometry: sourceGeometry),
      ActiveReminderDisplay(frame: destination, geometry: destinationGeometry),
    ]
    for count in [1, 2] {
      let presenter = ActiveReminderPanelController(
        feedback: { _ in }, geometry: { _ in sourceGeometry }, displays: { displays })
      presenter.interactions.snapping = false
      presenter.interactions.shake = false
      defer { presenter.reset() }
      let items = (1...(count + 1)).map { fixture($0) }
      try presenter.show(items, preview: true, pending: [], errors: [:], stale: false)
      let panels = try items.map { try XCTUnwrap(presenter.panels[$0.cardID]) }
      for i in 0..<count {
        panels[i].setFrameOrigin(CGPoint(x: source.midX - 120, y: source.midY + CGFloat(i) * 64))
      }
      let otherSurface = try XCTUnwrap(
        panels[count].contentView?.subviews.compactMap { $0 as? ActiveReminderDragView }.first)
      var otherPoint = CGPoint(x: panels[count].frame.midX, y: panels[count].frame.midY)
      otherSurface.pointer = { _ in otherPoint }
      let otherEvent = try pointerEvent(panels[count])
      otherSurface.mouseDown(with: otherEvent)
      otherPoint.x += destination.minX + 24 - panels[count].frame.minX
      otherPoint.y += destination.maxY - 110 - panels[count].frame.minY
      otherSurface.mouseDragged(with: otherEvent)
      otherSurface.mouseUp(with: otherEvent)
      if count == 2 { presenter.toggleJoin(items[0].cardID, peer: items[1].cardID, all: false) }
      let before = panels.map(\.frame)
      let locks = presenter.locks
      let surface = try XCTUnwrap(
        panels[0].contentView?.subviews.compactMap { $0 as? ActiveReminderDragView }.first)
      var point = CGPoint(x: panels[0].frame.midX, y: panels[0].frame.midY)
      surface.pointer = { _ in point }
      let event = try pointerEvent(panels[0])
      surface.mouseDown(with: event)
      point = CGPoint(x: destination.midX, y: destination.minY + 35)
      XCTAssertTrue(
        dock.contains(point), "Select the physical display even when its Dock covers the pointer")
      surface.mouseDragged(with: event)
      surface.mouseUp(with: event)
      let moved = panels.map(\.frame)
      let dx = moved[0].minX - before[0].minX
      let dy = moved[0].minY - before[0].minY
      for i in 0..<count {
        XCTAssertEqual(moved[i], before[i].offsetBy(dx: dx, dy: dy))
        XCTAssertTrue(destination.contains(moved[i]))
        XCTAssertFalse(source.contains(CGPoint(x: moved[i].midX, y: moved[i].midY)))
      }
      XCTAssertEqual(
        panels[count].frame, before[count], "Unrelated target-display occupancy stays fixed")
      XCTAssertTrue(
        ActiveReminderGrouping.valid(
          presenter.visibleFrames, geometry: destinationGeometry, occupied: [:]))
      XCTAssertEqual(presenter.locks, locks)
      try await Task.sleep(nanoseconds: 300_000_000)
      XCTAssertEqual(
        panels.map(\.frame), moved, "Settled placement must not jump back to the starting display")
      otherSurface.mouseDown(with: otherEvent)
      otherPoint.x += source.midX - panels[count].frame.midX
      otherPoint.y += source.midY - panels[count].frame.midY
      otherSurface.mouseDragged(with: otherEvent)
      otherSurface.mouseUp(with: otherEvent)
      XCTAssertTrue(presenter.gather(items[0].cardID))
      XCTAssertTrue(
        presenter.visibleFrames.values.allSatisfy { destination.contains($0) },
        "Gather uses the chosen card's display instead of the scattered inventory's midpoint")
      XCTAssertEqual(presenter.component(items[0].cardID).count, items.count)
    }
  }
  @MainActor
  func testCompletionShapesAndDeviceReducedMotionUpdateExistingRenderer() throws {
    let presenter = ActiveReminderPanelController(feedback: { _ in })
    defer { presenter.reset() }
    let items = [fixture(1), fixture(2, kind: "reminder")]
    try presenter.show(items, preview: true, pending: [], errors: [:], stale: false)
    let hosting = try items.map { item in
      try XCTUnwrap(
        presenter.panels[item.cardID]?.contentView?.subviews.compactMap {
          $0 as? NSHostingView<ActiveReminderCard>
        }.first)
    }
    let rect = CGRect(x: 0, y: 0, width: 16, height: 16)
    XCTAssertTrue(
      ActiveReminderCompletionShape(kind: hosting[0].rootView.item.kind).path(in: rect).contains(
        CGPoint(x: 2, y: 2)))
    XCTAssertFalse(
      ActiveReminderCompletionShape(kind: hosting[1].rootView.item.kind).path(in: rect).contains(
        CGPoint(x: 2, y: 2)))
    XCTAssertTrue(
      ActiveReminderCompletionShape(kind: "reminder").path(in: rect).contains(CGPoint(x: 8, y: 8)))
    let appearance = hosting.map { $0.rootView.appearance }
    presenter.interactions.reducedMotion = true
    for (i, view) in hosting.enumerated() {
      XCTAssertTrue(view.rootView.appearance === appearance[i])
      XCTAssertTrue(view.rootView.appearance.reducedMotion)
      XCTAssertEqual(view.rootView.appearance.cornerAnimationDuration, 0)
      XCTAssertTrue(
        presenter.panels[items[i].cardID]?.contentView?.subviews.contains(where: { $0 === view })
          == true,
        "Preference changes update the existing renderer without an inventory revision")
    }
    presenter.interactions.reducedMotion = false
    for view in hosting {
      XCTAssertEqual(
        view.rootView.appearance.reducedMotion,
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
      XCTAssertEqual(
        view.rootView.appearance.cornerAnimationDuration,
        NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? 0 : 0.12)
    }
    let output = URL(fileURLWithPath: "/tmp/nohmi-active-card-round1")
    try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
    for view in hosting {
      view.layoutSubtreeIfNeeded()
      view.displayIfNeeded()
      RunLoop.current.run(until: Date().addingTimeInterval(0.05))
      let rep = try XCTUnwrap(view.bitmapImageRepForCachingDisplay(in: view.bounds))
      view.cacheDisplay(in: view.bounds, to: rep)
      let png = try XCTUnwrap(rep.representation(using: .png, properties: [:]))
      try png.write(to: output.appendingPathComponent("\(view.rootView.item.kind).png"))
    }
  }
}
