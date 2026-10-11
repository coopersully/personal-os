# Workspace agent verification

This records branch-local evidence, not production deployment or universal variant coverage.

## Reproduce

```bash
CI=1 pnpm exec vitest run integration/workspace-agent
pnpm exec tsx scripts/workspace-agent-dictionary.ts
CI=1 pnpm verify
```

Join actual passing test results to MCP calls using a fresh trace path:

```bash
WORKSPACE_MCP_TRACE=/tmp/workspace-mcp-trace.jsonl CI=1 pnpm exec vitest run integration/workspace-agent --reporter=default --reporter=json --outputFile.json=/tmp/workspace-mcp-results.json
pnpm exec tsx scripts/workspace-agent-evidence.ts /tmp/workspace-mcp-results.json /tmp/workspace-mcp-trace.jsonl docs/engineering/workspace-agent-execution.md
```

The fixture authenticates real personal tokens and OAuth grants, calls the actual API and executes
migrations and queries in isolated PostgreSQL containers. It cleans up clients, pools and containers.
Traces contain tool/test names, never credentials or input data. Calls in failing tests do not count
as passing evidence. Neither registration nor static declarations count as execution. The report command exits unsuccessfully
if tests fail, tests are skipped, or any audited tool lacks a successful call.

## HTTP transport

Start the worktree with pnpm env:start and load pnpm fixtures:load. Then run:

```bash
QA_MCP_URL=http://127.0.0.1:PORT/mcp QA_MCP_FIXTURE=qa+loaded@nohmi.test pnpm exec tsx scripts/qa-mcp-workspaces.ts
```

The runner refuses non-loopback runtimes and arbitrary mutation owners. With QA_MCP_TOKEN alone,
it reads only. Fixture mode creates and revokes a temporary agent token, changes and restores each
workspace's search preference, restores bypass, and checks read-only and revoked-token denial.
Calls have bounded timeouts. Reload fixtures if interruption prevents cleanup.

October 11 local run: **27 checks passed**, including normal/read-only discovery, reads in all four
workspaces, persisted preference changes/readback/restoration, read-only mutation denial, and
revoked-token denial and agent-attributed audit events in every workspace. Its selected credential discovered 199 tools, not the complete catalog.

## Defects caught by execution

- Calendar silently dropped event links, reminders and availability; the adapter now uses full
  domain schemas. Persisted event readback crosses a daylight-saving boundary.
- Mail attachment IDs were constrained to UUIDs; opaque provider IDs now work.
- Contextual Finance question creation rejected fully authorized agents inside the service;
  creation and answers now preserve agent provenance.
- Account deletion waiting on a topology lock proceeded after token revocation; authorization is
  now checked after contention locks inside the mutation transaction.
- Interrupted bank completion committed accounts before its terminal receipt; those writes now
  commit atomically. A forced terminal-write failure proves rollback, and retry does not exchange
  the single-use provider token again.

Independent implementation review examined the assembled branch. Its three substantive findings have reproducing
regressions and fixes. The contextual/provider/handoff focused run passed 73 tests; a separate
review-fix run passed seven real MCP workflow tests.

Shipping review reproduced and corrected three further defects: Mail consent checks now share the
transaction that durably claims the exact draft (after its contention lock); answer rebinding locks
the current continuation before validating connection ownership; Finance transaction review retains
server-proposal, confidence and ambiguous-transfer checks even with execution authority. The focused
regressions passed 12 tests, including token revocation and bypass withdrawal before Mail acceptance,
a concurrent owner rebind, rejection of invented confidence, and persisted-evidence categorization.
Further shipping regressions prove pending bank attempts are durable before provider calls, failed
starts remain inspectable on replay, source-sync admission revalidates consent with agent audit, and
queued bank completion cannot exchange provider consent after revocation.

Additional execution found a human-only guard behind canonical transaction edits, a goal schema that
advertised required fields as optional, and a transaction read that omitted the revision required by
splitting. The adapters and service now expose full domain inputs, explicit agent execution and a
consistent record/revision snapshot. Negative authority and provenance checks accompany these cases.

## Limits

Plaid Hosted Link, bank synchronization, Mail sending/moving and outbound SMS use controlled provider doubles. Real
provider login/MFA, sends, invitations and money movement were not performed. Production provider
provisioning and consent remain unverified. Existing domain/API suites cover further pagination,
provider, revision and lifecycle branches; they are not automatically MCP transport evidence.

