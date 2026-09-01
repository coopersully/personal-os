# Finance budget buckets implementation plan

Before changing the Finance API, typed client, agent-action path, or MCP tools, read
`docs/engineering/external-boundary-reliability.md` and record any boundary evidence gaps.

1. Add canonical bucket/taxonomy contracts and mutation validation in
   `packages/domain/src/finance/buckets.ts`, export them from Finance, and
   extend the category-budget input with optional `bucketId`.
2. Add the three bucket tables and nullable budget snapshot foreign key in
   `packages/database/src/schema.ts`; create migration `0074` and journal entry.
3. Add `apps/api/src/finance/budget-bucket-service.ts` with ownership checks,
   exclusive membership replacement, version locks, historical rollups, and
   redacted audit events. Wire it into `finance-service.ts` and routes.
4. Extend the typed Finance client and the existing `budget_plan` agent action
   preparation/application path so agents receive the same policy and conflict
   semantics as users. Add MCP list/create/update/membership tools.
5. Add an accessible bucket-management block to the existing Finance Budgets
   page using shared primitives, with loading/error/empty states and cache
   invalidation.
6. Add domain, database/API, client/MCP, and Testing Library coverage. Complete the external-boundary
   reliability checks, then run focused tests, `pnpm verify`, and `git diff --check` before committing,
   pushing, and opening
   a draft dependent PR with base `cooper/finance-account-semantics`; do not
   merge.
