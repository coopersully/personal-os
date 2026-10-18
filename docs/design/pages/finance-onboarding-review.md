# Finance onboarding review

## Current implementation

The setup page uses `financeOnboardingApiAdapter` by default and permits an explicit injected
adapter for composition and tests. The existing profile, accounts and budget editors retain their
canonical ownership. The follow-on candidate composes a server-readiness route gate, the initial
manual/agent choice and manual-tool visibility. These candidate changes require independent review,
complete verification and browser acceptance before release readiness is claimed.

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

## Workspace access and manual controls

One shared server-snapshot query projects access and manual creation visibility. It is bound to the
current account session; an older owner's in-flight response cannot become a new owner's readiness.
Only an actual completion timestamp or the persisted migration-time existing-access grant permits
ordinary workspace entry. Neither loading nor read failure implies an incomplete or completed setup.
Previously recorded access is not revoked by later source, registration or Chat failure.

New owners entering ordinary Finance destinations return to setup with a bounded local Finance
return path. Setup, accounts/linking, Chat, Automations and question/review evidence stay reachable.
Correction, import and budget-approval tasks have explicit route context and a visible return to setup;
they expose their task material rather than an unrestricted ordinary workspace. A task marker is
navigation context only: canonical record access, mutation policy and exact human approval remain
server-enforced. Initial mode choice is saved through the existing review receipt; it does not
create a second preference store. Manual later can finish without a host. Automation now uses real
registration/cadence eligibility, while sending stays locked until actual current Chat proof.

Initial copyable agent guidance starts with `get_finance_playbook` and `setup_finances`. After an
actual registration, the Automations surface supplies the immutable server-issued instructions for
that host. Initial guidance never fabricates a schedule identifier, verified connection or successful
external job.

The settings editor saves only `financeManualVisibility` through the existing owner-session,
revision-CAS and queued workspace-preference hooks. Auto shows manual creation/import until a
registration exists; stale host health does not re-enable them. Show/Hide are explicit overrides.
Unknown or failed readiness reads do not expose new capture. The shared plus, manual account entry,
transaction creation and import menus/query/hash entries consume this projection. Account linking,
record corrections, categorization, questions, approval and export are retained. Confirmed host or
preference changes refresh the server snapshot rather than deriving counts from local mutation results.

## Acceptance still required

The durable setup candidate passed seven real-migration repository/composed HTTP tests at its frozen
head, covering owner isolation, revision races, rollback, completion/cascade, authority revocation,
receipt decoding and persisted legacy readback. That evidence does not establish the later integrated
UI candidate. Initial mode, safe routing, scoped tasks and manual visibility have focused source tests;
actual desktop/mobile journeys, full verification, API/MCP compatibility and current independent
review remain release gates.

Browser preparation uses disposable owners and real HTTP writers. Catalog data loaded after the
legacy migration is not a legacy grant: demo/loaded fixtures complete through actual setup API
receipts. Actual legacy eligibility requires records before the real migration. Pending/verified Chat
requires a valid original connection, owner policy, cadence and actual MCP fetch/nonce acknowledgment/
response; no direct verification flag or fixture grant substitutes for it. Authored browser scenarios
are not passing browser evidence until executed under the reserved runtime.

## Verification

Focused checks cover pure readiness, durable review, default-adapter feedback, session changes,
loading/error routing, local return-path validation, task scoping, exact budget approval, manual
visibility and actual-query refresh after confirmed host actions. Canonical financial editors retain
their separate checks. Complete CI, coverage/builds and live acceptance remain required. External
host scheduling and public MCP transport require their own evidence; a controlled local fixture and
client checks do not establish production scheduling or provider reachability.
