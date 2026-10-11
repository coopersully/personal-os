# Desktop pet reliability implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if the user selects delegation. Steps use checkboxes for tracking. Execution is not started by this document.

**Goal:** Correct pet rendering/input and responsiveness, then deliver trustworthy quick-access behavior and content.

**Architecture:** Retain one native moving panel and the existing Rust/React boundaries. Derive rendering and input from one pose, isolate lightweight appearance previews, and use pure gesture policies. Add content only after native acceptance of the foundation.

**Tech Stack:** Swift/AppKit/Core Animation, Rust/Tauri, React/shadcn, existing domain APIs and tests.

**Spec:** `docs/superpowers/specs/2026-10-09-desktop-pet-reliability-design.md`

## Global constraints

- User-facing product spelling is nohmi. Follow canonical desktop-background and design docs.
- All settings errors and discrete action feedback use Sonner; successful background saves stay silent.
- Shoo works only with the card closed. Only explicit pin/unpin changes stored pin intent.
- Use existing app-logo artwork and the central icon registry; no new icon pack or framework.
- Preserve saved settings, placements, account boundaries, Dock avoidance, and eight anchors.
- No permission bypass, broader input permission, or signing workaround.
- The spec's proposed defaults require review; no feature is already implemented by this plan.

## Review focus

1. Inactive-app first click and transparent-margin click-through: Task 2 native acceptance.
2. Stale appearance saves after account switch or rapid input: Task 3 ordering tests.
3. DST/week boundaries and truncated snapshots: Task 6 range/data-completeness tests.
4. Navigation, suspension, and out-of-order visibility messages must preserve pin: Task 4.
5. Pointer jitter, sparse sampling, menus, and sleeping must not cause shoo: Task 5.

## File ownership and execution order

Native scene: `PetScene.swift`; artwork: `Pet.swift`; placement: `PetGeometry.swift`,
`PetPlacement.swift`; animation: `PetMotion.swift`; Dock: `PetDock.swift`, all under
`apps/desktop/macos/Sources/IloNative/`. New pure silhouette and shoo policies stay beside them.
Native tests live under `apps/desktop/macos/Tests/IloNativeTests/`.
Transport/settings: `apps/desktop/src-tauri/src/{desktop,pet,coordinator,lifecycle,ritual,lib}.rs`.
UI: `apps/web/src/features/desktop/{bridge,settings,pet-overlay}.tsx` (bridge is `.ts`).
Color input: `apps/web/src/components/ui/color-picker.tsx`.

Tasks 1–3 establish the foundation. Tasks 4–7 are separate reviewable increments. Task 8 is
whole-system acceptance. No parallel writable work by default; the native scene is shared.

### Task 1: Reproduce and measure before selecting corrections

**Files:** inspect the ownership map; add evidence to this plan and the spec's Evidence section.
Temporary diagnostic output stays local and contains no private snapshot content.

**Interface:** produce a table of reproduction, observed boundary/queue behavior, measured
baseline, proposed correction, and validation method. Distinguish facts from hypotheses.

- [ ] Confirm checkout/build/runtime identity and current permission plus Dock geometry state.
- [ ] Reproduce clipping and adjacent-app interception at all eight anchors, 50/100/200% scale.
- [ ] Inspect panel/view/layer geometry at sleep endpoints and intermediate rotation frames;
  record which boundary causes unintended clipping. Do not select another offset-based fix first.
- [ ] Trace color input, preview/save calls, native configure calls, and acknowledgements with
  monotonic timestamps; measure p95 latency and maximum queued operations during rapid changes.
- [ ] Trace pinned navigation through React, Rust, and Swift, identifying whether pin or visibility changes.
- [ ] Record evidence and select the smallest correction consistent with the spec. If reliable
  click-through requires a different native window model, review that change before Task 2.
- [ ] Commit diagnosis documentation without claiming fixes.

### Task 2: Unified silhouette, sleep clipping, and input geometry

**Files:** modify `Pet.swift`, `PetScene.swift`, `PetGeometry.swift`; create `PetSilhouette.swift`
and `PetSilhouetteTests.swift`; extend `PetSceneTests.swift` and `PetGeometryTests.swift`.

