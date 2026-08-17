# Task 3 Finance action disposition report

Status: DONE

## Authoritative commit chain

1. `4f22087 fix(finances): serialize review targets`
2. `76a6b59 test(finances): cover review target serialization`
3. `42a3deb test(finances): cover review queue concurrency`
4. `e7baa15 test(finances): cover categorization queue overlap`
5. `5c6f1ad test(finances): cover budget queue overlap`
6. `536591b feat(finances): add action review client methods`
7. `0768c82 test(finances): cover action review client transport`
8. `350b7e5 fix(finances): preserve client action outcomes`
9. `d1eb227 test(finances): preserve client dispositions`
10. `b47c915 fix(finances): describe question answers`
11. `db0cfad test(finances): cover action dispositions`
12. `011aca0 docs(finances): document action disposition`
13. `0e6e60e fix(finances): separate evidence authority`
14. `6316f30 fix(finances): queue reviews transactionally`
15. `39c7cbe fix(finances): preserve refresh disposition`
16. `fix(finances): lock finance action targets` (this target-locking commit)

## Delivered behavior

- Every supported Finance mutation returns `applied`, `pending_review`, or `needs_input`.
- A persisted app-only setting controls the durable review bypass; agents cannot toggle it.
- Only signed-in human review routes approve or dismiss queued action reviews.
- `answer_finance_question` can supply bounded evidence without approval authority. The deprecated `resolve_finance_review` alias only translates legacy categorization answers.
- Public questions and reviews expose bounded descriptors, safe changes, and source references without private payloads.
- No Finance route or MCP tool executes external financial activity.

## Verification

- `pnpm exec vitest run packages/domain/src/domain.test.ts apps/api/src/finance-action-service.integration.test.ts apps/mcp/src/server.test.ts` — 59 tests passed.
- `pnpm --filter @personal-os/domain typecheck` — passed.
- `pnpm --filter @personal-os/api typecheck` — passed.
- `pnpm --filter @personal-os/mcp typecheck` — passed.
- `pnpm lint` — passed (four existing non-blocking integration-test warnings; no errors).
- `git diff --check` — passed.

## Evidence-authority follow-up

Status: DONE

- Review bypass now controls disposition only. Prepared categorization revalidates confidence, evidence basis, and ambiguous-transfer protections before any apply.
- An internal action-service-only capability permits an explicitly prepared permanent merchant rule; it is absent from tokens and MCP inputs.
- Focused Finance action and service integration suites passed (54 tests), together with API type checking and scoped Biome (four existing warnings, no errors).

## Transactional queue and bounded revisions follow-up

Status: DONE

- Bypass-off disposition now revalidates and queues only inside the locked database transaction.
- Multi-item budget, categorization, and merchant revisions use bounded SHA-256 snapshot digests.

## Refresh disposition follow-up

Status: DONE

- Finance insight refresh now carries mutation context and records a redacted, action-attributed audit in its transaction.
- Refresh preparation snapshots alert evidence with a bounded revision digest, and the API client preserves action outcomes while retaining the human legacy result.

## Target locking and budget revalidation follow-up

Status: DONE

- Approval and bypass-on commits take sorted semantic advisory locks, then `FOR UPDATE` locks for every prepared owned target before comparing the revision; locks remain held through writer, audit, and review terminalization.
- Complete budget plans now snapshot and lock the current month projection, durable plan parent, effective profile/pay account, active recurring obligations, referenced categories, and referenced goals. The bounded revision digest includes all of those capacity and replacement inputs.
- Single-category budgets and complete plans share `budget-month:<month>` review targets and the Finance writer's monthly advisory lock, so cross-variant proposals supersede safely.
- The integration coverage includes a barrier-based human-edit-versus-approval regression, a stale capacity-input plan regression, and cross-variant monthly review supersession.

## Target locking verification

- `pnpm vitest run apps/api/src/finance-action-service.integration.test.ts apps/api/src/finance-service.integration.test.ts` — 57 tests passed.
- `pnpm --filter @personal-os/api typecheck` — passed.
- `pnpm --filter @personal-os/database typecheck` — passed.
- `pnpm biome check apps/api/src/finance-action-service.ts apps/api/src/finance-service.ts apps/api/src/finance-action-service.integration.test.ts` — passed with four pre-existing `noNonNullAssertion` warnings in the action integration test; no errors.
- `git diff --check` — passed.
