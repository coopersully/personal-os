# macOS desktop: exploration and proposed design

Date: 2026-09-08. Status: architecture approved; native notifications added per
user request. Application implementation has not started.

## Objective

Make ilo a dependable macOS application connected to the hosted service or a
user-selected server, with first-class native notifications, a persistent desktop
pet, reliable Pinterest wallpapers, and native desktop widgets available through
Edit Widgets.

Keep TypeScript/React and Rust/Tauri. Add Swift/AppKit/SwiftUI for macOS-specific
surfaces and WidgetKit. Proposed minimum for the new Mac experience: macOS 14.
Preserve existing Windows compilation; Windows pet and widget support are outside
this delivery.

## Current functionality and evidence

| Area | What exists | Gap or observed issue |
| --- | --- | --- |
| Main desktop app | Bundled shared React renderer in Tauri 2; resizable compact window and pin control | No tray/menu-bar lifecycle, launch-at-login setting, single-instance or deep-link integration |
| Connection | Build-time `VITE_API_BASE_URL`; API supports human `Session` authorization | Unconfigured desktop defaults to localhost; no runtime server setting; session stored under one unscoped localStorage key |
| Hosted connectivity | Documented hosts are `app.ilo.coopersully.me` and `api.ilo.coopersully.me` | At 13:47 UTC, website returned 200, API health and native-origin OPTIONS returned 503 from AWS load balancer; website `/v1/me` serves HTML, not an API response |
| Production configuration | Release builds require a production API URL and signing configuration | Checked-in Terraform allows only the website origin for CORS; native renderer origins are present only in local example configuration |
| Today data | `/v1/daily-brief` includes tasks, reminders, now/next/all-day/later events, timezone and generation time; calendar events carry conference URLs | No small native projection contract or widget snapshot; finance is a separate API surface |
| Pinterest | Public-board extraction, daily pin shuffle, grid/stack layouts, background colors, spacing, rounded corners, padding and screen preview; native wallpaper application | Renderer-owned timer; synchronous image loading and `osascript` command; no explicit download timeout/cache; failed images can all be discarded without rejecting the collage |
| Wallpaper display | Unique output path avoids macOS wallpaper URL caching; old output cleanup | Same image rendered from main-screen dimensions is applied to every display; preview uses physical dimensions while compositor uses screen points; native apply lacks process-wide serialization |
| Desktop pet | None | New native panel, animation, menu and settings |
| Desktop notifications | Task/reminder due times, calendar start times and mail projections exist | No native notification authorization, scheduler, delivery ledger or actionable categories; new mail requires reliable arrival detection beyond unread counts |
| Apple widgets | None | New WidgetKit extension, shared storage, signing, packaging and installed-app validation |

Additional wallpaper issue: packaged CSP does not permit `i.pinimg.com` in
`img-src`, although the preview loads those images. Browser preview tests do not
prove that the installed desktop preview works.

Existing API-adapter and Pinterest-service tests pass: 12 tests across two files.
They use mocked transport and do not establish live sign-in, public-board access,
wallpaper application, or native widget registration. `cargo test --locked`
also compiled the existing native app successfully; it currently contains zero
Rust tests. Xcode 26.6 and the Rust toolchain are available locally. No production
configuration was changed.

## Architecture choice

Recommended: retain the bundled Tauri/React main app and add a small native Mac
companion layer. AppKit owns the menu bar, desktop panel, login-item integration
and wallpaper application; SwiftUI renders the compact native menu and widgets.
Apple's UserNotifications framework owns system notification scheduling,
presentation and responses, coordinated by the resident native host.
The native pet uses an image sprite without another full application web view.

Alternatives considered:

- A Tauri pet web view would reuse more React code, but adds another web runtime
  and requires careful testing of transparent windows, focus, Spaces and idle cost.
- A full SwiftUI rewrite would maximize native UI reuse but duplicates the product
  interface and substantially expands maintenance and migration work.

