# Finance Provider Item Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace account-owned Plaid synchronization with one authoritative Provider Item aggregate, expose truthful source health, and ship the preferred `get_finance_status` / `maintain_finances` MCP intent tools on that safe foundation.

**Architecture:** Plaid public-token exchange preserves Plaid's real Item identity. A new `finance_provider_items` table owns credentials, one cursor, claims, retry, reconnect, and freshness; Finance accounts reference it. A focused item service performs bounded legacy linking and a focused sync service owns fenced page projection. The existing Finance service retains its public methods as delegation seams so routes, maintenance, and callers migrate without a big-bang rewrite.

**Tech Stack:** TypeScript, Zod, Drizzle ORM, PostgreSQL 17, Vitest, Testcontainers, Hono, MCP SDK, Plaid HTTPS API.

## Global Constraints

- Plaid cursors are opaque. Never compare, sort, or select divergent cursors by value, account timestamp, or account health metadata.
- `finance_provider_items` is the sole authority for Plaid credentials, cursor, claim, retry, reconnect, and freshness after cutover.
- New connections persist Plaid's real `item_id`. The existing token hash is legacy grouping evidence only and is never provider provenance.
- Migration `0058_finance_provider_items` is additive and contains no production-data scan or `UPDATE`; budget proposals move to migration `0059`.
- Legacy linking processes at most 100 Item groups serially per slice. Scheduled sync processes at most 25 Items with three workers.
- Each provider request uses the existing 15-second timeout. Provider calls occur outside PostgreSQL transactions.
- Every page and final settlement revalidates the Item claim and, when present, the maintenance-run claim.
- MCP stays stateless and calls only the authenticated typed public API. It contains no Plaid, database, playbook, sequencing, or maintained-state logic.
- Credentials, token-derived legacy keys, provider bodies, and raw payloads never enter logs, audits, public contracts, or MCP results.
- Follow TDD for every behavior change. Run focused tests after each task and `pnpm verify` before handoff.

---

### Task 1: Preserve Plaid's authoritative Item identity

**Files:**
- Modify: `packages/connectors/src/plaid.ts`
- Modify: `packages/connectors/src/plaid.test.ts`

**Interfaces:**
- Produces: `PlaidItemToken = { accessToken: string; itemId: string }`
- Produces: `PlaidItemSnapshot = { itemId: string }`
- Changes: `PlaidConnector.exchangePublicToken(publicToken): Promise<PlaidItemToken>`
- Adds: `PlaidConnector.getItem(accessToken): Promise<PlaidItemSnapshot>`
- Consumed by: Tasks 3 and 4.

- [ ] **Step 1: Write failing connector tests for token exchange identity and legacy identity lookup**

Add exact assertions:

```ts
await expect(plaid.exchangePublicToken("public-token")).resolves.toEqual({
  accessToken: "access-token",
  itemId: "item-1",
});
await expect(plaid.getItem("access-token")).resolves.toEqual({ itemId: "item-1" });
```

The fake fetch must assert `/item/public_token/exchange` parses both `access_token` and `item_id`,
and `/item/get` sends only the provider credentials plus `access_token`. Add malformed/missing
`item_id` cases that expect the existing safe `plaid_invalid_response` classification.

- [ ] **Step 2: Run the connector test and observe RED**

Run:

```bash
pnpm exec vitest run packages/connectors/src/plaid.test.ts
```

Expected: FAIL because exchange returns a string and `getItem` does not exist.

- [ ] **Step 3: Implement the minimum typed connector change**

Use these public types:

```ts
export type PlaidItemToken = { accessToken: string; itemId: string };
export type PlaidItemSnapshot = { itemId: string };
```

Parse `item_id` with `z.string().min(1)` in both responses. Reuse `plaidRequest` so transport,
timeouts, body disposal, and safe errors remain unchanged. Do not return Plaid `request_id`, Item
status, or provider error payloads.

- [ ] **Step 4: Run focused connector verification**

Run:

```bash
pnpm exec vitest run packages/connectors/src/plaid.test.ts
pnpm --filter @personal-os/connectors typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/plaid.ts packages/connectors/src/plaid.test.ts
git commit -m "fix: preserve Plaid Item identity"
```

