# Setup and account-state runbook

## Fixtures

| Persona | Purpose |
| --- | --- |
| `qa+onboarding-new@ilo.test` | New, unverified, `not_started` setup |
| `qa+onboarding-google@ilo.test` | Verified, `in_progress`, Google step |
| `qa+onboarding-apple@ilo.test` | Verified, `in_progress`, Apple step |
| `qa+onboarding-finances@ilo.test` | Verified, `in_progress`, Finance step |
| `qa+onboarding-ready@ilo.test` | Verified, `in_progress`, Tasks-only ready step |
| `qa+empty@ilo.test` | Completed setup with an empty workspace |
| `qa+recovery@ilo.test` | Populated connector and finance recovery states |

All use `Testing12345!`. Reload fixtures after changing setup progress.

## Account-access pass

1. On sign-in, confirm the email placeholder uses `sam@example.com` and
   **Forgot your password?** sits beside the Password label.
2. Confirm **I have an invite code** opens registration.
3. Confirm the invitation input is two groups of four OTP slots and supports
   typing or pasting all eight alphanumeric characters.
4. Confirm Create account remains disabled until name, invite, valid email,
   strong password, and matching confirmation are complete.
5. Confirm the password checklist updates for length, mixed case, number, and
   symbol. Either eye button must show or hide both password fields.
6. Confirm recovery email validation and reset-password confirmation follow the
   same shared field contracts.

## New-account pass

1. Sign in as `qa+onboarding-new@ilo.test`.
2. Confirm the app opens `/setup`, not the app shell.
3. Confirm Step 1 introduces Personal OS, exposes a progress bar, and keeps
   **Exit setup** visible.
4. Continue to workspace selection. Confirm Calendar, Tasks, Mail, and Finances
   are whole-card checkbox targets; clicking either the copy or whitespace
   toggles the same control.
5. Select Tasks only and continue. Provider steps must be omitted and the flow
   must become a three-step path ending at **Your workspace is ready.**
6. Return to workspace selection, select Calendar or Mail, and continue.
   Confirm **Verify your email** appears before Google or Apple. Provider
   headings, forms, and service choices must not exist in the page.
7. Use **I’ve verified** before verification and confirm the gate remains in
   place. Confirm **Send another email** is available.
8. Confirm the summary says Tasks, no connected sources, and agent access off.
9. Exit setup, reload, and confirm the account remains on Today rather than
   entering a redirect loop.

## Resume pass

1. Sign in as `qa+onboarding-google@ilo.test`.
2. Confirm `/setup` resumes on Google, currently Step 3 of 5.
3. Confirm Calendar and Mail remain checked.
4. Confirm **Connect Google**, **Back**, **Skip Google**, and **Exit setup** are
   reachable and correctly named.
5. Do not launch provider OAuth during routine local QA.

## Conditional-step passes

- `qa+onboarding-apple` resumes at Apple with Calendar and Mail selected.
- `qa+onboarding-finances` resumes at Finances with Tasks and Finances selected.
- `qa+onboarding-ready` shows the Tasks-only summary and no connected sources.
- Each fixture must report the correct current/total step count for its selected
  path, keep Back and Exit reachable, and preserve the state after refresh.

## Existing and recovery passes

- `qa+empty` must enter Today directly and may reopen setup from the account
  menu without being forced into it.
- `qa+recovery` must expose provider failure or reauthentication next to affected
  Calendar, Mail, or Finance material, with an actionable recovery route.
- Failure state must not erase already-synced projections or setup progress.

## Responsive and accessibility

- At 390 × 844, keep one vertical sequence and visible exit.
- On every long provider step, Back and the forward/skip action remain visible.
- Progress uses `role="progressbar"` with current/max values.
- Each step starts at document top with programmatic focus on its heading.
- Every choice has a persistent label and keyboard target.
- Back never becomes more visually prominent than the forward action.
- Pending connection or progress writes prevent duplicate submission.
- Apple Account fields start blank after signing in and never inherit the Personal OS
  login email or password.

## Regression sentinels

- Setup state survives refresh and sign-in because it is server-owned.
- Existing accounts never enter new-account setup automatically.
- Tasks-only setup never asks about Google, Apple, or Plaid.
- Connected-account rows contain real data; never show speculative accounts or
  preview-only skeletons.
