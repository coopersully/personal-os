# Desktop pet system implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline for this user-directed implementation. Track work with the checkboxes and execution notes below.

**Goal:** Implement the agreed responsive pet/card system in the installed desktop app.
**Architecture:** One native panel contains the sprite and Tauri dashboard content. Pure geometry and presentation helpers own placement and reversible motion; the dashboard shares Today's timeline and uses Sonner.
**Tech Stack:** Swift/AppKit/CoreAnimation, Rust/Tauri, React/TypeScript, existing shadcn primitives.
**Spec:** ../specs/2026-10-07-desktop-pet-system-design.md

## Global constraints

- Preserve unrelated uncommitted work in this existing feature worktree.
- No new permissions, external services, or dependencies for desktop geometry.
- Idle tuck after 3 seconds; native card movement never chases a second window.
- All action errors use Sonner; silent persistence after release.
- Native QA is required; browser prototypes and unit tests do not prove window behavior.

## Review focus

- Negative display origins and mixed scale: cursor-owned placement stays reachable.
- Dock ambiguity: conservative fallback rather than fabricated accurate bounds.
- Interrupted transitions: click/drag/close never resets the grabbed pose or leaks private content.
- Account teardown while pinned: invalidate the dashboard immediately.
- Reparented webview: sizing, focus, and authenticated commands remain functional.

### Task 1: Geometry and presentation state

Files: create `apps/desktop/macos/Sources/IloNative/PetGeometry.swift`, `PetPlacement.swift`, and `Tests/IloNativeTests/PetGeometryTests.swift`; extend `PetMotion.swift` and its tests.

Interfaces: geometry consumes display bounds, obstacles, card/pet size, anchor, and cursor; produces fitted rectangles, attachment, and idle poses. Placement persists separate compact/card state per display. Idle eligibility consumes closed/hover/drag/anchor facts with an injectable clock.

- [x] Add failing tests for eight anchors, midpoint opening, bottom corners beside Dock, cursor snapping, blocked attachment, idle timing, and negative display origins.
- [x] Implement pure geometry, reversible attachment progress, idle policy, and placement storage.
- [x] Run `swift test --package-path apps/desktop/macos`. Expected: focused and existing native tests pass.

### Task 2: Single native scene and input

Files: refactor `Pet.swift` into sprite and controller responsibilities; add `PetScene.swift`; update `Bridge.swift` and `src-tauri/src/pet.rs`.

Interfaces: preserve prepare/ready/toggle/close and account teardown; add pin/state/resize actions. Native controller consumes Task 1 geometry. Frontend sends gesture starts once, not every frame.

- [x] Move native sprite and dashboard view into one panel; eliminate window-follow updates.
- [x] Implement cursor dragging, anchor candidates, pin/focus policy, resizing, attachment travel, 3-second idle tuck, wake, privacy cancellation, and reduced motion.
- [x] Persist after release; recover display disconnects without discarding saved display profiles.
- [x] Build Swift and Rust. Expected: no new compilation errors; native tests pass.

### Task 3: Shared timeline and dashboard

Files: extract a reusable timeline primitive under `apps/web/src/features/calendar`; update `app.tsx`, `features/desktop/pet-overlay.tsx`, and focused tests.

Interfaces: timeline layout accepts temporal items and a render callback so Today retains its event/task components and the pet uses authenticated snapshot actions without importing the whole application shell.

- [x] Extract the actual Today timeline layout and use it in both surfaces.
- [x] Put calendar before tasks; add pin, full-surface dragging with interactive exclusions, all-edge resize handles, keyboard movement/resize, and native visibility-driven refresh.
- [x] Add focused tests for control exclusions, pin/resize actions, shared timeline and Sonner failures.
- [x] Run focused Vitest and web typecheck/build. Expected: pass without changing unrelated contracts.

### Task 4: Installed app verification

- [ ] Run `pnpm verify`; distinguish existing failures from regressions and resolve regressions.
- [x] Build/install the Local app using its existing HMR origin; inspect the native scene with CUA.
- [ ] Verify drag, focus, pin, resize, open/close, idle peek, actual Dock bounds, display transitions, and Sonner failures. Record limits honestly.
- [x] Request one independent read-only review of this implementation, fix actionable defects, and update the design evidence.

## Execution notes

- User requested immediate implementation after section-by-section agreement. Proceed inline without another approval round; this explicit request overrides optional skill handoff gates.
- Existing dirty work belongs to this conversation. Do not stage or revert unrelated files. Spec/plan can be committed independently; implementation remains reviewable in the worktree until verified.
- Pre-flight: Tasks 2/3 share native action names and visibility/state payloads; keep those changes together and test both sides. Task 1 uses AppKit point coordinates throughout (not device pixels).

### Implementation evidence — 2026-10-07

