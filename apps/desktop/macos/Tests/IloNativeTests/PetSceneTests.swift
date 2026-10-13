import AppKit
import XCTest

@testable import IloNative

final class PetSceneTests: XCTestCase {
  func testClickDoesNotBeginOrFinishADrag() throws {
    _ = NSApplication.shared
    let pet = PetView(frame: CGRect(x: 0, y: 0, width: 72, height: 72))
    var starts = 0, finishes = 0, clicks = 0
    pet.dragStart = { _ in starts += 1 }
    pet.moved = { finishes += 1 }
    pet.click = { clicks += 1 }
    let event = try XCTUnwrap(NSEvent.mouseEvent(with: .leftMouseDown, location: .zero,
      modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil,
      eventNumber: 0, clickCount: 1, pressure: 1))
    pet.mouseDown(with: event)
    pet.mouseDragged(with: event)
    pet.mouseUp(with: event)
    XCTAssertEqual(starts, 0)
    XCTAssertEqual(finishes, 0)
    XCTAssertEqual(clicks, 1)
    pet.mouseUp(with: event)
    XCTAssertEqual(clicks, 1, "An unmatched release must not toggle quick access")
  }
  func testPetDragThresholdIgnoresJitterAndDoesNotToggleOnRelease() throws {
    _ = NSApplication.shared
    let pet = PetView(frame: CGRect(x: 0, y: 0, width: 72, height: 72))
    var origins: [CGPoint] = [], finishes = 0, clicks = 0
    pet.dragStart = { origins.append($0) }
    pet.moved = { finishes += 1 }
    pet.click = { clicks += 1 }
    func event(_ type: NSEvent.EventType, x: CGFloat) throws -> NSEvent {
      try XCTUnwrap(NSEvent.mouseEvent(with: type, location: CGPoint(x: x, y: 0),
        modifierFlags: [], timestamp: 0, windowNumber: 0, context: nil,
        eventNumber: 0, clickCount: 1, pressure: 1))
    }
    pet.mouseDown(with: try event(.leftMouseDown, x: 0))
    pet.mouseDragged(with: try event(.leftMouseDragged, x: 5))
    XCTAssertTrue(origins.isEmpty)
    pet.mouseUp(with: try event(.leftMouseUp, x: 5))
    XCTAssertEqual(clicks, 1)
    pet.mouseDown(with: try event(.leftMouseDown, x: 0))
    pet.mouseDragged(with: try event(.leftMouseDragged, x: 10))
    pet.mouseDragged(with: try event(.leftMouseDragged, x: 20))
    pet.mouseUp(with: try event(.leftMouseUp, x: 20))
    XCTAssertEqual(origins, [.zero])
    XCTAssertEqual(finishes, 1)
    XCTAssertEqual(clicks, 1)
  }
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
  func testNavigationPreservesPinUntilExplicitlyUnpinned() throws {
    _ = NSApplication.shared
    let suite = "nohmi.pet.pin.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let controller = PetController(placements: PetPlacementStore(defaults: defaults))
    let owner = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 400, height: 560),
      styleMask: .borderless, backing: .buffered, defer: false)
    owner.isReleasedWhenClosed = false
    defer { controller.clearOverlay(); owner.close() }
    let address = UInt64(UInt(bitPattern: Unmanaged.passUnretained(owner).toOpaque()))
    try controller.prepareOverlay(windowAddress: address)
    try controller.readyOverlay(windowAddress: address)
    func shields() -> [NSWindow] {
      NSApp.windows.filter { $0.title == "nohmi quick access dismissal" && $0.isVisible }
    }
    XCTAssertEqual(shields().count, NSScreen.screens.count)
    controller.setPinned(true)
    XCTAssertTrue(shields().isEmpty, "Pinned quick access must allow interaction with other apps")
    controller.dismissForNavigation()
    XCTAssertEqual(controller.presentationState["visible"] as? Bool, true)
    controller.closeOverlay(immediately: true)
    XCTAssertEqual(controller.presentationState["pinned"] as? Bool, true)
    try controller.readyOverlay(windowAddress: address)
    XCTAssertEqual(controller.presentationState["pinned"] as? Bool, true)
    controller.setPinned(false)
    // Reopening restores the transient dismissal surface without changing pin intent.
    try controller.prepareOverlay(windowAddress: address)
    try controller.readyOverlay(windowAddress: address)
    XCTAssertEqual(shields().count, NSScreen.screens.count)
    let shield = try XCTUnwrap(shields().first)
    XCTAssertTrue(shield.collectionBehavior.contains(.fullScreenAuxiliary))
    XCTAssertFalse(shield.collectionBehavior.contains(.fullScreenNone))
    let view = try XCTUnwrap(shield.contentView)
    let event = try XCTUnwrap(NSEvent.mouseEvent(with: .leftMouseDown, location: .zero,
      modifierFlags: [], timestamp: 0, windowNumber: shield.windowNumber, context: nil,
      eventNumber: 0, clickCount: 1, pressure: 1))
    view.mouseDown(with: event)
    XCTAssertEqual(controller.presentationState["visible"] as? Bool, true)
    view.mouseUp(with: event)
    XCTAssertTrue(shields().isEmpty)
    controller.dismissForNavigation()
    XCTAssertEqual(controller.presentationState["visible"] as? Bool, false)
  }
  func testShooDoesNotRecognizeWhileCardOpenOrMouseHeld() throws {
    _ = NSApplication.shared
    let suite = "nohmi.pet.shoo.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let controller = PetController(placements: PetPlacementStore(defaults: defaults))
    var preferences = settings(enabled: true)
    preferences.petShooEnabled = true
    preferences.petSleepEnabled = false
    controller.configure(preferences)
    let initial = controller.panel.frame
    for i in 0...8 {
      controller.observeShoo(at: CGPoint(x: initial.midX + (i % 2 == 0 ? 0 : 18), y: initial.midY), time: 100 + Double(i) * 0.08, buttons: 1)
    }
    XCTAssertEqual(controller.panel.frame, initial)
    let owner = NSWindow(contentRect: CGRect(x: 0, y: 0, width: 400, height: 560), styleMask: .borderless, backing: .buffered, defer: false)
    owner.isReleasedWhenClosed = false
    defer { controller.configure(settings(enabled: false)); controller.clearOverlay(); owner.close() }
    let address = UInt64(UInt(bitPattern: Unmanaged.passUnretained(owner).toOpaque()))
    try controller.prepareOverlay(windowAddress: address)
    try controller.readyOverlay(windowAddress: address)
    let open = controller.panel.frame
    for i in 0...8 {
      controller.observeShoo(at: CGPoint(x: open.midX + (i % 2 == 0 ? 0 : 18), y: open.midY), time: 200 + Double(i) * 0.08, buttons: 0)
    }
    XCTAssertEqual(controller.presentationState["visible"] as? Bool, true)
    XCTAssertEqual(controller.panel.frame, open)
  }
  func testCompactPanelRoutesOnlyVisibleArtwork() throws {
    _ = NSApplication.shared
    guard !NSScreen.screens.isEmpty else { throw XCTSkip("Requires an AppKit display") }
    let suite = "nohmi.pet.scene.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let controller = PetController(placements: PetPlacementStore(defaults: defaults))
    defer { controller.configure(settings(enabled: false)) }
    controller.configure(settings(enabled: true))
    controller.trackPointer(at: CGPoint(x: -100000, y: -100000))
    XCTAssertTrue(controller.panel.ignoresMouseEvents, "Outside pixels must pass through")
    controller.trackPointer(at: CGPoint(x: controller.panel.frame.midX, y: controller.panel.frame.midY))
    XCTAssertFalse(controller.panel.ignoresMouseEvents, "Visible body must accept input")
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

extension PetSceneTests {
  func testDisplayMigrationKeepsCurrentPlacementInsteadOfLoadingHistory() throws {
    _ = NSApplication.shared
    let screen = try XCTUnwrap(NSScreen.screens.first)
    let suite = "nohmi.pet.display-migration.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let store = PetPlacementStore(defaults: defaults)
    let controller = PetController(placements: store)
    var preferences = settings(enabled: true)
    preferences.petSleepEnabled = false
    controller.configure(preferences)
    controller.restorePosition(on: screen)
    controller.clampAndSave()
    let initial = controller.panel.frame
    let original = try XCTUnwrap(store.load(PetDisplays.id(screen)))
    store.save(PetSavedPlacement(x: 0, y: 1, anchor: 0, cardX: 0, cardY: 1,
      cardAnchor: 0, width: 800, height: 800), display: PetDisplays.id(screen))
    defer { controller.configure(settings(enabled: false)) }
    controller.migratePosition(to: screen)
    XCTAssertEqual(controller.panel.frame, initial)
    let migrated = try XCTUnwrap(store.load(PetDisplays.id(screen)))
    XCTAssertEqual(migrated.x, original.x, accuracy: 0.001)
    XCTAssertEqual(migrated.y, original.y, accuracy: 0.001)
    XCTAssertEqual(migrated.width, original.width)
    XCTAssertEqual(migrated.height, original.height)
    XCTAssertNil(migrated.anchor)
  }
}
