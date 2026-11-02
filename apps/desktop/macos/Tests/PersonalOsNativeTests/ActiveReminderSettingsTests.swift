import AppKit
import XCTest

@testable import PersonalOsNative

final class ActiveReminderSettingsTests: XCTestCase {
  func testOldDevicePreferencesDecodeWithoutResettingExistingChoices() throws {
    let old = Data(
      #"{"shake":false,"sensitivity":"high","snapping":false,"guides":true,"autoLock":true,"sounds":false,"volume":0.7,"reducedMotion":true,"returnCards":false}"#
        .utf8)
    let value = try JSONDecoder().decode(ActiveReminderInteractions.self, from: old)
    XCTAssertFalse(value.shake)
    XCTAssertEqual(value.volume, 0.7)
    XCTAssertEqual(value.startingDisplay, "pointer")
    XCTAssertEqual(value.edgeSpacing, 12)
    XCTAssertEqual(value.magnet, "eager")
    XCTAssertTrue(value.rememberPositions)
    XCTAssertFalse(value.respectFocus)
    XCTAssertEqual(
      try JSONDecoder().decode(ActiveReminderInteractions.self, from: JSONEncoder().encode(value)),
      value)
  }
  func testPlacementSpacingAndAnchorsRespectDockAndOccupancy() {
    var preferences = ActiveReminderInteractions()
    preferences.edgeSpacing = 32
    let geometry = preferences.geometry(
      PetGeometry(
        bounds: CGRect(x: 200, y: 100, width: 1400, height: 900),
        obstacles: [CGRect(x: 700, y: 100, width: 300, height: 80)]))
    let first = ActiveReminderPlacement.initial(
      in: geometry, occupied: [], anchor: "top-left", size: preferences.minimumSize)
    XCTAssertEqual(first.minX, 232)
    XCTAssertEqual(first.maxY, 968)
    let second = ActiveReminderPlacement.initial(
      in: geometry, occupied: [first], anchor: "top-left", size: preferences.minimumSize)
    XCTAssertFalse(ActiveReminderDocking.overlaps(first, second))
    XCTAssertEqual(geometry.fitCard(second), second)
    let center = ActiveReminderPlacement.initial(
      in: geometry, occupied: [], anchor: "center", size: preferences.minimumSize)
    XCTAssertEqual(center.midX, geometry.bounds.midX)
    XCTAssertEqual(center.midY, geometry.bounds.midY)
    preferences.edgeSpacing = 0
    let edge = ActiveReminderPlacement.initial(
      in: preferences.geometry(geometry), occupied: [], anchor: "top-right",
      size: preferences.minimumSize)
    XCTAssertEqual(edge.maxX, geometry.bounds.maxX)
    XCTAssertEqual(edge.maxY, geometry.bounds.maxY)
  }
  func testGentleMagnetDoesNotCaptureIntersectingDistantFootprint() {
    let frame = CGRect(x: 100, y: 100, width: 240, height: 64)
    let slot = ActiveReminderSlot(frame: frame.offsetBy(dx: 120, dy: 0), anchor: 2)
    XCTAssertNotNil(
      ActiveReminderGrouping.candidate(["a": frame], slots: [slot], radius: 40, footprint: true))
    XCTAssertNil(
      ActiveReminderGrouping.candidate(["a": frame], slots: [slot], radius: 16, footprint: false))
  }
  func testSemanticGainAndCountdownModes() {
    let previous = ActiveReminderAudio.interactions
    defer { ActiveReminderAudio.interactions = previous }
    var preferences = ActiveReminderInteractions()
    preferences.arrivalVolume = 0.2
    preferences.completionVolume = 0.7
    preferences.interactionVolume = 0
    ActiveReminderAudio.interactions = preferences
    XCTAssertEqual(ActiveReminderAudio.gain(for: .arrival), 0.2, accuracy: 0.001)
    XCTAssertEqual(ActiveReminderAudio.gain(for: .completion), 0.7, accuracy: 0.001)
    XCTAssertEqual(ActiveReminderAudio.gain(for: .failure), 0)
    let now = Date(timeIntervalSince1970: 1000)
    XCTAssertEqual(
      ActiveReminderDueText.compact(now.addingTimeInterval(125), now: now, seconds: false), "in 3m")
    XCTAssertEqual(
      ActiveReminderDueText.compact(now.addingTimeInterval(125), now: now, seconds: true),
      "in 2m 05s")
    preferences.titleLines = "two"
    preferences.textScale = "large"
    XCTAssertGreaterThan(preferences.minimumSize.height, 92)
  }
  func testFocusNeverInfersOffFromUnknownOrUnavailableConsent() {
    for status in ["on", "unknown"] {
      XCTAssertTrue(ActiveReminderFocus.blocksCards(respectFocus: true, status: status))
      XCTAssertFalse(ActiveReminderFocus.blocksCards(respectFocus: false, status: status))
    }
    XCTAssertFalse(ActiveReminderFocus.blocksCards(respectFocus: true, status: "off"))
  }
}
