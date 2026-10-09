# Desktop background setup


**Required: Sonner for all settings errors and discrete action feedback.** Pending, success,
and failure messages for notification tests, connection tests, refreshes, permissions, and
native actions must never appear as inline paragraphs, status rows, Alerts, banners, or cards.
Use one loading toast updated to the confirmed outcome; put recovery guidance in its description.
Do not replay cached results on page load. Background autosave success stays silent. Actual
permission/configuration state and field correction/retry controls may remain inline, but never
replace a Sonner error. Tests must assert Sonner and no inline action-result message.
See [the canonical feedback rule](../feedback.md).

The job is to keep enabled desktop features available without the main window open.
Desktop and Pet settings show a shared **Keep nohmi active** readiness overview. Its
**Review checks** dialog separates login startup, notification alerts, pet enablement,
and the morning routine. Routine settings link back to this setup.
The overview requires native login-status support and is not shown by the Windows fallback.
Desktop preferences save on change; setup navigation waits only while their write is pending.
Routine navigation is disabled while routine edits remain unsaved; the current
section has no redundant setup link. Returned native registration errors remain failed actions
even when the bridge request itself succeeds.

Use actual macOS login status, not the requested preference, as evidence of startup
approval. Pending approval offers **Open Login Items** with the next instruction;
missing installation and unavailable status stay explicit. Enabling startup saves only
that preference and preserves unrelated settings. Native preference writes are serialized with
startup registration. Global Notifications contains only OS permissions, master enablement,
sound, previews, and quiet hours; workspace links open and focus the owning notification card. Notification readiness
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

## Desktop settings composition

Desktop pet is a peer Settings destination, never hidden beneath Desktop app. Its primary
controls come before background diagnostics. Desktop app separates Updates, Background activity (including startup),
Widgets, and Server connection using the shared settings cards and content-width bento.
The installed app does not repeat its download promotion above its preferences.

Optional ritual setup never appears in the shared application layout. People find and configure
rituals in Settings → Rituals. Its local delivery group uses the short **Background settings**
action, with unsaved-change guidance in wrapping text rather than a long button label.

Login presents a quiet **Server settings** trigger. Hosted/custom selection, testing, and saving
live in its labelled, scrollable dialog; custom-server use does not automatically expose the
editor on login. Keep the active server, drafts, failure recovery, and account-switch behavior
intact. Native recovery evidence remains available inside this dialog.

Buttons and form fields must fit their owning cards/dialogs at 390px and desktop widths. Use
wrapping action groups and existing responsive settings containers, not overflow clipping.

## Wallpaper rendering boundary

The API resolves submitted public Pinterest boards before persisting them, using the bounded
10-second, 4 MiB connector fetch. Board identity and its matching feed must be present; generic
page imagery, login/discovery pages, missing/private boards, and malformed responses fail closed.
Existing HTTPS Pinterest origin restrictions remain; no additional credentials or hosts are used.

The macOS preview command shares the download, decode, layout, backdrop, and composition pipeline
with application. It returns a reduced PNG for the primary display without changing any desktop,
removes temporary output, and caches only successfully decoded sources. Account/server changes
cancel both paths; preference revisions also guard application. Preview snapshots may finish while
preferences save, but the UI discards superseded results and disables Refresh while saving/rendering.
All displays are prepared before application; existing partial-application errors remain explicit.

Provider markup can change and a public board can become unavailable after validation. These
remain actionable errors, never substitutes. Automated layout tests establish proportional geometry,
source repetition and frame coverage; native visual QA must additionally inspect real board imagery.

Local macOS smoke (2026-10-07): the development app resolved the saved public board, downloaded
and decoded its real images, displayed a native PNG preview, and applied the matching collage to
both connected displays (3840 × 2160 and 3024 × 1964). The primary-display output matched the
preview composition. A separate live missing-board request was rejected; service tests verify
rejection occurs before any preference write. This is local evidence, not a production-provider
availability guarantee.

### Notification permission and sound

Request notification alerts, sounds, and badges through UserNotifications. While macOS is
answering, show a pending state and disable duplicate requests and test delivery. Permission
is not granted merely because the request was accepted. Refresh the OS state after the
callback and when returning to the app. A prior denial opens Notifications in System Settings;
macOS cannot display the initial authorization prompt again. Authorized users can still have
banners or sounds disabled, and Focus can suppress presentation.

Launch at login uses SMAppService registration. If it returns `requiresApproval`, open Login
Items for user approval and continue showing the actual registration state. Closing a window
is distinct from quitting the process. Pet overlays and wallpaper do not require Accessibility
or Screen Recording access; do not request unrelated permissions.

