# nohmi setup experience design

**Status:** Approved interaction direction; ready for implementation planning
**Date:** September 1, 2026

## Summary

Redesign setup as a quiet, mobile-first extension of the authentication experience. The flow should feel lightweight and centered, preserve the existing setup state and integrations, and use the shared shadcn-based components already established in the app.

The public product name is always written **`nohmi`**. It is never title-cased or capitalized. Existing user-visible `Nomi` and `Ilo` branding is a regression and must be corrected wherever the setup work touches shared brand surfaces.

## User outcome

A new or returning user can move through setup without confronting a dense wizard. Every step clearly presents one decision, keeps its main content within or close to one mobile viewport, and makes the next action obvious without adding persistent chrome.

The user can:

- choose workspaces by selecting the workspace cards themselves;
- see which Google, Apple, and financial accounts are already connected;
- add another account from a compact list;
- consciously continue without connecting an account;
- finish setup by going directly to Today at a Glance or connecting an agent.

## Brand contract

### Public naming

- Display the product name as `nohmi` everywhere, including headings, metadata, accessible labels, onboarding copy, documentation, and generated user-visible content.
- Rename product-facing symbols and components when practical, such as `NomiBrandMark` to `NohmiBrandMark`, so future code does not reintroduce the wrong casing.
- The mark may appear without a wordmark where the surrounding context already identifies the product.
- Setup does not show a product wordmark in its header. Its only persistent header content is progress and `Exit Setup`.

### Compatibility naming

Do not mechanically rename internal or compatibility identifiers that are not user-visible. The following may remain when changing them would break compatibility or exceed this project:

- the repository and internal system identifier `personal-os`;
- legacy protocol and storage identifiers such as `ilo://`, `ui://ilo`, `$ilo-setup`, migrations, headers, or persisted keys;
- historical references that explicitly document the old product name.

Where a compatibility identifier becomes visible to a user, render it through a public `nohmi` label.

## Experience principles

- **One decision at a time.** A step should not feel like a dashboard.
- **Mobile first.** The 320-pixel layout is a primary layout, not a compressed desktop design.
- **Quiet structure.** Use whitespace, flat surfaces, and background changes instead of ornamental borders or shadows.
- **Stable geometry.** Selection must not move, resize, or reflow cards.
- **Progress without ceremony.** Progress and exit are available, but do not compete with the step.
- **Standard composition.** Use the established shadcn Button, Dialog, Drawer, Card, Item, form, and focus conventions.

## Setup frame

Create a shared `SetupFrame` that owns the layout for every step.

### Header

The header contains only:

- a progress indicator representing completed and current steps;
- `Exit Setup` aligned to the end of the same row.

Remove the setup wordmark, `Know Me`, standalone step-count headings, and percentage copy. The progress bar must still expose an accessible value and label.

The header uses the same horizontal content alignment as the centered body. It remains compact and respects the device safe area.

### Body

- Center the step content horizontally and, when its height permits, vertically within the usable viewport.
- Use a narrow reading measure comparable to the authentication form, expanding only where a bento grid or account list genuinely benefits.
- Prefer concise titles, one short supporting sentence, and compact controls.
- Avoid a large filled shell around the entire page.
- A step may scroll when content, validation, accessibility text sizing, or the keyboard requires it. Navigation must remain reachable without covering interactive content.

### Navigation

Create a shared `SetupNavigation` with circular, icon-only shadcn Buttons:

- back arrow at the lower-left when a prior step exists;
- forward arrow at the lower-right on ordinary steps;
- accessible names of `Back` and `Continue`;
- minimum 44-by-44-pixel targets, visible keyboard focus, and safe-area-aware offsets.

The controls float over a small bottom edge fade matching the page canvas. This fade is a functional legibility treatment and the sole setup exception to the no-gradient brand rule. It must not look like glass: no shadow, backdrop blur, glow, or translucent panel. The fade ignores pointer events; only the buttons receive interaction.

The welcome step shows only the forward control. The final ready step keeps the back control but has no forward control.

## Final ready step

