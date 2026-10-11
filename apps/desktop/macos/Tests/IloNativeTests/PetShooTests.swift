import XCTest
@testable import IloNative

final class PetShooTests: XCTestCase {
  let region = CGRect(x: 0, y: 0, width: 100, height: 100)
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
