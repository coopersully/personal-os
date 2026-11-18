---
name: personal-os-frontend
description: Build and refine accessible, domain-owned nohmi React PWA experiences. Use when changing `apps/web`, critiquing or refining a screen, translating UX feedback into shared rules, adding a feature page or view state, composing shadcn primitives, changing API queries, or refactoring the application shell.
---

# nohmi frontend

Apply the repository [tracking lifecycle](../../../docs/engineering/work-context.md#mandatory-tracking-lifecycle)
to assigned durable work; pure read-only use of this skill creates no tracking work.

Follow `docs/design/foundations.md`, `docs/design/governance.md`,
`docs/design/system.md`, the relevant page specification in
`docs/design/pages`, `apps/web/src/features/README.md`, and
`docs/engineering/feature-ownership.md`. Apply the installed `shadcn` skill for
component lifecycle and the available React best-practices guidance for
performance work.

Read `docs/product/workspaces.md` before changing a core workspace. Mail is a mail client, Tasks a
task manager, Calendar a calendar, and Finances a budgeting and net-worth application; nohmi
intelligence simplifies those familiar models rather than replacing them with a generic dashboard
or chat surface.

## Diagnose refinement before editing

For settings refinements, check rejected autocomplete drafts through blur/refocus and keep
validation on the visible input. Search must reveal existing editors without creating data.
Check compound choices against their actual column width, including internal overflow;
page containment alone can miss clipped options. Decorative ritual canvases stay within
their viewport; independently verify card/footer bounds after entrance animations settle.

- Record the visible symptom, conditions, and user or system cost without
  embedding the requested fix.
- Walk the governance diagnosis ladder: user outcome → information hierarchy →
  pattern → primitive → token → composition → defect.
- Fix the earliest stable layer responsible for the failure. Do not turn one
  preference into a global invariant or hide a shared cause behind a page-only
  override.
- State the proposed invariant or trial hypothesis, maturity, owner, affected
  surfaces/states, and verification. Keep exceptions explicit and contained.
- Treat implementation and automated tests as behavior evidence, not as proof
  of comprehension, visual quality, or user validation.

## Structure feature work

App-wide recovery uses the shared `RecoverySurface` (desktop dialog/mobile drawer), owned by the
session shell. Follow `docs/design/feedback.md`: account recovery precedes failed reads, which
precede snoozable connection-health reminders. Keep existing content mounted; no error banners
in navigation, sidebars, or bento layouts. Retry safe reads only, never uncertain writes. Use
authoritative connector health, not renderer-invented staleness. Connection reminders can only be
reviewed or temporarily snoozed, with owner-scoped session expiry and recurrence after 15 minutes.
Test persistence, expiry, identity isolation, automatic recovery, focus, and mobile drawer behavior.
Action feedback uses Sonner everywhere, including non-settings records and toolbars. Use
`RecoveryRequest` for domain-owned conflict/batch recovery; preserve drafts and reviewed retry
controls without inserting banners. Include companion lookup/configuration retries in the recovery
surface so they are usable while the page is blocked. Secondary reads use `QueryFeedback` so the read gate owns
them. Reserve geometry for conditional navigation attention controls and visually compare the
layout before, during, and after failures on desktop/mobile.
Use the shared modal-priority contract: defer late-opening page dialogs during recovery, preserve
already-open editors and drafts, and allow nested repair dialogs inside the recovery surface.

- Place a vertical feature under `apps/web/src/features/<domain>`.
- Keep its page composition, query hooks, local state, and feature-only
  components together.
- Use `@personal-os/api-client` and domain contracts; do not call providers or
  invent page-only representations of provider material.
- Compose `src/components/ui` primitives. Do not create replacement primitives
  or bypass shared theme tokens.
- Compose dense contextual navigation with the shared Sidebar, Collapsible,
  and sub-menu primitives. Keep account disclosures and child destinations as
  separate bounded rows; truncate identity text and align counts independently
  so live provider data cannot collapse into a text block.
- Do not repeat a workspace name between the switcher and its contextual
  navigation, and do not mark internal routes with external-link glyphs.
- Let the app shell own routing, global navigation, Today, the generic Add menu,
  and modal composition. Keep new domain behavior out of `app.tsx` unless it is
  necessary composition wiring.
- Keep page-wide orientation, search, filters, freshness actions, and the
  primary create action in the app frame. When the frame exposes them, begin
  the feature body with primary material instead of repeating a title, eyebrow,
  search field, or action bar.

## Expo mobile alignment

Start with `docs/design/mobile-frontend.md`, the canonical mobile frontend contract. It includes
native glass/navigation, motion, entity identity, geometry, actions, forms, filters, Tasks
organization, accessibility and notification feedback. Apply its linked forms contract to editors.

Follow `docs/design/system.md#expo-trailing-record-actions`: content-card icons and task checkboxes
anchor top-left, trailing record actions anchor top-right, and overflow uses vertical `⋮`. A single
action is an icon button; multiple actions use the native iOS menu. Project/list detail headings
include their leading semantic icon. Keep title/content gaps compact while preserving 44-point
touch targets. Apply the shared mobile components rather than page-only positioning overrides.

Settings-style form rows center the icon, label, value and accessory vertically. This takes
precedence over content-card top alignment. Follow `docs/design/mobile-forms.md`; use visible
named sections rather than Show more/More details disclosures for ordinary or optional fields.
Use the shared RecordIdentity title/description block, TagsField badge grid, and leading-icon
appearance picker. Keep lifecycle actions top-right (single icon or native ⋮ menu). Use the floating bottom-right
checkmark Save; untouched forms show Close at top-left and disabled Save, while edited forms
show Cancel with discard confirmation. Automatic defaults do not mark forms edited.

List configuration follows the filter/view contract in docs/design/mobile-forms.md: bounded filter
sheets, native sort/group selection, readable active chips, explicit reset scope, and an effective
presentation summary. Keep query configuration out of result-list content.

Association fields must prefix their label with the canonical entity icon from the mobile
product dictionary. Apply the same entity identity across headings and record controls. Record
forms never offer per-record time zones; use the account planning timezone in controls and saves.

## Detailed references

Read only the references the change touches; each rule in them is as binding as this file.

- Read [references/design-system.md](references/design-system.md) before composing page layout, block grammar, cards, `EventCard`, `ReadinessPanel`, interface copy, placeholders, interaction/tone treatment, workspace identity, weather/location controls, `ChoiceCardGroup`, or any dropdown/menu selection semantics.
- Read [references/settings.md](references/settings.md) before changing any Settings route, row, inline editor, settings choice control, page/subsection header, settings routing (`settingsPath`), row geometry, `SettingsIconSlot`, or running a Settings-wide visual pass.
- Read [references/interaction-standards.md](references/interaction-standards.md) before changing row icons, command labels, destructive confirmations, modal footers, inactive/danger rows, binary or dependent settings, Goals & Motives, Rituals (overview, steps, previews, History), dividers, Card slot padding, or filter/sort trigger glyphs.
- Read [references/data-views.md](references/data-views.md) before changing dataset filters/sorting, `data-table`, search action sections, reorderable lists, mobile record composition, data-page empty/error/stale/recovery states, or Settings data-view and native-permission audits.

## Make user state honest

Represent loading, empty, error, stale, reconnect, and capability states.
For provider-backed material, expose freshness and failure instead of silently
presenting a projection as current. Make destructive actions deliberate and
surface API policy or permission failures clearly.

For agent-driven setup, render the authenticated server plan as the source of
truth for current, blocked, and complete state. Ask the person only for the
connection, preference decisions, or approvals nohmi cannot perform. Keep hosted
skills and procedural prompts as optional compatibility references; never make
the person copy setup instructions between nohmi and an agent after the agent can
call nohmi.

For User Knowledge, read `docs/product/user-knowledge.md`. Present it as About you or Your context:
show what nohmi believes, whether the person stated it or nohmi inferred it, its source, confidence,
scope, and allowed purposes, with direct promotion, correction, restriction, dispute, export, and
deletion controls. Do not expose vector similarity, raw embeddings, or an unbounded memory dump as
the primary experience.

## Apply feedback consistently

**Settings feedback invariant:** all settings errors and discrete action feedback MUST use
Sonner. Never add inline pending/success/failure paragraphs, status rows, Alerts, banners, or
cards for notification tests, connection tests, refreshes, permission requests, or native actions.
Use one loading toast and update it on actual completion, with diagnostic next steps in its
description. Do not replay cached success on page mount. Keep autosave success silent. Field
corrections and actual permission/configuration state may remain inline but cannot replace the
Sonner error. Test both the toast and the absence of inline action-result text. This overrides
any generic inline-error guidance below; the canonical rule is `docs/design/feedback.md`.


Follow `docs/design/feedback.md`. Use `useFeedbackMutation` with an explicit
user-facing action and safe-retry classification. Render `MutationFeedback` for
persistent failures; edit forms use `FeedbackForm`, named inputs, and field-name
mapping instead of a second error banner. Prefer Sonner for transient action
results. Preserve drafts, one-time secrets, and cached data after failed refresh;
keep query recovery and stale status beside the affected work. Validate on
submit/meaningful blur, never on the first keystroke. Confirm irreversible actions
with `useConfirmAction`; keep feedback and focus reachable after menus close.

## Verify interaction behavior

Add focused Testing Library coverage for feature behavior. Use Playwright when
the change crosses routing, responsive layout, or a user-visible flow. Keep
the generated shadcn sources as vendor primitives; test product composition.

Target WCAG 2.2 AA across the complete flow. Prefer native HTML and established
shared primitives; follow WAI-ARIA APG keyboard conventions for composite
widgets. Automated checks do not replace keyboard, focus, zoom, reduced-motion,
responsive, realistic-state, and assistive-technology inspection appropriate
to the change.

Settings routing, row geometry, and Settings-wide visual audits are in [references/settings.md](references/settings.md); the detailed interaction standards are in [references/interaction-standards.md](references/interaction-standards.md).

## Examples, compact settings, and action grouping

Use plausible, non-personal sample values as text placeholders, not instructions such as
“What needs doing?” or “Add a description.” Pair examples coherently: “Plan meals for the week”
and “Choose three dinners and make a grocery list.” Keep persistent accessible labels; examples
are never defaults or saved data. Search examples demonstrate a meaningful query.

Setting fields rest in one vertically centered row with the label leading and the value trailing.
Simple short text and numeric values edit directly in the trailing value area without expanding
the row (for example Estimate in minutes). Use an appropriate keyboard. Expand only controls
that need more space; Done returns to the compact row without losing draft changes. Title/description are content fields
and remain visible. Allow rows to grow for accessibility rather than forcing clipping.

Action menus show semantic icons. Put ordinary actions first, then a separated destructive
group at the bottom in red. Cancelling a record and deleting/trashing are destructive; dismissing
a picker or cancelling an unsaved editor is not a destructive record action. Preserve confirmations
and disabled states. Native menus own their section separators and destructive rendering.
