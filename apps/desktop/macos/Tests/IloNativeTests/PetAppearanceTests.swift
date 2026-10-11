import XCTest
@testable import IloNative

final class PetAppearanceTests: XCTestCase {
  func testSaveBeforeFinalPreviewPreventsLateRepaint() {
    var preview = PetAppearanceState()
    preview.begin("first")
    XCTAssertTrue(preview.accept(session: "first", revision: 1))
    preview.finish(session: "first", revision: 3)
    XCTAssertFalse(preview.active)
    XCTAssertFalse(preview.accept(session: "first", revision: 2))
    XCTAssertFalse(preview.accept(session: "first", revision: 3))
    XCTAssertTrue(preview.accept(session: "first", revision: 4))
  }
  func testNewerPreviewSurvivesOlderSaveAndRejectsStaleSession() {
    var preview = PetAppearanceState()
    preview.begin("first")
    XCTAssertTrue(preview.accept(session: "first", revision: 2))
    XCTAssertFalse(preview.accept(session: "first", revision: 1))
    preview.finish(session: "first", revision: 1)
    XCTAssertTrue(preview.active)
    preview.finish(session: "first", revision: 2)
    XCTAssertFalse(preview.active)
    preview.begin("second")
    XCTAssertFalse(preview.accept(session: "first", revision: 100))
    XCTAssertTrue(preview.accept(session: "second", revision: 1))
    preview.clear()
    XCTAssertFalse(preview.accept(session: "second", revision: 2))
  }
}