The final step ends with two full-width body actions, in this order:

1. `Today at a Glance`
2. `Connect an Agent`

These buttons belong to the normal body flow rather than a footer or floating action region. Remove `Next`, `Continue`, `Review setup`, and any duplicate completion action from this step.

## Workspace selection

Replace the visible checkbox-card treatment with a shared `WorkspaceSetupGrid`.

- The entire card is the accessible selection target.
- Preserve native checkbox semantics with a visually hidden input.
- Do not display a checkbox glyph.
- Use a compact two-column bento grid on mobile and a balanced four-card layout when space permits.
- Each workspace inherits its existing workspace identity color from the central workspace registry.
- Unselected cards use a soft workspace-tinted surface. Selected cards use a stronger tint, filled icon treatment, and clear selected state without adding layout-changing borders.
- Hover, focus, pressed, and selected states remain distinguishable in light and dark modes.
- Workspace title and concise purpose copy must fit without truncating essential meaning.

Selection continues to write through the current setup persistence model. This redesign does not change workspace identifiers or API payloads.

## Connected-account pattern

Create a shared provider-step composition using `ConnectionList`, `ConnectionItem`, and `AddConnection`.

### List

- Show a compact list of currently connected accounts or institutions.
- Lead each row with the official provider mark through `BrandMark`; use the approved neutral monogram fallback when distributable artwork is unavailable.
- Show the account identity as the primary line.
- Show enabled workspaces or capabilities as concise secondary information.
- Avoid a card nested inside another card.
- When empty, keep the state brief and visually quiet while retaining an obvious add action.
- Place a plus action after the list. Its accessible label must name the provider, such as `Add another Google account`.

### Responsive add flow

The plus action opens the shared `ResponsiveDialog`:

- Dialog on desktop;
- Drawer on mobile;
- standard trigger, header, title, description, body, footer, close, and action slots;
- forms and instructions reuse the existing integration logic rather than introducing parallel connection code.

Provider behavior:

- **Google:** show the existing OAuth explanation and service/workspace choices, then start the current Google connection flow.
- **Apple:** show the existing email and app-specific-password form with the relevant concise instructions and help link.
- **Financial institutions:** show the existing Plaid explanation and launch Plaid Link. Rows represent institutions/accounts rather than an email identity.

Keep loading and recoverable errors inside the responsive surface. On success, close the surface, refresh the connected list, and retain the current setup step.

Do not automatically open the add surface solely because the list is empty. The empty list and plus action should let the user understand the page before choosing to connect.

## Continuing without a connection

If the user activates the forward control on a provider step with no connected account, open a provider-specific confirmation using `ResponsiveDialog`.

Examples:

- `You haven’t added a Google account. Continue without one?`
- `You haven’t added an Apple account. Continue without one?`
- `You haven’t added a financial institution. Continue without one?`

The confirmation offers an explicit continue action and a cancel action. Confirming advances through the existing setup persistence path; canceling returns focus to the forward control. Do not use a browser-native confirm dialog.

If at least one relevant account is connected, the forward control advances immediately.

## Component boundaries

Implementation should introduce or refine these responsibilities:

- `SetupFrame`: header, progress, viewport/body geometry, and navigation slots.
- `SetupNavigation`: arrow controls, safe-area positioning, and bottom edge fade.
- `WorkspaceSetupGrid`: accessible whole-card multi-selection.
- `ProviderConnectionStep`: shared provider-page composition and skip-confirmation behavior.
- `ConnectionList`: list semantics and empty state.
- `ConnectionItem`: provider identity and connected capabilities.
- `AddConnection`: standard plus action and responsive surface trigger.
- `ResponsiveDialog`: the already established desktop Dialog/mobile Drawer primitive; do not create a setup-only modal abstraction.

Prefer colocating setup-specific compositions in the setup feature. Promote a component to the global component directory only when its contract is genuinely useful outside setup.

## Data and integration boundaries

This project is a presentation and interaction refactor. Preserve:

- the current setup step sequence and persisted completion state;
- existing setup API calls and payloads;
- current Google OAuth behavior;
- current Apple credential validation and connection behavior;
- current Plaid Link behavior;
- existing workspace identifiers and service mappings;
- refresh and error semantics unless a concrete defect is discovered during implementation.

No database migration or public API change is expected.

## Responsive behavior

- Treat 320 pixels as the minimum supported viewport width.
- Keep primary content within a roughly 32-rem reading measure; allow a modestly wider maximum for grids and lists.
- Use one-column account content and the compact two-column workspace grid on phones.
- Prevent floating navigation from obscuring the last field or action by reserving sufficient scroll padding.
- Respect dynamic viewport units, safe-area insets, browser chrome, software keyboards, and increased text size.
- On wider screens, preserve the focused composition rather than stretching controls across the viewport.

## Accessibility

- Maintain semantic headings and form labels.
- Use real inputs for workspace and service selection.
- Expose `aria-checked` or native checked state for selectable cards.
- Give icon-only controls accessible names and tooltips where helpful.
- Return focus to the correct trigger when a Dialog or Drawer closes.
- Announce validation, connection errors, and progress changes without relying on color.
- Meet contrast requirements for workspace tints in light and dark modes.
- Respect reduced-motion preferences; no transition is required for comprehension.

## Copy guidelines

- Write `nohmi`, never `Nomi`, `Nohmi`, or `Ilo`, in current product-facing copy.
- Use sentence case.
- Prefer short, human instructions over setup jargon.
- Name providers and consequences directly.
- Avoid redundant status text when the visual and adjacent copy already communicate the state.

## Verification and acceptance criteria

Focused component and setup-flow coverage should verify:

- all current public product copy uses lowercase `nohmi`;
- progress and `Exit Setup` share the compact header;
- ordinary steps render the correct arrow controls and accessible names;
- the ready step renders no forward arrow and contains exactly the two specified full-width actions;
- selecting any part of a workspace card toggles its native checkbox state without geometry shift;
- provider lists render correct identities, marks, and enabled workspaces/capabilities;
- plus actions open a Dialog at desktop width and Drawer at mobile width;
- advancing with no connected provider opens the appropriate confirmation;
- confirming a skip persists and advances, while canceling restores focus;
- successful provider connection closes the surface and refreshes the list;
- the existing setup step and workspace selections survive reloads;
- layouts remain usable at 320-pixel mobile width and a representative desktop width;
- keyboard navigation, focus order, labels, and reduced motion remain correct.

Run focused tests and type/lint checks for changed files during iteration. Perform one complete setup-path browser review at the end rather than repeatedly running the full repository verification suite after every visual refinement.

## Implementation sequence

1. Correct the shared public brand constant, product mark naming, user-visible copy, and relevant design documentation to lowercase `nohmi` while preserving compatibility identifiers.
2. Introduce `SetupFrame` and `SetupNavigation`, then migrate existing steps without changing their data behavior.
3. Replace workspace selection with `WorkspaceSetupGrid`.
4. Introduce the shared connected-account pattern and move Google, Apple, and Plaid add flows into `ResponsiveDialog`.
5. Add provider-specific skip confirmations.
6. Refine the ready step and remove obsolete setup footer actions.
7. Add focused automated coverage and perform final mobile/desktop setup QA.

## Non-goals

- changing the setup step order;
- redesigning provider authorization protocols;
- changing persistence or database schemas;
- renaming compatibility protocols, migrations, or internal repository identifiers;
- creating a new modal system;
- adding decorative animation, glass, shadows, or ornamental gradients.

## Resolved decisions

- The product name is always lowercase `nohmi`.
- The setup header contains progress and `Exit Setup`, with no brand wordmark.
- Navigation uses floating arrow-only controls except on the final step.
- The final step uses two full-width body actions.
- Workspace cards are the selection controls and hide their checkbox visuals.
- Provider connections use a compact list plus a ResponsiveDialog/Drawer add flow.
- Continuing without a connection requires explicit provider-specific confirmation.
- The bottom canvas fade is allowed only as a functional setup navigation treatment.