The API remains the business boundary. `packages/domain` owns any cross-surface
snapshot/action contract. `packages/api-client` remains the typed HTTP surface for
React. Rust owns native transport and lifecycle; a narrow versioned bridge supplies
native views with snapshots and accepts typed actions. Provider integrations stay
behind the API and connector packages.

## 1. Connection, account and lifecycle foundation

- Official installed builds use the hosted HTTPS API by default. Keep local
  development pointed at its registered runtime. Verify the documented production
  hostname before finalizing release configuration; a healthy website alone does
  not verify API availability.
- Add Settings → Desktop with Server: Hosted ilo or Custom server, an API URL,
  Test connection, Save, and Reset to hosted. Make the same connection controls
  accessible before login and when the server is unavailable.
- Validate actual API responses, not just status 200. Custom servers use HTTPS;
  permit HTTP only for loopback development. Do not infer an API hostname by
  rewriting an arbitrary website address.
- Persist native sessions in macOS Keychain, scoped to canonical server origin
  and account. Native requests resolve paths against the selected server and
  never forward credentials across an origin-changing redirect. The bridge must
  not become an arbitrary URL or shell executor.
- On server change, stop old work, abort requests, clear renderer queries, native
  snapshots and pending/delivered notifications, and require authentication for
  the destination. Switching
  must not expose data or send credentials from the previous server.
- Prefer native HTTP transport for desktop to avoid requiring every custom server
  to support a web-view origin. Keep browser cookie authentication unchanged.
  Exercise login, logout, expired/revoked sessions, email verification/recovery
  and connector OAuth in an installed build. External authentication uses the
  system browser and returns to ilo through validated routing.
- The red close button hides the main window, removes the Dock icon, and keeps
  the app running in the menu bar. Reopening restores the window and Dock icon.
  The yellow minimize button retains standard macOS behavior.
- The menu bar always provides Open ilo, Quick access, Settings and Quit, including
  when the pet is disabled. Dock/Finder launches focus the existing process.
- Enable Open at login during initial desktop setup, with a settings toggle and
  accurate system registration/approval status. Use `SMAppService.mainApp`.
  Login launch starts quietly with menu bar and the enabled pet.
- Quit and Command-Q genuinely exit. Respect logout, shutdown and OS sleep;
  “always open” means resident after closing its window, not resisting explicit quit.

Acceptance: installed application signs into the selected service, switches
servers without credential/data crossover, survives window closure, reopens from
the menu bar/Finder, and launches at login without duplicate processes.

## 2. Native macOS notifications

Notifications are a core desktop capability, independent of whether the main
window is open or the pet is enabled. Deliver through `UNUserNotificationCenter`
with ilo's installed app identity, native banners/alerts, Notification Center
history, optional sounds and supported notification actions.

### Notification types and actions

| Type | Trigger | Actions |
| --- | --- | --- |
| Reminder due | An incomplete reminder reaches its due time | Open, Complete, Snooze 10 minutes |
| Task due | An incomplete, non-cancelled task reaches its due time | Open, Complete, Snooze 10 minutes |
| Upcoming calendar event | Before a selected calendar's event starts; default 10 minutes, configurable | Open event, Join meeting when a valid conference URL exists |
| New mail | A newly received inbox message arrives in an enabled mail account after the initial synchronization baseline | Open message/thread |
| Other workspace activity | Explicitly supported actionable events, such as a new finance review alert | Open the relevant item; category opt-in |

Schedule concrete recurrence occurrences separately. Never notify for completed,
cancelled or deleted material, declined meetings, or tasks/reminders without a
due time. All-day calendar alerts default off; allow a configurable alert time
when enabled. Apply the account's planning timezone for date-based choices and
correctly handle daylight saving and timezone changes.

Snooze postpones the notification, not the item's due date. Completing from a
notification uses existing authorized, audited mutation APIs, updates all desktop
surfaces and cancels related alerts. Actions revalidate server/account identity
and current item state; stale actions must not mutate a different account.
Do not report success if an action fails offline or requires renewed sign-in.
Join uses the existing validated system-browser meeting route.

### Settings and system integration