---

### Task 2: Add the Provider Item domain and additive storage boundary

**Files:**
- Modify: `packages/domain/src/finance.ts`
- Modify: `packages/domain/src/finance-maintenance.ts`
- Modify: `packages/domain/src/domain.test.ts`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/schema.test.ts`
- Create: `packages/database/migrations/0058_finance_provider_items.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Modify: `apps/api/src/finance-service.integration.test.ts`
- Modify: `apps/api/src/mail-service.integration.test.ts`
- Modify: `apps/api/src/icloud-uidvalidity-migration.integration.test.ts`

**Interfaces:**
- Produces: `financeProviderItems` Drizzle table and `financeAccounts.providerItemRecordId`.
- Produces: `FinanceProviderItemHealth` public status projection without credentials, remote Item ID, cursor, or legacy grouping key.
- Changes: Finance maintenance health applicability to `"not_run" | "applied" | "skipped_scoped"`.
- Consumed by: Tasks 3–6.

- [ ] **Step 1: Write RED domain tests**

Add parsing tests for:

```ts
financeProviderItemHealthSchema.parse({
  accountIds: [id],
  id,
  provider: "plaid",
  synchronization: {
    failureCode: null,
    failureCount: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    message: null,
    nextRetryAt: null,
    recovery: null,
    state: "stale",
  },
});

financeMaintenanceResultSchema.parse({
  applied: { categorizations: 0, transfers: 0 },
  asOf: start,
  health: { applicability: "not_run", confidence: "insufficient", refreshed: false },
  questions: { created: 0, total: 0 },
  verification: { duplicateActions: 0, freshness: "stale", state: "blocked" },
});
```

Extend `financeStatusDetailsSchema.accounts` with `providerItems:
z.array(financeProviderItemHealthSchema)`.

- [ ] **Step 2: Run domain RED**

```bash
pnpm exec vitest run packages/domain/src/domain.test.ts
```

Expected: FAIL on missing Provider Item schema and rejected `not_run`.

- [ ] **Step 3: Implement the public domain shapes**

The public Provider Item projection must contain only local Item ID, provider, owned local account
IDs, and `financeSynchronizationSchema`. It must not disclose Plaid Item ID, cursor, credential,
claim owner, or legacy grouping key.

- [ ] **Step 4: Write RED schema and migration tests**

Assert `finance_provider_items` contains:

```text
id, user_id, provider, provider_item_id, legacy_grouping_key,
encrypted_credentials, sync_cursor, sync_state,
sync_claim_id, sync_claim_owner, sync_claim_generation,
sync_claim_started_at, sync_claim_expires_at,
last_sync_attempt_at, next_sync_at, sync_error,
sync_error_code, sync_error_category, sync_recovery,
sync_failure_count, last_synced_at, created_at, updated_at
```

Assert these invariants:

- unique partial remote identity `(user_id, provider, provider_item_id)`;
- unique partial legacy identity `(user_id, provider, legacy_grouping_key)`;
- at least one identity is non-null;
- provider is `plaid`;
- claim fields are all null or all present, generation is nonnegative;
- current/stale states have no failure tuple; retrying/blocked states have the existing safe tuple;
- account foreign key is nullable and indexed;
- due and claim-recovery indexes target Item rows; and
- migration SQL contains no `UPDATE`, `DELETE`, URL, or credential value.

- [ ] **Step 5: Run schema RED**

```bash
pnpm exec vitest run packages/database/src/schema.test.ts
```

Expected: FAIL because the table, FK, and migration do not exist.

- [ ] **Step 6: Add schema and isolated migration `0058`**

Model the table in `schema.ts` using the existing `EncryptedCredentials`, connector failure, and
timestamp types. Add `providerItemRecordId` to `financeAccounts` with a nullable reference to the
Item table and an index.

Run the repository generator only to inspect the proposed delta:

```bash
pnpm --filter @personal-os/database db:generate --name finance_provider_items
```

Because repository snapshots intentionally stop at `0009`, do not retain a broad table replay or a
new broad snapshot. Follow the established `0050`–`0057` append-only convention: retain one
isolated `0058_finance_provider_items.sql` and append journal index `58` with monotonic
`when: 1786968000000`. Review the SQL for short metadata locks, FK order, partial indexes, and empty
table creation only.

