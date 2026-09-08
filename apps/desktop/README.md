# nohmi for macOS

The desktop app bundles the React interface with a resident Tauri/Rust process and a Swift companion. It supports macOS 14 or later. Windows still compiles, but the pet, WidgetKit extension, login registration and native wallpaper compositor are macOS features.

## Connection and daily use

Release builds start with `https://api.ilo.coopersully.me`. Settings → Desktop supports a custom HTTPS API origin; HTTP is permitted only for loopback development. The same server controls are available before sign-in and when the selected API is unavailable. Test connection checks the actual nohmi authentication response.

Requests use the selected origin through native HTTP. Session credentials stay in Keychain; redirects never forward them. Switching servers requires a fresh sign-in and clears the previous account's ambient data. Pet, widget and notification preferences are saved per installation, server and account. Login registration is an installation preference.

Closing the red window button hides the window and Dock icon. The menu-bar item remains available with Open nohmi, Quick access, Settings and Quit. Finder/Dock reopening restores the existing window; Command-comma opens Settings. Quit and Command-Q exit. Release preferences enable Open at login; debug builds leave it off. The actual macOS registration/approval state appears in settings.

## Pet, widgets and notifications

Settings → Desktop pet controls the animated creature, color, position reset and visible workspaces. The pet follows macOS Reduce Motion, can be dragged between displays, and opens a native Today menu with completion, meeting joins and quick capture. Finance summaries are opt-in. Widget workspace selection is independent of the pet.

The WidgetKit extension contains Tasks & Reminders Today (small, medium, large) and Today at a Glance (medium, large). The host writes bounded, filtered App Group snapshots. Widgets show freshness and authentication states, update their date boundaries, and use identity-checked actions. Completing a widget item requires provisioned shared Keychain access. Native widgets appear in Edit Widgets only in a correctly signed, installed bundle containing the extension.

Settings → Notifications controls permission, due tasks/reminders, event lead time and calendars, mail accounts, sounds, private previews and quiet hours. The native process reconciles OS requests independently of the renderer and pet. It includes future incomplete reminders for a seven-day scheduling horizon, skips positively identified declined invitations, preserves eligible schedules offline, and validates notification actions against current identity and material state.

New mail uses durable API arrival IDs and per-device cursors. Initial imports, sent replies, drafts and replayed provider messages do not generate incoming-mail alerts. A persisted native outbox retries OS scheduling failures. Old mail is coalesced into a bounded account/day catch-up alert. The resident process refreshes around once per minute with jitter/backoff and on wake; actual arrival latency also depends on connector synchronization (currently approximately five minutes for stale mail accounts). Scheduled OS alerts can fire after Quit. Detecting new mail requires the app to remain running; this release does not use APNs.

## Pinterest wallpaper

Wallpaper settings and manual preview remain in Settings → Wallpaper. The resident process refreshes daily at 08:00 in the device's local time and catches up once after missed days. Success stamps and appearance fingerprints belong to the individual installation/server/account, so another Mac's application does not suppress this Mac's refresh.

The connector bounds board fetches to ten seconds and 4 MiB, refuses redirects and extracts only permitted Pinterest image origins. Desktop downloads use bounded concurrency, time/size limits and a 128 MiB cache with seven-day expiry. AppKit composes each display at its own physical size; jobs serialize, obsolete jobs cancel, and current display files survive partial OS failures. Preview, pin selection and random backdrops use the same device date. Live board extraction still depends on Pinterest's public page availability and structure.

## Development and checks

From the repository root:

```sh
pnpm env:start
# In another terminal:
pnpm --filter @personal-os/desktop dev
```

The checked-in lifecycle assigns this worktree one loopback origin and stores it in `.env.codex.local`; `pnpm env:status` reports it. In the desktop sign-in screen, save that origin as a custom server. Tauri runs its renderer on the standard Vite development URL while API calls use the selected native server. Use `pnpm env:logs` and `pnpm env:stop` to manage the worktree runtime. Debug desktop connections otherwise retain the last selected server and default to Hosted nohmi on a fresh install.

```sh
pnpm verify
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
swift test --package-path apps/desktop/macos
bash apps/desktop/macos/scripts/build-widgets.sh
python3 -m unittest discover -s apps/desktop/macos/scripts -p 'test_*.py'
pnpm --filter @personal-os/desktop exec tauri build --debug --bundles app --ci
```

`pnpm verify` covers the shared web/API/domain/client product, coverage gates and desktop/mobile browser acceptance. The native checks separately compile Rust/Swift and the WidgetKit extension. CI runs these native checks on macOS and preserves Windows compilation.

## Signed releases

`pnpm --filter @personal-os/desktop bundle:dmg` runs `macos/scripts/release.sh`. Release CI supplies:

- `APPLE_CERTIFICATE` (base64 Developer ID Application certificate), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`.
- `APPLE_ID`, `APPLE_PASSWORD` (app-specific notarization credential), `APPLE_TEAM_ID`.
- `ILO_HOST_PROFILE_BASE64` and `ILO_WIDGET_PROFILE_BASE64`: matching distribution profiles for `app.personal-os.desktop` and `app.personal-os.desktop.widgets`.
- `ILO_KEYCHAIN_ACCESS_GROUP`: the exact provisioned shared group, typically `TEAMID.app.personal-os.desktop`.
- Both profiles must authorize `group.app.personal-os.desktop` (or an explicitly configured `ILO_APP_GROUP`).

The script imports the certificate into a temporary keychain, builds an initial app bundle, builds/signs the extension, embeds both profiles and the extension, validates profile expiry/identity/group permissions, signs the outer app, notarizes/staples the app, then creates/signs/notarizes/staples the DMG. It preserves host entitlements and rejects debug profiles. It never modifies an already notarized bundle.

Distribution requires final installed acceptance: notifications/permission settings, login and wake, widget gallery discovery and completion after Quit, logout clearing, meeting links, and mixed-display/Spaces wallpaper behavior. Successful compilation is not evidence that Apple provisioning or a hosted service is healthy.

## Validation record (2026-09-08)

`pnpm verify` passed: 1,852 tests in 198 files, 24 desktop/mobile E2E cases, and all coverage gates (96.79% statements/lines, 94.03% branches, 95.87% functions). Separate native verification passed 23 Rust tests, 29 Swift tests, four provisioning-script tests, WidgetKit extension compilation and the packaged debug app build.

Local packaged-app checks exercised native sign-in/sign-out, Keychain session restoration across Quit, Today tasks/reminders, Command-comma, settings rendering, server switching, pet enable/disable, close-to-background, pet quick access, task completion, quick capture and explicit Quit. Session transitions reset mounted query observers without reloading the packaged webview. Native notification permission was requested and macOS returned `UNErrorDomain` code 1 for this local build; real delivery has not been accepted. No valid Apple signing identity was available, so signed widget installation and login-item registration remain external acceptance requirements. Hosted readiness and the app's production API request returned HTTP 503, preventing production sign-in verification. Live provider OAuth, Pinterest application across physical displays/Spaces, and signed installed acceptance remain to be exercised. No production deployment or release publication was performed.

Framework references: [Apple UserNotifications](https://developer.apple.com/documentation/usernotifications), [SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice), [WidgetKit](https://developer.apple.com/documentation/widgetkit), [Tauri macOS bundles](https://v2.tauri.app/distribute/macos-application-bundle/).