- Add Settings → Notifications, also reachable from desktop onboarding. Explain
  the feature before requesting macOS authorization. Show actual authorization
  and alert/sound availability, provide Test notification and a route to macOS
  notification settings, and recover when permission changes outside ilo.
- Provide a master toggle, separate task/reminder/calendar/mail toggles, calendar
  advance timing, per-mail-account and per-calendar selection, sounds, quiet hours
  and content-preview controls. After authorization, due tasks/reminders and
  upcoming calendar events default on; ask the user to select mail accounts.
- Keep notification preferences separate from pet/widget workspace selection.
  Disabling the pet or hiding finances in its menu does not change notification
  subscriptions. Persist preferences per installation/server/account.
- Respect macOS Focus, user-selected banner/alert presentation and lock-screen
  privacy. Default mail previews to a generic new-mail message; sender/subject
  details require opt-in. Never include message bodies or finance balances by
  default. Do not request critical-alert privileges or bypass Focus.
- Quiet hours suppress immediate interruptions; skip meeting alerts for meetings
  that have ended and group still-relevant missed work into a summary afterward.
  Reconcile already queued notifications when any notification preference changes.

### Delivery, synchronization and reliability

- The native coordinator schedules upcoming due/event notifications with the OS
  ahead of time, using a bounded rolling queue and replenishing it as time moves
  forward. Delivery does not depend on React timers or the pet animation loop.
  Reconcile on mutations, remote sync, wake, reconnection, login, date/timezone
  change and notification-settings changes. Remove obsolete requests and replace
  rescheduled ones by stable request identity.
- Introduce a typed, authenticated incremental activity feed for native clients,
  backed by durable server-side event IDs and a replay cursor. Define contracts
  in `packages/domain`, authenticated behavior in `apps/api`, storage in
  `packages/database`, and the client adapter in `packages/api-client`.
  Connector synchronization produces arrival events only after successful
  projection writes. Initial imports and historical backfills establish a
  baseline without generating a flood of new-mail alerts.
- Detect actual new messages, including arrivals in an existing thread. Unread
  count increases, marking an old message unread, repeated syncs and reconnects
  are not new-message events. Preserve deduplication across provider reimports.
- While resident, poll the incremental API every 60 seconds with jitter and
  bounded backoff, independent of main-window visibility. Coalesce with other
  sync work and pause offline. Actual mail alert latency also depends on provider
  synchronization; surface reconnect/stale-provider state and test end-to-end
  ingestion rather than promising instant delivery from a polling client.
- Persist cursor and delivery identity per installation/server/account. Include
  material ID, occurrence and alert kind in due/event identity, and immutable
  arrival event ID for mail. Use stable OS request IDs and reconcile the ledger
  with pending/delivered requests after a crash. Do not claim exactly-once display
  across the OS and application stores; test recovery for duplicate suppression.
- After sleep or a long disconnection, skip expired meeting prompts and collapse
  old mail/due-item activity into a bounded catch-up summary. On expired feed
  cursors, rebaseline and summarize rather than replaying all historical events.
- Logout, observed credential revocation, account/server switch, notification
  disablement and item deletion cancel relevant pending and delivered alerts.
  Remote edits made while offline cannot cancel an OS request until the app learns
  of the edit; reconcile promptly on reconnect and revalidate every action.
- Already scheduled OS notifications can still be delivered when ilo is not
  running. New mail detection and unsynchronized edits require the resident app
  in this delivery. APNs-based delivery while fully quit is a separate extension,
  not a hidden requirement for custom servers. Respect system sleep and Focus;
  notification presentation is controlled by macOS.

Acceptance: a signed installed app appears in macOS notification settings and
delivers task/reminder, upcoming-event and new-mail alerts with its main window
closed and pet disabled. Test authorization denial/re-enablement, sound/preview
settings, Focus, quiet hours, snooze/completion/join/open actions, edits and
cancellations, recurrence, daylight saving, initial mail import, arrivals in
existing threads, reconnect/cursor replay, sleep, restart and account isolation.
Use both hosted and custom servers. Verify scheduled delivery separately from
provider-dependent mail latency and fully quit behavior.