- [ ] **Step 7: Keep historical migration fixtures isolated**

Append `0058_finance_provider_items` to the existing `migrationsWithout` arrays in the Finance,
Mail, and iCloud historical-migration tests. Do not alter the intended historical cutoff or their
assertions.

- [ ] **Step 8: Run focused domain/database verification**

```bash
pnpm exec vitest run packages/domain/src/domain.test.ts packages/database/src/schema.test.ts
pnpm exec vitest run apps/api/src/finance-service.integration.test.ts apps/api/src/mail-service.integration.test.ts apps/api/src/icloud-uidvalidity-migration.integration.test.ts
pnpm --filter @personal-os/domain typecheck
pnpm --filter @personal-os/database typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/domain/src/finance.ts packages/domain/src/finance-maintenance.ts packages/domain/src/domain.test.ts packages/database/src/schema.ts packages/database/src/schema.test.ts packages/database/migrations/0058_finance_provider_items.sql packages/database/migrations/meta/_journal.json apps/api/src/finance-service.integration.test.ts apps/api/src/mail-service.integration.test.ts apps/api/src/icloud-uidvalidity-migration.integration.test.ts
git commit -m "feat: add Finance Provider Items"
```

---

### Task 3: Persist new connections and migrate legacy Item groups safely

**Files:**
- Create: `apps/api/src/finance-provider-item-service.ts`
- Create: `apps/api/src/finance-provider-item-service.integration.test.ts`
- Modify: `apps/api/src/finance-service.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.integration.test.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/runtime-lifecycle.test.ts`

**Interfaces:**
- Produces: `createFinanceProviderItemService(options)`.
- Produces: `upsertConnection(input)` for one real Plaid `itemId`, encrypted credential, and selected accounts in one owned transaction.
- Produces: `backfillLegacyItems(limit = 100): Promise<{ blocked; complete; created; linked; replayDue }>`.
- Produces: `resolveItemForAccount(userId, accountId)` for Task 4.
- App handoff: `backfillFinanceProviderItems()` and startup/scheduled durable dispatch.

- [ ] **Step 1: Write RED PostgreSQL tests for new connection persistence**

Prove one exchange creates one Item row and links all returned accounts. The Item contains Plaid's
real `item-1`, one encrypted credential, null cursor, stale state, and immediate due time. Accounts
retain provider account IDs and currency. During the expand release they also receive legacy
credential/cursor/health shadow values for rolling-version compatibility, but no new code reads
those shadows as Item authority. Replaying the same owned Item updates the Item/account projection
without creating a second Item.

- [ ] **Step 2: Write RED backfill tests**

Use migrated PostgreSQL fixtures to prove:

- sibling legacy rows with the same grouping key become one unresolved Item;
- equal non-null cursors are preserved;
- missing or divergent cursors produce a null Item cursor and immediate replay due;
- independently encrypted equal credentials are accepted without ciphertext comparison;
- mismatched ownership/provider/undecryptable credentials create a safe blocked Item with no raw
  exception text;
- a locked group is skipped, the next group progresses, and a later pass converges;
- 101 groups require two calls, with at most 100 serial groups in the first call; and
- repeated completed calls report zero new links and no duplicate audit effects.

- [ ] **Step 3: Run service RED**

```bash
pnpm exec vitest run apps/api/src/finance-provider-item-service.integration.test.ts
```

Expected: FAIL because the service does not exist and connections still duplicate Item state on
accounts.

- [ ] **Step 4: Implement the focused Provider Item service**

Keep this module responsible only for Item connection persistence, legacy linking, owned lookup,
serialization, and safe backfill observation. It may depend on database, encryption helpers, clock,
and safe logging. It must not call Plaid, project transactions, calculate Finance health, or settle
maintenance runs.

Backfill uses `FOR UPDATE SKIP LOCKED`, stable group ordering, and the linked account FK as its
durable checkpoint. It seeds only `legacyGroupingKey`; it never promotes the old account hash to
`providerItemId`. Every blocked reason is an Ilo-authored safe code.

- [ ] **Step 5: Delegate Plaid exchange persistence from `finance-service.ts`**

