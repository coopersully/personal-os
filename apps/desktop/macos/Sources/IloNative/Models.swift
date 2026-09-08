import CryptoKit
import Foundation

struct NotificationPreferences: Codable {
  var enabled = false
  var tasks = true
  var reminders = true
  var calendar = true
  var mail = false
  var advanceMinutes = 10
  var sound = true
  var preview = false
  var quietStart: String?
  var quietEnd: String?
  var mailAccountIds: [String] = []
  var calendarIds: [String] = []
}
struct NativeSettings: Codable {
  var serverUrl: String
  var launchAtLogin: Bool
  var petEnabled: Bool
  var petColor: String
  var petWorkspaces: [String]
  var widgetWorkspaces: [String]?
  var notifications: NotificationPreferences
}
struct WorkItem: Codable, Identifiable {
  var id: String
  var title: String
  var dueAt: String?
  var status: String?
  var completedAt: String?
  var active: Bool {
    completedAt == nil
      && !["completed", "done", "cancelled", "canceled", "deleted", "archived"].contains(
        status ?? "")
  }
}
struct CalendarItem: Codable, Identifiable {
  var id: String
  var title: String
  var startsAt: String
  var endsAt: String
  var allDay: Bool
  var conferenceUrl: String?
  var calendarId: String
  var status: String
  var active: Bool { !["cancelled", "canceled", "deleted", "declined"].contains(status) }
}
struct NativeSnapshot: Codable {
  var schemaVersion: Int
  var serverUrl: String
  var accountId: String
  var generatedAt: String
  var timeZone: String
  var tasks: [WorkItem]
  var reminders: [WorkItem]
  var events: [CalendarItem]
  var financeSummary: String?
  var stale: Bool
  var identity: String { "\(serverUrl)|\(accountId)" }
  var calendar: Calendar {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: timeZone) ?? .current
    return c
  }
  func dueToday(_ items: [WorkItem], now: Date) -> [WorkItem] {
    items.filter {
      $0.active && parseDate($0.dueAt).map { calendar.isDate($0, inSameDayAs: now) } == true
    }.sorted { ($0.dueAt ?? "") < ($1.dueAt ?? "") }
  }
  func overdue(_ items: [WorkItem], now: Date) -> [WorkItem] {
    items.filter {
      $0.active && parseDate($0.dueAt).map { $0 < calendar.startOfDay(for: now) } == true
    }
  }
  func todayEvents(now: Date) -> [CalendarItem] {
    let start = calendar.startOfDay(for: now)
    let end = calendar.date(byAdding: .day, value: 1, to: start)!
    var seen = Set<String>()
    return events.filter {
      $0.active && seen.insert($0.id).inserted && (parseDate($0.startsAt) ?? .distantFuture) < end
        && (parseDate($0.endsAt) ?? .distantPast) > start
    }.sorted { $0.startsAt < $1.startsAt }
  }
  func filtered(workspaces: [String], now: Date = Date()) -> NativeSnapshot {
    var copy = self
    if !workspaces.contains("tasks") { copy.tasks = [] }
    if !workspaces.contains("reminders") { copy.reminders = [] }
    if !workspaces.contains("calendar") { copy.events = [] }
    if !workspaces.contains("finances") { copy.financeSummary = nil }
    // Ambient storage is bounded, even if the API accidentally returns its entire history.
    let today = calendar.startOfDay(for: now)
    let tomorrow = calendar.date(byAdding: .day, value: 1, to: today)!
    func prioritized(_ items: [WorkItem]) -> [WorkItem] {
      func rank(_ item: WorkItem) -> Int {
        guard item.active, let due = parseDate(item.dueAt) else { return 3 }
        return due >= today && due < tomorrow ? 0 : (due < today ? 1 : 2)
      }
      return items.sorted { left, right in
        let a = rank(left), b = rank(right)
        if a != b { return a < b }
        return (left.dueAt ?? "", left.id) < (right.dueAt ?? "", right.id)
      }
    }
    copy.tasks = Array(prioritized(copy.tasks).prefix(100))
    copy.reminders = Array(prioritized(copy.reminders).prefix(100))
    copy.events = Array(copy.events.prefix(100))
    copy.tasks = copy.tasks.map {
      var x = $0
      x.title = String(x.title.prefix(240))
      return x
    }
    copy.reminders = copy.reminders.map {
      var x = $0
      x.title = String(x.title.prefix(240))
      return x
    }
    copy.events = copy.events.map {
      var x = $0
      x.title = String(x.title.prefix(240))
      return x
    }
    copy.financeSummary = copy.financeSummary.map { String($0.prefix(240)) }
    return copy
  }
}
func parseDate(_ raw: String?) -> Date? {
  guard let raw else { return nil }
  let f = ISO8601DateFormatter()
  f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let result = f.date(from: raw) { return result }
  f.formatOptions = [.withInternetDateTime]
  return f.date(from: raw)
}
func canonicalOrigin(_ raw: String) throws -> String {
  guard let c = URLComponents(string: raw), let scheme = c.scheme?.lowercased(),
    let host = c.host?.lowercased(), c.user == nil, c.password == nil, c.query == nil,
    c.fragment == nil, c.path.isEmpty || c.path == "/",
    scheme == "https"
      || (scheme == "http" && ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host))
  else {
    throw NativeError.message("Server must be an HTTPS origin (HTTP is allowed only on loopback)")
  }
  let normalizedHost = host.contains(":") && !host.hasPrefix("[") ? "[\(host)]" : host
  let port = c.port.flatMap {
    ($0 == 443 && scheme == "https") || ($0 == 80 && scheme == "http") ? nil : $0
  }
  return "\(scheme)://\(normalizedHost)\(port.map { ":\($0)" } ?? "")"
}
func stableID(_ parts: String...) -> String {
  "ilo."
    + SHA256.hash(data: Data(parts.joined(separator: "\u{0}").utf8)).map {
      String(format: "%02x", $0)
    }.joined()
}
func validMeetingURL(_ raw: String?) -> URL? {
  guard let raw, let u = URL(string: raw),
    ["https", "http"].contains(u.scheme?.lowercased() ?? ""), u.host != nil, u.user == nil,
    u.password == nil
  else { return nil }
  return u
}
enum NativeError: LocalizedError {
  case message(String)
  var errorDescription: String? {
    switch self {
    case .message(let s): return s
    }
  }
}

