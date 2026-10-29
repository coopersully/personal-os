import XCTest
@testable import PersonalOsNative

final class PetContentWindowTests: XCTestCase {
  func testCalendarDayHonorsBothDSTTransitions() throws {
    let format = ISO8601DateFormatter()
    for (date, hours) in [("2026-03-08T12:00:00Z", 23.0), ("2026-11-01T12:00:00Z", 25.0)] {
      let range = try PetContentWindow.make("today", timeZone: "America/New_York", now: format.date(from: date)!)
      XCTAssertEqual(range.end!.timeIntervalSince(range.start) / 3600, hours)
    }
  }
  func testWeekMonthRollingAndUndatedWindow() throws {
    let format = ISO8601DateFormatter()
    let now = format.date(from: "2026-10-11T16:00:00Z")!
    let week = try PetContentWindow.make("week", timeZone: "America/New_York", now: now)
    XCTAssertEqual(format.string(from: week.start), "2026-10-11T04:00:00Z")
    let month = try PetContentWindow.make("month", timeZone: "America/New_York", now: now)
    XCTAssertEqual(format.string(from: month.end!), "2026-11-01T04:00:00Z")
    let rolling = try PetContentWindow.make("next30", timeZone: "America/New_York", now: now)
    XCTAssertEqual(format.string(from: rolling.end!), "2026-11-10T05:00:00Z")
    XCTAssertNil(try PetContentWindow.make("allUpcoming", timeZone: "UTC", now: now).end)
    XCTAssertThrowsError(try PetContentWindow.make("invalid", timeZone: "UTC", now: now))
    XCTAssertThrowsError(try PetContentWindow.make("today", timeZone: "invalid", now: now))
  }
}
