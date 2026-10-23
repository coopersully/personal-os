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


## Row styling, feedback and pet anchors (2026-10-23)

The native SwiftUI presenter now follows the shared row's filled checkbox, medium-weight title,
neutral light/dark tokens, compact padding and distinct task/reminder due lines. It removes the
extra kind/nohmi title strip. This remains a native rendering of the row contract, not a React
component mounted in a webview. Dragging uses the pet's actual geometry and input-transparent
anchor-guide view; release aligns to its eight corner/edge-midpoint anchors. Resizing retains an
attached anchor. Lock/policy hiding also removes any in-progress anchor guides. Arrival uses the bundled soft click and a short scale/fade; acknowledged completion
uses an original completion pluck and departure animation. Sound preferences, batch coalescing and
Reduce Motion are respected. Failed completion, refresh and policy hiding stay quiet.

Focused regressions failed first on the missing anchor/feedback APIs. The final suite passes
123 Swift and 76 Rust tests; repository lint also passes with existing warnings. Coverage includes successful versus failed/foreign completion,
sound preference forwarding, no duplicate arrival/completion effects, all eight anchors on an
offset display, actual native drag/resize event handling, preservation after the geometry-save
delay, and unchanged sibling geometry. The disposable app rebuilt from product sources displayed
the revised rows. Computer-use smoke moved one sample, resized it to 280 × 72 and completed it;
the remaining cards stayed visible. Audio assets are bundled and playback is requested through
NSSound; no loopback recording or independent audible-output measurement was performed.

The existing full-verifier and signed-release limits above remain. This native-only refinement
is branch-local and does not claim a green repository release gate or production deployment.


## Full-card gestures and Dock-aware perimeter targets (2026-10-23)

A follow-up presentation refinement adds 16 perimeter targets (corners, midpoints and quarter
edges) and uses `PetDisplays.geometry` for initial placement, live dragging/resizing, refresh,
snapping and saved geometry. This is the pet's existing cached Accessibility Dock measurement,
window-metadata and conservative-fallback pipeline, with no new permission prompt. Measured Dock
footprints allow clear corner lanes; missing measurements retain the safe reserved area. Attached
cards adapt when the Dock appears or hides and retain their anchor during resizing.

The whole card accepts dragging, including over a checkbox or title. A four-point threshold
separates clicks from movement; dragging never invokes completion or opening. Normal clicks retain
those actions, and pending/stale completion remains blocked. Both kinds align their checkbox at
the top/start. The drawn corner grip is removed; native resize edges and the invisible accessible
corner target remain.

Regression tests failed first on the missing geometry/gesture interfaces and then on failure to
return to the edge after the Dock hid. The final suites pass 126 Swift and 76 Rust tests. These
cover 16 anchors on offset displays, measured-Dock clear lanes, missing-measurement fallback,
Dock appearance/disappearance, gesture click/drag discrimination, pending-action guards, safe
fitting and unchanged sibling geometry. Strict formatting and whitespace checks pass. Live
computer-use smoke dragged from a checkbox and blank card space without completing, resized a
sample to 280 × 72 with the clean corner, and then completed it with a click. An extreme native
window-edge automation attempt timed out; the disposable preview was restarted. Corner resizing
was verified, but that automated extreme-edge attempt is not claimed as passing. Real hardware
multi-display and release Accessibility acceptance remain the certification work recorded above.


## Occupancy, joined surfaces, countdown and menus (2026-10-23)

Free slots now combine the 16 perimeter positions with flush neighbor placements. Candidate
footprints preserve the grabbed card's size and exclude occupied cards, the Dock and unsafe screen
areas. The stationary input-transparent preview shows faded card-sized slots beneath the grabbed
card, replacing the old dots. Release rechecks occupancy. Colliding saved positions relocate only
the colliding card while preserving its saved dimensions. Adjacent cards remain separate native
windows but square only their touching corners and draw one divider per shared edge. A short pull
separates one card, restores exposed corners and leaves siblings in place. Completion also restores
sibling corners without reflow.

The left checkbox aligns to the title's first baseline. A single shared visible-card clock updates
relative due text once per second; absolute local date/time remains on its own small line and is
cached until day/locale/time-zone changes. Minimum-height cards use a one-line title to keep the
time visible. Native right-click menus reuse the existing completion/open actions, expose Separate
card for joined cards, and guard pending/stale completion. Short cached, rate-bounded interaction
plucks/pulses cover grab, candidate, docking, separation, release, resize endpoints, menu/open,
pending and failure; countdown ticks and pointer frames remain quiet. Reduced Motion suppresses
scaling/shaking; notification sound preference and system mute remain authoritative.

