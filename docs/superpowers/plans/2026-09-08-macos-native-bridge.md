# Native companion implementation contract

Read the approved spec sections on notifications, pet and widgets for behavior. Own only `apps/desktop/macos/**`; parent owns Rust, web, API, global scripts. You are not alone; do not revert others' work. Do not spawn agents. Use public macOS 14+ APIs. Work through compilation/tests and report real limits.

Build Swift Package named `IloNative` in `apps/desktop/macos` with product `.library(name: "IloNative", type: .static, targets: ["IloNative"])`; no external package dependencies needed. Parent links with `swift-rs` SwiftLinker.with_package("IloNative", "../macos").

C ABI exports:
- `ilo_native_set_callback(callback: @convention(c) (UnsafePointer<CChar>?) -> Void)` registers host action callback. Callback receives JSON owned by Swift for duration of call; Rust copies it immediately.
- `ilo_native_dispatch(_ request: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar>?` decodes JSON, returns strdup(JSON result); parent frees via libc::free. Called on main thread. Every result is `{ "ok":true, ... }` or `{ "ok":false, "error":"..." }`.

Operations (`op` JSON key):
- `configure`: `settings` object described below, initializes pet/settings and login setting. Only change login registration when requested value differs from actual; report system status. No permission request implicitly from configure.
- `snapshot`: `snapshot` described below; update pet and widget shared JSON, reconcile scheduled alerts. Notification planning should be testable without OS services.
- `clear`: clear private snapshots, pet menu and pending/delivered notifications.
- `status`: return `notificationPermission` string (notDetermined/authorized/denied), `launchAtLogin` bool, `loginStatus` string, `widgetsAvailable` bool (shared container usable), optional error.
- `request_notification_permission`, `test_notification`, `reset_pet_position`, `quick_access`, `open_notification_settings`.
- `mail`: `id`, `title`, `body`, `path`, `accountId`, `serverUrl` sends arrival alert subject to configured preferences; dedupe stable OS id.
- `keychain_get`, `keychain_set`, `keychain_delete`: `serverUrl` and optional `value` string. Service `app.personal-os.desktop.session`; account is canonical server origin. Return `value` string/null. No secrets in logs or ambient snapshots.

settings shape: `{serverUrl:string,launchAtLogin:boolean,petEnabled:boolean,petColor:string,petWorkspaces:string[],notifications:{enabled:boolean,tasks:boolean,reminders:boolean,calendar:boolean,mail:boolean,advanceMinutes:number,sound:boolean,preview:boolean,quietStart:string|null,quietEnd:string|null,mailAccountIds:string[],calendarIds:string[]}}`. Workspace ids `tasks`, `reminders`, `calendar`, `finances`, `mail`, `goals`, `motives`. Empty mailAccountIds means no mail notifications. Empty calendarIds means all selected calendars.

snapshot shape: `{schemaVersion:1,serverUrl:string,accountId:string,generatedAt:string,timeZone:string,tasks:[{id,title,dueAt:string|null,status,completedAt:string|null}],reminders:[{id,title,dueAt:string|null,completedAt:string|null}],events:[{id,title,startsAt,endsAt,allDay:boolean,conferenceUrl:string|null,calendarId,status}],financeSummary:string|null,stale:boolean}`. Supplied material includes today's and overdue items and upcoming event candidates; Swift filters by planning date and notification time. Swift must purge previous account/server caches on identity change. Only serialize configured widget fields, never tokens.

Callback JSON: `{action:"open",path:"/today"}` (path allowed app-relative route); `{action:"capture",kind:"task"|"reminder"|"event"}`; `{action:"complete",kind:"task"|"reminder",id:string,serverUrl:string,accountId:string}`; `{action:"join",url:string,serverUrl:string,accountId:string}`; `{action:"refresh"}`. Rust performs authenticated mutations and refresh. Snooze stays native and does not modify due date. Other native operations must not invent callback kinds without messaging parent.

Widget extension lives outside package library source directory under `Widgets/`, with native SwiftUI widget families, Info.plist, entitlements and a script to build `.appex` using Xcode/Swift tools, then embed/sign with release app on request. App Group `group.app.personal-os.desktop` configurable via build. Do not fabricate usable app-group availability if entitlement missing. Native widget interactions may open validated ilo:// links for navigation; completion must use authenticated API and fail honestly. Prefer shared Keychain scoped access when provisioning supports it. Document production provisioning requirements and include direct tests/compilation commands.

Report in `apps/desktop/macos/IMPLEMENTATION.md`: implemented behavior, commands/results, integration interface, and unresolved production acceptance. Do not claim pending permission/provisioning tests passed.
