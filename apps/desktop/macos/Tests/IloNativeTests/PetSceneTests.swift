import AppKit
import XCTest

@testable import IloNative

final class PetSceneTests: XCTestCase {
  private func settings(enabled: Bool, scale: Double = 1) -> NativeSettings {
    NativeSettings(
      serverUrl: "https://api.example.com", launchAtLogin: false,
      petEnabled: enabled, petColor: "#33aaff", petScale: scale,
      petWorkspaces: ["tasks"], notifications: NotificationPreferences())
  }
  func testTrayQuickAccessWorksWithoutEnablingAmbientPet() throws {
    _ = NSApplication.shared
    guard !NSScreen.screens.isEmpty else { throw XCTSkip("Requires an AppKit display") }
    let suite = "nohmi.pet.scene.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let controller = PetController(placements: PetPlacementStore(defaults: defaults))
    let owner = NSWindow(
      contentRect: CGRect(x: 0, y: 0, width: 400, height: 560),
      styleMask: .borderless, backing: .buffered, defer: false)
    owner.isReleasedWhenClosed = false
    defer {
      controller.clearOverlay()
      owner.close()
    }
    controller.configure(settings(enabled: false))
    let address = UInt64(UInt(bitPattern: Unmanaged.passUnretained(owner).toOpaque()))
    try controller.prepareOverlay(windowAddress: address)
    try controller.readyOverlay(windowAddress: address)
    XCTAssertTrue(controller.panel.isVisible)
    XCTAssertEqual(controller.presentationState["visible"] as? Bool, true)
    controller.configure(settings(enabled: false))
    XCTAssertTrue(
      controller.panel.isVisible, "Background preference refresh must not dismiss tray access")
    controller.closeOverlay(immediately: true)
    XCTAssertFalse(controller.panel.isVisible, "Closing must not enable the ambient pet")
  }
  func testCompactPanelRemainsClickableBeforeReceivingPointerMovement() throws {
    _ = NSApplication.shared
    guard !NSScreen.screens.isEmpty else { throw XCTSkip("Requires an AppKit display") }
    let suite = "nohmi.pet.scene.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let controller = PetController(placements: PetPlacementStore(defaults: defaults))
    defer { controller.configure(settings(enabled: false)) }
    controller.configure(settings(enabled: true))
    controller.trackPointer(at: CGPoint(x: -100000, y: -100000))
    XCTAssertFalse(controller.panel.ignoresMouseEvents)
    XCTAssertGreaterThan(controller.panel.level.rawValue, Int(CGWindowLevelForKey(.dockWindow)))
  }
  func testClosingSnappedCardAndResetKeepTheCompactAnchor() throws {
    _ = NSApplication.shared
    let screen = try XCTUnwrap(NSScreen.main)
    let suite = "nohmi.pet.scene.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let controller = PetController(placements: PetPlacementStore(defaults: defaults))
    let owner = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 400, height: 560),
      styleMask: .borderless, backing: .buffered, defer: false)
    owner.isReleasedWhenClosed = false
    defer { controller.configure(settings(enabled: false)); controller.clearOverlay(); owner.close() }
    controller.configure(settings(enabled: true))
    controller.restorePosition(on: screen)
    let address = UInt64(UInt(bitPattern: Unmanaged.passUnretained(owner).toOpaque()))
    try controller.prepareOverlay(windowAddress: address)
    try controller.readyOverlay(windowAddress: address)
    controller.snapCard(to: 6)
    controller.closeOverlay(immediately: true)
    let geometry = PetDisplays.geometry(screen)
    let anchors = geometry.anchors(size: CGSize(width: 72, height: 72))
    XCTAssertEqual(controller.panel.frame.minX, anchors[6].minX, accuracy: 1)
    XCTAssertEqual(controller.panel.frame.minY, anchors[6].minY, accuracy: 1)
    controller.resetPosition()
    XCTAssertEqual(controller.panel.frame.minX, anchors[4].minX, accuracy: 1)
    XCTAssertEqual(controller.panel.frame.minY, anchors[4].minY, accuracy: 1)
  }
  func testPetContextMenuExposesOnlyTheThreeRequestedActions() throws {
    _ = NSApplication.shared
    let pet = PetView(frame: CGRect(x: 0, y: 0, width: 72, height: 72))
    let event = try XCTUnwrap(NSEvent.mouseEvent(with: .rightMouseDown, location: .zero,
      modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil,
      eventNumber: 0, clickCount: 1, pressure: 1))
    let menu = try XCTUnwrap(pet.menu(for: event))
    XCTAssertEqual(menu.items.map(\.title), ["Disable pet", "Pet settings", "Open nohmi"])
    var selected: String?
    pet.contextAction = { selected = $0 }
    for item in menu.items {
      NSApp.sendAction(try XCTUnwrap(item.action), to: item.target, from: item)
      XCTAssertEqual(selected, item.representedObject as? String)
    }
  }
  func testRestingPetScaleRendersImmediately() throws {
    _ = NSApplication.shared
    guard !NSScreen.screens.isEmpty else { throw XCTSkip("Requires an AppKit display") }
    let suite = "nohmi.pet.scene.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let controller = PetController(placements: PetPlacementStore(defaults: defaults))
    defer { controller.configure(settings(enabled: false)) }
    controller.configure(settings(enabled: true))
    XCTAssertEqual(controller.panel.frame.width, 72, accuracy: 1)
    controller.configure(settings(enabled: true, scale: 2))
    XCTAssertEqual(controller.panel.frame.width, 144, accuracy: 1)
    let sprite = try XCTUnwrap(controller.panel.contentView?.subviews.first as? PetView)
    XCTAssertEqual(try XCTUnwrap(sprite.layer).frame.width, 144, accuracy: 1)
    controller.configure(settings(enabled: true, scale: 0.5))
    XCTAssertEqual(controller.panel.frame.width, 36, accuracy: 1)
    XCTAssertEqual(try XCTUnwrap(sprite.layer).frame.width, 36, accuracy: 1)
  }
}
