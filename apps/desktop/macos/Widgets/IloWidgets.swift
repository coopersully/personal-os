import AppIntents
import Foundation
import SwiftUI
import WidgetKit

struct WorkspaceConfiguration: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Today workspaces"
  static var description = IntentDescription(
    "Choose the workspaces shown by this widget. Enable private finance summaries in ilo Desktop settings first."
  )
  @Parameter(title: "Tasks", default: true) var tasks: Bool
  @Parameter(title: "Reminders", default: true) var reminders: Bool
  @Parameter(title: "Calendar", default: true) var calendar: Bool
  @Parameter(title: "Finances", default: false) var finances: Bool
  @Parameter(title: "Mail shortcut", default: false) var mail: Bool
  @Parameter(title: "Goals shortcut", default: false) var goals: Bool
  @Parameter(title: "Motives shortcut", default: false) var motives: Bool
}
struct TodayEntry: TimelineEntry {
  let date: Date
  let snapshot: NativeSnapshot?
  let configuration: WorkspaceConfiguration
  var stale: Bool {
    snapshot?.stale != false
      || date.timeIntervalSince(parseDate(snapshot?.generatedAt) ?? .distantPast) > 900
  }
}
struct TodayProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> TodayEntry {
    TodayEntry(date: Date(), snapshot: nil, configuration: WorkspaceConfiguration())
  }
  func snapshot(for configuration: WorkspaceConfiguration, in context: Context) async -> TodayEntry
  { TodayEntry(date: Date(), snapshot: SharedSnapshotStore.read(), configuration: configuration) }
  func timeline(for configuration: WorkspaceConfiguration, in context: Context) async -> Timeline<
    TodayEntry
  > {
    let now = Date()
    let s = SharedSnapshotStore.read()
    var dates = [now, now.addingTimeInterval(900)]
    if let s {
      if let midnight = s.calendar.date(
        byAdding: .day, value: 1, to: s.calendar.startOfDay(for: now))
      {
        dates.append(midnight)
      }
      dates += s.events.flatMap {
        [parseDate($0.startsAt), parseDate($0.endsAt)].compactMap { $0 }
      }.filter { $0 > now && $0 < now.addingTimeInterval(86400) }
    }
    return Timeline(
      entries: Array(Set(dates)).sorted().prefix(24).map {
        TodayEntry(date: $0, snapshot: s, configuration: configuration)
      }, policy: .after(now.addingTimeInterval(900)))
  }
}
func widgetRoute(_ path: String) -> URL {
  var c = URLComponents()
  c.scheme = "ilo"
  c.host = "open"
  c.queryItems = [URLQueryItem(name: "path", value: path)]
  return c.url!
}

func widgetMeetingRoute(_ url: URL, snapshot: NativeSnapshot) -> URL {
  var c = URLComponents()
  c.scheme = "ilo"
  c.host = "join"
  c.queryItems = [
    URLQueryItem(name: "url", value: url.absoluteString),
    URLQueryItem(name: "serverUrl", value: snapshot.serverUrl),
    URLQueryItem(name: "accountId", value: snapshot.accountId),
  ]
  return c.url!
}

