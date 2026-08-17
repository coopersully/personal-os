# Task 3 Finance action disposition report

Status: DONE

## Authoritative implementation commit chain

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
16. `009f63f fix(finances): lock finance action targets`
17. `8d15bb2 fix(finances): recover action questions`
18. `6669233 test(finances): preserve refresh dispositions`
19. `fd6d084 test(finances): bound budget plan reviews`
20. `d0203bd test(finances): cover aggregate action reviews`
21. `094acd4 test(finances): cover refresh action boundaries`
22. `4cce8f8 fix(finances): recover action questions precisely`

## Completed behavior

- Every supported semantic Finance mutation, including insight refresh, returns exactly one of `applied`, `pending_review`, or `needs_input`.
- Bypass is a persisted, signed-in-app-only queue-versus-apply setting. It never waives ownership, revision, evidence, confidence, or ambiguous-transfer checks.
- Agents may apply an explicitly prepared permanent merchant-learning ledger rule through categorization; it receives the same checks and disposition as every other action.
- The signed-in app alone lists and approves or dismisses action reviews. Its question list exposes only bounded public descriptors.
- A question answer is a bounded JSON object with only requested fields. It is scoped to the originating agent when answered by an agent, merges into the stored action, and is prepared again. It cannot approve a review or change bypass; exact terminal replay is idempotent.
- Public review/question output remains bounded and redacted. No Finance API or MCP tool performs external financial execution.

## Boundary evidence

- Real PostgreSQL coverage proves two-item categorization queueing, bounded public projections, approval-time revalidation, and atomic application.
- Merchant merge coverage proves the source/target public labels remain correct even when the database returns target before source.
- Maximum-size categorization and budget-plan queue contracts retain bounded public revisions, changes, and source references.
- Refresh reviews retain the action-attributed redacted audit and roll back both audit and terminalization if review terminalization fails. API client and MCP coverage preserve all three refresh dispositions.
- Table-driven recovery coverage proves each of the eight action families exposes failure-specific, answerable descriptors and advances after a valid correction.

## Verification

- `pnpm vitest run apps/api/src/finance-action-service.integration.test.ts packages/domain/src/domain.test.ts` — 60 tests passed.
- `pnpm vitest run apps/api/src/finance-action-service.integration.test.ts apps/mcp/src/server.test.ts` — 41 tests passed.
- `pnpm --filter @personal-os/api typecheck`, `pnpm --filter @personal-os/domain typecheck`, `pnpm --filter @personal-os/database typecheck`, and `pnpm --filter @personal-os/mcp typecheck` — passed in their corresponding focused rounds.
- Scoped Biome checks and `git diff --check` passed in every implementation round; Biome reported only four pre-existing `noNonNullAssertion` warnings in the Finance action integration test.
- Final documentation verification: `pnpm lint` passed with the same four pre-existing action-integration warnings; `git diff --check` passed.

## Fix round 3 — authority semantics and client outcomes

Status: DONE

- Agent transaction category changes now carry categorization confidence, evidence revision, and rationale through preparation. Low-confidence, stale, candidate-transfer, and ambiguous-transfer proposals return `needs_input` before bypass can apply them.
- A prepared agent category change uses the categorization writer, so transaction provenance and classification evidence remain `agent`; a permanent merchant rule is available only through that prepared, evidence-backed path.
- A human answer supplies evidence only. Resumption uses the stored requesting agent identity and current durable bypass, yielding a review when bypass is off or an agent-attributed apply when it is on. The human responder is recorded separately as `finance.question_answered` audit history.
- Every agent-capable semantic Finance API-client mutation now returns `FinanceActionOutcome<T> | T` rather than claiming the human-only result type; MCP forwards that honest union unchanged.

### Verification

- `pnpm vitest run apps/api/src/finance-action-service.integration.test.ts packages/domain/src/domain.test.ts packages/api-client/src/client.test.ts apps/mcp/src/server.test.ts` — 89 tests passed.
- API, Domain, API-client, MCP, and Web type checks passed.
- Scoped Biome and `git diff --check` passed with the four existing `noNonNullAssertion` warnings in the Finance action integration test.

## Fix round 3B — actionable reviews and deterministic account locks

Status: DONE

- Revalidation discovers referenced accounts without locking, then locks owned accounts in sorted ID order before locking sorted transactions and categories. Transaction updates use the same account-before-transaction order, matching account deletion and eliminating the crossed lock cycle.
- A real PostgreSQL barrier regression holds account deletion after its account lock, starts pending transaction approval, and verifies both operations finish without a deadlock; the deleted account and transaction are absent afterward.
- Profile reviews describe material non-sensitive fields, redact employer and role values, and use a specific recoverable descriptor for invalid gross income. Budget allocations include category labels, amounts, and counts; merchant renames include both names.
- Pending Finance questions reuse the same ID only for the same requesting agent; an identical request from another agent receives an independent question.

## Fix round 4A — approval provenance and merchant-rule basis

Status: DONE

- Human approval records one redacted `finance.action_review_approved` audit row in the terminal approval transaction, retaining human approver/request attribution while the underlying mutation keeps requesting-agent attribution.
- Terminal replay returns the saved outcome without another approval audit. A failed terminal update rolls its approval audit back, and bypass application creates no human-approval audit.
- Transaction actions derive the current server-validated categorization basis. Valid merchant-rule proposals preserve rule provenance through bypass or human approval; stale, absent, or invalid evidence returns `needs_input`.

## Fix round 4B — complete projections and profile recovery

Status: DONE

- Nullable Finance profile fields and money clears are rendered as explicit `before → unset` changes; no clear is represented as `$0.00`.
- Budget-plan review rows disclose replacement mode plus a bounded, labeled account of existing allocations that are replaced, removed, or retained, alongside every incoming allocation.
- Profile validation derives its recoverable answer descriptor from the failing Zod path, including date, enums, numeric ranges, account fields, risk fields, and nullable-field recovery.

### Verification

- `pnpm exec vitest run apps/api/src/finance-action-service.integration.test.ts packages/domain/src/domain.test.ts` — 72 tests passed.
- `pnpm --filter @personal-os/api typecheck`, `pnpm --filter @personal-os/domain typecheck`, and `pnpm --filter @personal-os/database typecheck` — passed.
- Scoped Biome, formatter, and `git diff --check` — passed.
