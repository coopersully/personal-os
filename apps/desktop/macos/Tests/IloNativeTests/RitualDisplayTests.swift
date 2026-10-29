import AppKit
import XCTest
@testable import IloNative

final class RitualDisplayTests: XCTestCase {
 private func onMain(_ work: () -> Void) {
  if Thread.isMainThread { work() } else { DispatchQueue.main.sync(execute: work) }
 }
 private func message(_ view: NSView?) -> NSTextField? {
  guard let view else { return nil }
  if view.identifier?.rawValue == "ritual-secondary-message" { return view as? NSTextField }
  return view.subviews.compactMap { message($0) }.first
 }
 private func address(_ window: NSWindow) -> UInt64 {
  UInt64(UInt(bitPattern: Unmanaged.passUnretained(window).toOpaque()))
 }
 func testHotPlugResizeRotationScaleAndPrimarySwitchPreserveChecklistAndDraft() {
  onMain {
   _ = NSApplication.shared
   let primary = RitualDisplay(id: 1, frame: NSRect(x: 0, y: 0, width: 1440, height: 900), scale: 2)
   let left = RitualDisplay(id: 2, frame: NSRect(x: -1920, y: 0, width: 1920, height: 1080), scale: 1)
   var displays = [primary]
   let centre = NotificationCenter()
   // No test window is ordered onto the real user's desktop.
   var presentations = 0
   let manager = RitualBackdrop(displays: { displays }, sessionUnlocked: { true },
                                orderFront: { _ in presentations += 1 }, notifications: centre)
   let checklist = NSWindow(contentRect: NSRect(x: 200, y: 100, width: 648, height: 500),
                            styleMask: [.borderless], backing: .buffered, defer: false)
   checklist.isReleasedWhenClosed = false
   let draft = NSTextField(string: "my unfinished answer")
   checklist.contentView?.addSubview(draft)
   defer { manager.hide(); checklist.close() }
   XCTAssertTrue(manager.styleChecklist(windowAddress: address(checklist), prepare: true))
   XCTAssertEqual(checklist.frame, primary.frame)
   XCTAssertEqual(checklist.alphaValue, 0)
   XCTAssertTrue(manager.present(kind: "morning"))
   let originalPanel = manager.windows[0]
   XCTAssertTrue(checklist.parent === originalPanel)
   XCTAssertTrue(message(originalPanel.contentView)?.isHidden == true)
   let firstCount = presentations
   XCTAssertTrue(manager.present(kind: "morning"))
   XCTAssertEqual(presentations, firstCount, "Unchanged refresh must not reorder the desktop")

   displays = [primary, left]
   centre.post(name: NSApplication.didChangeScreenParametersNotification, object: nil)
   XCTAssertEqual(manager.windows.map(\.frame), [primary.frame, left.frame])
   XCTAssertTrue(manager.windows[0] === originalPanel)
   let secondary = manager.windows[1]
   XCTAssertEqual(message(secondary.contentView)?.stringValue, "continue on your main display")
   XCTAssertFalse(message(secondary.contentView)?.isHidden ?? true)
   XCTAssertFalse(secondary.canBecomeKey)
   XCTAssertFalse(secondary.ignoresMouseEvents)
   // Unplugging the primary immediately promotes the remaining screen, even at a negative origin.
   displays = [left]
   centre.post(name: NSApplication.didChangeScreenParametersNotification, object: nil)
   XCTAssertEqual(checklist.frame, left.frame)
   XCTAssertTrue(checklist.parent === secondary)
   XCTAssertEqual(manager.windows.count, 1)
   displays = [primary, left]
   centre.post(name: NSApplication.didChangeScreenParametersNotification, object: nil)
   XCTAssertEqual(checklist.frame, primary.frame)
   // Promote the other display and change its geometry and Retina scaling simultaneously.
   let rotated = RitualDisplay(id: 2, frame: NSRect(x: 0, y: 0, width: 1080, height: 1920), scale: 2)
   let moved = RitualDisplay(id: 1, frame: NSRect(x: 1080, y: -220, width: 1440, height: 900), scale: 2)
   displays = [rotated, moved]
   centre.post(name: NSApplication.didChangeScreenParametersNotification, object: nil)
   XCTAssertEqual(checklist.frame, rotated.frame, "Use point geometry without multiplying Retina scale")
   XCTAssertTrue(checklist.parent === secondary)
   XCTAssertTrue(manager.windows[0] === secondary)
   XCTAssertTrue(message(secondary.contentView)?.isHidden == true)
   XCTAssertFalse(message(manager.windows[1].contentView)?.isHidden ?? true)
   XCTAssertTrue(draft.superview === checklist.contentView)
   XCTAssertEqual(draft.stringValue, "my unfinished answer")
   // Correct an OS resize/move immediately, without replacing the checklist's content view.
   checklist.setFrame(NSRect(x: -200, y: 90, width: 800, height: 600), display: false)
   centre.post(name: NSWindow.didResizeNotification, object: checklist)
   XCTAssertEqual(checklist.frame, rotated.frame)
   let rescaled = RitualDisplay(id: 2, frame: rotated.frame, scale: 1)
   displays = [rescaled]
   centre.post(name: NSWindow.didChangeBackingPropertiesNotification, object: checklist)
   XCTAssertEqual(manager.windows.count, 1)
   XCTAssertEqual(checklist.frame, rescaled.frame)
   XCTAssertTrue(checklist.parent === secondary)
   XCTAssertNil(originalPanel.parent)
   XCTAssertFalse(originalPanel.isVisible)
   XCTAssertEqual(draft.stringValue, "my unfinished answer")
  }
 }
 func testNoDisplaysUnknownSessionAndHideCannotLeaveBlockersOrResurrectThem() {
  onMain {
   _ = NSApplication.shared
   let display = RitualDisplay(id: 8, frame: NSRect(x: 0, y: 0, width: 1280, height: 800), scale: 1)
   var displays = [display]
   var unlocked = true
   let centre = NotificationCenter()
   let manager = RitualBackdrop(displays: { displays }, sessionUnlocked: { unlocked }, orderFront: { _ in }, notifications: centre)
   let checklist = NSWindow(contentRect: display.frame, styleMask: [.borderless], backing: .buffered, defer: false)
   checklist.isReleasedWhenClosed = false
   defer { manager.hide(); checklist.close() }
   XCTAssertTrue(manager.styleChecklist(windowAddress: address(checklist)))
   XCTAssertTrue(manager.present(kind: "night"))
   unlocked = false
   centre.post(name: NSApplication.didChangeScreenParametersNotification, object: nil)
   XCTAssertTrue(manager.windows.isEmpty)
   XCTAssertFalse(checklist.isVisible)
   unlocked = true
   centre.post(name: NSApplication.didChangeScreenParametersNotification, object: nil)
   XCTAssertTrue(manager.windows.isEmpty, "Display notifications cannot bypass the readiness handshake")
   XCTAssertFalse(manager.present(kind: "night"))
   XCTAssertTrue(manager.styleChecklist(windowAddress: address(checklist)))
   XCTAssertTrue(manager.present(kind: "night"))
   displays = []
   centre.post(name: NSApplication.didChangeScreenParametersNotification, object: nil)
   XCTAssertTrue(manager.windows.isEmpty)
   XCTAssertNil(checklist.parent)
   displays = [display]
   centre.post(name: NSApplication.didChangeScreenParametersNotification, object: nil)
   XCTAssertTrue(manager.windows.isEmpty)
   XCTAssertTrue(manager.styleChecklist(windowAddress: address(checklist)))
   XCTAssertTrue(manager.present(kind: "night"))
   manager.hide()
   centre.post(name: NSApplication.didChangeScreenParametersNotification, object: nil)
   XCTAssertTrue(manager.windows.isEmpty)
  }
 }
 func testSecondaryMessageRemainsCenteredAfterResizeAndFadeDoesNotRecreatePanels() {
  onMain {
   _ = NSApplication.shared
   let frame = NSRect(x: -1000, y: -400, width: 1000, height: 700)
   let panel = makeRitualBackdrop(frame: frame, kind: "night", reduceMotion: true,
                                  reduceTransparency: true, secondary: true)
   defer { panel.close() }
   for size in [NSSize(width: 1000, height: 700), NSSize(width: 600, height: 1200)] {
    panel.setFrame(NSRect(origin: frame.origin, size: size), display: false)
    panel.contentView?.layoutSubtreeIfNeeded()
    guard let label = message(panel.contentView), let root = panel.contentView else { XCTFail("Missing guidance"); return }
    let box = label.convert(label.bounds, to: root)
    XCTAssertEqual(box.midX, root.bounds.midX, accuracy: 1)
    XCTAssertEqual(box.midY, root.bounds.midY, accuracy: 1)
    XCTAssertLessThanOrEqual(box.width, root.bounds.width - 64)
   }
   var displays = [RitualDisplay(id: 1, frame: frame, scale: 1)]
   let centre = NotificationCenter()
   let manager = RitualBackdrop(displays: { displays }, sessionUnlocked: { true }, orderFront: { _ in }, notifications: centre)
   let checklist = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
   checklist.isReleasedWhenClosed = false
   defer { manager.hide(); checklist.close() }
   XCTAssertTrue(manager.styleChecklist(windowAddress: address(checklist)))
   XCTAssertTrue(manager.present(kind: "night"))
   _ = manager.fadeOut()
   displays.append(RitualDisplay(id: 2, frame: NSRect(x: 0, y: 0, width: 800, height: 600), scale: 1))
   centre.post(name: NSApplication.didChangeScreenParametersNotification, object: nil)
   XCTAssertEqual(manager.windows.count, 1, "A hot plug during dismissal must not create an orphan blocker")
  }
 }
}