struct PlannedAlert: Equatable {
  var identifier: String
  var kind: String
  var materialID: String
  var title: String
  var body: String
  var fireAt: Date
  var path: String
  var conferenceURL: String?
}
struct AlertPlanner {
  // A conservative budget leaves room for mail and snoozes in the OS queue.
  static func plan(snapshot s: NativeSnapshot, preferences p: NotificationPreferences, now: Date)
    -> [PlannedAlert]
  {
    guard p.enabled, !s.stale else { return [] }
    var alerts: [PlannedAlert] = []
    var missed: [(String, WorkItem)] = []
    for (kind, items, enabled) in [
      ("task", s.tasks, p.tasks), ("reminder", s.reminders, p.reminders),
    ] where enabled {
      for item in items where item.active {
        guard let due = parseDate(item.dueAt) else { continue }
        if due < now.addingTimeInterval(-60) {
          missed.append((kind, item))
          continue
        }
        let fire = afterQuietHours(
          max(due, now.addingTimeInterval(1)), preferences: p, calendar: s.calendar)
        alerts.append(
          PlannedAlert(
            identifier: stableID(s.identity, kind, item.id, item.dueAt!), kind: kind,
            materialID: item.id, title: p.preview ? item.title : "\(kind.capitalized) due",
            body: p.preview ? "Due now" : "Open ilo to view details", fireAt: fire,
            path: kind == "task" ? "/tasks" : "/reminders", conferenceURL: nil))
      }
    }
    if !missed.isEmpty {
      let day = s.calendar.startOfDay(for: now).timeIntervalSince1970.description
      alerts.append(
        PlannedAlert(
          identifier: stableID(s.identity, "catchup", day), kind: "summary", materialID: "",
          title: "Work to catch up on", body: "\(missed.count) incomplete due items in ilo",
          fireAt: afterQuietHours(now.addingTimeInterval(2), preferences: p, calendar: s.calendar),
          path: "/today", conferenceURL: nil))
    }
    if p.calendar {
      for event in s.events
      where event.active && !event.allDay
        && (p.calendarIds.isEmpty || p.calendarIds.contains(event.calendarId))
      {
        guard let start = parseDate(event.startsAt), let end = parseDate(event.endsAt), end > now
        else { continue }
        let fire = afterQuietHours(
          max(
            start.addingTimeInterval(-Double(min(max(p.advanceMinutes, 0), 1440)) * 60),
            now.addingTimeInterval(1)), preferences: p, calendar: s.calendar)
        guard fire < end else { continue }
        alerts.append(
          PlannedAlert(
            identifier: stableID(s.identity, "event", event.id, event.startsAt), kind: "event",
            materialID: event.id, title: p.preview ? event.title : "Upcoming event",
            body: "Open ilo for event details", fireAt: fire, path: "/calendar",
            conferenceURL: validMeetingURL(event.conferenceUrl)?.absoluteString))
      }
    }
    var seen = Set<String>()
    return Array(
      alerts.sorted { $0.fireAt < $1.fireAt }.filter {
        $0.fireAt < now.addingTimeInterval(7 * 86400) && seen.insert($0.identifier).inserted
      }.prefix(48))
  }
  static func minutes(_ raw: String?) -> Int? {
    guard let raw else { return nil }
    let bits = raw.split(separator: ":")
    guard bits.count == 2, let h = Int(bits[0]), let m = Int(bits[1]), (0...23).contains(h),
      (0...59).contains(m)
    else { return nil }
    return h * 60 + m
  }
  static func afterQuietHours(
    _ date: Date, preferences p: NotificationPreferences, calendar: Calendar
  ) -> Date {
    guard let start = minutes(p.quietStart), let end = minutes(p.quietEnd), start != end else {
      return date
    }
    let c = calendar.dateComponents([.hour, .minute], from: date)
    let current = (c.hour ?? 0) * 60 + (c.minute ?? 0)
    let quiet = start < end ? current >= start && current < end : current >= start || current < end
    guard quiet else { return date }
    return calendar.nextDate(
      after: date, matching: DateComponents(hour: end / 60, minute: end % 60),
      matchingPolicy: .nextTime, repeatedTimePolicy: .first) ?? date
  }
}