Every notification type uses Sound CN’s CC0 Kenney soft click when sound is enabled. The
bundled PCM WAV is installed atomically in the user’s Library/Sounds for UserNotifications.
Missing assets and native authorization/delivery failures remain observable in settings and
Sonner. No notification permission or delivery test can prove Focus presentation or audible
output; verify those on the installed app. Local ad-hoc signing is not evidence that the
signed release’s identity, authorization, or login-item registration works in production.

Turning notifications on requests OS authorization as part of that explicit action. Merely
relaunching an app with previously denied permission does not reopen System Settings.

Manual notification tests use a separate submission queue and are excluded from routine pending
and delivered-notification cleanup, including reconciliation while scheduled alerts are off.
Account/server clearing still invalidates and removes tests. Tests submit immediately and show
OS acceptance separately from visible presentation. Screen sharing/mirroring notification
suppression is a global macOS privacy setting; the app does not override it.

### Pet appearance and quick access

The Desktop pet settings page owns an autosaving color picker and a scale slider from 50% to
200% (100% by default). Use the shadcn.io color-picker component with keyboard-accessible
saturation/brightness and hue controls plus editable hex input. Invalid colors and failed
preference writes use Sonner; successful autosaves stay silent. Resizing preserves the pet’s
saved anchor or free placement, immediately updates the visible sprite and hit target, and
clamps its full resized bounds to the available screen geometry.

Clicking the pet opens a floating app webview beside it, using the app theme, shadcn cards,
buttons, and Sonner. Tray Quick access remains available when the ambient pet is disabled;
closing that dashboard does not enable the pet. Do not use SwiftUI/AppKit menus or popovers
for quick-access content.
Escape, the close action, or focus moving outside the overlay dismisses it. Workspace choices
filter the cached snapshot. Completion and meeting actions verify the current server/account;
account clearing destroys the overlay so stale account content cannot reappear. The native
layer owns the sprite, window placement, and authenticated transport only.

Local macOS smoke (2026-10-07): verified the new picker and autosaving scale in the installed
Local app, resized the native sprite to 200%, restored 100%, and opened the app-styled task and
calendar cards with the main window closed. Visual QA caught and corrected shrinking cards and
clipped task titles; cards retain their content height and the overlay scrolls vertically.

### Connected pet motion

**Target behavior, revised during design on 2026-10-07; not a claim of native implementation.**
The [living pet system decision record](../../superpowers/specs/2026-10-07-desktop-pet-system-design.md)
tracks the agreed interactions, engineering proposals, unresolved choices, and required evidence.
These rules supersede the earlier header-only dragging, always-above pet, and separate-window
follower design described by the current implementation.

The pet and quick-access card form one moving object. Opening expands the card from the pet;
closing collapses it into the pet. Repeated input reverses from the current pose without jumping.
The card reuses Today's calendar preview above tasks, supports resizing, and offers a pin action
that keeps it open and above ordinary windows. All noninteractive card surfaces initiate dragging;
interactive controls and scrolling keep their usual behavior.

Before dragging, closing may retrace the original opening. Once the open card moves, its visible
pet becomes the new collapse destination. Closing leaves the pet there, not at a previous resting
point. Drag constraints use only the card rectangle, without permanent space reserved for the pet.
Near the top of the screen, the pet hangs upside down beneath the card. Near the bottom, it peeks
upright above the card. It moves around the card's perimeter as necessary to stay visible without
restricting the card's available movement. Attachment transitions stay continuous and do not jitter.

Eight optional snap anchors cover corners and side midpoints. The cursor selects the candidate,
including when the card has hit a movement boundary. Targets remain visible during dragging;
release commits the selected placement, while moving away retains free placement. The expanded
card fits the selected corner/side; the pet adapts to the card. Compact and expanded placement
consider their own footprints and actual Dock obstruction, so space beside the Dock remains usable.
Exact Dock observation still requires native feasibility checks; do not assume a whole reserved
strip is the Dock or add unrelated permissions to inspect it.

Opening preserves the selected anchor's alignment before obstacle fitting: corners expand inward,
left/right midpoints center the card vertically along that edge, and top/bottom midpoints center
it horizontally. Anchor 4 therefore opens along the right edge, not at the desktop's center.
Pet attachment adapts afterward; it must not override the card's preferred alignment.

