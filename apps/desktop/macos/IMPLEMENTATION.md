# Native macOS companion

Implemented under `apps/desktop/macos` for macOS 14 or newer. The static Swift Package product is `IloNative`; it has no third-party package dependencies. Rust owns application lifecycle, transport, authentication, synchronization and validated action routing.

## Implemented behavior

- C ABI JSON dispatch and callback exports, with owned `strdup` responses and main-thread dispatch enforcement.
- Canonical HTTPS-origin Keychain storage, loopback-only HTTP development exception, optional provisioned shared Keychain group, and no credential persistence in snapshots/logs.
- `SMAppService.mainApp` login registration with accurate enabled/approval/not-found status and no repeated registration while approval is pending. Configuration never requests notification authorization.
- Native UserNotifications authorization, system-settings navigation, test delivery, task/reminder/calendar/mail categories, completion/open/join actions and native ten-minute snooze. Delivery ledger contains hashed request identities and timestamps, survives process restart, and bounds retained entries.
- Pure notification planning: 48-request rolling seven-day budget; completed/cancelled/deleted/declined filtering; stable occurrence and account identities; selected calendar/mail accounts; sound and preview privacy; account-timezone quiet hours including DST; overdue catch-up and quiet-hour mail summaries; expired meeting suppression. Pending requests reconcile against snapshots/preferences and obsolete delivered items are removed. Snoozes retain their fire time but honor updated privacy/sound preferences. Rescheduled occurrence actions are rejected.
- Original native creature artwork with idle/hover/drag feedback in a transparent nonactivating AppKit panel, cross-Space/fullscreen-auxiliary behavior, color setting, automatic Reduce Motion handling, sleep/disabled animation suspension, drag-versus-click separation, normalized per-display saved position and display-removal clamping. The pet stays hidden until an authenticated snapshot exists.
- SwiftUI quick access from pet or menu-bar action, including today's work, distinct earlier-overdue groups, deduplicated events, meeting joins, capture actions, selected workspace routes and opt-in finance summary. Completion shows pending state and a failure message if a subsequent snapshot has not confirmed success; it never assumes that dispatching a callback completed an API mutation. Cached snapshots show freshness and stale state. VoiceOver labels and Escape dismissal are provided.
- Independent pet and widget workspace privacy filters. Versioned, atomic, size-bounded App Group JSON snapshots contain only approved fields; no session tokens. Container availability is checked against actual signed entitlements, not inferred from a fabricated directory path. Account changes and logout remove snapshots and reload timelines.
- Two native WidgetKit widgets with App Intent configuration: Tasks & Reminders Today (small/medium/large), and Today at a Glance (medium/large). Timeline transitions cover upcoming events, staleness and planning-timezone midnight. Empty data opens sign-in instead of displaying fabricated personal examples. Widget completion validates snapshot identity, shared Keychain availability, `/v1/me`, current material state, and confirmed API completion; requests reject redirects and use timeouts. No Keychain access means an honest action error. Native links open relevant app routes or the validated meeting route.
- Build scripts produce a real `.appex`, extract `Metadata.appintents`, validate plists, optionally sign the extension, and embed/sign it before outer app notarization.

## Bridge integration

The contract remains `docs/superpowers/plans/2026-09-08-macos-native-bridge.md`, with these coordinated additions:

- `settings.widgetWorkspaces?: string[]` independently controls ambient widget storage; omission defaults to `tasks`, `reminders`, `calendar`. `petWorkspaces` only controls the pet menu.
- `mail.userId` is required and must equal the current snapshot's logged-in `accountId`. `mail.accountId` is the selected connector/mail account ID. Both server and user identity are checked before arrival delivery.
- `status` additionally returns `notificationAlertsAvailable` and `notificationSoundsAvailable`. `request_notification_permission` returns `requestPending: true`; authorization is asynchronous, so subsequent `status` calls report the OS result. A `status.error` describes login/notification/widget service limitations without making up availability.
- Widget routes: `ilo://open?path=/today` (and other app-relative workspace paths), and `ilo://join?url=<encoded URL>&serverUrl=<origin>&accountId=<user ID>`. Rust validates these routes and current identity.
- `ilo_native_set_callback` accepts a non-null C callback. Copy callback JSON during the call. Free every non-null `ilo_native_dispatch` return using `libc::free`. Dispatch is main-thread-only; permission/scheduling completion occurs asynchronously.