Replace the access-token hash path with:

```ts
const { accessToken, itemId } = await plaid.exchangePublicToken(input.publicToken);
return providerItems.upsertConnection({
  accessToken,
  accounts: await plaid.getAccounts(accessToken),
  context,
  institution: input.institution ?? "Plaid",
  itemId,
});
```

Preserve existing authenticated route behavior and account audit policy. Use
`providerAccountId` as the Plaid account source `remoteId`.

- [ ] **Step 6: Wire bounded backfill lifecycle**

Add `app.backfillFinanceProviderItems()`. In `main.ts`, run one startup pass before startup Finance
sync and one scheduled pass before each scheduled Finance sync. A pass returning `complete: false`
is normal durable progress, not process failure. The lifecycle test must prove shutdown waits for
the owned pass and does not launch untracked work.

- [ ] **Step 7: Run focused service/app verification**

```bash
pnpm exec vitest run apps/api/src/finance-provider-item-service.integration.test.ts apps/api/src/app.integration.test.ts apps/api/src/runtime-lifecycle.test.ts
pnpm --filter @personal-os/api typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/finance-provider-item-service.ts apps/api/src/finance-provider-item-service.integration.test.ts apps/api/src/finance-service.ts apps/api/src/app.ts apps/api/src/app.integration.test.ts apps/api/src/main.ts apps/api/src/runtime-lifecycle.test.ts
git commit -m "feat: migrate Plaid connections to Provider Items"
```

---

### Task 4: Cut synchronization over to the Item-owned cursor and claim

**Files:**
- Create: `apps/api/src/finance-provider-item-sync-service.ts`
- Create: `apps/api/src/finance-provider-item-sync-service.integration.test.ts`
- Modify: `apps/api/src/finance-service.ts`
- Modify: `apps/api/src/finance-service.integration.test.ts`
- Modify: `apps/api/src/finance-maintenance-service.ts`
- Modify: `apps/api/src/finance-maintenance-service.integration.test.ts`

**Interfaces:**
- Produces: `syncAccount(accountId, context, onProgress?, scope?)` compatibility entrypoint.
- Produces: `syncDueItems()` and `syncDueItemsForUser(userId, scope, context, onProgress?)`.
- Preserves: existing `FinanceSyncBatchResult` and Finance-service public method names by delegation.
- Consumes: Provider Item owned lookup/backfill from Task 3 and Plaid identity APIs from Task 1.

- [ ] **Step 1: Write RED Item-cursor lifecycle tests**

Cover these exact persistence boundaries:

1. A legacy Item with null remote identity calls `getItem`, commits the real `itemId` under the
   active Item claim, then begins transaction sync.
2. Two linked accounts with divergent legacy cursors start from null; no code reads
   `lastSyncedAt` to choose a cursor.
3. A page projection and its `nextCursor` commit atomically on the Item.
4. Process loss after that commit resumes from exactly the committed Item cursor.
5. Invalid-cursor classification clears the Item cursor and schedules one controlled replay.
6. Two runtimes targeting sibling accounts produce one provider stream; the loser receives a
   conflict and writes nothing.
7. Claim loss before page commit and before final settlement produces zero account, merchant,
   category, transaction, cursor, health, and audit writes after loss.
8. Complete-Item raw projection runs for an account/window target, while reconciliation,
   categorization, questions, cash flow, health, and review remain scoped.
9. Retry, reconnect, recovery, and last-success state are stored only on the Item and reflected by
   all linked accounts.
10. Due selection returns at most 25 Items and uses at most three provider workers.

- [ ] **Step 2: Run sync-service RED**

```bash
pnpm exec vitest run apps/api/src/finance-provider-item-sync-service.integration.test.ts
```

Expected: FAIL because synchronization still claims an account and writes the cursor to siblings.

- [ ] **Step 3: Extract and implement the focused sync service**

Move only Plaid Item claim, provider pagination, raw account/transaction projection, Item
freshness, and safe failure settlement out of the 6,000-line Finance service. Inject narrow
callbacks for existing deterministic category/merchant projection and maintenance-claim
validation instead of duplicating those rules.

The canonical lock order is:

```text
maintenance run when present
→ Provider Item
→ linked Finance accounts sorted by UUID
→ category/merchant lookup rows
→ Finance transactions
→ audit rows
```

Provider requests occur between short transactions. Every transaction validates Item claim ID,
owner, generation, and database lease time. Item cursor advancement is in the same transaction as
the page projection and audit effects. The expand release may mirror that committed cursor and
health tuple to linked account shadow columns in the same transaction for old-version reads; it
must never select or claim from those shadows. Final health and failure settlement update the Item;
new account status serialization derives from it.

- [ ] **Step 4: Replace account-owned scheduler selection and delegation**

Keep `createFinanceService().syncPlaidAccount`, `.syncDuePlaidAccounts`, and
`.syncDueAccountsForUser` as small delegation methods during the rollout. Delete the
`lastSyncedAt` cursor ordering selector and every authoritative path that selects, claims, or
advances from sibling account cursors. A same-transaction legacy shadow write is allowed only for
rolling-version compatibility. Do not retain a hidden legacy read fallback once an account has
`providerItemRecordId`.

- [ ] **Step 5: Reconcile maintenance claim renewal and step recovery**

The maintenance coordinator continues renewing its run claim around the sync step. The Item sync
service validates that run claim in every local write when context contains one. A blocked Item
settles the sync step and the run honestly; it does not manufacture a health-step result.

- [ ] **Step 6: Run focused synchronization and maintenance verification**

```bash
pnpm exec vitest run apps/api/src/finance-provider-item-sync-service.integration.test.ts apps/api/src/finance-service.integration.test.ts apps/api/src/finance-maintenance-service.integration.test.ts
pnpm --filter @personal-os/api typecheck
```

Expected: PASS, with no PostgreSQL concurrent-client warning and no retained account-cursor
selection test.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/finance-provider-item-sync-service.ts apps/api/src/finance-provider-item-sync-service.integration.test.ts apps/api/src/finance-service.ts apps/api/src/finance-service.integration.test.ts apps/api/src/finance-maintenance-service.ts apps/api/src/finance-maintenance-service.integration.test.ts
git commit -m "fix: synchronize Plaid Provider Items atomically"
```

---

### Task 5: Make Finance status, results, and source attribution truthful

**Files:**
- Modify: `apps/api/src/finance-status-service.ts`
- Modify: `apps/api/src/finance-status-service.integration.test.ts`
- Modify: `apps/api/src/finance-maintenance-service.ts`
- Modify: `apps/api/src/finance-maintenance-service.integration.test.ts`
- Modify: `apps/api/src/finance-service.ts`
- Modify: `apps/api/src/finance-service.integration.test.ts`
- Modify: `packages/api-client/src/client.test.ts`
- Modify: `apps/api/src/app.integration.test.ts`

**Interfaces:**
- Finance status `details.accounts.providerItems` lists safe Item-level health.
- Linked Plaid accounts derive `synchronization` and `lastSyncedAt` from their Item.
- Maintenance health applicability is always explicit and missing step means `not_run`.
- Plaid `finance_account` sources use `providerAccountId` as `remoteId`.

- [ ] **Step 1: Write RED status tests for Item authority**

Create one Item with two accounts and assert:

- status has one Provider Item and two accounts;
- Item current/stale/retrying/blocked state controls freshness and blockers once, not twice;
- each account presents the same Item synchronization evidence while retaining its own balance,
  kind, currency, and account ID;
- an unlinked legacy Plaid account is migration-blocked rather than treated as current; and
- missing/stale Item evidence keeps spending, income, wealth, budget, and health confidence
  conservative.

- [ ] **Step 2: Write RED maintenance-result test**

Create an all-outstanding run that blocks during synchronization before a health step exists.
Assert persisted and public result:

```ts
health: {
  applicability: "not_run",
  confidence: "insufficient",
  refreshed: false,
}
```

Also retain cases proving a committed global health step is `applied` and a committed scoped skip is
`skipped_scoped`.

- [ ] **Step 3: Write RED source-attribution tests**

Assert Plaid connection/sync initialization audits use:

```ts
{
  accountId: localAccountId,
  provider: "plaid",
  remoteId: "plaid-account-id",
  sourceType: "finance_account",
}
```

Manual accounts continue to use the local account ID as `remoteId`. A Plaid row lacking remote
account identity uses null and never substitutes its local UUID.

- [ ] **Step 4: Implement serializers and result inference**

Read accounts and Provider Items in the same repeatable-read status transaction. Build one Item map
and derive linked account synchronization from it. Count source blockers by Item. In
`resultFor`, replace scope inference with:

```ts
applicability: health?.applicability ?? "not_run"
```

Update `financeAccountSourceValue` to use `providerAccountId` for non-manual accounts.

- [ ] **Step 5: Update typed fixtures and run focused verification**

```bash
pnpm exec vitest run apps/api/src/finance-status-service.integration.test.ts apps/api/src/finance-maintenance-service.integration.test.ts apps/api/src/finance-service.integration.test.ts apps/api/src/app.integration.test.ts packages/api-client/src/client.test.ts
pnpm --filter @personal-os/api typecheck
pnpm --filter @personal-os/api-client typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/finance-status-service.ts apps/api/src/finance-status-service.integration.test.ts apps/api/src/finance-maintenance-service.ts apps/api/src/finance-maintenance-service.integration.test.ts apps/api/src/finance-service.ts apps/api/src/finance-service.integration.test.ts packages/api-client/src/client.test.ts apps/api/src/app.integration.test.ts
git commit -m "fix: report authoritative Finance source health"
```

---

### Task 6: Ship the preferred typed API and MCP intent tools

**Files:**
- Modify: `packages/api-client/src/features/finances.ts`
- Modify: `packages/api-client/src/client.test.ts`
- Modify: `apps/mcp/src/tools/finances.ts`
- Modify: `apps/mcp/src/tool-catalog.ts`
- Modify: `apps/mcp/src/server.test.ts`
- Modify: `apps/mcp/src/tool-catalog.test.ts`
- Modify: `apps/mcp/src/prompts.ts`
- Modify: `docs/mcp.md`

**Interfaces:**
- Produces: `api.getFinanceStatus(scope?)`.
- Produces: `api.maintainFinances(scope?)`.
- Produces: `api.getFinanceMaintenanceRun(id)`.
- Produces MCP: `get_finance_status` and `maintain_finances`.

- [ ] **Step 1: Write RED API-client tests**

Assert exact requests:

```ts
await api.getFinanceStatus();
// GET /v1/finances/status

