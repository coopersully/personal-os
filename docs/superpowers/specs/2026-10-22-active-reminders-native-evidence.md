# Active reminders native probe evidence

Date: 2026-10-22. Local macOS 27.0.1 arm64, Swift 6.4. Ad-hoc signed disposable app;
no Developer ID signing identity is installed. This establishes local boundary behavior, not
release-signature equivalence or coverage of every supported macOS version.

## Observed

- Recent keyboard/pointer input timing was readable while ListenEvent access was false.
- A non-activating floating NSPanel appeared while Codex remained the foreground application.
  Receipt persistence completed; querying pending OS requests then showed only the separate control
  request. The ordinary control notification was subsequently delivered by macOS.
- Replacing the same pending request at due-minus-two seconds with a due-plus-five-second request
  succeeded. Exiting the process immediately after replacement acceptance left the fallback alive:
  usernoted recorded its banner at the expected fallback time after process exit.
- Notification authorization initially returned denied. Cooper reported seeing no prompt. The OS
  recorded a permission request and denial; System Settings showed the probe disabled. Only the
  disposable probe's notification toggle was enabled for testing and restored Off after the smoke.
- Cooper manually locked and unlocked the Mac. During lock, recent input, on-console and login-done
  remained true. NSWorkspace session/sleep observers did not report this lock. The foreground app
  changed to `com.apple.loginwindow`, the session dictionary acquired lock-state metadata, and both
  changed back after unlock. Never infer unlocked state from input/on-console alone.
- The panel was also exposed as an accessible system dialog with readable text. A full-screen
  Settings attempt did not establish which application/Space was foreground at presentation;
  therefore this is not counted as a passed full-screen delivery test.

## Implementation ruling

Proceed with implementation using elapsed input plus session/display state and explicit exclusion
of loginwindow/locked-session metadata. Unknown or inconsistent state means away. Use only public
framework calls; do not add input capture or accessibility prompts. Preserve ordinary OS delivery
when activity or presentation is unavailable. The real implementation must repeat background,
lock, crash and privacy tests before release. Full-screen/Spaces, actual display sleep, placement,
permissions on the release-signed app, and minimum-supported-macOS smoke remain acceptance work;
none is claimed passed here.

The throwaway probe ran under `work/active-reminders-native-probe/` and is not product code.
Its source was archived in the ignored execution workspace after the smoke; raw activity/session
observations were deleted. No raw session metadata or user activity history is committed.


## Implemented renderer smoke

The same disposable app was rebuilt against the actual product Swift sources, with synthetic local
items and a simulated completion acknowledgement (no production API or user items). Observed:

- The real compact stack renders accessible source/title/due context, Open, Mark complete and
  Previous/Next. Mark complete displayed a disabled Completing state before the fixture response;
  only acknowledgement retired the card and exposed the next item.
- Native header dragging initially failed. An explicit native drag view, expanded header hit area,
  and first-mouse acceptance fixed the boundary. The running widget subsequently saved normalized
  placement against the persistent display UUID. Unit coverage also verifies movement/release and
  the 24-point geometry rule.
- A second disposable app entered actual macOS full-screen mode and closed itself after eight
  seconds. During that interval it was the foreground application and the product panel reported
  visibility on the active Space. This replaces the earlier unverified Settings attempt.
- Source tests cover stale return after lock, quiet-policy changes during preparation, fallback
  acceptance before cancellation, persisted receipts/storage failure, acknowledgement and owner
  fences. Local fixture acknowledgement is not evidence of an installed release's API transport.

Physical display-sleep behavior, the release-signed application, and minimum-supported-macOS
hardware remain release smoke limits; they are not claimed verified on this development host.

The disposable probe’s notification setting was restored to Off in System Settings and its process
was stopped after the smoke. The installed nohmi application and its notification setting were not
used as the test fixture.

## Independent review repairs

The branch review found three delivery/isolation defects: generic stale reconciliation could rewrite
an accepted fallback, feed opt-out could cancel ordinary delivery, and the desktop transport dropped
its expected owner binding. Regression tests exercise managed-request exclusion, authoritative
removed-source resolution (including completion/not-found and offline failure), ordinary handoff,
and the explicit native expected-account parameter. Removed-source reads run in batches of at most
eight; a failed batch keeps the previous inventory. The presenter also skips frame fitting while a
drag is held, avoiding periodic renders clamping a move between displays. These repairs have source
tests; the release certification limits above still apply.

## Branch verification status

Implementation is local on `cooper/active-reminders`; it has not been merged, deployed or installed
over the existing application. Independent review repaired the reminder delivery and ownership
findings, including same-owner settings-generation history and policy fencing of deferred handoffs.

Passed checks:

- Full native suite: 76 Rust and 115 Swift tests.
- Repository lint/contracts and all TypeScript checks; production builds.
- Focused persistence, migration, API/default/owner/paging and UI tests. Generated MCP discovery
  documentation and migration journal assertions include the new field/migration.
- Active-reminder browser acceptance on desktop and mobile. The full browser run completed with
  151 passed, two intentionally skipped, and one failure in the existing Finance registered-host
  chat-history scenario (`e2e/finance-setup-modes.spec.ts:169`), which returned an empty history.

`pnpm verify` is **not green**. An initial complete run exposed stale Finance grant test expiry
(reproduced on the base branch), plus the migration assertion and generated dictionary changes;
these were repaired. Both UI timing failures passed under the repository's existing CI timeout.
A complete CI run then had a workspace-search socket hang-up and a lost Provider Item database
connection; those suites passed isolated retries and the next full run. That next run instead
failed the existing Finance post-lock expiry assertion in
`apps/api/src/finance/maintenance-execution.integration.test.ts` (the preceding two runs passed it).
The retry was stopped at that failure. No Finance production timing or authority rule was changed.
A green full-suite/coverage receipt remains required before release, alongside the native
certification checks above. Failed-run logs and browser traces remain in the ignored local worktree.

## Independent compact cards revision (2026-10-22)

Cooper replaced the original single-stack presentation with one independent window per item.
The native rows follow the app's shared TaskItem/ReminderItem completion/title/due grammar and
start at 320 × 88 points. Each has a native drag strip, resize edges and an accessible grow area;
minimum size is 240 × 72. New arrivals occupy free space and sibling retirement does not reflow
existing cards. Size, normalized position and the last display UUID are saved per item/account.
Legacy receipt/placement stores still decode.

Focused regressions first failed on the old single-window API and on missing native hit areas.
The final native suite passes 76 Rust and 120 Swift tests, including independent windows/sizes,
geometry round-trip, cross-display drag render behavior, header/grow-area hit testing, event-based
resizing with minimum sizes, and per-card pending/error/acknowledgement isolation. A disposable
four-item app rendered the compact product views with accessible completion and grow areas.
Fixture completion removed only the chosen window; recorded sibling frames stayed unchanged.
Initial computer-use attempts exposed missing native hit areas and corner interception by the
window edge. Native AppKit overlays, event-coordinate tracking and a 24-point inner grow-area target
fixed those boundaries. The running product-source preview then shrank one card from 320 × 88 to
280 × 72, enlarged it to 360 × 112, moved it, and completed it. Recorded sibling frames stayed
unchanged throughout. This passes the local single-display drag/resize smoke; physical multi-display
and the existing signed-release gates remain manual acceptance work. The preview process was
stopped and its temporary pointer/frame diagnostics erased. No permission settings were changed.

This bounded revision changes native presentation only; the earlier full-suite Finance failures
remain recorded above. It does not claim a new green full repository release gate.