The current shipping-review MCP suite passed **77 tests across 22 files**, with successful calls to **232/232**
normal-discovery tools in the audited domains. The [execution report](workspace-agent-execution.md)
joins protocol traces to passing assertions and includes per-workspace totals. Some successful
operations intentionally return needs_input or blocked; tests assert those dispositions and absence
of unsupported effects. Prepared challenge and archived-report fixtures verify those tools without
claiming the incomplete maintenance fixture reached settlement. This is tool-level execution, not
exhaustive coverage of every field combination or full provider workflows. The implementation plan
retains unchecked variant/provider acceptance gates rather than silently treating tool counts as
proof of them.

## Repository gates

- `CI=1 pnpm check:node`: passed type checking, **3,824 tests in 381 files**, coverage and production
  builds. Coverage: **97.12% statements/lines, 95.89% functions, 94.16% branches**; thresholds unchanged.
- Additional test-only challenge/report/recovery work passed the final 65-test MCP run and a fresh
  integration TypeScript check. Shipping-review changes have the focused execution and regression evidence above. A full `pnpm verify` invocation remains the required shipping gate.
- Repository/infrastructure checks passed in the preceding `pnpm verify` invocation. That command
  stopped at a test-fixture TypeScript error, subsequently fixed; it is not recorded as a passing
  monolithic invocation. The component gates were continued independently.
- `pnpm lint`: passed, including deployment/connector contracts (212 warnings and 14 informational
  diagnostics; no errors).
- `CI=1 pnpm test:e2e`: **80 passed, 2 intentional device-specific skips** (11.5 minutes)
  against the final product code. The skipped desktop-only geometry/review-control checks have
  desktop coverage; they are not skipped MCP cases.

## Design decisions retained during implementation

- Execute inline in the existing isolated worktree; independent implementation and shipping reviews.
  Cost if wrong: integration defects; reproduced failures and fresh review passes supplement the
  full repository and protocol checks.
- Prove the Calendar vertical slice before completing the inventory. Cost if wrong: inventory
  omissions; the completed typed-API audit and 232-tool execution report now bound that risk.
- Add explicit root test dependencies for cross-package protocol fixtures. Cost if wrong: dependency
  duplication or drift; production package boundaries remain unchanged.
- Update original-connection host expectations to match approved authority while retaining owner,
  token and connection isolation. Cost if wrong: overly permissive fixture expectations; negative
  cross-connection calls and existing host service suites remain active.
- Use a shared execution-authority helper for registered operations while retaining the existing
  reversible-action evaluator. Cost if wrong: future registration/policy drift; schema, scope and
  real authorization suites cover the present catalog.
- Use hosted Plaid consent and durable encrypted receipt/exchange state. Cost if wrong: provider
  provisioning incompatibility; actual Hosted Link provisioning/consent remains unverified.
- Leave request expiry on the API's injected authentication clock and pass the service clock to
  transaction admission, holding token/policy locks through commit. Cost if wrong: inconsistent
  expiry decisions; deterministic OAuth expiry/refresh and contention tests cover both layers.
- Commit the hosted pending attempt and idempotency receipt before the provider request, then
  persist its URL or redacted failure. Commit account attachment/terminal completion together after provider fetch. Cost if wrong: orphaned or repeated effects; forced database failure
  proves rollback and replay safety. An interrupted start remains inspectable and replay never creates another provider session.
- Keep legacy prepared-action guards and admit canonical transaction edits through an internal
  reviewed-execution capability. Cost if wrong: divergent authority between paths; both retain
  separate regression tests and canonical writes preserve agent attribution.
- Count needs_input/blocked only as verified domain outcomes, never applied effects. Cost if wrong:
  overstated parity; the report explicitly limits its claim to tool-level execution.

Independent implementation and shipping findings were reproduced and fixed. These results establish
local verification, not production deployment.

Hosted-link failure/replay checks also force a PostgreSQL write failure after provider success.
Failed attempts report `outcome: failed`, distinguish provider rejection from uncertain persistence,
and emit allowlisted operational metadata without provider artifacts or credentials. Replays never
create another session. OAuth and personal-token consent describe source and destination disconnection.

Further review reproduced bank-sync consent revocation while its item claim waits, missing hosted
institution names, and stale split versions after ledger edits. Sync now admits execution only after
its contested locks, hosted exchange state preserves provider institution metadata, and split versions
use the existing database-owned material-change generation, read under a transaction row lock.
Provider metadata follows the [Plaid Link result contract](https://plaid.com/docs/api/link/).

Shipping audit regressions also verify terminal review decisions, host schedule changes and answer
bindings retain the initiating credential in transactional audit records. Pure budget-policy previews
work with read-only access and bypass disabled. Hosted-bank start replays suppress expired or already
claimed authorization links and report recovery work instead of presenting unusable consent.