await api.maintainFinances({ type: "window", start: "2026-08-01", end: "2026-08-16" });
// POST /v1/finances/maintenance with { scope: ... }

await api.getFinanceMaintenanceRun(runId);
// GET /v1/finances/maintenance/:id
```

Responses must parse the domain schemas and preserve structured API errors and request IDs.

- [ ] **Step 2: Implement and verify the typed client**

```bash
pnpm exec vitest run packages/api-client/src/client.test.ts
pnpm --filter @personal-os/api-client typecheck
```

Expected: PASS.

- [ ] **Step 3: Write RED MCP discovery and invocation tests**

Assert:

- `get_finance_status` requires `finances:read`, is read-only, closed-world, idempotent, and uses
  workflow stage `inspect`;
- `maintain_finances` requires separately consented `finances:maintain`, is non-read-only, closed-world,
  non-idempotent as a host hint, uses policy `approved_rule`, and stage `commit`;
- a read-only or write-only server advertises status but never maintenance;
- a token without Finance scopes advertises neither;
- no-argument maintenance sends `{ scope: { type: "all_outstanding" } }` through the API client;
- window and exact-target inputs use the shared maintenance scope schema and expose no batch,
  retry, confidence, cursor, or provider argument; and
- text fallback, structured result, `_ilo` metadata, recovery links, and API errors use the shared
  result envelope.

- [ ] **Step 4: Register the thin MCP tools and catalog metadata**

Descriptions must say these are the preferred complete-workspace operations, no arguments means
all outstanding work, and questions/approvals remain pending rather than guessed. Handlers are only:

```ts
async (input) => apiResult(() => api.getFinanceStatus(input.scope));
async (input) => apiResult(() => api.maintainFinances(input.scope));
```

Do not add Plaid or Finance workflow prose beyond intent, scope, authority, and recovery semantics.

- [ ] **Step 5: Update the Finance prompt and MCP documentation**

Change `review_finances` to start with `get_finance_status` and, when caller intent plus write scope
permit, invoke `maintain_finances` once. Do not prescribe a schedule, pagination loop, or
client-specific automation. Update `docs/mcp.md` to list the tools as shipped and retain the API as
the durable lifecycle owner.

- [ ] **Step 6: Run focused MCP verification**

```bash
pnpm exec vitest run apps/mcp/src/server.test.ts apps/mcp/src/tool-catalog.test.ts packages/api-client/src/client.test.ts
pnpm --filter @personal-os/mcp typecheck
pnpm --filter @personal-os/mcp build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/api-client/src/features/finances.ts packages/api-client/src/client.test.ts apps/mcp/src/tools/finances.ts apps/mcp/src/tool-catalog.ts apps/mcp/src/server.test.ts apps/mcp/src/tool-catalog.test.ts apps/mcp/src/prompts.ts docs/mcp.md
git commit -m "feat: expose Finance maintenance intent through MCP"
```

---

### Task 7: Verify the correction and hand back to the Finance completion plan

**Files:**
- Modify: `docs/superpowers/plans/2026-08-15-workspace-maintenance-finance.md`
- Create: `.superpowers/sdd/2026-08-16-finance-provider-item-sync/report.md` (ignored evidence artifact)

**Interfaces:**
- Produces: reviewed, verified Provider Item correction and shipped high-level MCP tools.
- Handoff: parent plan resumes at budget proposal migration `0059`, then review artifact, UI, and production QA.

- [ ] **Step 1: Run focused boundary checks**

```bash
pnpm exec vitest run packages/connectors/src/plaid.test.ts packages/domain/src/domain.test.ts packages/database/src/schema.test.ts apps/api/src/finance-provider-item-service.integration.test.ts apps/api/src/finance-provider-item-sync-service.integration.test.ts apps/api/src/finance-service.integration.test.ts apps/api/src/finance-status-service.integration.test.ts apps/api/src/finance-maintenance-service.integration.test.ts packages/api-client/src/client.test.ts apps/mcp/src/server.test.ts apps/mcp/src/tool-catalog.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Run the complete deterministic repository gate**