- Implemented a single native scene, pure geometry/placement/motion helpers, native pointer
  gestures, cursor anchors, edge attachment, pin/resize, 3-second idle peek, and immediate
  sleep/session-lock/account teardown. Reused Today’s timeline in the web dashboard.
- Independent review found and corrected persisted card placement, active-display authority,
  oversized Dock avoidance, interrupted close rebasing, correction reset, and perimeter origins
  during dragging. Tests cover endpoint reversals and placement profiles; visual tuning is pending.
- Native suite: 55 tests passed. Dashboard/settings-feedback/form suites: 30 tests passed.
  The four focused app recovery cases pass after removing duplicate settings alerts; retry lives
  in Sonner. TypeScript, native Rust/Swift build, and web production build pass.
- Today smoke: populated `demo+full@nohmi.test` at `/today`, 1280×720 and 390×844; shared timeline
  renders, no document horizontal overflow, no browser console errors. This does not verify native motion.
- Rebuilt and installed the Local app against the worktree-managed HMR origin. Startup is waiting inside macOS `SecItemCopyMatching` for Keychain
  access; requested the user to approve the native prompt. Do not bypass that prompt.
- Native card focus, reparented viewport, click-through, live Dock geometry, multi-display/Spaces,
  reduced-motion appearance, and drag/resize/open/close/peek visual behavior remain unverified.
  The earlier native smoke in the page contract predates this single-window implementation.

- Full `pnpm verify` first completed its test phase with 3 failing UI assertions and 3,409
  passing tests. The failures concerned duplicate settings feedback and an unscoped goal-form
  assertion; all three now pass in the focused app run (plus the wallpaper retry case).
  A fresh complete verification run is pending; coverage/build/E2E gates are not claimed green.

### Verification continuation — 2026-10-08

- Keychain access is unblocked. Restarting the app against the healthy managed runtime fixed
  the stale blank startup window. Rebuilt and installed the Local app against the same HMR origin.
- Added an accessible window title to the native pet panel. Temporary activation diagnostics
  were removed from the final build.
- Native UI checks with the main window closed: calendar and tasks render in the reparented
  webview; pin state toggles; keyboard movement moves the card and adapts the pet below it at
  the top edge; keyboard resizing reflows content; close/reopen keeps location and size;
  Escape closes; Open nohmi returns to the main app. Restored unpinned preference after testing.
- Coordinate pointer input is blocked by the macOS automation provider for this panel
  (`noWindowsAvailable`), although accessibility actions and keyboard input work. Do not
  claim pointer dragging, snap feel, or live Dock/Space/multi-display behavior as visually verified.
- Native tests: 57 passed. The three failing full-suite settings cases now pass in isolation
  with Sonner-based assertions and retry actions, including the absence of duplicate inline errors.
  The wallpaper load-error test observes Sonner directly instead of depending on toast DOM timing.
- Full `pnpm verify` passed lint/type checking, then stopped at 4 Finance test failures
  (3,409 passing tests across 333 passing files). All previously failing desktop/settings
  assertions passed in this run. The Finance failures were three 5-second timeouts and a
  2-second lock-observation assertion. A rerun of those three untouched Finance files passed
  115 tests but still hit four timeouts, including some different cases. This suggests host
  timing pressure but is not proof of a clean full run; coverage/build/full E2E gates remain
  unconfirmed. Do not change unrelated Finance code or relax test limits to claim green.
- Native activation tracing found a repeated-ready race: React development mode announces
  readiness twice before progress advances. The old zero-progress focus rule resigned the
  newly keyed panel and triggered its blur dismissal. Key eligibility now follows ready/open
  intent, including the initial zero-progress pose. The hidden Tauri owner no longer dismisses
  the macOS scene independently. Input regression tests also cover inactive-app first-click
  acceptance and retaining the exposed face's hit area while waking. Accessibility bounds
  are clipped to the display. Temporary tracing is removed from the final build.
- Final installed build: the prepared dashboard opens with calendar/tasks and Escape works
  immediately without first clicking a dashboard control. Cold-start and pointer-only timing
  still warrant hands-on confirmation alongside drag/snap/Dock behavior.
- Focused `desktop-settings.spec.ts` browser verification also exceeded its 45-second case
  timeout at 390px and 1100px. Both captured a rendered settings page rather than a native
  build failure. Stopped the remaining cases after those repeated timing failures; this is
  not E2E pass evidence. Logs: `/tmp/nohmi-desktop-e2e.log`; full check:
  `/tmp/nohmi-pet-verify-oct8.log`; Finance rerun: `/tmp/nohmi-finance-rerun.log`.

- Follow-up geometry/performance fix (2026-10-08): corrected inward side-peek rotations;
  compact bottom corners now use the physical screen boundary even when Dock metadata only
  reports a rejected full-screen window. Card drag/resize retain conservative Dock-safe fitting
  in that fallback, and the obstructed midpoint does not tuck through the unknown Dock.
