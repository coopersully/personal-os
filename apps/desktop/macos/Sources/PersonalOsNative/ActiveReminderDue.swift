import Combine
import Foundation

final class ActiveReminderClock: ObservableObject {
  @Published var now = Date()
  private var labelDay = ""
  private var labels: [Date: String] = [:]
  func absoluteLabel(for due: Date) -> String {
    let calendar = Calendar.autoupdatingCurrent
    let day =
      "\(calendar.startOfDay(for: now))|\(calendar.timeZone.identifier)|\(Locale.autoupdatingCurrent.identifier)"
    if labelDay != day {
      labels = [:]
      labelDay = day
    }
    if let label = labels[due] { return label }
    let label = ActiveReminderDueText.absolute(due, now: now)
    labels[due] = label
    return label
  }
}
enum ActiveReminderDueText {
  static func compact(_ due: Date, now: Date) -> String {
    let delta = Int(ceil(due.timeIntervalSince(now)))
    let seconds = abs(delta)
    let h = seconds / 3600
    let m = seconds % 3600 / 60
    let s = seconds % 60
    let duration =
      h >= 24
      ? "\(h / 24)d \(h % 24)h"
      : h > 0
        ? String(format: "%dh %02dm", h, m)
        : m > 0 ? String(format: "%dm %02ds", m, s) : String(format: "%02ds", s)
    return delta == 0 ? "now" : delta < 0 ? "\(duration) late" : "in \(duration)"
  }
  static func relative(_ due: Date, now: Date) -> String {
    let interval = due.timeIntervalSince(now)
    if abs(interval) < 1 { return "Due now" }
    let seconds = Int(ceil(abs(interval)))
    let amount: String
    if seconds >= 86400 {
      let days = seconds / 86400
      let hours = (seconds % 86400) / 3600
      amount = "\(days) \(days == 1 ? "day" : "days")" + (hours > 0 ? " \(hours) hr" : "")
    } else if seconds >= 3600 {
      let hours = seconds / 3600
      let minutes = (seconds % 3600) / 60
      amount = "\(hours) hr" + (minutes > 0 ? " \(minutes) min" : "")
    } else if seconds >= 60 {
      let minutes = seconds / 60
      let remainder = seconds % 60
      amount = "\(minutes) min" + (remainder > 0 ? " \(remainder) sec" : "")
    } else {
      amount = "\(seconds) sec"
    }
    return (interval > 0 ? "Due in " : "Overdue by ") + amount
  }
  static func absolute(
    _ due: Date, now: Date, calendar: Calendar = .autoupdatingCurrent,
    locale: Locale = .autoupdatingCurrent
  ) -> String {
    let formatter = DateFormatter()
    formatter.locale = locale
    formatter.calendar = calendar
    formatter.timeZone = calendar.timeZone
    formatter.timeStyle = .short
    if calendar.isDate(due, inSameDayAs: now) { return formatter.string(from: due) }
    if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now),
      calendar.isDate(due, inSameDayAs: tomorrow)
    {
      return "Tmr · " + formatter.string(from: due)
    }
    formatter.dateStyle = .medium
    return formatter.string(from: due)
  }
}