// Redirects are rejected before the session Authorization header can reach another origin.
final class WidgetTransport: NSObject, URLSessionTaskDelegate {
  let account: String
  init(account: String) { self.account = account }
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }
  func request(origin: String, path: String, token: String, method: String = "GET") async throws
    -> [String: Any]
  {
    guard let url = URL(string: origin + path) else {
      throw NativeError.message("Invalid ilo server")
    }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.timeoutInterval = 15
    request.setValue("Session \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if method == "POST" {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = Data("{\"completed\":true}".utf8)
    }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.urlCache = nil
    configuration.timeoutIntervalForResource = 20
    let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    defer { session.invalidateAndCancel() }
    let (data, response) = try await session.data(for: request)
    guard let response = response as? HTTPURLResponse else {
      throw NativeError.message("ilo did not respond")
    }
    guard (200..<300).contains(response.statusCode) else {
      if response.statusCode == 401 {
        try SharedSnapshotStore.invalidateRevokedSession(
          server: origin, account: account, rejectedToken: token)
      }
      throw NativeError.message(
        response.statusCode == 401
          ? "Sign in to ilo again" : "ilo could not complete this item (\(response.statusCode))")
    }
    guard data.count <= 1024 * 1024,
      let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw NativeError.message("Unexpected ilo response") }
    return json
  }
}
struct CompleteWorkIntent: AppIntent {
  static var title: LocalizedStringResource = "Complete ilo item"
  static var description = IntentDescription(
    "Complete the selected task or reminder in your signed-in ilo account.")
  static var openAppWhenRun = false
  @Parameter(title: "Item") var itemID: String
  @Parameter(title: "Kind") var kind: String
  @Parameter(title: "Server") var server: String
  @Parameter(title: "Account") var account: String
  init() {}
  init(itemID: String, kind: String, snapshot: NativeSnapshot) {
    self.itemID = itemID
    self.kind = kind
    self.server = snapshot.serverUrl
    self.account = snapshot.accountId
  }
  func perform() async throws -> some IntentResult {
    guard ["task", "reminder"].contains(kind),
      itemID.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
    else { throw NativeError.message("Invalid ilo item") }
    let origin = try canonicalOrigin(server)
    guard let s = SharedSnapshotStore.read(), s.serverUrl == origin, s.accountId == account else {
      throw NativeError.message("This widget belongs to a previous sign-in. Open ilo to refresh.")
    }
    guard let group = SessionKeychain.accessGroup, !group.isEmpty,
      let token = try SessionKeychain.get(origin)
    else {
      throw NativeError.message(
        "Open ilo to sign in. Widget completion requires provisioned shared Keychain access.")
    }
    let transport = WidgetTransport(account: account)
    let me = try await transport.request(origin: origin, path: "/v1/me", token: token)
    guard let user = me["user"] as? [String: Any], user["id"] as? String == account else {
      throw NativeError.message("Your ilo account changed. Open ilo to refresh.")
    }
    let collection = kind == "task" ? "tasks" : "reminders"
    let existing = try await transport.request(
      origin: origin, path: "/v1/\(collection)/\(itemID)", token: token)
    guard let raw = existing[kind],
      let current = try? JSONDecoder().decode(
        WorkItem.self, from: JSONSerialization.data(withJSONObject: raw)), current.id == itemID,
      current.active
    else {
      throw NativeError.message(
        "This item is no longer available to complete. Open ilo to refresh.")
    }
    guard SharedSnapshotStore.read()?.identity == s.identity else {
      throw NativeError.message("Your ilo account changed")
    }
    let result = try await transport.request(
      origin: origin, path: "/v1/\(collection)/\(itemID)/complete", token: token, method: "POST")
    guard let completed = result[kind] as? [String: Any], completed["id"] as? String == itemID,
      completed["completedAt"] is String || completed["status"] as? String == "completed"
    else { throw NativeError.message("ilo did not confirm completion") }
    try SharedSnapshotStore.removeCompleted(id: itemID, kind: kind, identity: s.identity)
    return .result()
  }
}
struct WidgetWorkRow: View {
  let item: WorkItem
  let kind: String
  let snapshot: NativeSnapshot
  var body: some View {
    HStack(spacing: 8) {
      Button(intent: CompleteWorkIntent(itemID: item.id, kind: kind, snapshot: snapshot)) {
        Image(systemName: "circle").font(.title3).foregroundStyle(.teal)
      }.buttonStyle(.plain).accessibilityLabel("Complete \(item.title)")
      Link(destination: widgetRoute(kind == "task" ? "/tasks" : "/reminders")) {
        Text(item.title).font(.callout).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }
}
struct WorkTodayView: View {
  let entry: TodayEntry
  @Environment(\.widgetFamily) private var family
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      if let s = entry.snapshot {
        let tasks = entry.configuration.tasks ? s.dueToday(s.tasks, now: entry.date) : []
        let reminders =
          entry.configuration.reminders ? s.dueToday(s.reminders, now: entry.date) : []
        let overdueTasks = entry.configuration.tasks ? s.overdue(s.tasks, now: entry.date) : []
        let overdueReminders =
          entry.configuration.reminders ? s.overdue(s.reminders, now: entry.date) : []
        HStack {
          Text("Today").font(.headline).foregroundStyle(.teal)
          Spacer()
          Text("\(tasks.count + reminders.count)").font(.title2.bold()).foregroundStyle(.teal)
        }
        let limit = family == .systemSmall ? 2 : (family == .systemMedium ? 3 : 7)
        ForEach(Array(tasks.prefix(limit))) { WidgetWorkRow(item: $0, kind: "task", snapshot: s) }
        ForEach(Array(reminders.prefix(max(0, limit - tasks.count)))) {
          WidgetWorkRow(item: $0, kind: "reminder", snapshot: s)
        }
        if tasks.isEmpty && reminders.isEmpty {
          Text("Nothing due today").font(.callout).foregroundStyle(.secondary)
        }
        if !overdueTasks.isEmpty || !overdueReminders.isEmpty {
          Text("\(overdueTasks.count + overdueReminders.count) earlier overdue").font(.caption)
            .foregroundStyle(.orange)
        }
        if family == .systemLarge {
          ForEach(Array(overdueTasks.prefix(2))) {
            WidgetWorkRow(item: $0, kind: "task", snapshot: s)
          }
          ForEach(Array(overdueReminders.prefix(max(0, 2 - overdueTasks.count)))) {
            WidgetWorkRow(item: $0, kind: "reminder", snapshot: s)
          }
        }
        Spacer(minLength: 0)
        freshness
      } else {
        empty
      }
    }.containerBackground(.background, for: .widget).widgetURL(widgetRoute("/today"))
  }
  var freshness: some View {
    Link(destination: widgetRoute("/today")) {
      Text(
        entry.stale
          ? "May be outdated · Open ilo"
          : "Updated \((parseDate(entry.snapshot?.generatedAt) ?? entry.date).formatted(date: .omitted, time: .shortened))"
      ).font(.caption2).foregroundStyle(.secondary)
    }
  }
  var empty: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("ilo Today").font(.headline)
      Text("Sign in to see your day").font(.callout).foregroundStyle(.secondary)
      Link("Open ilo", destination: widgetRoute("/today"))
    }
  }
}
struct GlanceView: View {
  let entry: TodayEntry
  @Environment(\.widgetFamily) private var family
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Today at a Glance").font(.headline).foregroundStyle(.teal)
      if let s = entry.snapshot {
        HStack(spacing: 18) {
          if entry.configuration.tasks {
            Link(
              "\(s.dueToday(s.tasks, now: entry.date).count) tasks",
              destination: widgetRoute("/tasks"))
          }
          if entry.configuration.reminders {
            Link(
              "\(s.dueToday(s.reminders, now: entry.date).count) reminders",
              destination: widgetRoute("/reminders"))
          }
        }.font(.callout.weight(.medium))
        if entry.configuration.calendar {
          let events = s.todayEvents(now: entry.date).filter {
            $0.allDay || (parseDate($0.endsAt) ?? .distantPast) > entry.date
          }
          ForEach(Array(events.prefix(family == .systemLarge ? 4 : 1))) { event in
            HStack {
              Link(destination: widgetRoute("/calendar")) {
                HStack {
                  RoundedRectangle(cornerRadius: 2).fill(.teal).frame(width: 3)
                  VStack(alignment: .leading, spacing: 3) {
                    Text(event.title).font(.callout.weight(.medium)).lineLimit(1)
                    Text(
                      event.allDay
                        ? "All day"
                        : (parseDate(event.startsAt)?.formatted(date: .omitted, time: .shortened)
                          ?? "")
                    ).font(.caption).foregroundStyle(.secondary)
                  }
                  Spacer()
                }.frame(maxHeight: 38)
              }
              if let url = validMeetingURL(event.conferenceUrl),
                (parseDate(event.endsAt) ?? .distantPast) > entry.date
              {
                Link("Join", destination: widgetMeetingRoute(url, snapshot: s)).font(
                  .caption.weight(.medium))
              }
            }
          }
        }
        if entry.configuration.finances, let summary = s.financeSummary {
          Link(summary, destination: widgetRoute("/finances")).font(.caption).lineLimit(2)
        }
        HStack {
          if entry.configuration.mail { Link("Mail", destination: widgetRoute("/mail")) }
          if entry.configuration.goals { Link("Goals", destination: widgetRoute("/goals")) }
          if entry.configuration.motives { Link("Motives", destination: widgetRoute("/motives")) }
        }.font(.caption)
        Spacer(minLength: 0)
        WorkTodayView(entry: entry).freshness
      } else {
        Text("Sign in to see your day").foregroundStyle(.secondary)
        Link("Open ilo", destination: widgetRoute("/today"))
      }
    }.containerBackground(.background, for: .widget).widgetURL(widgetRoute("/today"))
  }
}
struct TasksWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: "app.personal-os.desktop.tasks", intent: WorkspaceConfiguration.self,
      provider: TodayProvider()
    ) { WorkTodayView(entry: $0) }.configurationDisplayName("Tasks & Reminders Today").description(
      "Due today and earlier overdue work, with authenticated completion."
    ).supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}
struct GlanceWidget: Widget {
  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: "app.personal-os.desktop.glance", intent: WorkspaceConfiguration.self,
      provider: TodayProvider()
    ) { GlanceView(entry: $0) }.configurationDisplayName("Today at a Glance").description(
      "Upcoming events and selected workspaces."
    ).supportedFamilies([.systemMedium, .systemLarge])
  }
}
@main struct IloWidgets: WidgetBundle {
  var body: some Widget {
    TasksWidget()
    GlanceWidget()
  }
}
