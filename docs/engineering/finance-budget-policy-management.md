# Finance budget policy management storage

This is the bounded source contract for migration `0087`. HTTP/client registration and full
verification remain Integration work. It creates no automatic budget authority. Human-only
management retains `executionAvailable:false`, and position and usage remain unavailable.

## Immutable history and exact lineage

Policy versions, saved previews, and period baselines reject every UPDATE. Policy roots may
change only state, lifecycle revision, updated time, and disable attribution. Proposal roots may
change only state, lifecycle revision, updated time, and withdrawal attribution. Null-safe row
comparisons protect every other column, including future columns. Terminal disabled/withdrawn
states cannot revert; lifecycle revisions cannot decrease. DELETE is not intercepted, so owner
privacy cascades still remove the entire history.

Composite foreign keys bind budget versions to their plan and owner, policy versions to their
policy/plan/owner, and every proposal budget reference to the same plan. A saved preview's
proposal and policy version must occur together on one owned proposal. UUID identities and
finite timestamps must remain representable by the public schemas. Integer increments return
an explicit conflict at `2147483647`; they never rely on a PostgreSQL overflow error.

## Stored JSON contract

The immutable PostgreSQL validators inspect only supplied values. They validate strict keys,
required/null fields, canonical trimmed strings, JavaScript UTF-16 length bounds, UUIDs, complete
months, cents, unique resource/allocation/direction/protection/delta identities, bounded totals,
and delta arithmetic. Preview input/result identities, observed revisions, evaluation time, and
explicit expiry agree. Drizzle JSON columns use the domain snapshot and terms types.

Stored position and usage accept only the unavailable variants this management slice produces.
Consequently, stored results must be denied and execution unavailable. Adding an available
producer requires a separately reviewed storage transition; plausible provider JSON cannot
bypass this boundary. Validators enforce the public packet schema, not a second policy evaluator.

Named timezone validation uses an embedded, frozen set accepted by the public Intl parser at
migration authoring, including canonical names and available aliases. It performs no mutable
catalog query. Calendar and timestamp parsing use explicit ISO fields and offsets. Published
validator definitions and migration history must not be edited in place; any extension requires
a new migration and database/public-parser admission regressions.

## Transaction and deletion order

Management writes acquire owner `FOR KEY SHARE` admission, the `finance-profile:<user>` advisory
lock, the receipt advisory lock, the policy root, the proposal root where relevant, then candidate
dependencies. Baseline designation locks its plan and requires active status before consuming the
owner/month slot. Policy/proposal mutations use the supplied transaction for their reads, history,
audit, and completed receipt. Failure rolls back those effects; the existing helper may retain an
explicit failed receipt.

Candidate dependencies form one deduplicated union across resources and allocations. UUID case
is normalized for lock identity. The order is `finance_accounts`, `finance_categories`,
`finance_goals`, `finance_income_streams`, then UUID within each table. Every dependency is checked
for ownership under `FOR KEY SHARE`, retained until proposal/save commit. No child-lock trigger
is installed. Pure preview and history reads use a repeatable-read snapshot without row locks.

The existing account-deletion path takes reimbursement/provider topology locks, an optional
provider parent, accounts ordered by UUID, and then account children. It never acquires the
profile advisory or policy/proposal roots. Its account-to-income foreign-key actions follow the
same account-before-income order. This service takes none of those topology/provider/transaction/
attention locks. Account deletion does acquire its audit foreign-key owner `KEY SHARE` after
account locks. A deterministic real-service regression queues owner DELETE behind P's owner
admission while P waits on the deleting account. PostgreSQL permits the compatible audit FK
`KEY SHARE` to complete: account deletion commits, owner deletion commits, and P rejects the
missing dependency without saving a preview. This measured schedule disproved the initially
suspected three-transaction deadlock; no shared deletion-path repair or child-lock trigger was
made. The regression remains part of this lock contract. Category, goal, and income
sources have no application hard-delete path; goal removal updates status. Future deletion
paths must review owner admission and retain this regression.

Real-PostgreSQL tests pause proposal/save transactions behind a row or audit-table lock, observe
the actual database wait, and prove competing deletion blocks through commit. Reversed candidate
order still locks the same sorted union; a deletion that wins causes a clean mutation rejection.

History reads return the original parsed packet unchanged. Current dependency existence,
revisions, expiry, and disabled/withdrawn state are assessed separately. Deleted category,
account, goal, or income-source references mark a saved preview stale. None of these checks
constitutes the future commit-time position fence or grants permission to execute a budget.
