# Flat surface language design

## Status

Established design-system rule. Today is the initial reference surface.

## Problem

Decorative dividers, elevation, and gradients compete with the commitments a
person is trying to scan. In particular, the app-bar bottom border and Today
queue rail duplicate separation that the surrounding surfaces already provide.

## Outcome

The interface reads as a calm, flat instrument. Related material may flow
together; distinct regions are primarily separated by semantic background tone
and spacing. A line is present only when it communicates containment, a row
boundary, an input/control boundary, or a meaningful state boundary.

## Invariant

- Do not use box shadows or gradients as ordinary surface or interaction
  decoration.
- Prefer the semantic material ladder and spacing to separate shell chrome,
  page regions, and related material.
- Do not add a structural divider merely because two regions meet. Keep a
  border when removing it would make an interactive control, an ordered row, a
  modal/sheet edge, or a semantic status boundary unclear.
- A distinct panel earns a contrasting background only when it represents a
  bounded action, state, or independently scanned region. Connected material
  remains open on its parent surface.
- Keyboard focus, hover, selection, and error states remain perceivable with
  semantic background, foreground, and border changes; they never need a
  shadow, gradient, ring, or outline.

## Reference application

The shared `WorkspaceAppBar` loses its quiet bottom divider. Today’s desktop
queue loses its left divider and remains a secondary rail through its existing
spacing and parent layout. These changes apply in light, dark, desktop, and
narrow layouts without changing geometry or interaction behavior.

## Verification

Inspect Today at desktop and narrow widths in both themes. Confirm that the
app bar remains understandable without a bottom line, the queue remains
secondary without a left line, and controls/states retain visible boundaries.
