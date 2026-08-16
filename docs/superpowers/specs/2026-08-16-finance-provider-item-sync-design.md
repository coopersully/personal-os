# Finance Provider Item synchronization design

**Date:** 2026-08-16
**Status:** Approved in conversation
**Parent design:** `2026-08-15-workspace-maintenance-finance-design.md`

## Goal

Make the Plaid boundary safe enough to support Ilo's always-available Finance status and
maintenance tools. One Plaid Item must have one authoritative credential, cursor, synchronization
lease, retry state, and freshness record. Account projections must not independently infer the
ordering of opaque Plaid cursors.

This design corrects the synchronization foundation of the existing Finance maintenance plan. It
does not move orchestration into MCP, add client-specific automation, or expand Finance's authority
to move money, trade, approve budgets, answer human questions, or create unapproved permanent
rules.

## Problem

The current Finance model persists Plaid Item state on every projected Finance account. Sibling
accounts can therefore hold divergent non-null cursors, independently encrypted copies of the same
credential, and account-scoped claim and health state. The current recovery path attempts to choose
one divergent cursor using account `lastSyncedAt`. Plaid cursors are opaque, and that timestamp is
not transactionally coupled to cursor chronology. A crash can make a newer cursor appear older;
choosing it can permanently skip changes that remain visible only from another sibling's earlier
cursor.

Two public-contract problems accompany that storage defect:

- a maintenance run blocked before its health step may report health as applied even though the
  step never ran; and
- Plaid account initialization audits currently use the local Finance account UUID as the
  provider `remoteId`, which cannot identify the authoritative Plaid account revision.

These defects block relying on `get_finance_status` and `maintain_finances` as the simple,
repeatable MCP intent surface.

## Chosen approach

Introduce a Provider Item aggregate and make it the sole synchronization authority for Plaid. A
focused API service synchronizes an Item, projects its accounts and transactions idempotently, and
advances the one Item cursor only inside a fenced projection transaction. Roll it out with
expand–migrate–contract so current production rows and rolling application versions remain safe.

### Rejected alternatives

- **Order divergent cursors using timestamps or cursor values:** cursors are opaque, and account
  health timestamps do not prove cursor ancestry.
- **Keep account-owned state and reset to a null cursor whenever divergence appears:** this is a
  safe immediate fallback but leaves duplicated credentials, claims, retries, and freshness as a
  continuing source of drift.
- **Persist every raw Plaid page or introduce full event sourcing:** durable page claims can improve
  forensic detail, but idempotent projections, a single committed cursor, maintenance steps, and
  attributed audits already provide the required recovery. Raw provider-payload retention adds
  privacy, encryption, deletion, and storage obligations without a current product need.

## Boundaries and ownership

- `packages/domain` owns Provider Item synchronization, health, maintenance-result, and source
  reference contracts.
- `packages/database` owns the Provider Item table, account relationship, indexes, and migrations.
- `packages/connectors` remains the Plaid transport boundary and returns bounded, normalized
  provider evidence. It does not decide maintained state.
- `apps/api` owns connection persistence, item synchronization, claims, projection, retry,
  recovery, audit, maintenance coordination, and public status.
- `packages/api-client` exposes the API contracts used by web and MCP.
- `apps/mcp` remains a stateless authenticated adapter. It does not call Plaid or PostgreSQL and
  contains no cursor, sequencing, rubric, or financial-rule logic.
- `apps/web` presents item/account source health, questions, approvals, and maintenance results.

## Data model

Add `finance_provider_items` with these invariants:

- internal UUID primary key and owning `user_id`;
- provider discriminator, initially `plaid`;
- nullable authoritative provider Item identity with a unique partial
  `(user_id, provider, provider_item_id)` key;
- nullable `legacy_grouping_key` used only to group pre-migration sibling accounts until the first
  safe provider read resolves Plaid's real Item identity, with a unique partial
  `(user_id, provider, legacy_grouping_key)` key;
