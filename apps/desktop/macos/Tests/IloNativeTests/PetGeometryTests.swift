import AppKit
import XCTest

@testable import IloNative

final class PetGeometryTests: XCTestCase {
  let area = CGRect(x: -1000, y: 0, width: 1000, height: 700)
  func testMeasuredDockOpensCornerLanesButKeepsLargeCardClear() throws {
    let screen = CGRect(x: 1920, y: -275, width: 1512, height: 982)
    let dock = try XCTUnwrap(PetDock.resolve(
      CGRect(x: 2320, y: 1281, width: 712, height: 74), screen: screen, desktopTop: 1080))
    XCTAssertEqual(dock, CGRect(x: 2320, y: -275, width: 712, height: 74))
    let geometry = PetDisplays.resolvedGeometry(
      frame: screen, visible: CGRect(x: 1920, y: -201, width: 1512, height: 875),
      dockFrames: [dock], hiddenDock: false)
    for index in [4, 6] {
      let anchor = geometry.anchors(size: CGSize(width: 72, height: 72))[index]
      XCTAssertEqual(anchor.minY, -263)
      XCTAssertEqual(geometry.tucked(frame: anchor, anchor: index)?.1, .top)
    }
    let card = geometry.fitCard(CGRect(x: 1932, y: -263, width: 1400, height: 500))
    XCTAssertFalse(card.intersects(dock))
    XCTAssertGreaterThanOrEqual(card.minY, dock.maxY)
  }
  func testDockMeasurementRejectsFullscreenAndUnrelatedDisplay() {
    let screen = CGRect(x: 0, y: 0, width: 1920, height: 1080)
    XCTAssertNil(PetDock.resolve(screen, screen: screen, desktopTop: 1080))
    XCTAssertNil(PetDock.resolve(CGRect(x: 3000, y: 1000, width: 300, height: 80),
      screen: screen, desktopTop: 1080))
    XCTAssertEqual(PetDock.resolve(CGRect(x: 0, y: 200, width: 74, height: 700),
      screen: screen, desktopTop: 1080), CGRect(x: 0, y: 180, width: 74, height: 700))
  }
  func testSnappedCardClosesToCompactAnchorRatherThanAttachedHead() {
    let geometry = PetGeometry(bounds: area, obstacles: [CGRect(x: -650, y: 0, width: 300, height: 70)])
    let size = CGSize(width: 72, height: 72)
    for anchor in 0..<8 {
      let card = geometry.card(size: CGSize(width: 400, height: 560), anchor: anchor, near: .zero)
      let head = geometry.petFrame(card: card, size: 72, edge: .top)
      XCTAssertEqual(geometry.closedPet(frame: head, size: size, anchor: anchor), geometry.anchors(size: size)[anchor])
    }
    let free = CGRect(x: -500, y: 400, width: 72, height: 72)
    XCTAssertEqual(geometry.closedPet(frame: free, size: size, anchor: nil), free)
  }
  func testFacialContrastUsesPetColorInsteadOfSystemTheme() {
    XCTAssertEqual(PetView.facialColor(for: .black), .white)
    XCTAssertEqual(PetView.facialColor(for: .white), .black)
    XCTAssertEqual(PetView.facialColor(for: NSColor(srgbRed: 0.05, green: 0.1, blue: 0.2, alpha: 1)), .white)
    XCTAssertEqual(PetView.facialColor(for: .yellow), .black)
  }
  func testIdleDelayIsConfigurableAndInactivityRestartsIt() {
    var idle = PetIdlePolicy()
    XCTAssertFalse(idle.update(now: 10, eligible: true, delay: 20))
    XCTAssertFalse(idle.update(now: 29, eligible: true, delay: 20))
    XCTAssertTrue(idle.update(now: 30, eligible: true, delay: 20))
    XCTAssertFalse(idle.update(now: 31, eligible: false, delay: 20))
    XCTAssertFalse(idle.update(now: 32, eligible: true, delay: 20))
  }
  func testUnknownDockBlocksCornersAndTheirHiddenPose() throws {
    let geometry = PetDisplays.resolvedGeometry(
      frame: CGRect(x: 1920, y: -275, width: 1512, height: 982),
      visible: CGRect(x: 1920, y: -201, width: 1512, height: 876),
      dockFrames: [], hiddenDock: false)
    let anchors = geometry.anchors(size: CGSize(width: 72, height: 72))
    for index in [4, 6] {
      XCTAssertGreaterThanOrEqual(anchors[index].minY, -201)
      let pose = try XCTUnwrap(geometry.tucked(frame: anchors[index], anchor: index))
      XCTAssertEqual(pose.0.minY, anchors[index].minY)
      XCTAssertEqual(pose.1, index == 4 ? .left : .right)
    }
    XCTAssertGreaterThanOrEqual(anchors[5].minY, -201)
    XCTAssertGreaterThanOrEqual(
      geometry.card(size: CGSize(width: 400, height: 560), anchor: 4, near: .zero).minY, -189)
  }
  func testUnknownDockKeepsDraggedCardsAndMidpointPeeksOutOfReservedStrip() {
    let geometry = PetDisplays.resolvedGeometry(
      frame: CGRect(x: 0, y: 0, width: 1920, height: 1080),
      visible: CGRect(x: 0, y: 74, width: 1920, height: 976),
      dockFrames: [], hiddenDock: false)
    let card = geometry.fitCard(CGRect(x: 12, y: 12, width: 400, height: 560))
    XCTAssertEqual(card.minY, 86)
    XCTAssertEqual(geometry.bounds.maxY, 1050)
    let anchors = geometry.anchors(size: CGSize(width: 72, height: 72))
    XCTAssertNil(geometry.tucked(frame: anchors[5], anchor: 5))
    XCTAssertEqual(geometry.tucked(frame: anchors[4], anchor: 4)?.1, .left)
    XCTAssertEqual(geometry.tucked(frame: anchors[6], anchor: 6)?.1, .right)
  }
  func testHiddenDockLeavesPhysicalBottomAvailableToCards() {
    let geometry = PetDisplays.resolvedGeometry(
      frame: area, visible: area.insetBy(dx: 0, dy: 70), dockFrames: [], hiddenDock: true)
    XCTAssertNil(geometry.conservativeCardBounds)
    XCTAssertEqual(
      geometry.card(size: CGSize(width: 320, height: 400), anchor: 4, near: .zero).minY, 12)
  }
  func testKnownDockFitsSmallCardsBesideItAndLargeCardsAboveIt() {
    let dock = CGRect(x: -650, y: 0, width: 300, height: 70)
    let geometry = PetDisplays.resolvedGeometry(
      frame: area, visible: CGRect(x: -1000, y: 70, width: 1000, height: 600),
      dockFrames: [dock], hiddenDock: false)
    XCTAssertNil(geometry.conservativeCardBounds)
    let small = geometry.card(size: CGSize(width: 300, height: 400), anchor: 4, near: .zero)
    XCTAssertEqual(small.minY, 12)
    XCTAssertFalse(small.intersects(dock))
    let large = geometry.fitCard(CGRect(x: -900, y: 12, width: 800, height: 400))
    XCTAssertGreaterThanOrEqual(large.minY, dock.maxY)
    XCTAssertFalse(large.intersects(dock))
  }
  func testWidgetsDoNotDisplacePetOrCard() {
    let widget = CGRect(x: -370, y: 480, width: 360, height: 180)
    let geometry = PetDisplays.resolvedGeometry(
      frame: area, visible: area, dockFrames: [], hiddenDock: false)
    let pet = CGRect(x: -84, y: 520, width: 72, height: 72)
    XCTAssertEqual(geometry.fit(pet), pet)
    XCTAssertTrue(geometry.anchors(size: pet.size)[2].intersects(widget))
    let card = CGRect(x: -400, y: 290, width: 380, height: 390)
    XCTAssertEqual(geometry.fitCard(card), card)
    XCTAssertNotNil(geometry.tucked(frame: pet, anchor: 3))
  }
  func testUnknownSideDockBlocksCompactAndTuckedPositions() {
    let geometry = PetDisplays.resolvedGeometry(
      frame: area, visible: CGRect(x: -930, y: 0, width: 930, height: 700),
      dockFrames: [], hiddenDock: false)
    let anchors = geometry.anchors(size: CGSize(width: 72, height: 72))
    for index in [0, 6, 7] {
      XCTAssertGreaterThanOrEqual(anchors[index].minX, -922)
    }
    XCTAssertNil(geometry.tucked(frame: anchors[7], anchor: 7))
  }
  func testSidePeeksFaceIntoTheScreen() {
    XCTAssertEqual(PetAttachment.left.angle, 90)
    XCTAssertEqual(PetAttachment.right.angle, -90)
  }
  func testPetAcceptsFirstClickWhileTheAppIsInactive() {
    let pet = PetView(frame: CGRect(x: 0, y: 0, width: 72, height: 72))
    XCTAssertTrue(pet.acceptsFirstMouse(for: nil))
  }
  func testWakeKeepsTheExposedFaceClickableUntilPointerLeaves() {
    let geometry = PetGeometry(bounds: area, obstacles: [])
    let compact = CGRect(x: -84, y: 12, width: 72, height: 72)
    let tucked = CGRect(x: -84, y: -36, width: 72, height: 72)
    let exposedFace = CGPoint(x: -48, y: 4)
    let waking = geometry.compactHitFrame(
      compact: compact, visible: compact, tucked: tucked, keepWakeArea: true)
    XCTAssertTrue(waking.contains(exposedFace))
    XCTAssertFalse(waking.contains(CGPoint(x: -48, y: -4)))
    XCTAssertFalse(
      geometry.compactHitFrame(
        compact: compact, visible: compact, tucked: tucked, keepWakeArea: false
      ).contains(exposedFace))
  }
  func testSideAnchorCentersCardWithoutPetHeadroom() {
    let geometry = PetGeometry(bounds: area, obstacles: [])
    let card = geometry.card(size: CGSize(width: 320, height: 400), anchor: 3, near: .zero)
    XCTAssertEqual(card.midY, area.midY)
    XCTAssertEqual(card.maxX, area.maxX - 12)
  }
  func testBottomCornersRemainAvailableBesideDock() {
    let dock = CGRect(x: -650, y: 0, width: 300, height: 70)
    let geometry = PetGeometry(bounds: area, obstacles: [dock])
    let anchors = geometry.anchors(size: CGSize(width: 72, height: 72))
    XCTAssertEqual(anchors.count, 8)
    XCTAssertEqual(anchors[4].minY, 12)
    XCTAssertGreaterThanOrEqual(anchors[5].minY, dock.maxY)
    XCTAssertEqual(
      geometry.snap(cursor: CGPoint(x: -5, y: 5), size: CGSize(width: 72, height: 72)), 4)
  }
  func testTopCardAttachesBelowAndFullCardCanHidePet() {
    let geometry = PetGeometry(bounds: area, obstacles: [])
    let top = geometry.card(size: CGSize(width: 320, height: 400), anchor: 2, near: .zero)
    XCTAssertEqual(geometry.attachment(card: top, petSize: 72, preferred: .top), .bottom)
    XCTAssertEqual(geometry.attachment(card: area, petSize: 144, preferred: .top), .hidden)
  }
  func testOversizedCardShrinksAboveDockInsteadOfCoveringIt() {
    let dock = CGRect(x: -800, y: 0, width: 600, height: 100)
    let geometry = PetGeometry(bounds: area, obstacles: [dock])
    let frame = geometry.fit(area)
    XCTAssertFalse(frame.intersects(dock))
    XCTAssertTrue(geometry.inset.contains(frame))
    XCTAssertGreaterThan(frame.width, 600)
  }
  func testIdlePosesUseEveryScreenEdgeAndRejectDock() {
    let geometry = PetGeometry(bounds: area, obstacles: [])
    let anchors = geometry.anchors(size: CGSize(width: 72, height: 72))
    for (anchor, edge) in [(0, PetAttachment.bottom), (3, .left), (4, .top), (7, .right)] {
      let pose = geometry.tucked(frame: anchors[anchor], anchor: anchor)
      XCTAssertEqual(pose?.1, edge)
      XCTAssertLessThan(
        pose!.0.intersection(area).width * pose!.0.intersection(area).height, 72 * 72)
    }
    let blocked = PetGeometry(
      bounds: area, obstacles: [CGRect(x: -1000, y: 0, width: 1000, height: 80)])
    XCTAssertNil(blocked.tucked(frame: anchors[4], anchor: 4))
  }
  func testSeparateDisplayProfilesPreserveCompactCardAndPinPreferences() throws {
    let suite = "nohmi.pet.test.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let store = PetPlacementStore(defaults: defaults)
    store.pinned = true
    store.save(
      PetSavedPlacement(
        x: 0.2, y: 0.3, anchor: nil, cardX: 0.7, cardY: 0.6,
        cardAnchor: nil, width: 480, height: 600), display: "external")
    store.save(
      PetSavedPlacement(
        x: 0.8, y: 0.1, anchor: 4, cardX: 0.8, cardY: 0.4,
        cardAnchor: 4), display: "builtin")
    let restored = PetPlacementStore(defaults: defaults)
    let external = try XCTUnwrap(restored.load("external"))
    XCTAssertEqual(external.x, 0.2)
    XCTAssertEqual(external.cardX, 0.7)
    XCTAssertEqual(external.width, 480)
    XCTAssertNil(external.anchor)
    XCTAssertEqual(restored.activeDisplay, "builtin")
    XCTAssertTrue(restored.pinned)
    restored.reset()
    XCTAssertNil(restored.load("external"))
    XCTAssertNil(restored.activeDisplay)
    XCTAssertTrue(restored.pinned)
  }
  func testLegacyPositionMigratesOnceWithoutMovingOrOverwritingNewPlacement() throws {
    let suite = "nohmi.pet.migration.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    defaults.set(["display": "42", "x": 0.3, "y": 0.6], forKey: "ilo.pet.position")
    let store = PetPlacementStore(defaults: defaults)
    XCTAssertEqual(store.legacyDisplay, "42")
    let visible = CGRect(x: -1000, y: 70, width: 1000, height: 600)
    let geometry = PetGeometry(bounds: area, obstacles: [])
    store.migrateLegacy(
      display: "external-uuid", visible: visible, geometry: geometry,
      size: CGSize(width: 72, height: 72))
    let saved = try XCTUnwrap(store.load("external-uuid"))
    XCTAssertEqual(
      area.minX + saved.x * (area.width - 72), visible.minX + 0.3 * (visible.width - 72),
      accuracy: 0.001)
    XCTAssertEqual(
      area.minY + saved.y * (area.height - 72), visible.minY + 0.6 * (visible.height - 72),
      accuracy: 0.001)
    XCTAssertNil(saved.anchor)
    XCTAssertNil(defaults.object(forKey: "ilo.pet.position"))
    XCTAssertEqual(store.activeDisplay, "external-uuid")
    defaults.set(["display": "42", "x": 0.9, "y": 0.1], forKey: "ilo.pet.position")
    store.migrateLegacy(
      display: "external-uuid", visible: visible, geometry: geometry,
      size: CGSize(width: 72, height: 72))
    XCTAssertEqual(store.load("external-uuid")?.x, saved.x)
    XCTAssertNil(defaults.object(forKey: "ilo.pet.position"))
  }
  func testIdleRequiresThreeUninterruptedEligibleSeconds() {
    var idle = PetIdlePolicy()
    XCTAssertFalse(idle.update(now: 100, eligible: true))
    XCTAssertFalse(idle.update(now: 102.99, eligible: true))
    XCTAssertTrue(idle.update(now: 103, eligible: true))
    XCTAssertFalse(idle.update(now: 104, eligible: false))
    XCTAssertFalse(idle.update(now: 200, eligible: true))
    XCTAssertFalse(idle.update(now: 202, eligible: true))
  }
}
