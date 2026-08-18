# Task 5 report — typed reimbursement question resolution

## DONE

- Maintenance reimbursement questions now accept one bounded typed `answer` object and retain candidate IDs, revisions, and source references only in the private payload.
- The Finance action service revalidates owned transactions, accounts, allocations, categories, reimbursement cases, credit capacity, and revisions under locks before preparation and commit.
- Expense answers support durable entirely-personal classification and exact personal/reimbursable splits with a reimbursement case; credit answers support explicit non-reimbursement evidence and partial multi-case matching.
- Question terminalization, review disposition, semantic write, and audit remain in the same Finance action transaction. Maintenance questions can be answered by a same-user `finances:write` agent only through their explicit stored authority.
- Public Finance question listing is available to scoped callers, status includes pending action questions, and typed API-client/MCP question answers serialize reimbursement input through the generic answer protocol.
- Focused Finance action, status, route, and MCP tests plus workspace type checking and Biome passed.

## CONCERNS

- `packages/api-client/src/client.test.ts` currently fails before exercising this change because its `financeStatus` fixture omits already-required reimbursement summary fields. That fixture is outside this task's owned changes and was left untouched.
- Expense conversion intentionally returns `needs_input` for a multi-allocation expense, rather than collapsing distinct categories or allocation order into an unsafe reimbursement split.

## BLOCKED

- None.
