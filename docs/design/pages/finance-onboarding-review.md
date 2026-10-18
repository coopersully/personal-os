# Finance onboarding review

## Current implementation

The setup page uses `financeOnboardingApiAdapter` by default and permits an explicit injected
adapter for composition and tests. The existing profile, accounts and budget editors retain their
canonical ownership. This implementation does not activate a global setup gate. Durable storage and
API integration require PostgreSQL and browser acceptance before release readiness is claimed.

The leaf review loads a revisioned server snapshot. People can review a saved answer, explicitly
choose unknown, or choose none where the question permits it. Display preferences require an
explicit review. Financial values are edited through the existing profile editor rather than
copied into a second profile. Saving sends review dispositions, the expected onboarding revision,
and a fresh idempotency key. Completion is a separate request against the saved revision.
Only a returned completion timestamp presents setup as complete. A failed write preserves the
visible draft and requires explicit reload before another write; background focus/reconnect does
not replace the draft. Reload deliberately replaces it with the current server snapshot and is also available after
editing canonical financial answers. Its pre-action copy explains that unsaved review choices are
replaced. Reload failure retains the draft and keeps writes locked.

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

## Durable API and storage

| Method | Endpoint | Scope |
| --- | --- | --- |
| GET | `/v1/finances/onboarding` | `finances:read` |
| POST | `/v1/finances/onboarding/answers` | `finances:write` |
| POST | `/v1/finances/onboarding/complete` | `finances:write` |

Each endpoint derives owner identity from authentication, prevents private caching, validates its
input and returns a validated snapshot. Mutation admission holds the owner deletion guard, rechecks
current agent execution authority, and locks the canonical profile and onboarding state. State CAS,
exact actor-bound idempotent response and audit commit in one transaction. Missing rows read as
revision zero without writes. Completion is immutable and revisions advance once per accepted change.

Migration `0116_finance_onboarding_receipts` stores review dispositions and operation receipts;
financial values retain their canonical writers. Profile revisions cannot erase durable explicit unknowns. Surviving legacy setup skip receipts
are projected by stable question identity, independent of their older profile-version marker; an
explicit canonical unknown with provenance is also retained. Missing historical receipts are not
reconstructed.
A saved answered disposition is revalidated against current canonical evidence before completion.
The essential registry covers location, household, income, reserves, debts, obligations and goals;
unknown remains acceptable and a budget is never a prerequisite.

Preferences use the existing revisioned Finance preference API, including manual Auto/Show/Hide.
Migration `0118_finance_preferences_legacy_access` records one-time legacy access only for owners
with Finance-specific records at migration time, including failed provider journeys. General account
setup and seeded categories grant nothing; later records do not auto-grant legacy access. The grant
preserves read/correction access, never completion or messaging authority, and cascades on owner deletion.

Chat readiness comes from the canonical persisted conversation service, including current original
connection and execution authority. Registration/cadence eligibility is checked independently so a
pending message challenge does not block automation-now completion. A failed optional Chat lookup
rolls back its savepoint and projects unavailable sending while manual-later setup can proceed;
a sanitized internal event records that failure. Essential storage failures do not manufacture state.

## Acceptance still required

The actual frozen baseline and Chat migrations precede setup storage, with preferences/legacy access
following it. Real PostgreSQL migration, owner isolation, revision races, rollback, privacy cascade
and authority revocation tests remain required. A global gate stays inactive until manual-later,
pending-verification, required-input, existing-user, resume and API/MCP compatibility paths pass
integrated verification. Agent protocol integration, the initial agent/manual choice and one-time setup prompt, broad manual
creation-control consumers, and live browser acceptance are separate evidence. This review does not
claim those wider journeys complete.

## Verification

Focused tests cover the pure readiness matrix, explicit unknown/manual-later save and completion,
revision handoff, conflict draft retention/reload, pending completion, Chat history with locked
sending, and completed setup during source failure. Existing setup-page tests cover the retained
canonical editors. Pure/service/HTTP/client checks do not prove PostgreSQL constraints, live provider
behavior or
integrated browser acceptance. Repository integration tests exercise the actual migrations when the
reserved database proof runs.