The native library does not introduce new callback action kinds. Server-owned recurrence occurrences are represented by distinct material/occurrence times; no local recurrence expansion changes server data. All-day calendar notification delivery stays off; the current settings contract has no all-day alert-time field. Animation respects the OS Reduce Motion preference; the current settings contract has no separate animation toggle.

## Verification performed

On September 8, 2026 with Xcode 26.6 / Swift 6.3.3:

- `swift test --package-path apps/desktop/macos`: **29 tests passed**. Covers origin validation, account/occurrence action isolation, completed/cancelled filtering, planner bounds, privacy filtering, independent widget selection, same-day/earlier-overdue boundaries, event deduplication, quiet-hour meeting expiry, DST skipped-hour behavior, stale input and multi-display position clamping.
- `swift build --package-path apps/desktop/macos -c release`: static library built successfully.
- `apps/desktop/macos/scripts/build-widgets.sh`: arm64 macOS 14 extension compiled, App Intents metadata extracted, and both output plists passed `plutil -lint`.
- `ILO_WIDGET_ARCH=x86_64 ILO_WIDGET_OUTPUT="$PWD/apps/desktop/macos/build/intel" apps/desktop/macos/scripts/build-widgets.sh`: Intel macOS 14 extension also compiled with metadata/plist validation.
- Metadata contains both `CompleteWorkIntent` and `WorkspaceConfiguration`.
- `nm -g .../libIloNative.a` confirms `_ilo_native_dispatch` and `_ilo_native_set_callback` exports.
- `bash -n apps/desktop/macos/scripts/{build-widgets,embed-widgets}.sh`: passed.

## Release provisioning and installed acceptance

Compilation does not prove system authorization, widget registration or signed identity. No signing identity or provisioning profile was invented, and the real user's notification/login preferences were not changed as a test.

Register the app and widget identifiers under the same Apple team. Provision `group.app.personal-os.desktop` (override `ILO_APP_GROUP` if necessary) and a shared Keychain access group such as `TEAMID.app.personal-os.desktop` for both targets. Both Info.plists must include the resolved `IloAppGroup` and `IloKeychainAccessGroup` values; entitlements and provisioning profiles must permit those exact groups. Existing sessions stored before shared-Keychain provisioning may require a fresh sign-in.

After the Tauri bundle exists, call `scripts/embed-widgets.sh /absolute/path/nohmi.app` with `ILO_SIGNING_IDENTITY`, `ILO_KEYCHAIN_ACCESS_GROUP`, `ILO_HOST_ENTITLEMENTS`, `ILO_WIDGET_PROVISIONING_PROFILE`, and `ILO_HOST_PROVISIONING_PROFILE`. The script preserves supplied host entitlements, embeds the extension in `Contents/PlugIns`, signs nested content before the outer app, and validates the complete signature. Set `ILO_WIDGET_ARCH` to match the host architecture; for a universal host build and combine both extension architectures before final signing. Notarize/staple afterward using the existing release process.

Still requires a signed installed-app acceptance pass: actual Keychain sharing and user isolation; login approval/reopen; notification denial/re-enable, Focus/sound/previews, delivery with the main window closed or app quit, snooze/completion/join and sleep/restart recovery; actual new-mail feed replay; multi-display/Spaces/fullscreen reachability; VoiceOver/keyboard behavior; widget discovery/configuration and authenticated completion in Edit Widgets; stale/offline clearing; hosted/custom-server sign-in; and idle CPU/energy measurement. macOS controls banner presentation and WidgetKit refresh timing. Delivery remains best-effort across OS and app stores, not exactly-once.
