# Finance budget buckets implementation plan

1. Add canonical bucket/taxonomy contracts and mutation validation in
   `packages/domain/src/finance/buckets.ts`, export them from Finance, and
   extend the category-budget input with optional `bucketId`.
2. Add the three bucket tables and nullable budget snapshot foreign key in
   `packages/database/src/schema.ts`; create migration `0073` and journal entry.
3. Add `apps/api/src/finance/budget-bucket-service.ts` with ownership checks,
   exclusive membership replacement, version locks, historical rollups, and
   redacted audit events. Wire it into `finance-service.ts` and routes.
4. Extend the typed Finance client and the existing `budget_plan` agent action
   preparation/application path so agents receive the same policy and conflict
   semantics as users. Add MCP list/create/update/membership tools.
5. Add an accessible bucket-management block to the existing Finance Budgets
   page using shared primitives, with loading/error/empty states and cache
   invalidation.
6. Add domain, database/API, client/MCP, and Testing Library coverage. Run
   focused tests, `pnpm verify`, `git diff --check`, then commit, push, and open
   a draft dependent PR with base `cooper/finance-account-semantics`; do not
   merge.