**Interfaces:** `PetSilhouette.path() -> CGPath` supplies body/ears for rendering and hit testing.
`PetSilhouette.contains(_ point: CGPoint, transform: CGAffineTransform, clip: CGRect) -> Bool`
maps a screen-space point through the inverse current pose and respects intended visible clipping.
Keep render envelope separate from this input predicate and from card placement bounds.

- [ ] Add failing tests for ears/body hit, shadow/margin miss, rotated/scaled silhouette, tucked
  hidden-body miss, and all-eight-anchor close destinations.
- [ ] Run `swift test --package-path apps/desktop/macos`; confirm new regression failures.
- [ ] Implement the observed clipping correction from Task 1 using the shared pose. Remove the
  mouth and oversized wake hit region; preserve first-click wake/open through event ownership.
- [ ] Connect actual panel mouse routing to visible input regions, retaining card control/resize
  handling and cross-app click-through. Avoid per-frame geometry IPC or full-screen input windows.
- [ ] Rerun native tests; visually inspect intermediate and settled sleep poses. Test a nearby
  underlying-app button, inactive first click, right-click, drag, and Reduce Motion on the build.
- [ ] Commit only after recording native input/render evidence or an explicit tool limitation.

### Task 3: Responsive, ordered appearance updates

**Files:** `settings.tsx`, `bridge.ts`, their tests, `color-picker.tsx` and its tests;
Rust `desktop.rs`, `lib.rs`; Swift `Bridge.swift`, `PetScene.swift`, `Models.swift`.
Create `apps/web/src/features/desktop/appearance-preview.ts` and `.test.ts` for queue policy.

**Interfaces:** add `previewPetAppearance({sessionId, revision, color, scale})` to bridge.ts;
Tauri `desktop_preview_pet_appearance` validates color/finite scale and forwards a matching native
`preview_pet_appearance` operation. Return acknowledged session/revision. Newest revision wins
within an active account-scoped session; account changes invalidate the session.

- [ ] Add tests asserting one in-flight/one latest pending preview, final color wins under delayed
  acknowledgements, account switch invalidates pending work, and unrelated preferences survive.
- [ ] Run `pnpm exec vitest run apps/web/src/features/desktop/settings.test.tsx apps/web/src/features/desktop/appearance-preview.test.ts apps/web/src/components/ui/color-picker.test.tsx`;
  confirm the new ordering tests fail before implementation.
- [ ] Implement latest-value scheduling; separate preview from durable saves. Flush gesture-end
  saves and 250 ms keyboard/text inactivity saves without accumulating obsolete color writes.
- [ ] Make native preview update only appearance; prevent older settings acknowledgements from
  repainting a newer preview. Add invalid-value/session tests and Sonner failure/retry assertions.
