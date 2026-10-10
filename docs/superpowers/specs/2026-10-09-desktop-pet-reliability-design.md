# Desktop pet reliability and quick access design

Status: proposed design for review; no implementation or performance success claimed.
Canonical requirements: `docs/design/pages/desktop-background.md`, Pet reassessment.
Checkpoint: `6699d6fb` on `cooper/desktop-background-setup`.

## Outcome and priorities

The pet is a responsive desktop companion that never blocks nearby controls with invisible
hit areas. Its sleeping pose, card attachment, and movement look connected at every supported
scale. Quick access preserves explicit pin intent and shows useful, scoped commitments and
ritual state. Prioritize rendering/input correctness, then latency, then additional content.

The user approved diagnosis before fixes and confirmed shoo works only with the card closed.
Defaults and algorithms below are recommendations for review, not previously approved facts.

## Evidence and limits

Live reports establish sleep clipping at every location, laggy/inaccurate color updates,
oversized hit areas, and navigation that appears to unpin quick access. Existing tests did
not establish correct native rendering or responsiveness.

Source leads, not confirmed root causes:

- `PetScene.swift` clips the panel envelope to screen geometry while separately transforming
  the sprite and maintaining a rectangular wake corridor. Investigate rotation, view/layer
  bounds, AppKit window constraints, and backing-scale conversion independently.
- Compact mode keeps the entire panel receptive to mouse input. Returning nil from an NSView
  hit test alone does not establish cross-application click-through.
- Color-picker changes run through the serialized full settings read/save path. Measure queue
  growth, native reconfiguration, and out-of-order acknowledgements.
- Pin state, visibility, navigation, and owner-window lifecycle cross Swift/Rust/React. Trace
  the actual state change before assuming which layer causes the reported unpin.
- The native snapshot has a preformatted finance summary, not arbitrary date-range totals.
  Do not relabel that summary to imply a filter was applied.

Full verification at checkpoint failed with 12 tests across five files. Focused passes are not
release readiness. The local build's Accessibility grant and actual Dock measurement also need
fresh verification; do not bypass macOS consent or weaken signing to make them pass.

## Architecture decision

Keep the existing single moving native panel containing the pet and web card, plus the separate
input-transparent anchor guide panel. Keep native ownership of motion, geometry, and pointer
recognition. Keep Rust ownership of authorized settings and account-scoped snapshot transport.
Keep React ownership of settings and card content. No new rendering framework or full rewrite.

Extract small pure policies only where they remove duplicated decisions: silhouette geometry,
appearance revision handling, and shoo recognition. This is preferable to more per-state offsets
or a new multi-window pet/card system that risks reintroducing drag desynchronization.

### One pose, distinct bounds

Each native frame has one pose: translation, rotation, scale, and intentional occlusion.
Derive both drawing and input geometry from it. Distinguish:

- Artwork silhouette: body and ears; no mouth. Eye contrast follows body luminance.
- Render envelope: transformed artwork plus needed shadow/animation extent.
- Input region: visible transformed silhouette only; no shadows or invisible wake corridor.
- Card region: the actual card including interactive header; decorative pet does not enlarge
  the card's placement footprint or restrict movement against desktop edges.

Screen sleep intentionally reveals the same eyes-and-ears portion used when peeking over the
card, rotated inward for the selected edge. Clip only at the intended reveal boundary; no
additional cuts through ears/eyes from a window or layer. Preserve existing Dock-safe corridor
rules, eight anchors, cursor-based snap selection, and anchor-aware close destinations.

Hover may wake the pet but must not create a large invisible clickable corridor. A click
starting on the visible silhouette must still open once, even if wake motion starts before
mouse-down. Test the first click from an inactive app and clicks on an underlying app beside it.
If the existing panel cannot provide reliable click-through, stop and present evidence plus a
focused native-input alternative before changing window architecture or requesting permissions.

### Motion and lifecycle

Explicit modes: idle, tucking, tucked, waking, dragging, snapping, opening, open, resizing,
closing, shooing, disabled, and suspended. Pin is an independent preference, not a mode.
Do not implement every combination as a separate animation.

- Drag supersedes decorative motion; it cannot trigger shoo or sleep.
- Opening clears sleep/shoo recognition and transitions from the current presentation pose.
- Reversal/interruption starts from the visible pose, never a stale endpoint.
- Closing returns to the selected anchor or the freely moved destination already agreed.
- Suspension, disable, screen removal, and account changes cancel timers/gestures safely.
- Reduce Motion uses immediate placement or a short opacity transition, without travel/bounce.
- Settled idle/tucked states do not continuously render unchanged layers. One native animation
  clock owns active movement; no React/network round trips per animation frame.

### Appearance preview and persistence

Use a shared native appearance-preview operation for color and scale. Coalesce to the latest
value per display frame; keep at most one transport operation in flight and one latest pending
value. Tag previews with an edit-session identifier and increasing revision. Reject stale
updates and acknowledgements within that session; invalidate it on account/server changes.

Preview never writes preferences, refreshes snapshots, or reconfigures unrelated systems.
Autosave the final value on gesture completion; keyboard/text edits save after 250 ms inactivity
or blur. Serialize persistence, replace superseded pending appearance patches, and preserve
other settings fields. Completion of an older save must not overwrite a newer visual preview.
On failure, Sonner reports the unsaved state and offers retry; do not silently claim durability.
Color input, swatch, native body, and persisted value must agree after completion/relaunch.