## 3. Desktop pet and quick access

- A small transparent, borderless AppKit panel floats above ordinary application
  windows. Use public macOS APIs and test normal Spaces and full-screen Spaces;
  never obscure system security surfaces or grab focus while idle.
- One bundled original sprite with idle, hover, drag and click animation. Settings
  offers enable/disable, color, animation/reduced-motion behavior, reset position,
  and workspace checkboxes. Start with tasks, reminders and calendar selected;
  finance is opt-in. Save preferences per installation and workspace visibility
  per selected account/server.
- Dragging moves the pet and saves its display-relative position. A click opens
  an anchored popover; dragging must not accidentally open it. Clamp positions
  after display removal, resolution changes and reconnection. Provide keyboard
  access through the menu bar, visible focus, VoiceOver labels and Escape dismissal.
- Quick access shows all tasks/reminders due on the account's current planning
  date, a separate earlier-overdue group, current/next/all-day/today events,
  Join meeting, Add task, Add reminder, Add event, and selected workspace links.
- Reuse server-authoritative day/timezone rules. Existing `brief.today` only holds
  future reminders: merge it with same-date overdue reminders to avoid losing
  reminders whose due time passed earlier today. Deduplicate event groups by ID.
- Quick capture initially opens the existing editor in the main app with the
  correct action and date. Completion uses the existing audited APIs; show pending
  and failure states and never claim an offline completion succeeded.
- Finance opt-in adds a compact budget status and Open finances. Keep account
  identifiers, balances and transaction details out of default ambient surfaces.
  Other enabled workspaces expose supported summaries and direct entry points;
  missing data is not represented by an invented zero count.
- A native coordinator owns refresh while the main window is hidden. Refresh on
  opening quick access, successful mutations, wake, reconnection and planning-date
  rollover; coalesce requests, allow one in-flight refresh and back off on failures.
  Mark cached data with freshness; clear private data on logout/server switch.
- Keep idle work small: animation does not drive network polling, stop animation
  when disabled or asleep, fetch finance only when selected, and profile CPU,
  memory and energy with the main window hidden.

Acceptance: pet stays reachable across displays/Spaces, remembers appearance,
honors workspace selection, opens correct editors and meeting links, and displays
consistent day data without keeping the main UI active.

## 4. Pinterest wallpaper reliability

Preserve the existing settings and layout behavior; improve the execution path.

- Move scheduling to the native lifecycle coordinator. Persist last successful
  local application per installation/account/server, so applying on one Mac does
  not suppress another Mac. Use one local planning-date rule for daily selection
  and refresh; check for missed refresh after sleep/network recovery.
- Serialize manual and scheduled application. Cancel obsolete work on account,
  server or settings changes. Prevent an earlier job from deleting a later job's
  active output.
- Download off the UI thread with bounded concurrency, timeouts, byte/dimension
  limits and a bounded image cache. Restrict image downloads and redirects to
  supported Pinterest image hosts. Add board-fetch timeouts and response limits
  in the API; move provider-specific extraction behind the connector boundary.
- Validate decoded images and require enough usable images before changing any
  wallpaper. Repeated pins remain supported. On failure preserve the current
  wallpaper and expose last failure plus Retry in settings.
- Replace the embedded JXA compositor with testable native image composition and
  AppKit application, using physical target-display size and consistent scaled
  spacing. Produce an image for each display/aspect ratio and test mixed Retina
  and non-Retina setups.
- Keep unique output URLs and atomic writes. Retain every file still referenced
  by a display; clean up only obsolete successful-job files. Report partial
  display failures accurately.
- Permit the required Pinterest preview image host in the packaged CSP. Compare
  preview and output for both layouts and fit modes, including padded frames.

Acceptance: live public-board preview and application work in a packaged app;
slow/offline/corrupt-image failures leave the previous wallpaper intact; daily
refresh catches up after sleep with no duplicate jobs; mixed displays look right.

## 5. Native desktop widgets

