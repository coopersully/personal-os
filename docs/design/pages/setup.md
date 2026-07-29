# Setup — guided workspace specification

## User job

**Make ilo useful by connecting the sources I choose, without trapping me in
setup or asking me to understand the whole product first.**

Setup is a short guided path, not a product tour. It asks one consequential
question at a time, performs real connection work in place, and always preserves
an immediate route into Today.

## Entry, exit, and persistence

- A newly registered account enters `/setup` immediately.
- The first saved action changes setup from `not_started` to `in_progress`.
- Every completed step and workspace selection is saved to the user account.
  Refreshing, signing in elsewhere, or returning from a provider resumes the
  saved step.
- **Exit setup** is visible on every step. It persists `dismissed` before
  opening Today, so the person is never bounced back into the flow.
- Finishing persists `complete` before opening Today.
- Existing accounts migrate as `dismissed`; setup never interrupts a person who
  already uses ilo.
- Setup remains available from the account menu after dismissal or completion.

## Information hierarchy

```text
Orientation
├── ilo identity
├── current step and total progress
└── persistent Exit setup action

Current decision
├── one short heading
├── one consequence-oriented explanation
└── one bounded choice or connection action

Existing material
└── already-connected account rows, when present

Movement
├── Back
└── Continue, Skip, or Open Today
```

## Sequence

1. **Welcome** introduces ilo, user control, and the single setup promise.
2. **Workspaces** asks which areas are useful now. This shapes the remaining
   path; it does not disable product areas.
3. **Verify email** appears before provider setup when Calendar or Mail was
   selected and the ilo address is not yet verified. Google and Apple content
   must not render until verification succeeds.
4. **Google** appears when Calendar or Mail was selected. The person selects
   Calendar, Mail, or both before OAuth, and ilo requests only those scopes.
5. **Apple** appears for the same workspace conditions and accepts a real
   app-specific password connection.
6. **Finances** appears when Finances was selected and launches the existing
   Plaid connection flow. Multiple institutions can be added in sequence.
7. **Ready** summarizes selected workspaces and connected sources, then offers
   either Today or the agent-access handoff. Both actions persist setup as
   complete before navigating.

Tasks require no external connection and therefore add no setup step. A person
may skip every provider and still complete setup.

## Block contracts

| Block | Content and rules | Empty or unavailable state |
| --- | --- | --- |
| `orientation` | Compact wordmark, saved progress, and Exit setup. It remains stable across the sequence. | Progress still names the current step when conditional steps are omitted. |
| `choice` | Workspace and provider-service selections share one whole-card checkbox pattern with stable geometry. The full card toggles the control. | Continue is disabled only when no workspace is selected. |
| `connection` | One bounded card contains provider context, the real connection action, and no speculative account preview. | The forward action says “Skip …” when no account is connected. |
| `sequence` | Connected sources render as compact material rows above the add-another action. | Omit the list; never render placeholder accounts. |
| `attention` | Email verification is a dedicated prerequisite step, not an inline provider warning. Provider failures appear beside the connection they affect. | A working recovery action is shown when available. |
| `summary` | The ready step reports selected workspaces, source count, and agent-access posture, then offers Today and Connect an agent. | “None yet” is explicit and points to later setup. |

## Provider handoff contract

- OAuth state stores the requested services and a closed set of safe return
  paths. Provider callbacks never accept an arbitrary redirect.
- Returning from Google lands on `/setup`, where persisted progress and the
  refreshed connector query render the real connected account.
- Selecting only Mail does not bootstrap Calendar; selecting only Calendar does
  not request Gmail scopes or bootstrap Mail.
- Reconnecting an existing Google identity preserves previously enabled
  services while adding newly authorized ones.
- Connection failures do not erase setup progress or prevent Skip/Exit.

## Responsive and accessibility contract

- Desktop uses one centered reading column with a bounded choice grid. Narrow
  layouts collapse choices and footer actions into a single vertical sequence.
  Back and the forward action remain in a compact fixed action surface so a
  long provider form never hides the next decision.
- The primary action follows the content in DOM order. Back never becomes the
  visually dominant action.
- Step changes return the document to the top and move programmatic focus to
  the new heading. The heading is not added to the normal tab sequence.
- Progress exposes `role="progressbar"` and numeric values; its animation is
  supplemental.
- Every service and workspace choice has a persistent text label and keyboard
  target. Icons never carry the only meaning.
- Step movement uses opacity/transform only and is removed under
  `prefers-reduced-motion`.
- Pending mutations disable the affected movement so duplicate provider starts
  and conflicting progress writes cannot be submitted.
- Provider credential fields must not reuse or expose the ilo sign-in password.
  Apple setup suppresses current-password autofill and begins with blank fields.
- Third-party connection scripts load only after the corresponding provider is
  configured and the person reaches its actionable surface.

## Verification

1. Register a new account and confirm Setup renders before the app shell.
2. Exit from the first step and confirm Today opens and remains open after
   refresh.
3. Resume an `in_progress` account and confirm its saved step and selected
   workspaces render.
4. Select Tasks only and confirm the provider steps are omitted.
5. With an unverified account, select Calendar or Mail and confirm the
   verification step hard-blocks both provider screens. Verify the address and
   confirm the flow advances to Google.
6. Request Calendar-only and Mail-only Google authorization and inspect the
   resulting scopes.
7. Return from Google OAuth and confirm the setup route and real connected
   account are restored.
8. Complete without connections and with multiple connections.
9. Choose **Connect an agent** from Ready and confirm setup is completed before
   Settings opens the agent-access section.
10. Verify keyboard operation, heading focus and scroll reset, reduced motion,
   error recovery, blank provider credentials, 320 px layout, and normal
   desktop layout.
