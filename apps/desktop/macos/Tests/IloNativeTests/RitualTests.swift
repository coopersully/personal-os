import CryptoKit
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

extension RitualTests {
 func testUnreadableRitualCiphertextIsQuarantinedWithoutCreatingAKey() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  let url = directory.appendingPathComponent("identity.sealed")
  let other = directory.appendingPathComponent("other.unreadable-" + UUID().uuidString + ".sealed")
  try Data("other encrypted bytes".utf8).write(to: other)
  let bytes = Data("original encrypted bytes".utf8)
  try bytes.write(to: url)
  var lookups = 0
  let result = try RitualStore.readFile(url, identity: "identity", lookupKey: { lookups += 1; return nil })
  XCTAssertEqual(lookups, 1)
  XCTAssertEqual(result["storageWarning"] as? Bool, true)
  XCTAssertEqual((result["queue"] as? [Any])?.count, 0)
  XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
  let quarantines = try RitualStore.quarantinedFiles(url)
  XCTAssertEqual(quarantines.count, 1)
  XCTAssertEqual(try Data(contentsOf: quarantines[0]), bytes)
  XCTAssertEqual((try FileManager.default.attributesOfItem(atPath: quarantines[0].path)[.posixPermissions] as? NSNumber)?.intValue, 0o600)
  let subsequent = try RitualStore.readFile(url, identity: "identity", lookupKey: { XCTFail("Absent cache must not create/read keys"); return nil })
  XCTAssertEqual(subsequent["storageWarning"] as? Bool, true)
  try RitualStore.deleteFiles(url)
  XCTAssertTrue(try RitualStore.quarantinedFiles(url).isEmpty)
  XCTAssertTrue(FileManager.default.fileExists(atPath: other.path))
  let cleared = try RitualStore.readFile(url, identity: "identity", lookupKey: { nil })
  XCTAssertNil(cleared["storageWarning"])
 }
 func testCorruptCiphertextIsQuarantinedButLockedKeychainIsNot() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  let url = directory.appendingPathComponent("identity.sealed")
  let bytes = Data("corrupt ciphertext".utf8)
  try bytes.write(to: url)
  XCTAssertThrowsError(try RitualStore.readFile(url, identity: "identity", lookupKey: { throw NativeError.message("Keychain access denied") }))
  XCTAssertEqual(try Data(contentsOf: url), bytes)
  XCTAssertTrue(try RitualStore.quarantinedFiles(url).isEmpty)
  let recovered = try RitualStore.readFile(url, identity: "identity", lookupKey: { SymmetricKey(size: .bits256) })
  XCTAssertEqual(recovered["storageWarning"] as? Bool, true)
  XCTAssertEqual(try RitualStore.quarantinedFiles(url).count, 1)
 }
 func testValidEncryptedRitualCacheRemainsReadable() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: directory) }
  let url = directory.appendingPathComponent("identity.sealed")
  let key = SymmetricKey(size: .bits256)
  let plain = try JSONSerialization.data(withJSONObject: ["queue": [["answer": "private"]]])
  let sealed = try AES.GCM.seal(plain, using: key, authenticating: Data("identity".utf8))
  try XCTUnwrap(sealed.combined).write(to: url)
  let restored = try RitualStore.readFile(url, identity: "identity", lookupKey: { key })
  XCTAssertNil(restored["storageWarning"])
  XCTAssertEqual((restored["queue"] as? [[String: String]])?.first?["answer"], "private")
  XCTAssertTrue(try RitualStore.quarantinedFiles(url).isEmpty)
 }
}