### Shoo: closed card only

Proposed defaults: off for existing/new profiles, Medium sensitivity when enabled. Settings
provide an enable switch and Low / Medium / High sensitivity with plain-language descriptions.
These are discrete choices, not an unexplained numeric threshold.

Recognition uses timestamped pointer displacement in screen points, not event count or speed
alone. Start only over the visible pet; retain samples within its silhouette bounds expanded by
12 points so intentional shaking can cross its boundary. This observation area never intercepts
clicks. Leaving that area resets recognition.

Initial calibration values (must be validated against recordings before release):

| Sensitivity | Minimum alternating strokes | Minimum stroke length | Maximum gesture duration |
| --- | --- | --- | --- |
| Low | 6 | 24 pt | 800 ms |
| Medium | 4 | 18 pt | 700 ms |
| High | 4 | 12 pt | 900 ms |

Ignore sub-3-point jitter; count a stroke only after meaningful reversal along the gesture's
dominant axis. Reset on button-down, dragging, menu use, opening, transition, disable, suspension,
or a sample gap above 150 ms. Tucked hover wakes normally; recognition starts fresh once waking
finishes. There is a 2-second cooldown after arrival, and the pointer must leave before rearming.

Choose the farthest valid compact-anchor center from the pointer at recognition on the current
display. Exclude the current anchor; resolve ties by stable anchor index. If no other safe anchor
exists, stay put. Reuse Dock-aware placement and snapping motion; never cross the Dock through
an invalid path. If a straight travel path is blocked, use a reduced-motion placement transition
instead of introducing a pathfinding subsystem. Persist the new anchor once settled.

### Card actions and pinning

Render a compact title/action row without its own card background. Pin and other ordinary
actions are backgroundless; active pin has a filled background. Open nohmi uses the existing
actual app-logo artwork on a visible background with a tooltip and accessible name. Do not use
a letter stand-in or add an icon pack. Remove the mouth, description, X, refresh, and bottom
quick actions. Keep the calendar preview above commitments.

Only explicit pin/unpin changes stored pin intent. Opening a task, workspace, settings, or nohmi
keeps a pinned card visible and pinned. Unpinned navigation may close it. Escape explicitly
closes either card without clearing pin intent; reopening restores it. Outside-click closes only
an unpinned card. Disabling/logging out may hide content but does not silently toggle pin.

Refresh visible card data every minute and on relevant published changes; no overlapping
refreshes. Do not refresh while closed. Account changes immediately clear old private content.

### Content windows and rituals

Proposed independent task/reminder choices: Today, This week, This month, Next 7 days,
Next 30 days, All upcoming. Default Today. Separate Include overdue toggle defaults on;
undated items appear only in All upcoming in a labelled group. Exclude completed/cancelled
items. Today/week/month use the account timezone and existing week-start preference; rolling
windows start at today's local midnight and end exclusively N calendar days later. If no
week-start preference exists, use locale week start consistently with the main calendar.

Apply ranges before truncation/pagination, not to today's already limited snapshot. Preserve
account/server identity and explicit stale/partial status. Show capped results honestly with a
link to the owning workspace; do not imply a truncated list is complete.

Finance must use honest metrics: Today / This week / This month / Last 30 days show actual
spending through now, using the same transaction and currency rules as Finances. Default This
month. Next 30 days shows known scheduled outflows, labelled “Upcoming,” not predicted spending
or a prorated budget. Include it only if the owning Finance domain supplies authoritative
scheduled data; otherwise disable that option with explanatory configuration copy. Never mix
currencies or reuse the current budget summary under a different range label.

Add Show rituals, default off to preserve existing content. When enabled, show only enabled
morning/evening rituals. Due incomplete rituals appear above the calendar with an Open ritual
action; completed ones appear in a compact status section below it. Before the configured
window, show Scheduled rather than overdue/incomplete urgency. Preserve skipped/missed states
honestly and use the ritual runtime's logical day/occurrence, not a second local completion flag.
Opening a ritual respects pin intent. Failures use Sonner; unavailable data is never “complete.”

## Reliability, measurement, and acceptance

All settings errors and discrete action feedback use Sonner; successful background saves stay
silent. Keep true permission/configuration state inline. Backward-compatible settings decoding
provides defaults; validate finite scale and enumerations at the native command boundary.
No new external providers, input hooks requiring broader permissions, or dependency upgrades.

Before fixes, capture a baseline and reproduce at 50%, 100%, and 200% scale, all eight anchors,
both theme contrasts, Reduce Motion, and available display scales. Record frame intervals,
main-thread update time, preview queue depth, input-to-visible latency, and settled CPU activity
without logging pointer history or private content persistently.

Engineering targets: at most one pending preview plus one in flight; p95 native update work
below 4 ms during a 10-second gesture; p95 color/scale input-to-visible below 50 ms on this Mac;
no sustained missed display refreshes or unchanged per-frame drawing while settled. Report
device/refresh rate and measured results, not an unmeasured “60 fps” claim.

Native acceptance must include nearby underlying-app clicks, first-click wake/open, rapid color
reversal, drag during animation, anchor-close/reset, open-card navigation with pin, sleep/shoo
false positives, Dock resizing, and missing Accessibility permission. Where tooling cannot drive
native input, explicitly obtain manual evidence instead of substituting accessibility activation.
Resolve full verification failures before release; checkpoint commits may document known failures.