Ship a SwiftUI/WidgetKit extension embedded in the signed ilo application. It must
appear in macOS Edit Widgets. Floating application windows do not satisfy this
requirement. Use one extension containing both widgets:

1. **Tasks & Reminders Today:** small, medium and large families; native typography,
   accent heading/count, circular completion controls and compact rows resembling
   Apple's Reminders widget conventions. Include tasks and reminders due today;
   identify earlier overdue work separately. App Intents perform authenticated
   completion through the same API contract with accurate success/failure behavior.
2. **Today at a Glance:** medium and large families; current/next event, due counts,
   all-day context and compact selected-workspace summaries. Calendar, tasks and
   reminders default on; finance and other workspaces are configurable. Each
   supported row opens the relevant ilo screen or meeting action.

The app writes a versioned, size-bounded, privacy-filtered snapshot atomically to
an App Group container. The extension receives only the fields it needs; secrets
never enter snapshot JSON. Widget action credentials use appropriately scoped
Keychain access, and all reads/actions remain bound to server/account identity.
Purge snapshots and request reload on logout, revoked access or server change.

Use timeline entries for upcoming transitions and local midnight, and request
reload after data changes. macOS controls scheduling, so show last-updated/stale
states and provide a refresh/open-app path; do not promise real-time updates.
Configuration changes request a refreshed filtered snapshot. Cache misses show
Sign in/Open ilo or an unavailable state, not fabricated example personal data.

Build/sign the extension with the same Apple team and compatible entitlements,
embed it before signing/notarizing the outer app, and include verification in the
macOS release workflow. Verify App Group access and widget discovery in the
installed artifact, not only an Xcode preview.

Acceptance: both widgets can be added through Edit Widgets, configured, resized,
and used after closing the main window. Validate completion, deep links, timezone
rollover, stale/offline data and account clearing on a signed installed build.

## Delivery order and verification

Implement five independently reviewable increments in the order above: connection
and lifecycle, native notifications, pet, wallpaper reliability, then widgets.
The connection/lifecycle foundation is the first implementation scope;
notifications, pet and widgets share its account isolation, native refresh
coordinator and action routing. Notifications do not depend on the pet or widgets.
Wallpaper can follow the foundation without depending on the pet artwork.

Use `apps/desktop/src-tauri` for native host modules, an `apps/desktop/macos`
directory for the native companion and extension, and domain-owned web feature
modules for settings. Keep additions to the existing large `app.tsx` limited to
composition. Extend domain/API/client contracts only where existing public
behavior cannot supply the required native projection.

Run focused unit/integration tests for transport isolation, snapshot filtering,
day boundaries, notification scheduling/reconciliation, activity-feed replay and
deduplication, actions and wallpaper failures; native tests for lifecycle,
positioning and composition; and manual installed-app acceptance for login items,
Spaces, Keychain, notification authorization/delivery/actions, widgets and
wallpaper. Run `pnpm verify` plus native compilation
and extension/bundle validation before a PR. Browser E2E is not native acceptance.

Current external dependency: the documented hosted API returned 503. Recheck
availability and investigate deployment health before claiming production sign-in
works. Release signing and App Group provisioning must be validated during native
packaging; local tool availability does not establish account provisioning.

## Platform references

- [Apple: WidgetKit](https://developer.apple.com/documentation/widgetkit)
- [Apple: Creating a widget extension](https://developer.apple.com/documentation/widgetkit/creating-a-widget-extension)
- [Apple: Keeping a widget up to date](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date)
- [Apple: SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice)
- [Apple: User Notifications](https://developer.apple.com/documentation/usernotifications)
- [Apple: Asking permission to use notifications](https://developer.apple.com/documentation/usernotifications/asking-permission-to-use-notifications)
- [Apple: Scheduling a notification locally](https://developer.apple.com/documentation/usernotifications/scheduling-a-notification-locally-from-your-app)
- [Apple: Declaring actionable notification types](https://developer.apple.com/documentation/usernotifications/declaring-your-actionable-notification-types)
- [Tauri: System tray](https://v2.tauri.app/learn/system-tray/)
