import XCTest
@testable import IloNative
final class RitualTests: XCTestCase {
 func testPresentationRequiresPendingUnlockedAndDue() {
  let now = Date(timeIntervalSince1970: 1000)
  let current:[String:Any] = ["status":"pending", "dueAt":"1970-01-01T00:15:00Z", "expiresAt":"1970-01-01T00:30:00Z"]
  XCTAssertTrue(ritualShouldPresent(current, now:now, locked:false))
  XCTAssertFalse(ritualShouldPresent(current, now:now, locked:true))
  var snoozed=current; snoozed["snoozedUntil"]="1970-01-01T00:20:00Z"
  XCTAssertFalse(ritualShouldPresent(snoozed,now:now,locked:false))
  var done=current;done["status"]="completed"
  XCTAssertFalse(ritualShouldPresent(done,now:now,locked:false))
 }
}
extension RitualTests {
 func testOfflineIdentityRequiresTheSameRetainedSession() {
  let binding=ritualSessionBinding(account:"account-a",token:"session-a")
  XCTAssertEqual(ritualBoundAccount(binding,token:"session-a"),"account-a")
  XCTAssertNil(ritualBoundAccount(binding,token:"session-b"))
  XCTAssertNil(ritualBoundAccount(binding,token:nil))
 }
}

extension RitualTests {
 func testBackdropConsumesPointerInputAndStaysBelowChecklist() {
  let check = {
   _ = NSApplication.shared
   let panel = makeRitualBackdrop(frame: NSRect(x: 0, y: 0, width: 800, height: 600), kind: "morning", reduceMotion: true, reduceTransparency: false)
   XCTAssertFalse(panel.ignoresMouseEvents)
   XCTAssertLessThan(panel.level.rawValue, ritualChecklistLevel.rawValue)
   let blocker = panel.contentView?.hitTest(NSPoint(x: 20, y: 20))
   XCTAssertTrue(blocker is NSVisualEffectView)
   XCTAssertTrue(blocker?.acceptsFirstMouse(for: nil) == true)
   XCTAssertFalse(panel.canBecomeKey)
  }
  if Thread.isMainThread { check() } else { DispatchQueue.main.sync(execute: check) }
 }
}

extension RitualTests {
 func testPrivatePresentationRequiresAUsableUnlockedConsoleSession() {
  XCTAssertFalse(ritualSessionIsUnlocked(nil))
  XCTAssertFalse(ritualSessionIsUnlocked([:]))
  var session: [String: Any] = [kCGSessionOnConsoleKey as String: true, kCGSessionLoginDoneKey as String: true]
  XCTAssertTrue(ritualSessionIsUnlocked(session))
  session["CGSSessionScreenIsLocked"] = true
  XCTAssertFalse(ritualSessionIsUnlocked(session))
  session["CGSSessionScreenIsLocked"] = "unavailable"
  XCTAssertFalse(ritualSessionIsUnlocked(session))
  session["CGSSessionScreenIsLocked"] = false
  XCTAssertTrue(ritualSessionIsUnlocked(session))
  session[kCGSessionOnConsoleKey as String] = false
  XCTAssertFalse(ritualSessionIsUnlocked(session))
 }
 func testPreparationRejectsAnUnknownChecklistWindow() {
  let check = {
   _ = NSApplication.shared
   XCTAssertFalse(RitualBackdrop.shared.styleChecklist(windowAddress: UInt64.max, prepare: true))
  }
  if Thread.isMainThread { check() } else { DispatchQueue.main.sync(execute: check) }
 }
}

extension RitualTests {
 func testRapidSessionHideCannotLeaveABackdropWithoutAChecklist() {
  let check = {
   _ = NSApplication.shared
   let backdrop = RitualBackdrop.shared
   let card = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 500), styleMask: [.borderless], backing: .buffered, defer: false)
   let address = UInt64(UInt(bitPattern: Unmanaged.passUnretained(card).toOpaque()))
   _ = backdrop.styleChecklist(windowAddress: address, prepare: true)
   // Lock removes the native reference before Rust sees the notification. A
   // rapid unlock must refuse the stale ready presentation and remove blockers.
   backdrop.hide()
   XCTAssertFalse(backdrop.present(kind: "morning"))
   XCTAssertTrue(backdrop.windows.isEmpty)
   XCTAssertFalse(card.isVisible)
   XCTAssertFalse(backdrop.present(kind: "night"))
   XCTAssertTrue(backdrop.windows.isEmpty)
  }
  if Thread.isMainThread { check() } else { DispatchQueue.main.sync(execute: check) }
 }
}
