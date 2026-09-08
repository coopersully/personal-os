# macOS Desktop Implementation Plan

> Execution: use superpowers:subagent-driven-development with the approved design as authority. Run focused tests before full verification. Continue through all increments without another design approval.

**Goal:** Deliver the approved Mac desktop connection, lifecycle, notification, pet, wallpaper and WidgetKit experience.
**Architecture:** Bundled React remains the main UI. Rust owns selected-server transport and resident refresh; a compiled Swift library supplies public AppKit/UserNotifications interfaces and WidgetKit shares filtered snapshots through an App Group.
**Tech stack:** TypeScript, Tauri 2, Rust, Swift, SwiftUI, AppKit, UserNotifications, WidgetKit, PostgreSQL/Drizzle.
**Spec:** `docs/superpowers/specs/2026-09-08-macos-desktop-design.md`

## Global constraints

- macOS 14 minimum for native additions; retain Windows compilation.
- Production API default `https://api.ilo.coopersully.me`; HTTPS custom origins and HTTP loopback only.
- Credentials are Keychain-owned and never serialized to web storage, notification payloads or widget snapshots.
- Account/server changes invalidate in-flight operations and erase ambient snapshots and queued notifications.
- Explicit Quit exits. Close hides; menu bar remains available.
- Do not change unrelated product behavior or published migrations.

## Task 1: Native transport and desktop lifecycle

Files: `apps/desktop/src-tauri/src/{desktop,transport,native}.rs`, `Cargo.toml`, `build.rs`, `lib.rs`, `tauri.conf.json`; `apps/web/src/api.ts`, `api.test.ts`, `features/desktop/bridge.ts`.
Interface: `desktop_request({path,method,body,serverUrl}) -> {status,body}` sends relative `/v1/` paths to the selected origin with native credentials; `desktop_settings`, `desktop_save_settings`, `desktop_test_connection`, `desktop_native_action` expose settings and bounded native actions. The passed serverUrl is an identity guard, never a routing override.
- [x] Test canonical server validation, rejected schemes/paths, redirect refusal and obsolete-origin rejection before implementing transport.
- [x] Persist settings atomically; use native Keychain operations; serialize session lifecycle and guard response generation.
- [x] Add menu-bar Open, Quick access, Settings, Quit; close-to-hide and restore activation; single-instance and validated action routing.
- [x] Adapt typed API-client fetch for desktop native transport without leaking response tokens into React. Browser cookie behavior stays unchanged.
- [x] Run Rust unit tests and API-adapter tests.

## Task 2: Swift native companion and widgets

Ownership: `apps/desktop/macos/**` only. Interface contract: `docs/superpowers/plans/2026-09-08-macos-native-bridge.md`.
- [x] Compile a Swift static library with `ilo_native_dispatch` and callback registration; no provider calls in UI.
- [x] Implement login-item status, scoped Keychain credentials, native notification authorization/actions, pet panel and snapshot writer.
- [x] Test pure notification planning, filtering and position clamping before wiring native presentation.
- [x] Add both WidgetKit families, configuration, App Group snapshot reading, action routing, explicit stale/empty states and build/embed script.
- [x] Run Swift tests and compile widget extension; inspect signing entitlements and record provisioning limits.

## Task 3: Desktop settings and action composition

Files: `apps/web/src/features/desktop/{bridge,settings,settings.test}.tsx` (bridge uses `.ts`), `apps/web/src/app.tsx` composition only.
- [x] Add pre-login server control and desktop-only Settings sections for Desktop, Pet and Notifications using existing shadcn primitives.
- [x] Wire save/test errors, privacy/workspace controls, launch-at-login system status and native test notification.
- [x] Handle native route/capture events in main application and invalidate data after successful native actions.
- [x] Test visible save/failure/server reset and hidden browser-only controls; run frontend typecheck.

## Task 4: Resident coordinator and notification activity

Files: `apps/desktop/src-tauri/src/coordinator.rs`; domain/API/database/client feature modules for activity feed.
- [x] Use an OS-independent timer to fetch authenticated brief and feed with a session generation guard, bounded backoff and persisted cursor.
- [x] Produce filtered native snapshot with full planning-date due material, separate overdue work, deduplicated current/upcoming events and optional budget summaries.
- [x] Emit durable new-mail events after successful connector projections; skip import baseline and duplicate/replayed remote messages.
- [x] Schedule native due/event alerts and cursor-driven mail notifications; cancel on lifecycle/preferences/material changes.
- [x] Test feed isolation/replay/baseline and coordinator expiry/server change before full integration.

## Task 5: Wallpaper reliability

Files: existing Rust wallpaper command extracted to `wallpaper.rs`, native compositor, API Pinterest provider module and tests; web scheduler removed in favor of coordinator.
- [x] Test unusable downloads, invalid image origins, timeouts and concurrent jobs.
- [x] Add bounded asynchronous download/cache, native composition, per-display sizing and atomic output retention.
- [x] Schedule per-installation daily refresh from native coordinator; retain actionable errors and retry in settings.
- [x] Permit Pinterest preview images in packaged CSP; verify both layouts and fit modes.

## Task 6: Integration and release verification

Files: release/build scripts and documentation.
- [x] Compile Rust/Swift and widget extension; run focused tests, then `pnpm verify` without reducing coverage thresholds.
- [x] Review auth/redirect/isolation behavior, native background lifecycle, notification deduplication, widget cache privacy and wallpaper recovery.
- [x] Inspect installed app for menu bar, close/reopen, pet and settings; validate live API separately from app build success.
- [x] Document exact unresolved signing/provisioning or hosted-service failures; do not claim untested native acceptance.

## Acceptance limits

Implementation and local checks are complete. Signed installed acceptance is still pending: this machine has no Apple signing identity, and local notification authorization returns UNErrorDomain 1. Widget discovery, login registration and real OS delivery require the provisioned installed release. Hosted readiness and the production API returned HTTP 503. See `apps/desktop/README.md` for exact validation and release requirements.