After 3 uninterrupted seconds idle with the card fully closed and the stationary compact pet
on an anchor, tuck it halfway into the corresponding edge with its eyes and ears facing inward.
Hover or interaction reveals the pet at its normal position; a click/keyboard activation still
opens the card and a drag still moves it. Free placement, an open card, movement, hover, or
keyboard focus suppress the tuck. Preserve the saved position and start a fresh idle interval
after interaction. The exposed face must remain reachable. The living decision record tracks
the current corner-edge and Dock/menu-bar fallback proposals separately from confirmed behavior.

The agreed animation model separates presentation states (resting, tucking, peeking, waking,
preparing, opening, open, closing, and unavailable) from drag/resize/snap interactions and placement
conditions. Pointer-controlled movement is precise; release and attachment transitions may soften.
Transitions reverse from their current pose. Direct input overrides decorative motion, and private
content teardown overrides presentation. Pinning changes dismissal behavior without relocating the
pet. Keep expressions restrained and preserve the same controls under Reduced Motion.

The accepted architecture uses one native window containing the native pet view and web dashboard.
Window movement moves both together. Separate window, placement, animation, and dashboard owners
keep geometry and motion independent of data refresh. Show valid cached content while refreshing;
account changes invalidate it immediately. Transparent animation space must pass unrelated desktop
input through. Native click-through and Dock observation remain validation requirements.

Save position and size silently after release, keeping compact-pet position, card placement, and
card size distinct per display. Persist semantic anchors and relative free positions. Preserve
the shipped single-display position through a one-time conversion; a valid new placement takes
precedence, and the old record is removed only after conversion succeeds. Restart into
the compact pet with the pin preference retained for the next opening. The cursor selects the
destination display while dragging. Display removal fits the object onto a remaining display while
preserving the old placement; reconnection does not unexpectedly pull it back. Keep it available
on ordinary desktop Spaces, respect full-screen apps, and avoid taking focus merely because pinned.

Preserve keyboard controls, Reduced Motion, display-change recovery, and immediate private-content
teardown on account clearing or disabling, even when pinned. Initial loading must leave the pet
available; preparation failures use Sonner. Suspend unnecessary animation and data refresh work
while hidden. The earlier local smoke checks above establish only the earlier implementation.


Implementation draft (2026-10-08): the worktree now contains the single-window native scene,
cursor-based anchors, separate display placements, pin/resize, adaptive attachment, 3-second
idle peek, and the shared Today timeline. The [implementation plan and evidence](../../superpowers/plans/2026-10-07-desktop-pet-system.md)
records native/unit/browser checks. Keychain startup is unblocked. The installed Local app has
been checked with the main window closed: quick access renders the real calendar and tasks,
keyboard movement moves the scene, top-edge placement turns the pet upside down below the card,
keyboard resizing reflows the webview, and close/reopen preserves the moved location and size.
Pin state, Escape dismissal, and opening the main app were also exercised. The native suite has
64 passing tests. Native input also preserves the wake-up hit area, exposes only the onscreen
accessibility target, accepts the first click while inactive, and retains keyboard focus across
repeated readiness announcements before the opening animation's first frame. The hidden Tauri
owner no longer has a competing macOS blur handler. Pointer dragging could not be driven by the available macOS UI automation
because it could not target this panel for coordinate input. Actual pointer snap/release feel,
live Dock avoidance, multiple displays/Spaces, and Reduced Motion still need hands-on verification;
unit geometry tests do not establish those visual results.


Native geometry/performance correction (2026-10-08, revised after live Dock occlusion):
side peeks face inward. Avoidance takes priority over corner alignment: when a valid Dock
rectangle is available, compact and card footprints fit beside it; when metadata exposes only
an unusable full-screen Dock window, the entire reserved Dock strip is blocked for both.
The earlier assumption that unmeasured corner lanes were usable is withdrawn. Never tuck
through a blocked Dock strip; validate the entire hide/reveal corridor, not just its endpoint.
A corner may tuck into its other edge when that corridor is clear; otherwise remain visible.

Desktop widgets are not placement obstacles (decision clarified 2026-10-09). The pet and
card may overlap widgets and must stack above them. Keep the native panel one level above
the Dock, which also places it above desktop-layer widgets. Do not move a selected anchor
or hiding path to avoid a widget. Dock avoidance remains separate: observe changes at
one-second intervals while active and at gesture boundaries, refit invalid positions, and
cancel stale hiding poses when Dock geometry changes. Compact windows remain receptive to
mouse input without depending on a global mouse-move notification to become clickable.

