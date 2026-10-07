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

- [ ] Add failing tests for eight anchors, midpoint opening, bottom corners beside Dock, cursor snapping, blocked attachment, idle timing, and negative display origins.
- [ ] Implement pure geometry, reversible attachment progress, idle policy, and placement storage.
- [ ] Run `swift test --package-path apps/desktop/macos`. Expected: focused and existing native tests pass.

### Task 2: Single native scene and input

Files: refactor `Pet.swift` into sprite and controller responsibilities; add `PetScene.swift`; update `Bridge.swift` and `src-tauri/src/pet.rs`.

Interfaces: preserve prepare/ready/toggle/close and account teardown; add pin/state/resize actions. Native controller consumes Task 1 geometry. Frontend sends gesture starts once, not every frame.

- [ ] Move native sprite and dashboard view into one panel; eliminate window-follow updates.
- [ ] Implement cursor dragging, anchor candidates, pin/focus policy, resizing, attachment travel, 3-second idle tuck, wake, privacy cancellation, and reduced motion.
- [ ] Persist after release; recover display disconnects without discarding saved display profiles.
- [ ] Build Swift and Rust. Expected: no new compilation errors; native tests pass.

### Task 3: Shared timeline and dashboard

Files: extract a reusable timeline primitive under `apps/web/src/features/calendar`; update `app.tsx`, `features/desktop/pet-overlay.tsx`, and focused tests.

Interfaces: timeline layout accepts temporal items and a render callback so Today retains its event/task components and the pet uses authenticated snapshot actions without importing the whole application shell.

- [ ] Extract the actual Today timeline layout and use it in both surfaces.
- [ ] Put calendar before tasks; add pin, full-surface dragging with interactive exclusions, all-edge resize handles, keyboard movement/resize, and native visibility-driven refresh.
- [ ] Add focused tests for control exclusions, pin/resize actions, shared timeline and Sonner failures.
- [ ] Run focused Vitest and web typecheck/build. Expected: pass without changing unrelated contracts.

### Task 4: Installed app verification

- [ ] Run `pnpm verify`; distinguish existing failures from regressions and resolve regressions.
- [ ] Build/install the Local app using its existing HMR origin; inspect the native scene with CUA.
- [ ] Verify drag, focus, pin, resize, open/close, idle peek, actual Dock bounds, display transitions, and Sonner failures. Record limits honestly.
- [ ] Request one independent read-only review of this implementation, fix actionable defects, and update the design evidence.

## Execution notes

- User requested immediate implementation after section-by-section agreement. Proceed inline without another approval round; this explicit request overrides optional skill handoff gates.
- Existing dirty work belongs to this conversation. Do not stage or revert unrelated files. Spec/plan can be committed independently; implementation remains reviewable in the worktree until verified.
- Pre-flight: Tasks 2/3 share native action names and visibility/state payloads; keep those changes together and test both sides. Task 1 uses AppKit point coordinates throughout (not device pixels).
