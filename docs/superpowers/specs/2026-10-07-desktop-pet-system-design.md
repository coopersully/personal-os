# Desktop pet interaction system

Status: design accepted for implementation, 2026-10-07. The user explicitly requested
implementation after accepting the final behavior defaults. Native verification remains
required; this document is not evidence of shipped behavior.

Canonical page contract: [Desktop background setup](../../design/pages/desktop-background.md#connected-pet-motion).

## Intent

The desktop pet is a compact entry point to a responsive, app-styled dashboard. Pet and
card feel like one connected object during opening, closing, movement, resizing, and
snapping. Fast task and meeting actions remain usable with the main app window closed.
The desktop should remain available around the object; neither invisible padding nor
pet decoration should unnecessarily restrict where the card can go.

## Confirmed decisions

### Content and appearance

- Keep nohmi's theme, shared shadcn components, icon registry, and Sonner feedback.
  Quick-access content must not revert to macOS menus or native popovers.
- The card begins with the calendar preview from Today at a Glance, followed by its
  tasks. Reuse the actual component and behavior rather than maintaining a visual copy.
- Retain the requested larger, taller eyes and smoother idle animation. The existing
  pet color and scale settings remain applicable; card dimensions are independently resizable.
- A pin action keeps the card open when focus changes and above ordinary app windows.
  Explicit close remains available. Pinning must not prevent privacy/account teardown.

### Open and close

- The opening anchor determines the card's preferred alignment, before fitting it around
  actual obstructions. Corners expand inward; side midpoints center along the corresponding
  side. Specifically, anchor 4 opens vertically centered along the right edge, not at the
  center of the desktop. Anchor 8 mirrors this at the left; the top/bottom midpoints center
  horizontally. Use the usable display's placement bounds consistently for midpoint alignment.
- Do not discard the opening anchor in favor of a generic "open upward/downward" rule.
  The pet's eventual attachment edge is a separate decision and must not move the card away
  from its preferred alignment merely to accommodate the pet.
- The card expands outward from the pet and collapses into it; independent fades or
  unrelated movement do not establish this relationship.
- Reversing an in-progress transition continues from its current pose, without resetting.
- On opening without subsequent movement, closing can retrace the original path to the
  compact pet's position.
- Once the open card is dragged, its currently visible pet becomes the new collapse
  destination. Do not retain a separate old resting point below or away from the card.
- Closing after a move leaves the pet at its new location. It does not return to its
  pre-drag desktop position.

### Dragging and resizing

- The whole noninteractive card surface can initiate movement, not only a header or pet
  head. Buttons, checkboxes, links, fields, and scrolling must retain their normal behavior.
- Pet and card move as one object. A sprite window chasing movement notifications from
  another window is not an acceptable final movement implementation.
- Only the card rectangle constrains movement of the expanded object. Pet headroom,
  feet, and other decorative overflow must not reserve a permanent screen margin.
- The card is resizable. Resizing must keep controls usable and allow content to scroll
  within the card rather than overflow horizontally.
- Compact-pet movement still considers the full compact pet's visible bounds.

### Cursor-based snapping

- Free placement is always allowed; snapping is optional.
- Provide eight logical anchors: four corners and the midpoint of each screen side.
- During either pet or card dragging, the cursor chooses the candidate anchor. Do not
  compare the anchor against the pet, original resting point, or card center instead.
- Every target remains reachable by the pointer, including when the card has reached a
  movement boundary. Keep drag capture until release outside the visible object as needed.
- Indicate the candidate while dragging; release commits the snap. Moving away cancels it.
- Targets must remain visible over the card during a drag rather than being obscured by it.
- For an expanded card, the selected anchor positions the card within that corner/side.
  It does not require the pet's center or original grab point to occupy the cursor location.
- After an expanded snap, closing collapses into the pet at its final visible position.

### Adaptive pet attachment — added in the latest conversation

- Near the top of the display, including all three top anchors, put the pet beneath the
  card, upside down, peeking from its bottom edge. The card can sit at the top without
  reserving headroom for an upright pet.
- Near the bottom, place the pet upright above the card.
- As the card approaches an edge, the pet can move around its perimeter to an edge with
  room. The card remains the placement authority; pet attachment adapts to it.
- Make attachment changes connected motion, not a teleport, abrupt flip, or jitter when
  hovering around a threshold.
- Once moved, the collapse destination follows the pet's actual attachment position.
  An upside-down pet must return to its normal compact orientation as the card closes.

### Dock and display geometry

- Use distinct compact-pet and expanded-card fit calculations.
- A bottom corner beside the Dock remains available when the actual Dock does not occupy
  that corner. Do not reserve the whole bottom strip merely because macOS visibleFrame does.
- A card too large for a pet-sized opening must fit in adjacent available space.
- Menu bars, display edges, and the actual Dock obstruction constrain placement. This also
  applies when the Dock is on a side. Decorative pet attachment must avoid these obstructions
  without shrinking the card's movement area unnecessarily.

### Idle edge peek — added during brainstorming

- After 3 uninterrupted seconds with the card fully closed, the compact pet stationary,
  and the pet on an anchor, animate it halfway behind the corresponding screen edge.
  Show the same ears/eyes portion used when peeking from the card, facing into the desktop.
- A free-positioned pet does not auto-hide. Neither an open card nor ongoing dragging,
  opening/closing, pointer hover, or keyboard focus is eligible for the idle tuck.
- Hover or interaction wakes the pet and returns it to its normal upright position.
  Clicking/keyboard activation must also perform the intended open action without requiring
  a second activation. Starting a drag wakes it without consuming the drag.
- The idle pose is transient presentation. It must not overwrite the saved resting position,
  anchor, or card placement. After waking and finishing interaction, start a fresh 3-second
  idle interval; do not immediately tuck again because an old deadline expired.
- Reverse an interrupted tuck/reveal from its current pose. Use one cancellable deadline;
  do not run a frame loop just to count idle time. Respect Reduced Motion and suspend work
  when unavailable. Reset eligibility after wake/display changes rather than acting on stale time.

Working defaults shown in the study, still open to refinement:

- Top anchors peek downward, upside down; bottom anchors peek upward, upright. Side midpoint
  anchors rotate inward. At corners, use the horizontal top/bottom edge rather than clipping
  both sides of the face diagonally.
- The exposed face must remain reachable. At the top, use the boundary below the menu bar;
  if the Dock blocks the proposed edge pose, keep the pet visible instead of hiding behind it.
- Eligibility requires the compact pet to actually occupy a resolved compact anchor, not just
  retain a logical anchor from a previously snapped card. Closing a moved card at its visible
  pet location must not send the pet across the screen solely to perform an idle tuck.

## Agreed architecture

One native window owns the combined pet/card scene. Native movement moves
the entire object atomically; one presentation coordinator owns transitions. This replaces
the current separate sprite panel following a webview window through move notifications.
The browser study demonstrates desired behavior, not native performance or API feasibility.

Keep the native pet drawing and app-styled web dashboard as views within that same window.
The window controller owns dragging, resizing, pin/focus policy, and display changes. A placement
calculator solves geometry; an animation controller owns the current pose and transitions;
the dashboard owns shared Today content, authenticated actions, theme, and Sonner feedback.
Dragging must not rely on per-frame cross-window follower updates or network/data refresh.

Show valid cached dashboard content immediately when available and refresh independently.
Invalidate account-scoped content immediately when its authority changes. Native validation
must establish transparent-area click-through and Dock geometry before claiming those behaviors
work; a successful browser study does not settle either capability.

Keep responsibilities distinct:

1. Geometry: display/Dock obstacles, compact/card rectangles, cursor targets, and attachment.
2. Presentation: reversible opening/closing, perimeter travel, reduced motion, and idle motion.
3. Native window: movement, resize, focus/pin policy, display changes, and bounded hit testing.
4. Dashboard: shared Today calendar, tasks, authenticated quick actions, and Sonner feedback.

The visible pet and the card can both accept pointer input, but neither pet decoration nor
transparent animation space should inflate the card's drag constraints. Transparent areas
must not become an invisible desktop-sized click interceptor.

Use hysteresis for attachment changes and snap acquisition/release so the pet does not
oscillate at a boundary. Keep card content layout stable during reveal; move/clip/composite
the presentation instead of repeatedly laying out the dashboard. Concrete timing, thresholds,
minimum dimensions, and the exact native view integration remain to be selected and measured.

## Agreed animation model

The user accepted this state model and the principle of precise movement during input with
softer movement after release. Timing ranges below remain tuning proposals rather than fixed
requirements. The separately accepted native composition is described above.

Keep presentation, direct manipulation, and placement as separate state dimensions. Avoid a
flat enumeration of every combination of pinned, anchored, rotated, dragging, and open.

| Presentation state | Visual intent and transition rule |
| --- | --- |
| Resting | Upright compact pet; occasional blink and barely perceptible breathing. Eligible anchored rest starts the 3-second deadline. |
| Tucking | Rotate toward the selected edge and withdraw halfway as one continuous move. Any interaction reverses it. |
| Tucked | Ears/eyes remain exposed and reachable; no looping attention animation. |
| Waking | Quick lift/turn back to the normal resting pose. Preserve the user's requested click or drag, rather than swallowing it. |
| Preparing | Keep the pet visible while dashboard preparation is incomplete. The card reveal must not promise ready content before it exists. A loading hint is only needed if preparation is perceptibly slow. |
| Opening | Reveal the card from the pet's current visible origin toward its solved rectangle; pet travels to its chosen attachment. |
| Open | Card fully interactive; pet attached to its edge with minimal movement. |
| Closing | Card collapses into its resolved pet destination; pet restores compact scale and upright orientation continuously. |
| Unavailable | Disabled, suspended, or invalid account context. Remove private card content immediately; presentation polish cannot delay teardown. |

Interaction states that can coexist with the applicable presentation state:

- Dragging pet/card: movement follows the pointer directly without a trailing position spring.
  Decorative tilt must not move the grab point or affect placement geometry.
- Snap candidate: highlight the cursor-selected target and optionally outline the actual landing
  rectangle. Candidate feedback does not pull the object out of the user's hand.
- Settling after release: one short placement transition, interruptible by immediately grabbing
  it again. No repeated overshoot or oscillation around the target.
- Resizing: card edges track input directly; content responds inside the card. Avoid springing
  the content size on every pointer update. An anchored opposite edge/corner should remain stable.
- Attachment travel: pet moves around the available perimeter while the card remains stable.
  Remember the path through reversals; do not switch sides halfway through a move.

Pinned, free/anchored placement, edge/orientation, pointer/focus presence, and Reduced Motion
are conditions, not separate bespoke animation sequences. Pinning changes dismissal and window
level; it does not trigger a pet relocation.

Agreed clean-transition rules:

- Maintain one current geometric pose and interrupt from it, rather than chaining independent
  timeouts or resetting to the start frame of a named animation.
- Privacy teardown outranks everything. Direct manipulation outranks decorative movement.
  Explicit open/close actions outrank idle behavior. A tuck is never queued behind an interaction.
- Dragging during opening/closing freezes or resolves the current presentation without moving
  the grabbed point. Opening while tucked preserves a single activation; waking must not add a
  conspicuous wait before responding.
- Preserve corner/side placement through card-size changes and keep the collapse destination
  consistent through attachment changes. Freeze resolved geometry for a transition unless a
  real interaction or display/Dock change requires a new solution.
- The hover region must cover the exposed face and its reveal path long enough to avoid a
  wake/leave/tuck loop caused by the pet moving away from the cursor. Do not intercept unrelated
  desktop input with a large invisible window.
- Treat Reduced Motion as a presentation policy for the same states, preserving all controls
  while removing travel, flips, squash, and breathing.

Starting timing ideas, to tune visually rather than treat as requirements: wake around
120–180 ms; open/close around 180–260 ms; tuck/perimeter travel around 220–320 ms; snap settling
around 100–160 ms. Direct drag/resize response has no intentional easing delay. Springs use
settling criteria, so these ranges describe perceived motion rather than rigid timer durations.

Keep the expression layer restrained: a small ear perk on hover and one subtle acknowledgment after a
confirmed task completion. Avoid continuous pupil tracking, large celebrations, or pet motion
as a substitute for Sonner error feedback. Exact poses remain part of visual tuning.

## Agreed persistence and display behavior

- Save movement and resizing silently after release. Store compact-pet position, card placement,
  and card size separately, associated with the display. Store anchors semantically and free
  positions relative to the display, rather than relying only on absolute pixel coordinates.
- Restore the compact pet when nohmi restarts. Remember the pin preference for its next opening;
  do not automatically expose the dashboard at startup.
- During a cross-display drag, the cursor determines the destination display and its targets.
- On display disconnection, move the pet/card onto a remaining display and fit it into reachable
  bounds. Preserve the disconnected display's saved placement separately from this fallback.
- On reconnection, do not immediately relocate an object the user is using. Retain the saved
  placement for when the pet is returned to that display.
- Dock and resolution changes adjust placement only as much as required to remain usable,
  preserving anchor intent. The closed pet's actual resting position remains independent of
  the card's logical anchor; idle behavior must not teleport it to that anchor.
- Keep the pet available on ordinary desktop Spaces while respecting full-screen apps. Pinning
  keeps the dashboard above ordinary windows without taking focus; it does not force it over
  full-screen apps or system UI.

## Existing safeguards to preserve

- Current account/server authority must guard actions and asynchronous results. Clearing the
  account, signing out, disabling the pet, or other privacy teardown hides private content
  immediately, even while pinned or animating.
- Errors go through Sonner. Autosave success stays silent. No inline action-result banners.
- Failed preparation leaves the pet reachable and provides actionable feedback.
- Respect Reduced Motion and keyboard access. Suspension must stop unnecessary animation
  and refresh work. Pinning does not override sleep or explicit app Quit.
- Do not add unrelated Accessibility or Screen Recording permissions merely to obtain layout
  geometry. Exact Dock observation and its fallback need validation on supported macOS versions.

## Implementation decisions and validation gates

- Reparent the existing Tauri dashboard content into the native pet panel so the native sprite
  and web dashboard share one moving window. Keep the Tauri webview's authenticated command
  identity. Validate focus, viewport sizing, teardown, and transparent click-through locally.
- Observe Dock window bounds through public CoreGraphics metadata without capturing pixels.
  When exact bounds are unavailable, use conservative visible-frame placement; do not claim
  precise beside-Dock behavior until observed on the installed app.
- If no exterior edge can fit the pet, tuck it completely behind the card temporarily. Reappear
  when space returns. Do not move the card or cover interactive content to accommodate the pet.
- Expose all edges/corners for resizing, with a usable minimum and in-card scrolling. Provide
  keyboard movement and resizing. Escape closes even when pinned.
- Noninteractive surfaces drag; buttons, fields, links, menus, checkboxes, and scrolling retain
  their own actions. No window drag should begin from those interactive targets.
- Use top/bottom edges at corners for idle tucking, and skip obstructed tucks. The pet must
  actually occupy a compact anchor; a remembered card anchor alone does not qualify.
- Native event/input behavior, mixed display scales, Dock auto-hide, and Spaces must be verified
  on this computer; failures block completion claims for those capabilities.

## Evidence and acceptance still required

The local HTML companion is illustrative and uses mock content. It cannot prove native drag
smoothness, actual Dock detection, always-on-top behavior, or Today component integration.
Before completion, inspect the installed app while dragging and resizing, at all eight anchors,
with bottom/side Docks, relevant displays/scales, repeated transition reversals, and Reduced
Motion. Verify pin/unpin, keyboard close/movement, quick actions, Sonner errors, and account
teardown during motion. Test geometry and state transitions independently of rendered frames.
Idle checks must cover the 3-second threshold, actual anchor eligibility, timer resets,
pointer/focus suppression, all four edge orientations, Dock obstruction, wake during tuck,
single-activation opening, immediate dragging, and no saved-position mutation while hidden.

## Decision history

1. Initial direction: one connected pet/card interaction, shared Today preview, pin, resize,
   eight optional anchors, and Dock-aware placement.
2. After moving an open card, keep the pet at the new location when closing.
3. Revise snapping to follow the cursor; after moving, replace the old resting point with
   the pet's visible position. This supersedes translating a separate resting point.
4. Constrain expanded movement by the card alone. Move the pet around the perimeter;
   use an upside-down bottom attachment near the top and upright top attachment near the bottom.
5. Preserve the opening anchor's alignment. Anchor 4 means vertically centered along the
   right edge, explicitly not the center of the desktop; apply the corresponding rule to
   every other anchor. Obstacle fitting follows this preferred placement.
6. A closed, stationary, anchored pet tucks halfway into its edge after 3 seconds idle.
   Hover or interaction reveals it and restores its normal position. Obstruction handling,
   corner-edge choice, and actual compact-anchor eligibility are recorded as working defaults.
7. Shorten the previously proposed 10-second idle delay to 3 seconds. Animation states and
   interruption rules were presented for discussion.
8. Accept the animation state model and interruption rules: precise movement under direct
   input, softer movement after release, restrained personality, and reversible transitions.
   This approves that design section, not the unfinished architecture or implementation plan.
9. Accept one native window containing the native pet view and web dashboard, with distinct
   window, placement, animation, and dashboard responsibilities. Cached content and background
   refresh must not block movement; transparent click-through and Dock observation require
   native verification. Persistence and multi-display behavior remain to be settled.
10. Accept silent position/size persistence after release; separate compact and card placements;
    compact startup with remembered pin preference; cursor-owned cross-display dragging;
    reachable disconnect fallback without discarding saved placements; no forced relocation on
    reconnection; and ordinary-Space availability that respects full-screen apps.

11. Accept resize/keyboard/error defaults and temporary full pet concealment when no exterior
    edge has room. User explicitly requests implementation now; proceed inline in this worktree.

Interactive studies are local, ignored artifacts under `.superpowers/brainstorm/48623-1791408578/`.
This document, not that local directory or the chat alone, carries the durable decisions.