- encrypted Item credential and encryption metadata using the existing credential boundary;
- one nullable opaque sync cursor;
- connection and synchronization state;
- safe failure code/category, recovery owner, failure count, last attempt, last success, and next
  due time;
- claim ID, claim owner, claim generation, claim start, and lease expiry for fencing;
- created and updated timestamps; and
- indexes for due selection, stale-claim recovery, and owned Item lookup.

At least one of `provider_item_id` and `legacy_grouping_key` must be present during migration. New
connections always store Plaid's real `item_id` and do not need a legacy key. The existing
account-level `providerItemId` value is a hash of the access token, not Plaid Item provenance; it
may seed `legacy_grouping_key` but must never be exposed or promoted as the remote Item identity.

Add a nullable `provider_item_record_id` foreign key to `finance_accounts`. During the rollout,
legacy account-level Provider Item identity, encrypted credentials, cursor, claim, retry, and
freshness fields remain available for compatibility. Local, CSV, and other non-Plaid accounts do
not require a Provider Item row.

The new table stores no transaction history, raw Plaid page, merchant data, account balance, or
other provider payload. Existing normalized Finance tables remain the ledger projections.

## Expand–migrate–contract rollout

### Expand

Migration `0058_finance_provider_items` adds the empty Provider Item table, its constraints and
indexes, and the nullable Finance-account foreign key. It performs no production-data scan or
backfill. The planned budget proposal migration moves from `0058` to `0059`; later unpublished
Finance migrations shift accordingly. Published migrations `0000` through `0057` remain immutable.

The Plaid connector returns both `accessToken` and Plaid's real `itemId` from public-token exchange,
as Plaid's API specifies. Connection code writes one Item and its selected accounts atomically.
Compatible reads accept the new Item authority when present and retain the legacy account path
until backfill convergence.

### Migrate

A bounded, durable maintenance operation groups owned Plaid accounts by provider Item identity and
processes at most 100 Item groups serially per slice. It records progress, counts, safe failures,
and attributed audit evidence and can resume after process loss. The backfill itself makes no
provider request; a group requiring replay becomes immediately due for the normal sync scheduler.

For each group:

1. validate that ownership, provider identity, and credential material agree;
2. create or claim an Item row keyed by the legacy grouping value, leaving `provider_item_id` null;
3. link every sibling account in stable ID order;
4. if every non-null legacy cursor is identical, preserve that cursor;
5. if cursors are missing or divergent, store a null Item cursor and make the Item immediately due
   for a controlled full replay; and
6. leave conflicts blocked with a safe operator-owned reason rather than selecting evidence by
   timestamp.

Credential ciphertext is not compared for equality because independent encryption IVs make equal
plaintext differ. Migration validates credentials by their owned source and normal decryption
boundary without printing, logging, or auditing secret material.

Before synchronizing a legacy Item whose real provider identity is still null, the connector calls
Plaid `/item/get` using the owned access token. A short fenced transaction records the returned
`item_id` before transaction pagination begins. A uniqueness conflict or mismatch with an existing
owned Item is blocked for operator review; the service does not merge connection aggregates based
only on credential or account overlap.

### Cutover

After backfill and replay evidence converge, due selection, claims, provider fetches, cursor
advancement, retry, reconnect, and freshness read only from the Provider Item. Account status is a
projection of the Item's source health plus account-specific ledger evidence. Compatibility writes
may continue for one release only when required for safe rolling deployment; the Item remains the
authority.

### Contract

A later independently reviewed migration removes obsolete account-level credentials, cursors,
claims, retries, and source freshness only after production evidence shows no legacy callers or
unlinked Plaid accounts. This design does not combine that destructive cleanup with the expand or
backfill release.

## Synchronization flow

1. The Finance maintenance run establishes scope and evidence cutoff and claims the Provider Item.
2. The service loads and locks the Item, then its linked accounts in ascending stable ID order.
3. It snapshots the credential and starting cursor, commits the short claim transaction, resolves
   a missing legacy remote Item identity with Plaid `/item/get`, and calls Plaid outside a database
   transaction with the repository's bounded provider timeout.