- Drag events now coalesce on the display clock and flush the release cursor. A stationary,
  noninteractive guide panel avoids making the moving pet/card panel screen-sized. Selected
  guides are white. Unchanged layouts/transforms/window order are retained; ordinary dragging
  translates the panel. Old tucked poses clear on relocation/display changes.
- Verification: 62 native tests passed, including negative-origin display geometry, fallback
  bottom corners, inward rotations, conservative card movement, hidden Dock, and known-Dock
  fitting. Cargo development build succeeded and was installed into `nohmi Local.app` against
  the existing HMR origin. App inspection confirmed the inward side peek, wake/open, rendered
  timeline/tasks, pin toggle, and Escape. Restored unpinned preference afterward.
- A two-second idle sample before the change contained recurring sprite drawing and layer
  display work; the corresponding new idle sample contained no sampled `PetView.draw` or
  layer-display stacks. This is limited sampling evidence, not a drag FPS benchmark. Logs:
  `/tmp/nohmi-pet-performance-before.txt`, `/tmp/nohmi-pet-performance-after.txt`,
  `/tmp/nohmi-pet-performance-tests.log`, `/tmp/nohmi-pet-performance-build.log`.
  Native coordinate dragging remains unavailable from the UI automation provider, including
  with the card pinned, so live corner snapping/highlight and pointer smoothness remain manual
  checks. The earlier full-repository Finance/E2E timeout limitations still apply.

- Follow-up Dock/widget correction: live metadata reproduced the reported obstruction. The
  running compact pet occupied `(1428, 12, 72, 72)` at window layer 3, intersected the 74-point
  reserved Dock strip, and sat below Dock layer 20. The earlier unmeasured-corner fallback was
  unsafe and is superseded: missing exact Dock bounds now block the reserved strip for compact
  and card placements. Known Dock rectangles still permit genuinely clear corner lanes.
- Visible desktop-layer Notification Center rectangles now participate as widget obstacles.
  Entire tuck corridors must be clear; corner peeks try the adjacent side before remaining
  visible. A one-second active observation updates changed obstacles outside dragging, with
  fresh metadata at release. The scene sits at Dock layer + 1 as a stacking safeguard.
- Native verification: 64 tests passed, including unknown bottom/side Dock obstruction,
  sideways corner peeking above the reserved strip, widget fitting, and blocked hide paths.
  Log: `/tmp/nohmi-pet-obstacles-all-tests.log`. No web or server code changed in this correction.

- Installed and signature-verified the updated Local build. Live inspection after restart found
  the pet on the secondary display at `(3348, -275, 72, 84)`, at layer 21 above Dock layer 20,
  with no detected widget intersection. That display had no reserved Dock strip; this live check
  verifies stacking and current reachability, while primary-display fallback avoidance is covered
  by the geometry tests rather than an automated pointer drag. Evidence:
  `/tmp/nohmi-pet-live-obstacles-after.txt`, `/tmp/nohmi-pet-obstacles-build.log`.

- Ship review corrections: tray Quick access can present the dashboard while the ambient pet
  is disabled, including after repeated settings synchronization. Closing it does not enable
  the ambient pet. Resting scale changes immediately update the panel and recompute tucked
  geometry. A one-time conversion preserves the shipped normalized position before removing
  the old single-display record; existing per-display placement wins.
- Verification of these corrections: 67 native tests passed, including actual panel visibility
  with the pet disabled, immediate scale changes, and negative-origin position migration.
  Log: `/tmp/nohmi-ship-review-native.log`. The earlier full verification attempt was stopped
  for these fixes and is not completion evidence.

- 2026-10-09 clarification and correction: widgets may be overlapped, provided the pet/card
  stack above them. Removed widget avoidance from placement and hide corridors. The compact
  panel now accepts input continuously within its small window, eliminating its dependency
  on an asynchronous global pointer event to become clickable. Regression tests reproduced
  widget displacement and the ignored compact window before the fix; all 68 native tests
  now pass (`/tmp/nohmi-pet-oct9-tests.log`).
- Rebuilt, copied, and signature-verified `nohmi Local.app`; restarted its stopped worktree
  runtime and relaunched the app. The Today page loads and an accessibility press opens the
  calendar/tasks card. Native coordinate-click verification is still blocked by the UI
  provider's `noWindowsAvailable` error. Do not count accessibility activation as pointer proof.
- Live Dock metadata still exposes a full-screen window, not its visible footprint. Precise
  beside-Dock placement remains unresolved while the optional Accessibility geometry decision
  is pending. Shipping is paused; no merge or full-verification claim is made for these changes.

