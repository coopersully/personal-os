import XCTest

@testable import IloNative

final class PetMotionTests: XCTestCase {
  func testRebasingCollapseDestinationPreservesPetAndCardPoseOnReversal() {
    var correction = PetPoseCorrection()
    let compact = CGPoint(x: 100, y: 150)
    let attached = CGPoint(x: 600, y: 500)
    let p = 0.4
    let visible = CGPoint(
      x: compact.x * (1 - p) + attached.x * p, y: compact.y * (1 - p) + attached.y * p)
    correction.rebase(from: compact, to: visible, at: p)
    let offset = correction.offset(at: p)
    XCTAssertEqual(visible.x * (1 - p) + attached.x * p + offset.x, visible.x, accuracy: 0.0001)
    XCTAssertEqual(visible.y * (1 - p) + attached.y * p + offset.y, visible.y, accuracy: 0.0001)
    XCTAssertEqual(correction.offset(at: 0), .zero)
    XCTAssertEqual(correction.offset(at: 1), .zero)
    // Another reversal/rebase composes with the previous correction instead of resetting it.
    let next = CGPoint(x: 450, y: 300)
    let q = 0.2
    let oldOffset = correction.offset(at: q)
    let before = visible.x * (1 - q) + attached.x * q + oldOffset.x
    correction.rebase(from: visible, to: next, at: q)
    XCTAssertEqual(
      next.x * (1 - q) + attached.x * q + correction.offset(at: q).x, before, accuracy: 0.0001)
  }
  func testFreshOpeningDoesNotReplayCorrectionFromPriorClose() {
    var motion = PetTransition()
    var correction = PetPoseCorrection()
    motion.request(open: true)
    motion.advance(seconds: 0.05, reducedMotion: false)
    correction.rebase(from: .zero, to: CGPoint(x: 100, y: 50), at: motion.progress)
    XCTAssertNotEqual(correction.offset(at: motion.progress), .zero)
    motion.request(open: false)
    for _ in 0..<90 { motion.advance(seconds: 1 / 60, reducedMotion: false) }
    XCTAssertTrue(motion.isSettled)
    correction.reset()
    motion.request(open: true)
    motion.advance(seconds: 0.05, reducedMotion: false)
    XCTAssertEqual(correction.offset(at: motion.progress), .zero)
  }
  func testOpeningAndClosingSettleWithoutOvershoot() {
    var motion = PetTransition()
    XCTAssertEqual(motion.state, "idle")
    for open in [true, false] {
      motion.request(open: open)
      XCTAssertEqual(motion.state, open ? "opening" : "closing")
      for _ in 0..<90 {
        motion.advance(seconds: 1 / 60, reducedMotion: false)
        XCTAssertTrue((0...1).contains(motion.progress))
      }
      XCTAssertTrue(motion.isSettled)
      XCTAssertEqual(motion.state, open ? "open" : "idle")
    }
  }
  func testRepeatedClicksReverseFromTheCurrentPoseAndVelocity() {
    var motion = PetTransition()
    motion.request(open: true)
    for _ in 0..<6 { motion.advance(seconds: 1 / 60, reducedMotion: false) }
    let pose = motion.progress
    let velocity = motion.velocity
    motion.request(open: false)
    XCTAssertEqual(motion.progress, pose)
    XCTAssertEqual(motion.velocity, velocity)
    for index in 0..<20 {
      motion.request(open: index.isMultiple(of: 2))
      motion.advance(seconds: 1 / 120, reducedMotion: false)
      XCTAssertTrue(motion.progress.isFinite)
    }
    motion.request(open: false)
    for _ in 0..<90 { motion.advance(seconds: 1 / 60, reducedMotion: false) }
    XCTAssertEqual(motion.state, "idle")
  }
  func testDisplayRefreshRateDoesNotChangeThePose() {
    var sixty = PetTransition()
    var oneTwenty = PetTransition()
    sixty.request(open: true)
    oneTwenty.request(open: true)
    for _ in 0..<12 { sixty.advance(seconds: 1 / 60, reducedMotion: false) }
    for _ in 0..<24 { oneTwenty.advance(seconds: 1 / 120, reducedMotion: false) }
    XCTAssertEqual(sixty.progress, oneTwenty.progress, accuracy: 0.000001)
  }
  func testReducedMotionAndPrivacyCancellationCannotLeavePartialPresentation() {
    var motion = PetTransition()
    motion.request(open: true)
    for _ in 0..<9 { motion.advance(seconds: 1 / 60, reducedMotion: true) }
    XCTAssertEqual(motion.state, "open")
    motion.request(open: false, immediately: true)
    motion.advance(seconds: 10, reducedMotion: false)
    XCTAssertEqual(motion.state, "idle")
    XCTAssertEqual(motion.progress, 0)
  }
  func testInvalidClockIntervalsAndLongSleepStayFinite() {
    var motion = PetTransition()
    motion.request(open: true)
    for interval in [Double.nan, .infinity, -1, 0] {
      motion.advance(seconds: interval, reducedMotion: false)
    }
    XCTAssertEqual(motion.progress, 0)
    motion.advance(seconds: 3600, reducedMotion: false)
    XCTAssertTrue(motion.progress.isFinite)
    XCTAssertTrue((0...1).contains(motion.progress))
  }
}