4. For every bounded provider page, a short database transaction locks the maintenance run when
   present, the Item, and affected accounts in canonical order; validates claim ID, owner,
   generation, and lease; projects account and transaction evidence idempotently; writes redacted
   attributed audits; and advances the Item cursor atomically with those changes.
5. The service renews the claim around every provider wait and local step. Claim loss prevents
   account, merchant, category, transaction, cursor, health, and audit writes.
6. Completion records Item freshness and schedules the next due synchronization. Process loss
   resumes from the last cursor committed with a complete page.

A null cursor performs a controlled full Item replay. Existing stable provider identities and
idempotency constraints prevent duplicate accounts, transactions, questions, or audit effects.
Invalid-cursor provider responses also clear the Item cursor and enter this bounded replay path.

## Scope behavior

Plaid cursor correctness is Item-wide. A maintenance target naming one account therefore
synchronizes the complete shared Item projection and advances the single Item cursor. Downstream
reconciliation, categorization, questions, cash-flow analysis, budget work, health calculation,
and review remain limited to the requested account, exact entity, or time window.

Two runtime instances cannot synchronize sibling accounts from the same Item concurrently. Due
selection processes at most 25 Items with three workers per scheduler pass, matching the existing
Finance synchronization capacity bound. The Item claim fences every page and final settlement.

## Failure and recovery

- Invalid Plaid authority or Item login state becomes `blocked` with reconnect ownership and no
  automatic due time.
- Transport, timeout, rate-limit, and safe provider failures become durable retrying state using
  the repository backoff contract.
- Configuration or encryption failures expose safe Ilo-authored codes and recovery ownership;
  provider bodies, tokens, and ciphertext never enter public results, audits, or logs.
- A stale Item claim is recoverable after its lease. The next worker resumes from the last committed
  Item cursor.
- Divergent legacy cursors never produce an inferred cursor. They force null-cursor replay.
- A partial external response that did not commit its projection can be requested again; local
  projection and audit effects are idempotent.
- Status distinguishes unavailable, reconnect, stale, retrying, current, and migration-blocked
  sources. Missing or stale evidence never becomes an authoritative zero.

Provider calls cannot be atomically committed with PostgreSQL. The durable boundary is the last
fenced page projection and cursor transaction, not successful receipt of a provider response.

## Public status and maintenance result

Finance maintenance steps expose applicability explicitly:

```ts
type FinanceStepApplicability = "not_run" | "applied" | "skipped_scoped";
```

A missing step record is `not_run`; run scope cannot imply execution. A completed scoped run may
record `skipped_scoped` for intentionally global work. Only a successfully committed step can
report `applied`.

`get_finance_status` reports Provider Item readiness and freshness separately from account coverage
and ledger health. `maintain_finances` returns the durable run and the same truthful step states.
Overall run states remain queued, active, maintained, maintained-with-questions, awaiting approval,
blocked, recoverable failure, or terminal failure according to the existing Finance maintenance
contract.

## Source attribution

For a Plaid-backed Finance account, a `finance_account` material source uses:

- `provider: "plaid"`;
- local Finance account UUID in `accountId`;
- Plaid `providerAccountId` in `remoteId`, nullable only when authoritative provider identity is
  genuinely unavailable; and
- the provider revision when available, otherwise the local evidence revision disclosed as such.

Manual/local accounts use the local account UUID as both the local identity and `remoteId`.
Relinking or reprojection cannot silently make a different Plaid account appear to be the same
provider source.

## MCP contract

The preferred Finance MCP surface remains:

- `get_finance_status`, requiring `finances:read`; and
- `maintain_finances`, requiring `finances:write`, with an optional `all_outstanding`, bounded
  window, or exact target scope and no client-owned sequencing options.

MCP forwards the scoped agent token through the typed API client and returns API-owned status,
freshness, backlog, questions, budget, health, run, and recovery links. It does not expose provider
credentials or accept tokens as tool arguments. A read-only server does not advertise
`maintain_finances`. Tool descriptions contain intent and authority boundaries, not the Finance
playbook or recovery algorithm.

