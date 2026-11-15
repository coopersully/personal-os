# Design system and menus

Detailed rules moved from the `personal-os-frontend` skill. Every rule here is binding.

## Apply the design system deterministically

- State the page's immediate user job and classify each visible group using the
  design-system block grammar before adding layout.
- Compose existing shadcn primitives. Do not add feature-specific replacements
  for Card, Item, Alert, Collapsible, Empty, or Sonner.
- Compose the shared compound `EventCard` for non-spatial event summaries and
  previews. Fill or omit its named slots instead of creating page-specific
  event-card markup. Calendar grid blocks remain a separate spatial pattern
  because their position and size encode time.
- Use one raised primary block at most. Do not wrap every page group in a card;
  use an open sequence or a quiet queue for ordered material.
- When four or more diagnostic rows answer one readiness question, show one
  product/object overview with the shared `ReadinessPanel`, an honest aggregate
  state, and the next unresolved check. Show determinate progress only after all
  required reads settle. The closed overview has a hard two-row maximum: put
  identity, status, and a one-line focus on row one, then count, progress, and
  evidence access on row two. The focus replaces the normal description; never
  add a focus callout, nested `Item`, action, or third row. Open the complete
  vertical `ItemGroup`, including per-check actions, in a labelled dialog;
  diagnostic review must never expand the overview. Promote an actionable
  failure as **Next step**, but call a non-actionable failure **Current
  constraint**. Do not make diagnostics a default dashboard grid.
- Apply the interface-copy contract: delete helper text that restates an
  obvious label, and use a preview when the result can be shown more clearly
  than it can be explained.
- Keep labels persistent. When a placeholder is useful, demonstrate the
  expected shape with obviously fictional reserved material such as
  `sam@example.com`; never use personal data, production identifiers, or
  plausible credentials.
- Keep interaction treatment flat. Shared controls use semantic background and
  border changes for hover, focus, and selection; do not add rings, outlines,
  or box shadows as interaction indicators.
- Separate ordinary surfaces and controls with opaque semantic tone rather than
  a visible resting border. Shared primitives may reserve transparent border
  geometry for focus, invalid, increased-contrast, or functional data states;
  a legacy `outline` variant does not require a drawn outline.
- Keep semantic foreground tokens intact on interactive controls. Never add a
  global color override that can defeat a component's `text-*` contrast class.
- Keep navigation icon geometry stable across states: use the regular and
  filled weights of the same icon, with fill reserved for the active
  destination.
- Treat Calendar, Tasks, Mail, and Finances as the only colored workspace
  identities. Read their label, route, and glyph from the shared workspace
  registry and render the solid `WorkspaceIcon` whenever representing the
  whole workspace. Use a white glyph on fully saturated fill without a border or extra frame. Keep its palette stable across selection; use the
  control surface for active state. Keep every palette high-chroma and distinct
  at peripheral glance in both themes; do not mute workspace identity toward
  gray in the name of calmness. Never copy workspace palette values into a
  feature, apply them to a whole page, or use them as status. Today stays
  neutral, Reminders stays inside Tasks, and ordinary actions, records, views,
  and providers use unframed functional icons.
- Treat Today, Calendar, Tasks, Mail, and Finances as the complete workspace
  set. The navigation-owner manifest, rather than a leaf route, determines the
  active workspace sidebar: Today has no contextual sidebar; Tasks owns
  Reminders. Goals, Motives, Reviews, and Activity belong to the account utility
  in Settings. Account configuration is a tenant of the shell: it uses the
  shared frame and sidebar column, with a Settings page heading instead of an
  app bar (see `docs/design/pages/settings.md`), but must not become a workspace,
  take a workspace identity, or enter the switcher. Only a standalone flow such
  as setup may replace the shell.
- Combine only attributes that answer the same user question into one compact
  trigger and detail surface. Keep a neighbouring control when it represents a
  distinct action—for example, weather icon + temperature combine, while the
  location remains a separate map control. Use connected-service marks instead
  of raw provider identifiers.
- Weather detail uses a time-of-day sky header with the condition, temperature,
  and no more than two supporting facts. A location trigger opens an in-app map
  preview; clicking that preview is the explicit external action, never the
  trigger's direct behavior.
- Use `ChoiceCardGroup` for a small, mutually exclusive set of previewable
  preferences. The full card must be the radio hit target; do not place a
  disconnected radio beside a clickable-looking card. Always reserve the
  selection-marker space so selection does not shift content; anchor card
  information at the top/start and stretch any preview at the inline end.
- Treat review feedback as a system input: convert it into a named invariant in
  `docs/design/system.md` when governance criteria justify cross-product scope,
  assign it to the responsible shared layer, and add focused coverage plus live
  QA before closing the work. Keep page-specific rules in the page spec and
  unproven preferences as trial hypotheses.
- Keep source, freshness, capability, policy, and action result visible at the
  smallest useful level. Keep raw metadata, history, rare controls, and verbose
  configuration behind labelled disclosure.
- Update the page specification when a change establishes or revises a reusable
  interaction rule. UI and its specification must land together.

## Menus and selection semantics

Apply the app-wide [menu standards](../../../../docs/design/system.md#menus-and-selection-controls-all-workspaces).
Use `DropdownMenuItem` for commands/navigation, `DropdownMenuRadioGroup` and
`DropdownMenuRadioItem` for mutually exclusive values, and `DropdownMenuCheckboxItem`
for independent toggles. Shared trailing radio/checkbox indicators must remain visible
when unchecked; do not append ad hoc checkmarks or nest interactive inputs in menu rows.
Keep multi-select menus open while adjusting options. Reserve indicator space, constrain
menus to the viewport, and separate destructive actions with a separator and destructive
variant. Replace one-action overflow menus with accessible direct icon buttons.
Verify keyboard navigation, selected/unselected/mixed/disabled states, and narrow layouts.
These rules apply to every workspace and Settings, not only Tasks.
