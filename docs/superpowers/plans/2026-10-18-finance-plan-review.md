# Finance plan review and decision ledger

October 18, 2026. Four independent read-only reviews covered the larger workstream slices.
No implementation or runtime tests were performed by these reviewers. Findings were checked against
source and incorporated as design §13, task refinements, and dependency corrections.

## Review coverage and disposition

| Review slice | Main findings | Disposition |
| --- | --- | --- |
| Spending, List, Trends, Rhythm | Period-sensitive recognition could double-count across bins; expected vs received reimbursements differ; partial account scope can mislead budget fills; date-only data cannot support intraday claims | Shared contribution snapshot, separate full-budget utilization, exact-month history, calendar-day comparison, negative-total disclosure added |
| Cash flow, recurring, payday, reimbursements, goals | No complete recurring occurrence ledger; balance inclusion basis missing; reimbursements allocation-owned; recurring currency/service identity incomplete; legacy goal zero not confirmed | Explicit occurrence/snapshot prerequisites, grouping existing reimbursement identities, guarded receipt correction, currency/service coverage and goal confirmation/horizon added |
| Automations, Chat, Reviews, Activity | Host registry narrower than copy-prompt flow; claimed work cannot silently move connections; capability self-report insufficient; concurrent replies and case state undefined | Three proposed external-host behaviors await confirmation; fixed run-owned message snapshot accepted; case/evidence and guarded recovery contracts drafted |
| Authority, setup, manual parity, integration | Legacy budget writes omitted from task ownership; old setup completion differs from onboarding; disconnected existing users could be stranded; whole-stream dependencies unnecessarily serial | Expanded mutation inventory, independent onboarding completion, existing-user access preserved, capability matrix and narrow release gates added |

## Accepted and no longer open

- Maximum parallel execution and earliest independent verified shipping; no aesthetic wave barriers.
- Missed-run grace and recurring-run candidate thresholds; session-only bubble placement.
- One maintenance-owned message batch per run; subsequent messages always follow up later.
- Contextual Reply in Chat with visible removable draft references; removal does not dismiss a case.
- Manual-later setup, visible locked Chat, all listed views, historical budget behavior, and visual
  financial intelligence doctrine remain as agreed in the consolidated design.

## Three review proposals — subsequently approved

1. **Other external agents:** proposed generic polling registration with expected schedule and copyable
   ID-bearing prompt. Bind its first authenticated check-in to the original authorized connection.
   This is not a direct scheduler integration or permission granted by possessing an ID.
2. **Chat verification:** proposed automatic harmless test-message retrieval, acknowledgment, and saved
   response, bound to protocol version. Show Verifying then Connected; do not unlock on self-report alone.
3. **Interrupted runs:** proposed checkpointed retry/resume without repeating committed effects. On
   revoked access, stop; expose reconnect or explicit replacement-agent recovery. Unclaimed work can
   reassign, but claimed financial work requires the guarded audited recovery path.

Cooper explicitly approved all three after discussion. No outstanding product confirmation remains
from this review. Implementation still requires the documented contracts, verification, and delivery
authorization. The schedule ID is always included in each recurring automation prompt; it is not an
authentication key. Engineering checks below remain required.

## Engineering verification, not user questions

- Full MCP-to-UI outcome coverage and all active-budget mutation paths.
- Historical approval and allocation data quality; no falsification of old agent actors.
- Exact recognition, recurring occurrence, balance snapshot, reimbursement correction and goal-progress
  semantics, with the regression cases already added to the implementation plan.
- Actual external-host protocol round trips, notification behavior, and production-equivalent evidence.
- Supported-host compatibility, migration backfills, tenant isolation, retries and financial audit atomicity.

## Planning artifacts

- [Consolidated design](../specs/2026-10-18-finance-experience-design.md)
- [Implementation tasks](2026-10-18-finance-experience.md)
- [Parallel ownership and shipping map](2026-10-18-finance-workstreams.md)
- [Canonical financial intelligence motivation](../../product/finance-workspace-plan.md#finance-intelligence-and-visual-exploration)

No unresolved contradiction is permission to invent a user preference. Raise any discovery that changes
accepted behavior; otherwise implement the explicit contracts and defaults with verification.
