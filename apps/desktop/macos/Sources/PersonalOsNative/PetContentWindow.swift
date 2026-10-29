import Foundation

/// Calendar arithmetic follows the account timezone and nohmi's Sunday-start calendar.
struct PetContentWindow {
  let start: Date
  let end: Date?
  let today: Date
  let label: String
  let timeZone: String
  static func make(_ selection: String, timeZone: String, now: Date) throws -> PetContentWindow {
    guard let zone = TimeZone(identifier: timeZone) else { throw NativeError.message("Invalid account timezone") }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    calendar.firstWeekday = 1
    let today = calendar.startOfDay(for: now)
    var start = today
    var end: Date?
    let label: String
    switch selection {
    case "today": label = "Today"; end = calendar.date(byAdding: .day, value: 1, to: today)
    case "week":
      label = "This week"
      start = calendar.date(byAdding: .day, value: -(calendar.component(.weekday, from: today) - 1), to: today)!
      end = calendar.date(byAdding: .day, value: 7, to: start)
    case "month":
      label = "This month"
      start = calendar.date(from: calendar.dateComponents([.year, .month], from: today))!
      end = calendar.date(byAdding: .month, value: 1, to: start)
    case "next7": label = "Next 7 days"; end = calendar.date(byAdding: .day, value: 7, to: today)
    case "next30": label = "Next 30 days"; end = calendar.date(byAdding: .day, value: 30, to: today)
    case "last30":
      label = "Last 30 days"; start = calendar.date(byAdding: .day, value: -29, to: today)!
      end = calendar.date(byAdding: .day, value: 1, to: today)
    case "allUpcoming": label = "All upcoming"; end = nil
    default: throw NativeError.message("Invalid pet date window")
    }
    return PetContentWindow(start: start, end: end, today: today, label: label, timeZone: timeZone)
  }
  var json: [String: Any] {
    let iso = ISO8601DateFormatter()
    let date = DateFormatter()
    date.locale = Locale(identifier: "en_US_POSIX")
    date.timeZone = TimeZone(identifier: timeZone)
    date.dateFormat = "yyyy-MM-dd"
    return ["start": iso.string(from: start), "end": end.map { iso.string(from: $0) } as Any? ?? NSNull(),
      "today": iso.string(from: today), "fromDate": date.string(from: start), "throughDate": date.string(from: today),
      "label": label, "timeZone": timeZone]
  }
}
