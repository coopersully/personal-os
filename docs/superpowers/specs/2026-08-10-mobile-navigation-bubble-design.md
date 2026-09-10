# Mobile navigation bubble design

> **Status: Superseded.** The approved implementation is the labelled
> workspace dock and separate Actions bubble in
> [`2026-08-10-mobile-workspace-dock-design.md`](2026-08-10-mobile-workspace-dock-design.md).

## Context

At widths of 900 px and below, ilo currently exposes three navigation
mechanisms: a top-left hamburger button, a five-item bottom navigation bar, and
the sidebar drawer reached from the hamburger. This repeats destinations and
leaves less room for the page body.

## User outcome

On a narrow screen, a person needs one predictable way to reach every
destination without giving up the current page's controls.

## Decision

- **Maturity:** trial
- **Owner:** app shell (`apps/web/src/app.tsx` and `apps/web/src/styles.css`)
- **Affected surfaces:** every authenticated web route at `max-width: 900px`
- **Invariant:** Narrow layouts expose one navigation entry point: a labelled,
  fixed bottom-right button bearing the existing favicon. It opens the existing
  sidebar drawer; no hamburger control or destination bottom bar remains.

The existing top navigation stays in the document so its page-specific actions
remain at the top right. On narrow screens it loses its visible app-bar surface,
leading navigation control, and contextual material. The page body and calendar
height no longer reserve space for the removed bottom navigation.

## Interaction and accessibility

The bubble is a semantic button with `aria-controls="app-sidebar"`, an
`aria-expanded` value that follows the drawer state, and the accessible name
“Open Navigation”. The favicon is decorative inside that named control. Existing
overlay click, Escape, close-button, focus, and body-scroll behavior remain
unchanged. Safe-area insets keep the bubble reachable above mobile system UI.

## Verification

Testing Library verifies the sole labelled trigger and drawer open/close flows.
Live QA at a 390 × 844 viewport verifies that the app bar has no visual surface,
the floating favicon button remains visible and reachable, and content has no
bottom-navigation reservation or horizontal overflow.
