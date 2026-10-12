import AppKit
import QuartzCore
import XCTest
@testable import IloNative

final class PetShooTests: XCTestCase {
  let region = CGRect(x: 0, y: 0, width: 100, height: 100)
  func testReopeningAfterShooUsesTheNewAnchor() throws {
    _ = NSApplication.shared
    let screen = try XCTUnwrap(NSScreen.main)
    let suite = "nohmi.pet.shoo.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let store = PetPlacementStore(defaults: defaults)
    store.save(PetSavedPlacement(x: 1, y: 0.5, anchor: 4), display: PetDisplays.id(screen))
    let controller = PetController(placements: store)
    var settings = NativeSettings(serverUrl: "https://api.example.com", launchAtLogin: false,
      petEnabled: true, petColor: "#000000", petScale: 1, petWorkspaces: [],
      notifications: NotificationPreferences())
    settings.petSleepEnabled = false
    settings.petShooEnabled = true
    settings.petShooSensitivity = "high"
    controller.configure(settings)
    let owner = NSWindow(contentRect: CGRect(x: 0,y: 0,width: 400,height: 560),
      styleMask: .borderless, backing: .buffered, defer: false)
    owner.isReleasedWhenClosed = false
    defer { settings.petEnabled = false; controller.configure(settings); owner.close() }
    let address = UInt64(UInt(bitPattern: Unmanaged.passUnretained(owner).toOpaque()))
    func settle() {
      let end = Date().addingTimeInterval(0.9)
      while Date() < end { RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.02)) }
    }
    try controller.prepareOverlay(windowAddress: address)
    try controller.readyOverlay(windowAddress: address)
    settle()
    controller.closeOverlay(immediately: true)
    let scene = try XCTUnwrap(controller.panel.contentView)
    let sprite = try XCTUnwrap(scene.subviews.first as? PetView)
    let center = controller.panel.convertPoint(toScreen: sprite.convert(CGPoint(x: 30,y: 32), to: nil))
    let time = CACurrentMediaTime()
    for i in 0...4 {
      controller.observeShoo(at: CGPoint(x: center.x + (i % 2 == 1 ? 12 : 0), y: center.y),
        time: time + Double(i) * 0.05, buttons: 0)
    }
    settle()
    let anchor = try XCTUnwrap(store.load(PetDisplays.id(screen))?.anchor)
    XCTAssertNotEqual(anchor, 4, "Gesture must move the compact pet first")
    try controller.prepareOverlay(windowAddress: address)
    settle()
    let dashboard = try XCTUnwrap(scene.subviews.last)
    let actual = controller.panel.convertToScreen(dashboard.convert(dashboard.bounds, to: nil))
    let expected = PetDisplays.geometry(screen).card(size: CGSize(width: 400,height: 560), anchor: anchor, near: .zero)
    XCTAssertEqual(actual.midX, expected.midX, accuracy: 1)
    XCTAssertEqual(actual.midY, expected.midY, accuracy: 1)
  }
  func testDeliberateAlternatingStrokesAndSensitivity() {
    for (sensitivity, length, count): (String, CGFloat, Int) in [("low", 24, 6), ("medium", 18, 4), ("high", 12, 4)] {
      var policy = PetShoo(sensitivity: sensitivity)
      XCTAssertFalse(policy.update(point: CGPoint(x: 40, y: 40), time: 0, eligible: true, overArtwork: true, region: region))
      for index in 1...count {
        let point = CGPoint(x: index % 2 == 1 ? 40 + length : 40, y: 40)
        XCTAssertEqual(policy.update(point: point, time: Double(index) * 0.08, eligible: true, overArtwork: true, region: region), index == count)
      }
    }
  }
  func testJitterSlowHoverAndSinglePassDoNotShoo() {
    for points in [[40,41,39,40,42,40], [10,20,30,40,50,60], [40,65,40,65,40]] {
      var policy = PetShoo(sensitivity: "medium")
      for (i,x) in points.enumerated() {
        XCTAssertFalse(policy.update(point: CGPoint(x: x, y: 40), time: Double(i) * 0.2, eligible: true, overArtwork: true, region: region))
      }
    }
  }
  func testOpeningLeavingAndSparseSamplesDiscardHistory() {
    for interruption in ["open", "outside", "gap"] {
      var policy = PetShoo(sensitivity: "medium")
      for i in 0...3 {
        XCTAssertFalse(policy.update(point: CGPoint(x: i % 2 == 0 ? 40 : 60, y: 40), time: Double(i) * 0.08, eligible: true, overArtwork: true, region: region))
      }
      XCTAssertFalse(policy.update(point: CGPoint(x: interruption == "outside" ? 200 : 40, y: 40), time: interruption == "gap" ? 1 : 0.32, eligible: interruption != "open", overArtwork: true, region: region))
    }
  }
  func testCannotStartOutsideSilhouette() {
    var policy = PetShoo(sensitivity: "high")
    for i in 0...10 {
      XCTAssertFalse(policy.update(point: CGPoint(x: i % 2 == 0 ? 40 : 60, y: 40), time: Double(i) * 0.05, eligible: true, overArtwork: false, region: region))
    }
  }
  func testFarthestAnchorExcludesCurrentAndUnsafeDestinations() {
    let geometry = PetGeometry(bounds: CGRect(x: 0, y: 0, width: 1000, height: 800), obstacles: [])
    XCTAssertEqual(geometry.farthestAnchor(from: CGPoint(x: 0,y: 0), size: CGSize(width: 72,height: 72), excluding: 6), 2)
    let blocked = PetGeometry(bounds: geometry.bounds, obstacles: [geometry.bounds])
    XCTAssertNil(blocked.farthestAnchor(from: .zero, size: CGSize(width: 72,height: 72), excluding: nil))
  }
}