enum NotificationEligibility {
  static func isCurrent(
    _ info: [AnyHashable: Any], snapshot s: NativeSnapshot, preferences: NotificationPreferences,
    now: Date
  ) -> Bool {
    guard preferences.enabled, info["serverUrl"] as? String == s.serverUrl,
      info["accountId"] as? String == s.accountId, let kind = info["kind"] as? String
    else { return false }
    let id = info["id"] as? String ?? ""
    let occurrence = info["occurrence"] as? String ?? ""
    switch kind {
    case "task":
      return preferences.tasks
        && s.tasks.contains { $0.id == id && $0.active && $0.dueAt == occurrence }
    case "reminder":
      return preferences.reminders
        && s.reminders.contains { $0.id == id && $0.active && $0.dueAt == occurrence }
    case "event":
      return preferences.calendar
        && s.events.contains {
          $0.id == id && $0.active && $0.startsAt == occurrence
            && (parseDate($0.endsAt) ?? .distantPast) > now
            && (preferences.calendarIds.isEmpty || preferences.calendarIds.contains($0.calendarId))
        }
    case "mail": return preferences.mail && preferences.mailAccountIds.contains(id)
    case "summary":
      return
        (preferences.tasks
        && s.tasks.contains { $0.active && (parseDate($0.dueAt) ?? .distantFuture) < now })
        || (preferences.reminders
          && s.reminders.contains { $0.active && (parseDate($0.dueAt) ?? .distantFuture) < now })
    default: return false
    }
  }
}