## External-boundary record

| Concern | Provider Item answer |
| --- | --- |
| Capability and owner | `apps/api` reads Plaid account and transaction evidence through `packages/connectors`; the Finance service owns durable projection, health, and recovery. |
| Configuration and authority | The API requires the existing Plaid production environment, client identity, secret, encrypted Item access token, `finances:write` maintenance authority, and owned user/Item/account relationships. MCP receives none of these provider credentials. |
| Transport | The deployed API calls Plaid over HTTPS/TCP 443 through the existing production egress contract. Web and MCP call only the public Ilo API. |
| Time and capacity | Each Plaid request uses the repository 15-second provider timeout beneath the 60-second public edge timeout. Scheduler passes select at most 25 Items with three workers. Pagination continues only through durable background work; interactive maintenance returns after its durable run handoff. |
| Commit point | Maintenance is accepted when its run commits. Provider progress is accepted only when a fenced page projection, redacted audits, and the new Item cursor commit together. |
| Delivery semantics | Item identity and provider pages may be requested again after timeout or process loss. Stable provider identities, idempotent projection constraints, run-attributed effects, and the single Item cursor make replay safe. Cursor divergence forces full replay rather than inference. |
| Degraded behavior | Status exposes stale, retrying, reconnect, unavailable, or migration-blocked Item health, safe failure codes, recovery ownership, and pending work. It never reports missing evidence as zero activity. |
| Recovery and observation | The durable scheduler retries transient failures, reconnect waits for human authority repair, stale claims can be recovered, and maintenance/status surfaces expose run IDs, freshness, safe failures, and first-party recovery links. Logs use allowlisted aggregate fields without credentials or provider payloads. |
| Evidence | Static schema/config contracts, migrated PostgreSQL lifecycle tests, claim/replay/concurrency tests, full repository verification, production runtime-policy validation, a least-privileged provider-read smoke from the deployed API, and post-deploy Item freshness evidence. |

## Verification

Required behavior and PostgreSQL integration tests cover:

- one Item for multiple Plaid accounts and one credential/cursor authority;
- public-token exchange preserving Plaid's real `item_id`, plus `/item/get` resolution for legacy
  Items without treating the old token hash as provider provenance;
- matching, missing, and divergent legacy cursor backfill;
- null-cursor full replay without duplicate projections or audits;
- page commit followed by process loss and exact cursor resume;
- invalid cursor reset and bounded replay;
- two runtimes competing for sibling accounts;
- claim loss before page and final settlement with zero fenced writes;
- connection, retry, reconnect, stale-claim, and safe configuration failures;
- complete-Item synchronization with account/window/target-scoped downstream work;
- truthful `not_run`, `applied`, and `skipped_scoped` results;
- Plaid `providerAccountId` source attribution and manual-account fallback;
- migration against a fresh database and preservation of existing Finance rows;
- resumable, bounded backfill and observable convergence;
- typed API and MCP discovery, least-privilege visibility, annotations, structured results, and
  recovery links; and
- production runtime configuration plus a least-privileged, non-destructive post-deploy status
  and synchronization-freshness smoke.

The final branch must pass focused package tests and `pnpm verify`. A green mock is not production
evidence. The delivery report must distinguish code behavior, migration/backfill readiness,
deployed runtime policy, real Plaid reachability, and post-deploy freshness.

## Completion criteria

This correction is complete when:

1. every connected Plaid account is linked to exactly one owned authoritative Provider Item;
2. no runtime path orders or selects divergent opaque cursors;
3. all Plaid claims, page projections, cursor commits, retries, and freshness are Item-owned and
   fenced;
4. legacy divergence converges through safe replay without duplicate ledger effects;
5. maintenance results never claim an unexecuted health step was applied;
6. Plaid account audits use provider account identity;
7. `get_finance_status` and `maintain_finances` expose the resulting source state through the public
   API and stateless MCP adapters; and
8. production-backed evidence shows the connected account reaches current freshness or exposes a
   truthful, actionable blocked/retrying state.
