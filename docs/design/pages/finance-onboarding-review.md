# Finance onboarding review

## Current implementation

The setup page accepts an optional `FinanceOnboardingAdapter` and renders the review only when
that durable server adapter is supplied. The current application composition does not supply it.
This slice therefore does not activate a setup gate or claim production onboarding persistence.
The existing profile, accounts and budget editors retain their canonical ownership.

The leaf review loads a revisioned server snapshot. People can review a saved answer, explicitly
choose unknown, or choose none where the question permits it. Display preferences require an
explicit review. Financial values are edited through the existing profile editor rather than
copied into a second profile. Saving sends review dispositions, the expected onboarding revision,
and a fresh idempotency key. Completion is a separate request against the saved revision.
Only a returned completion timestamp presents setup as complete. A failed write preserves the
visible draft and requires explicit reload before another write; background focus/reconnect does
not replace the draft. Reload deliberately replaces it with the current server snapshot.

## Readiness contract

`deriveFinanceOnboardingReadiness` is a pure presentation projection, not an authorization grant.
It has no storage or network effects.

- A usable or syncing source is sufficient. Existing users preserve workspace access.
- Explicit unknown answers are allowed. None is accepted only for questions that allow it.
- Budget creation and approval are separate and never block this setup projection.
- Automation later does not require a registration. Automation now requires an authorized
  registration with cadence; pending messaging verification does not block completion.
- Chat sending requires a registration, verified messaging and actual send capability.
  Existing history availability is projected separately.
- Recorded completion survives source, registration or messaging failure. Those failures never
  restart onboarding.
- Manual creation visibility follows explicit show/hide, or registration count in auto mode;
  connection health does not override an explicit preference.

## Integration still required

The adapter must persist onboarding review receipts independently of unrelated profile revisions,
validate canonical question identities and dispositions, and enforce ownership, revision conflicts
and idempotency on the server. It must project the canonical Chat readiness contract rather than
infer verification from registration existence. No local-storage substitute is provided.

Durable API/storage integration follows the actual frozen Finance baseline and Chat migration
chain. Navigation, workspace settings, a global setup gate, and live browser acceptance are outside
this leaf slice. The gate must stay inactive until manual-later, pending-verification, required-input
and existing-user compatibility paths pass integrated verification.

## Verification

Focused tests cover the pure readiness matrix, explicit unknown/manual-later save and completion,
revision handoff, conflict draft retention/reload, pending completion, Chat history with locked
sending, and completed setup during source failure. Existing setup-page tests cover the retained
canonical editors. These checks do not prove a durable adapter, live provider behavior or integrated
browser acceptance.