- Accessibility Dock geometry approved and implemented (2026-10-09): Desktop pet settings
  explicitly opens the OS permission page, using one Sonner toast for action feedback.
  Permission and measurement availability remain separate states. A bounded utility-queue
  reader reads only the Dock AXList position/size; validated frames open corner lanes while
  larger cards remain clear. Denied/revoked/stale/unavailable geometry retains the fallback.
- Verification: all 70 native tests and 39 desktop settings tests passed; web type checking
  and the local Cargo build passed. The rebuilt Local app was copied and signature-verified.
  Startup is currently waiting in the existing RitualStore Keychain read; the macOS SecurityAgent
  prompt requires the user's approval and cannot be driven by the available computer tool.
  Actual Accessibility consent and measured Dock footprint remain pending live verification.
  Logs: `/tmp/nohmi-dock-access-tests.log`, `/tmp/nohmi-dock-access-web.log`,
  `/tmp/nohmi-dock-access-typecheck.log`, `/tmp/nohmi-dock-access-build.log`.

- Live permission verification: after the user's macOS approval, the installed Local app
  reports “Accessibility allowed · Dock geometry available.” The actual Dock AXList passes
  the native footprint validation on this host; permission alone is no longer the only evidence.
  Accessibility activation of the tucked top-right pet wakes it and opens the calendar/tasks
  card, with the pet hanging below the top-aligned card. Open nohmi returns to the main app.
  Pointer dragging/corner snapping remain manual checks; no saved placements were reset for QA.

- Pet touchups (2026-10-09): snapped cards now close/save to the selected compact anchor;
  reset retains the active display and restores its bottom-right anchor. Screen peeks use
  the physical screen edge rather than the card's half-mask. Sprite rotation now preserves
  scale; slider previews are frame-coalesced and save on release. Facial contrast follows
  the chosen body color. Sleep has an enable switch and a 1–300 second delay (default 3).
  Right-click exposes disable/settings/open actions. The smaller header has pin and nohmi
  icon actions; Escape/outside dismissal remains, with pinning preventing outside dismissal.
  Quick access refreshes every minute while open and invalidates after native snapshot updates.
- Focused verification: 75 Swift tests, 56 Rust library tests, and 51 frontend tests passed;
  web type checking and the native development build passed. Installed and signature-verified
  the rebuilt `nohmi Local.app`. Live inspection confirmed white facial features on the saved
  black 200% pet, the compact header, icon navigation, and separate Sleep settings. Native
  pointer drag/snapping remains a manual check; accessibility activation is not pointer proof.
  Full repository verification is running; no merge or full-suite success is claimed yet.
  Logs: `/tmp/nohmi-pet-touchups-{native,rust,web,type,build,verify}.log`.
- The final frontend rerun also passed all 51 tests after separating the Sleep card.
  This newly ad-hoc-signed build currently reports Accessibility unavailable despite the
  enabled macOS entry, including after the user toggled permission and the app restarted.
  Asked the user to remove/re-add this exact Local app; precise Dock placement verification
  remains pending. The app uses conservative Dock clearance until trust is restored.

### Checkpoint handoff — 2026-10-09

- User requests committing/pushing all current work before a joint system reassessment.
  Latest requirements are recorded in the canonical desktop-background document under
  “Pet reassessment.” Do not start another speculative clipping fix or claim it resolved.
- Live defects: sleep clips at every location; color input is severely laggy and sometimes
  inaccurate; opening a destination incorrectly unpins the card. New requirements include
  no mouth, backgroundless header with active pin styling and actual nohmi logo, no bottom
  quick actions, per-domain time windows, and optional ritual completion cards.
- Full `pnpm verify` failed: 331 test files passed, five failed; 3,419 tests passed,
  12 failed, plus one unhandled connector timeout. Failures are in app.test.tsx,
  finances/plan-page.test.tsx, connector-service.integration.test.ts,
  finance-action-service.integration.test.ts, and finance-provider-item-service.integration.test.ts.
  The app failures include wallpaper preview decoding, so do not label all failures unrelated.
  See `/tmp/nohmi-pet-touchups-verify.log`. Focused native/Rust/frontend results above remain
  scoped evidence only. No merge or release readiness is claimed.
- Branch: `cooper/desktop-background-setup`; PR #218 — Guide desktop background setup.
  Local app: `/Users/cooper/Applications/nohmi Local.app`; runtime `http://127.0.0.1:64986`.
  Saved appearance is black, 200% scale; preserve user settings and placements.
- Optional Accessibility remains unverified for the latest ad-hoc build. Toggling the old
  entry and restarting did not restore the app's trust flag. User was asked to remove/re-add
  the exact installed app; there is no confirmation that this second step is complete.
- Next discussion should distinguish screen-edge clipping from native-window/layer clipping,
  separate immediate visual preview from durable settings work, and profile dragging, color,
  scaling, opening/closing, and sleeping before making performance claims. No new architecture
  has been selected yet. Earlier ship authorization does not waive verification/review gates.
