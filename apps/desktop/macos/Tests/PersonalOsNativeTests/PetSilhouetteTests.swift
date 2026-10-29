import AppKit
import XCTest
@testable import PersonalOsNative

final class PetSilhouetteTests: XCTestCase {
  func testSettledPeekDoesNotKeepADisplayClockRunning() {
    _ = NSApplication.shared
    let pet = PetView(frame: CGRect(x: 0,y: 0,width: 72,height: 72))
    let window = NSWindow(contentRect: pet.bounds, styleMask: .borderless, backing: .buffered, defer: false)
    window.isReleasedWhenClosed = false
    window.contentView = pet
    window.orderFront(nil)
    defer { pet.stopAnimation(); window.close() }
    pet.peeking = true
    pet.animationActive = true
    let until = Date().addingTimeInterval(0.5)
    while Date() < until { RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.02)) }
    // A blink can begin near this sampling point; wait beyond that short active segment.
    if pet.hasAnimationClock {
      let afterBlink = Date().addingTimeInterval(0.4)
      while Date() < afterBlink { RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.02)) }
    }
    XCTAssertFalse(pet.hasAnimationClock)
  }
  func testEyesStayCenteredInBodyForEveryBlinkAndBob() {
    for height: CGFloat in [1, 8.2, 9.2] {
      for bob: CGFloat in [-0.65, 0, 0.65] {
        let eyes = PetView.eyeRects(height: height, bob: bob)
        XCTAssertEqual((eyes[0].midX + eyes[1].midX) / 2, 36, accuracy: 0.001)
        XCTAssertEqual(eyes[0].midY, 37 + bob, accuracy: 0.001)
        XCTAssertEqual(eyes[1].midY, eyes[0].midY, accuracy: 0.001)
      }
    }
  }
  func testTransparentMarginsDoNotHitThePet() {
    _ = NSApplication.shared
    let pet = PetView(frame: CGRect(x: 0, y: 0, width: 72, height: 72))
    XCTAssertNil(pet.hitTest(CGPoint(x: 5, y: 35)), "Transparent margin must not intercept another app")
    XCTAssertNil(pet.hitTest(CGPoint(x: 35, y: 65)), "Gap above the head is not artwork")
    XCTAssertNotNil(pet.hitTest(CGPoint(x: 20, y: 49)), "Ear remains interactive")
    XCTAssertNotNil(pet.hitTest(CGPoint(x: 36, y: 32)), "Body remains interactive")
  }
  func testTopSleepRendersRotatedEarInsideVisiblePanel() throws {
    _ = NSApplication.shared
    let screen = try XCTUnwrap(NSScreen.main)
    let suite = "nohmi.pet.raster.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let placements = PetPlacementStore(defaults: defaults)
    placements.save(PetSavedPlacement(x: 0.5, y: 1, anchor: 1), display: PetDisplays.id(screen))
    let controller = PetController(placements: placements)
    var settings = NativeSettings(serverUrl: "https://api.example.com", launchAtLogin: false,
      petEnabled: true, petColor: "#000000", petScale: 1,
      petWorkspaces: [], notifications: NotificationPreferences())
    settings.petSleepAfterSeconds = 1
    controller.configure(settings)
    defer { settings.petEnabled = false; controller.configure(settings) }
    controller.trackPointer(at: CGPoint(x: -100000, y: -100000))
    let end = Date().addingTimeInterval(3)
    while Date() < end { RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.02)) }
    let scene = try XCTUnwrap(controller.panel.contentView)
    let pet = try XCTUnwrap(scene.subviews.first as? PetView)
    XCTAssertTrue(pet.peeking)
    XCTAssertNotNil(pet.hitTest(CGPoint(x: pet.frame.minX + 19, y: pet.frame.minY + 15)), "Rendered rotated ear must share input geometry")
    let bitmap = try XCTUnwrap(NSBitmapImageRep(bitmapDataPlanes: nil,
      pixelsWide: Int(scene.bounds.width), pixelsHigh: Int(scene.bounds.height), bitsPerSample: 8,
      samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
      bytesPerRow: 0, bitsPerPixel: 0))
    let context = try XCTUnwrap(NSGraphicsContext(bitmapImageRep: bitmap)?.cgContext)
    try XCTUnwrap(scene.layer).render(in: context)
    let ratio = CGFloat(bitmap.pixelsWide) / scene.bounds.width
    let x = Int((pet.frame.minX + 19) * ratio)
    let y = Int((scene.bounds.height - pet.frame.minY - 15) * ratio)
    let ear = try XCTUnwrap(bitmap.colorAt(x: x, y: y))
    XCTAssertGreaterThan(ear.alphaComponent, 0.5, "Rotated ear must be painted before screen clipping")
  }
  func testPetHasNoMouthPixels() throws {
    _ = NSApplication.shared
    let pet = PetView(frame: CGRect(x: 0, y: 0, width: 72, height: 72))
    pet.color = .black
    pet.peeking = true
    pet.peekOcclusion = 0
    let bitmap = try XCTUnwrap(pet.bitmapImageRepForCachingDisplay(in: pet.bounds))
    pet.cacheDisplay(in: pet.bounds, to: bitmap)
    // Read both y orientations: the mouth area must be uniformly black body, unlike the eyes.
    let center = try XCTUnwrap(bitmap.colorAt(x: bitmap.pixelsWide / 2, y: bitmap.pixelsHigh * 47 / 72)?.usingColorSpace(.sRGB))
    XCTAssertLessThan(center.redComponent, 0.1, "The mouth must be removed from the artwork")
  }
}