extension RitualDisplayTests {
 func testDecorativeSkyIsBoundedSharedOnlyWithSecondaryAndClearedOnHide() {
  onMain {
   _ = NSApplication.shared
   let first = RitualDisplay(id: 1, frame: NSRect(x: 0, y: 0, width: 1000, height: 700), scale: 1)
   let second = RitualDisplay(id: 2, frame: NSRect(x: -800, y: 0, width: 800, height: 600), scale: 1)
   var connected = [first, second]
   let centre = NotificationCenter()
   let manager = RitualBackdrop(displays: { connected }, sessionUnlocked: { true }, orderFront: { _ in }, notifications: centre)
   let checklist = NSWindow(contentRect: first.frame, styleMask: [.borderless], backing: .buffered, defer: false)
   checklist.isReleasedWhenClosed = false
   defer { manager.hide(); checklist.close() }
   let pixels = Data([20, 30, 40, 255]).base64EncodedString()
   XCTAssertFalse(manager.updateSky(width: 1, height: 1, pixels: pixels))
   XCTAssertTrue(manager.styleChecklist(windowAddress: address(checklist)))
   XCTAssertTrue(manager.present(kind: "morning"))
   XCTAssertFalse(manager.updateSky(width: 401, height: 1, pixels: pixels))
   XCTAssertFalse(manager.updateSky(width: 1, height: 241, pixels: pixels))
   XCTAssertFalse(manager.updateSky(width: 1, height: 1, pixels: "bad data"))
   XCTAssertTrue(manager.updateSky(width: 1, height: 1, pixels: pixels, dark: true))
   func image(_ view: NSView?) -> NSImageView? {
    guard let view else { return nil }
    if let image = view as? NSImageView, image.identifier?.rawValue == "ritual-sky-image" { return image }
    return view.subviews.compactMap { image($0) }.first
   }
   XCTAssertTrue(image(manager.windows[0].contentView)?.isHidden == true)
   XCTAssertFalse(image(manager.windows[1].contentView)?.isHidden ?? true)
   XCTAssertNotNil(image(manager.windows[1].contentView)?.image)
   XCTAssertEqual(message(manager.windows[1].contentView)?.textColor, NSColor.white)
   connected.append(RitualDisplay(id: 3, frame: NSRect(x: 1000, y: 0, width: 700, height: 900), scale: 2))
   centre.post(name: NSApplication.didChangeScreenParametersNotification, object: nil)
   XCTAssertTrue(image(manager.windows[1].contentView)?.image === image(manager.windows[2].contentView)?.image)
   _ = manager.fadeOut()
   XCTAssertFalse(manager.updateSky(width: 1, height: 1, pixels: pixels))
   manager.hide()
   XCTAssertFalse(manager.updateSky(width: 1, height: 1, pixels: pixels))
   XCTAssertTrue(manager.styleChecklist(windowAddress: address(checklist)))
   XCTAssertTrue(manager.present(kind: "night"))
   XCTAssertNil(image(manager.windows[1].contentView)?.image, "Never reuse a previous ritual's projection")
  }
 }
}