```bash
pnpm verify
```

Expected: exit 0 with lint/contracts, all workspace typechecks, at least 95% statements/functions/
lines and 94% branches, production builds, and desktop/mobile Playwright acceptance.

- [ ] **Step 3: Perform a security and data-integrity self-review**

Search the diff and tests to prove:

```bash
rg -n "lastSyncedAt.*cursor|syncCursor.*lastSyncedAt|legacyGroupingKey|encryptedCredentials|accessToken|providerItemId" apps packages
git diff --check
git status --short
```

Confirm no runtime path orders opaque cursors; secrets/legacy keys stay out of public serializers,
logs, and audits; every provider write is fenced; the migration has no backfill; and the Item lock
order is consistent.

- [ ] **Step 4: Record evidence and remaining production risks**

The report must separate:

- code behavior proven locally;
- fresh and historical migration evidence;
- bounded backfill readiness;
- production configuration and egress evidence;
- real Plaid reachability, which is not proven by mocks; and
- post-deploy Item freshness/reconnect evidence still required.

- [ ] **Step 5: Reconcile the parent plan**

Mark the unsafe account-cursor correction and high-level typed API/MCP portions as delivered. Keep
budget proposals at `0059` and retain the remaining review artifact, web UI, production deployment,
and production-backed Finance health acceptance tasks. Do not claim the broader Finance workspace
is complete yet.

- [ ] **Step 6: Request independent code review and address findings**

Use `superpowers:requesting-code-review`. Critical or important correctness findings must be fixed
with new RED→GREEN tests and a fresh `pnpm verify` before completion.

- [ ] **Step 7: Commit final plan/report changes**

```bash
git add docs/superpowers/plans/2026-08-15-workspace-maintenance-finance.md
git commit -m "docs: record Finance Provider Item delivery"
```

After this task, continue the approved parent plan without reopening the Provider Item design:
budget proposal/approval (`0059`), durable Finance review artifact, Finance UI, then deployment and
production-backed QA.