- [ ] Run the focused frontend tests, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`,
  and native tests; remeasure against the spec targets and verify saved values after relaunch.
- [ ] Commit the complete cross-layer preview change.

### Task 4: Pin intent and compact header

**Files:** `pet-overlay.tsx`, `.test.tsx`; Rust `pet.rs`, `lifecycle.rs`; Swift `PetScene.swift`,
`PetPlacement.swift`, relevant native tests; use existing brand-mark component/artwork.

**Interfaces:** retain existing `pet_action` and presentation event names. Navigation reads pin
intent; only the explicit pin action writes it. Visibility changes never imply unpin.

- [ ] Add regressions: pinned task/navigation keeps card visible and pinned; Escape closes but
  preserves pin; reopening restores it; unpinned outside-click closes; account change clears data.
- [ ] Add UI assertions for actual logo artwork, active filled pin, no header card background,
  no description/X/refresh/bottom actions; retain accessible names and tooltips.
- [ ] Run native tests and `pnpm exec vitest run apps/web/src/features/desktop/pet-overlay.test.tsx`;
  confirm new tests expose current behavior before fixing it.
- [ ] Correct navigation/visibility ownership and restyle the header using existing app primitives.
- [ ] Rerun focused tests and manually navigate from a pinned native card; check narrow/resized layout.
- [ ] Commit this increment.

### Task 5: Configurable closed-card shoo

**Files:** create native `PetShoo.swift`, `PetShooTests.swift`; modify `PetScene.swift`,
`PetGeometry.swift`, `Models.swift`, Rust `desktop.rs`, frontend `bridge.ts`, `settings.tsx`, tests.

**Interfaces:** settings `petShooEnabled: Bool` default false and `petShooSensitivity` enum
`low | medium | high` default medium. Pure policy
`PetShoo.update(point: CGPoint, time: Double, eligible: Bool, region: CGRect) -> Bool` returns
one recognition; `reset()` drops history. Scene owns cooldown/rearm and safe-anchor movement.

- [ ] Add timestamped traces for each spec sensitivity, slow hover, one fast pass, jitter,
  click entry, diagonal shake, sparse sampling, leaving region, and stale history after opening.
- [ ] Add scene tests for closed-only eligibility, tucked wake then fresh recognition, held mouse,
  active menu, cooldown, same-display farthest-safe-anchor tie-break, and no safe destination.
- [ ] Run native tests and settings tests; confirm new contract failures.
- [ ] Implement policy with spec thresholds and settings validation/default migration. Use existing
  motion/geometry for relocation; clear history on lifecycle transitions and keep click area precise.
- [ ] Rerun tests; calibrate against actual deliberate and ordinary pointer interactions. Document
  any threshold adjustments before changing the spec; verify Reduced Motion and Dock clearance.
- [ ] Commit with manual false-positive evidence; do not claim tuning from synthetic traces alone.

### Task 6: Independent time windows with honest data

**Files:** frontend `settings.tsx`, `bridge.ts`, `pet-overlay.tsx`, tests; Rust `desktop.rs`,
`coordinator.rs`, `pet.rs`; native `Models.swift`, `Bridge.swift`, `NativeTests.swift`.
Create `apps/desktop/src-tauri/src/pet_content.rs`, registered in `lib.rs`, for content-range policy.

**Interfaces:** settings `petTaskWindow`, `petReminderWindow` use
`today | week | month | next7 | next30 | allUpcoming`; independent overdue booleans default true.
`petFinanceWindow` uses `today | week | month | last30 | next30`, default month. Add structured
pet-only content ranges/results with start-inclusive/end-exclusive boundaries, timezone, truncated
flag, and per-currency finance amounts; do not repurpose the shared notification/widget snapshot.

- [ ] Audit owning task/reminder/finance API range and pagination capabilities; record exact routes
  before changing coordinator queries. If a new public API is required, specify/review that bounded
  domain change separately; do not fake a range by filtering today's capped data.
- [ ] Add failing Rust tests for DST-short/long days, week/month boundaries, overdue separation,
  undated grouping, range-before-cap, mixed currencies, account mismatch, and unsupported forecasts.
- [ ] Implement range policy and backward-compatible settings; source complete authorized data or
  return honest partial/unavailable results. Next30 finance is scheduled outflows only.
- [ ] Add UI tests for independent autosaves, timezone labels, actual vs upcoming finance copy,
  partial results, and Sonner errors; preserve calendar preview and minute refresh without overlap.
- [ ] Run Rust/native tests and focused settings/overlay tests; validate with deterministic dated
  fixtures across two timezones. Record API routes and final schema in the spec.
- [ ] Commit this content increment independently of native motion changes.

### Task 7: Ritual status in quick access

**Files:** Rust `ritual.rs`, `pet.rs`, `coordinator.rs`; frontend `pet-overlay.tsx`, `settings.tsx`,
`bridge.ts`, tests; use existing ritual domain/runtime state, not a new completion store.

**Interfaces:** `petShowRituals` defaults false. Authorized pet response exposes enabled ritual
occurrence identity, logical date, schedule eligibility, canonical status, and supported open action.
Reuse existing ritual open handling with explicit pet-window authorization and no token exposure.

- [ ] Add tests for disabled ritual absent, scheduled before window, due incomplete at top,
  completed below calendar, skipped/missed labels, midnight occurrence ownership, and stale data.
- [ ] Add authorization tests: different account/server cannot read or open the prior occurrence;
  ritual navigation does not unpin the card.
- [ ] Run focused tests to establish failures, then adapt the authorized runtime projection and UI.
  Completion comes only from authoritative runtime/domain state.
- [ ] Run Rust and overlay/settings tests; verify fixture morning/evening transitions in the app.
- [ ] Commit this increment.

### Task 8: Whole-system acceptance and delivery

**Files:** expand existing native/overlay/settings tests and `e2e/desktop-settings.spec.ts` where
browser evidence is meaningful; update canonical docs and this plan with measured outcomes.

- [ ] Rebuild/install using the repository's current desktop workflow; record binary identity and
  runtime. Confirm Accessibility and measured Dock geometry separately without bypassing consent.
- [ ] Execute the spec's native interaction matrix, including animation interruption and available
  display/Space changes. Record manual gaps explicitly; do not count AX activation as pointer proof.
- [ ] Compare before/after timing, queue bounds, and settled CPU results against spec targets.
- [ ] Run `pnpm verify`; diagnose the recorded checkpoint failures and any regressions. Do not
  lower thresholds, skip failing tests, or label all old failures unrelated without evidence.
- [ ] Review the full branch under repository review/PR workflows. Commit and push verified work;
  merging remains subject to current CI, review, and existing ship-it gates.

## Review handoff

Read the spec and plan together. Recommended execution: native sequential work in this chat,
because rendering, input, and motion share one controller and require repeated live inspection.
Subagent-driven execution is an alternative only if selected, with isolated writable work.
The first execution result must be Task 1's diagnosis, not an unverified replacement build.

## Execution evidence — 2026-10-11

Baseline: 75 native tests passed; local runtime restarted via `pnpm env:start`.
A temporary native probe exercised 24 scale/anchor combinations without modifying saved user
placements. At the top edge (100%), AppKit's unrotated `visibleRect` ends at logical y=40,
while the sprite's ears extend to y=58 and rotation occurs only in the backing layer. Thus
view clipping and rotated artwork use different coordinate systems. Side edges have the same
mismatch on x. Proposed correction: rotate drawing coordinates inside the view, maintaining
untransformed AppKit layout; require a raster regression and live acceptance before claiming fixed.
Probe log: `/tmp/nohmi-pet-geometry-probe.log`. At bottom-center the conservative Dock obstacle
correctly prevents tucking; actual Dock geometry remains a separate permission-dependent check.

Color changes currently queue full serialized settings writes and native configuration per
picker change; appearance previews have no color equivalent. Open/capture navigation always
calls `hide`, regardless of pin. These paths are source-confirmed; timing and user-visible
acceptance remain to be measured. Detailed execution ledger is in the ignored plan workspace.

### Foundation checkpoint — 2026-10-11

Implemented shared artwork/input geometry, drawing-coordinate rotation, mouth removal,
centered eyes, appearance preview coalescing with account-scoped revisions, pin-preserving
navigation, the compact header, and closed-card shoo with settings. Cooper reports the
sleeping diagnostic build looks good; exhaustive pointer/display/scale acceptance is still
pending. Native tests: 88 passed. Rust library tests: 58 passed. Focused web tests: 60 passed.
These are checkpoint results, not whole-system acceptance or a performance certification.

The raster-only ear probe passed before the correction; only rotated hit-testing reproduced
that regression. Do not describe the raster probe as proof of the original clipping cause.
Shoo thresholds have synthetic-trace coverage but still need real-pointer calibration.
Tasks 6–8 and full verification remain outstanding. Local HMR briefly failed because a new
select import referenced an absent primitive; it now uses the existing NativeSelect and the
app renders again.

### Content and live acceptance checkpoint

Commit `3b88a892` adds independent content windows, canonical ritual cards, settled-peek clock
suspension, and presentation ordering. Verification at this checkpoint: 91 Swift tests, 63 Rust
tests, and 62 focused desktop frontend tests passed. The debug build is installed as nohmi Local.
Cooper confirmed rapid color/scale changes settle smoothly and correctly, then confirmed nearby
underlying-app clicks and closed-pet shoo behavior look good. Native UI inspection also verified
that opening nohmi from the pinned card preserves its pin and visibility. These are qualitative
interaction results; no measured p95 latency or full multi-display acceptance is claimed.
Full repository verification and fresh whole-branch review remain release gates.

Follow-up: shoo needed to invalidate the prior card placement after an earlier opening. A native
open/close/shoo/reopen regression failed before the fix and passes afterward; Cooper confirmed
“Fixed” in the rebuilt app. Whole-branch review also found and corrected the task completion body
and content-refresh freshness handling. Shared request fixtures now validate against domain
schemas; failed refreshes preserve native freshness, disable stale actions, and notify via Sonner.