Geometry/countdown tests first failed on missing contracts. A restore regression then demonstrated
that collision recovery changed saved card dimensions; recovery now preserves size. The final
Swift suite passes 134 tests, covering occupied-slot filtering, same-size neighbor slots, Dock
exclusion, partial/full touching corners with a single divider, joining/pulling apart, reserved
anchors, restored collisions, menu actions and pending guards. The independent focused review
found one wheel-event regression in the full-card overlay. The overlay now forwards wheel events
to hit-tested hosting content; its new forwarding regression failed first and then passed without
starting movement. The 76 Rust tests, 20 desktop release-script tests, strict Swift formatting and
whitespace checks pass. The original synthesized samples have deterministic generation source.

The disposable preview contains a joined pair plus separate cards and varied synthetic due times.
Computer-use evidence observed the live second countdown, retained local time, and the joined
state's Complete/View in nohmi/Separate card menu. After interaction the computer-use guard
reported changed UI, so further input/relaunch was stopped to preserve the user's ongoing trial.
Menu action and separation correctness are additionally covered by native tests. The sample
View in nohmi callback intentionally does nothing; real application cards use the existing native
open action. The source-only wheel forwarding repair is verified by the native suite; the ongoing
preview session was left undisturbed. Existing signed-release/hardware/full-verifier limits above
remain unchanged; this is not production certification.

### Browser-first grouping iteration (2026-10-23)

At the user's request, stopped the disposable native card preview and moved further interaction
iteration to `apps/web/active-cards-playground.html` in this worktree's managed development runtime.
This HTML is a development-only entry, not a production build entry. The prototype uses local
sample data, simulated presence/system notifications and rectangular Dock exclusion; it does not
read Accessibility, alter real reminders, or establish native delivery evidence.

Browser trial adds smallest-size arrivals (240 × 76 CSS pixels), locked connected joins, shake
collection that retains the held drag, all-visible stacks, per-item context commands, accessible
menu alternatives, a working settings proposal, and creation-default controls. It retains live
relative/absolute due times, occupancy-aware full-size slot previews, free movement, edge resizing,
completion acknowledgement/error/retry, sounds and reduced-motion behavior. Gathered stacks start
locked; ordinary joins start unlocked. The pet's sensitivity thresholds are reused as the trial's
gesture model. Separate task/reminder creation defaults remain a proposal, not a storage/API change.

Ten headless browser interaction checks passed: minimum geometry, locked-group movement, unlocked
separation, actual pointer shake/gather/continued drag, full-size slots, completion failure/retry,
away notification/return, creation default, invisible-edge resizing, and checkbox drag without
completion. A failed resize check exposed missed pointer capture when leaving a narrow edge;
initial pointer capture and a rendered-condition assertion fixed and verified that path. Final
run had no page errors. Evidence and test script are in the ignored
`.superpowers/sdd/2026-10-22-active-reminders/browser/` directory (`check.cjs`, `check.log`,
`playground.png`). The visible in-app browser was left with two joined sample cards and two separate
cards. Native grouping/settings implementation intentionally awaits this browser iteration.


The subsequent join-control browser refinement passed eleven interaction checks, including
Shift-click locking of the full connected component, one-pixel divider color/thickness parity,
inset/full-length endpoints, and connected slot corner geometry. Join DOM nodes are retained
across lock toggles so their CSS length transition runs. Icons are generated from the shared
reicon registry using `generate-active-card-preview-icons.ts`; no runtime React bundle is needed.
The shared Docker host exhausted memory during dependency optimization, so this worktree’s
Compose runtime was stopped and the sample-only loopback server
`python3 apps/web/scripts/preview-active-cards.py` now hosts the same HTML. Other projects were
left running. This remains browser-only evidence.

Earshot browser iteration: installed pinned Earshot 0.4.0 in the ignored local audio environment,
with a full Python dependency lock and `pnpm audio:setup` / `pnpm audio:render` entry points.
Ten procedural bank assets were rendered offline with passing signal audits and verified SHA-256s;
the MIT notice and measured manifest are committed alongside the WAVs. Optional semantic audio
models were not installed; no human blind-test claim is made. Playback uses local preloaded,
cached buffers, master mute/volume, throttled slot ticks, and one briefly crossfaded voice.

The browser now supports Shift-lock and Shift-unlock across the geometrically connected component,
semantic context-menu icons, 240 × 64 compact cards, and an exact-time/abbreviated-countdown row
with monospace numerals. Pending/error states retain the exact time. The final browser run passed
13 interaction checks, including loading all ten assets and decoding the completion cue; the icon
contract and whitespace checks passed. Evidence: `browser/earshot-ui-check.log` and
`browser/earshot-cards.png` under the existing ignored evidence directory. Native behavior remains
unchanged by this browser iteration.
