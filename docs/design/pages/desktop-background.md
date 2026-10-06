# Desktop background setup

The job is to keep enabled desktop features available without the main window open.
Desktop and Pet settings show a shared **Keep nohmi active** readiness overview. Its
**Review checks** dialog separates login startup, notification alerts, pet enablement,
and the morning routine. Routine settings link back to this setup.
The overview requires native login-status support and is not shown by the Windows fallback.
Setup navigation is disabled while preferences or routine edits remain unsaved; the current
section has no redundant setup link. Returned native registration errors remain failed actions
even when the bridge request itself succeeds.

Use actual macOS login status, not the requested preference, as evidence of startup
approval. Pending approval offers **Open Login Items** with the next instruction;
missing installation and unavailable status stay explicit. Enabling startup saves only
that preference and preserves unrelated unsaved form edits. Notification readiness
requires both the nohmi setting and OS alert permission. The notification page offers
permission, system settings, and a test alert; permission is not proof of delivery.

Morning readiness requires an enabled morning definition, automatic presentation on
this Mac, and no reported recovery, storage, or delivery failure. Failed reads suppress
completion percentages. The pet check describes its saved enablement, not observed pixels.
Settings refresh every three seconds while visible and on focus; local routine health
refreshes every ten seconds. Refreshed evidence never replaces an edited preference draft.

Closing the window leaves the existing process active. Quit stops the pet, routines,
and new notification checks; previously scheduled OS alerts may still fire. Explain
sleep/wake catch-up without promising execution while asleep or powering on the Mac.

## Native boundary and evidence

- Owner: the desktop Swift bridge uses ServiceManagement to open Login Items. The Rust
  native-action allowlist exposes only that named operation. OS user approval remains
  authoritative; this action cannot grant it.
- Transport: in-process Tauri/Rust/Swift dispatch on the macOS main thread; no new network,
  entitlement, launch agent, helper process, or dependency. Existing API reads supply the
  authenticated morning definition and existing local storage supplies delivery health.
- Commit and recovery: saving launch-at-login uses the existing atomic preference write
  and registration path. Opening System Settings has no durable commit and can be repeated.
  A settings-open result means navigation was requested, not that approval was granted.
- Failure and time: OS status is polled only while the settings surface is visible, with
  a focus refresh on return. API/native read failures remain unavailable and preserve
  drafts. Registration errors are reported separately from actual approval.
- Verification: component tests cover pending approval, preference isolation, focus
  refresh, paused routines, missing evidence, and failures. Swift compilation and native
  tests check bridge compatibility. A signed installed build still needs manual checks
  for OS approval, login relaunch, notification delivery, close-window pet/routine behavior,
  sleep/wake, and explicit Quit. Mocked readiness cannot establish those OS behaviors.