Dock placement optionally uses macOS Accessibility access, requested explicitly from Desktop
pet settings (approved 2026-10-09). The OS owns consent and revocation; nohmi never grants
itself access. Settings show actual permission and geometry availability. Opening System
Settings reports its outcome through one Sonner toast and does not claim permission was granted.
The Dock reader only reads the Dock application's AXList role, position, and size; it performs
no accessibility actions and reads no other applications or screen pixels. OS permission is
broader than these reads, so the UI explains this specific use.

The native scene owns measurement. Accessibility IPC runs on a utility queue with 50 ms
per-call timeouts, a 250 ms read budget, a bounded child list, and at most one read in flight.
Main-thread geometry consumes a one-second cache that expires after three seconds. Invalid,
full-screen, denied, or unavailable measurements use the conservative existing fallback;
revocation discards the cached rectangle. Confirmed Dock bounds permit compact and card
footprints beside it when they fit, while larger cards stay clear. No durable job or network
is involved, and measurements are not persisted. The periodic geometry observer refits anchors
and hiding paths when permission or Dock size changes. OS changes to the AXList structure can
still make precise geometry unavailable despite permission being granted; native acceptance
must confirm the measured footprint, not merely the permission flag.

Selected anchor guides are white, independent of the pet color. Guides live in a stationary,
input-transparent overlay so dragging never expands the moving pet/card panel to screen size.
Pointer events coalesce to the display clock, with the release cursor flushed before snapping.
Ordinary movement only translates the panel; unchanged view frames, transforms, and window order
are retained. Dock metadata is refreshed at gesture boundaries, display transitions, and the
low-frequency obstacle check; it is not read on each pointer frame. Decorative sprite animation pauses during direct movement;
a settled peek only redraws its expression when needed. Relocation clears the old tucked pose.

### Pet interaction refinements (2026-10-09)

- Snapping the open card establishes both its card anchor and the compact pet's close
  destination. Closing an unsnapped, freely moved card still leaves the pet at its new location.
  Reset clears obsolete tuck geometry and uses the pet's current display and measured Dock.
- Screen-edge sleep uses physical screen clipping only; card attachment retains its separate
  half-body mask. Sprite size and its rendered layer scale together. Face details use whichever
  of black and white has greater contrast against the chosen pet color, independent of app theme.
- Desktop pet settings autosave an idle-sleep toggle and a delay of 1–300 seconds, defaulting
  to enabled and three seconds. Sleep means tucking while anchored with the card closed; hover
  and interaction wake it. Slider movement previews scale through a lightweight native command;
  releasing or completing a keyboard step persists the final setting once.
- Right-clicking the pet offers Disable pet, Pet settings, and Open nohmi in a native contextual
  menu. Disabling persists through the same serialized, account-scoped settings transaction.
  Errors open the app and use Sonner. The quick-access dashboard remains app-styled web content.
- The card has a compact header with Today, pin, and a tooltip-labelled nohmi symbol action.
  Remove the description, manual refresh, and X. Escape and outside-click still dismiss it;
  pinning suppresses outside-click dismissal. Refresh data every minute while open and update
  from newly published native snapshots without transferring private payloads in events.

### Pet reassessment: accepted requirements, not implemented (2026-10-09)

Live user feedback supersedes the earlier implementation claims: the pet still clips whenever
it sleeps, and color changes are severely laggy and sometimes inaccurate. Existing geometry
tests do not establish correct rendering. Reproduce the actual sleep clipping at every edge
and trace color input through preview, persistence, native updates, and rendering before
choosing fixes. Review the whole interaction system for responsive, seamless animation;
do not equate passing tests with smooth native behavior.

- Remove the mouth; retain contrasting eyes.
- Place the title and header actions directly above the content without a surrounding card
  background. Actions are backgroundless except the active pin, which is filled, and the
  nohmi action, which has a visible background and the actual application logo, not a letter.
- Pinning is persistent user intent. Opening a task or other destination in the main app
  must not unpin quick access. Only explicitly clicking unpin changes pinned to unpinned.
- Remove the bottom quick actions.
- Add independent useful time-window choices for tasks, reminders, and finances: today,
  this week, this month, and the next 30 days are requested examples. Exact options and
  overdue, calendar-boundary, and finance semantics need agreement before implementation.
- Add optional morning/evening ritual cards reflecting whether enabled rituals are complete;
  incomplete enabled rituals get a prominent item at the top. Reuse authoritative ritual
  completion state. Placement and interaction details remain to be discussed.

The immediate request is to checkpoint and push existing work, preserve context, then reassess
the system together. These requirements must not be represented as already shipped.
