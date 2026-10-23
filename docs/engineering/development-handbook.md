# Development handbook

Start here after agreeing on an outcome. Reuse settled decisions, existing issues, branches, PRs,
checks and reviews. Do not restart the workflow because another skill was invoked. This handbook
routes the work; owning skills provide details only when their step is needed. Small contributions
stay small. Multi-owner outcomes use [epic delivery](epic-delivery.md).

The offline planner is executable decision support, not an autonomous launcher or merge authority:

```bash
node scripts/development-plan.mjs --state .context/development-state.json
```

It reads one local JSON file, emits the next ready step, step dispositions, receipt keys and scoped
iteration commands, and performs no network requests, compilation or mutations. Invalid/missing
scope fails rather than inventing a narrow plan. Unknown valid paths yield broad iteration checks.
The planner reuses `verification-plan.mjs` and the existing CI dependency classifier.

## Select the requested work

- `plan`: clarify and propose the outcome/decomposition; no tracking writes or execution implied.
- `review`: inspect the existing candidate and relevant evidence; no implementation or publication.
- `contribute`: track, implement, review and publish; no merge authority implied.
- `deliver`: continue through complete final verification and the role-preserving handoff gates.

Implementation/durable changes require Nohmi Linear tracking under the standing repository grant.
A request to build, track, test, publish and merge safely may supply the remaining scoped grants together.
Merge intent must be explicit: “get this merged,” “merge when safe,” or “ship it” qualifies;
implementation or PR publication alone does not. Without it, stop before merge.
Record its actual scope once. Do not ask again when it is already clear. Separate new-chat, sidebar,
recurrence and production-effect authority still follows epic/handoff contracts. Plan mode can
produce an issue proposal without creating it. Existing work enters at its next missing evidence,
not at a fixed first step. Coordinators delegate implementation; choosing a mode never changes role.
Carry the agreed intent, rationale, non-goals, unfinished obligations and grants through the handoff.
Use repository oversight’s local lifecycle and monitoring references; do not require a personal skill
install, add a supervisor layer or reconfirm settled decisions. Planning, dispatch, acknowledgement,
implementation, review and acceptance each require their own evidence, separate from waiting/blocked.

## Step contracts

Each step produces an inspectable result and a receipt. `done` means a matching receipt exists;
`unnecessary` means the mode/scope excludes the step; `ready` means its prerequisites are satisfied;
`waiting` means prerequisite evidence is missing; `blocked` means required authority is absent.
These are planning dispositions, not live provider or acceptance verdicts. Record external waits,
failures and next triggers in the existing checkpoint; they do not become passing receipts.

| Step | Output and owning workflow | Skip/reuse and recovery |
| --- | --- | --- |
| understand | Compact outcome brief: observable behavior, non-goals, criteria, decisions and scope of authorization; `agent-context.md` routes product truth | Reuse agreed conversation/issue criteria. Ask only about unresolved choices affecting the result. |
| track | Existing or new direct Nohmi issue, verified project and scope; `linear-work-sync` | Reuse correct existing tracking. Ambiguous identity blocks writes, not research. |
| plan | Owners, dependency milestones, shared paths, integration acceptance and verification; `oversight` / `epic-delivery.md` | Ordinary local contribution needs no separate plan artifact. Required for coordinated work and explicit planning. |
| implement | Scoped code/docs/tests, intentional diff, owner self-review; applicable implementation skill | Reuse completed work; preserve dirty work and existing ownership. Route repairs back to its worker. |
| verify-focused | Behavior regression, affected consumer types, changed-file lint and relevant contract/platform checks; `personal-os-testing` | Reuse receipts with matching inputs. Failed check gets bounded diagnosis, not blind full-suite retries. |
| review | Independent requirement/standard dispositions; `deep-review` | Reassess changed concerns and consumers; retain valid coverage. Self-review cannot fill independent acceptance. |
| publish | Same PR created/refined with consistent Work map and Linear backlinks; `create-pr` | Reuse an existing PR; refresh only affected metadata. Publication is not proof of acceptance. |
| verify-final | Complete frozen-candidate local or equivalent hosted verification; `delivery-verification.md` | Reuse the complete matching set. Missing hosted stages require full local verification, not guessed exemptions. |
| deliver | Live protected merge, production or non-runtime acceptance and reconciliation; `handoff` | Historical completion is reusable only for that outcome. Refresh live gates before any new effect. |

The default order is an efficient dependency order, not a ban on useful early review or publication.
Independent review can inspect an incomplete candidate and report gaps without running full tests.
Draft publication or making a candidate review-ready to obtain required external review may occur
before review convergence/final verification when the applicable skill and authorization permit it.
Record gaps honestly; do not claim merge readiness. A valid publication receipt can therefore exist
before a review receipt. No reorder waives final review, complete verification or live merge gates.

## Input and receipt format

Version 1 input contains `mode`, `coordination` (boolean), `scopeComplete: true`, `paths`, `context`,
`authority` and `receipts`. The path list includes committed, staged, unstaged and relevant untracked
files, both rename paths and deleted paths. For planning, list proposed affected paths and revise
when implementation differs. Include global verifier changes. The caller is responsible for this
inventory; the planner cannot prove completeness from a list supplied by an agent.

`context` contains nonempty opaque fingerprints for:

| Key | Meaning |
| --- | --- |
| source | Source snapshot: committed revision plus included dirty/untracked content and deletions, or frozen candidate SHA |
| base | Actual target and integration base revision |
| verifier | Tool/lockfile/config/workflow versions, execution environment and check-selection definition; change when required coverage changes |
| policy | Loaded acceptance policy digest and relevant workflow/role instruction versions |
| requirements | Outcome criteria and issue eligibility/requirement revision |
| metadata | Current intended PR/issue identity, Work map, links and publication state |
| ownership | Actual repository/worktree, role, execution owner and assignment revision |

Use content digests or authoritative revision IDs, not timestamps or the same placeholder for every
candidate. Do not hash unrelated log output into source identity. Missing context blocks planning.
Policy affecting check applicability must also update `verifier`; approval/feedback changes refresh
live merge gates even when source receipts are reusable. Source or base changes invalidate whole
step receipts conservatively; the reviewer may construct a new receipt carrying valid unaffected
sub-evidence with an explicit assessment. The planner never silently carries it forward.

`authority` has `track`, `implement`, `publish`, `deliver` booleans derived from actual user grants.
These flags cannot grant permission or override a role restriction. Keep the authorization source
in the existing private record. A receipt is:

```json
{
  "step": "verify-focused",
  "key": "copy the planner receiptKey for this step and current context",
  "result": "pass",
  "owner": "actual execution owner",
  "elapsedMs": 420,
  "evidence": ["absolute private receipt path or authoritative source URL"]
}
```

Store the original command, check scope, input revisions, environment, result and timing at that
evidence location. Review evidence additionally identifies independent reviewers and coverage;
delivery uses the existing acceptance/checkpoint schema. Do not duplicate those detailed records.
Keep receipts in observation order (oldest first); the last record for the same step/key wins,
so a later failed or incomplete result supersedes an older pass. Preserve failure diagnosis and
recovery evidence before issuing a new passing receipt.
The planner checks receipt shape and selected input binding only; it does not authenticate evidence,
prove review independence, or replace ship-it evaluation. Never create a pass merely to advance it.

A receipt key hashes the schema version, step and its named context dependencies. Output exposes
those dependencies. PR metadata changes invalidate tracking/publication but preserve source checks;
source/base/verifier changes invalidate verification; source/base/policy/criteria/verifier changes invalidate
review. Delivery completion is historical: every new merge still requires fresh provider gates.

## Verification scope and performance

[Verification efficiency](verification-efficiency.md) governs focused iteration. The planner emits
candidate commands, not a complete behavioral test selector. Name the regression, negative cases,
consumer contracts and applicable platform/provider checks from the actual requirements. A docs-only
iteration needs content/link review, not application compilation. Tooling scripts need their own
regressions even when product code is unchanged. Shared contracts expand to transitive consumers.

Complete final verification remains mandatory for every shipping candidate, including docs-only
changes under current policy. This is an explicit conservative boundary, not an optimized final
scope classifier. Narrow final exemptions require separately reviewed classifier/enforcement changes;
this handbook introduces none. Hosted equivalence can avoid duplicate local work only when every
required stage is present and current. Full verification runs after convergence on a frozen committed
candidate; draft publication and early review do not each require their own full run.

One execution owner shares receipts. Reviewers ask for named missing evidence; they do not each run
the suite. Load this map once, then the current step's owner and relevant domain contract, not every
skill in advance. Re-read changed instructions at safe checkpoints. Keep private state in the
existing checkpoint/registry; the planner state is a derived view, not a second tracking authority.

Measure cold CLI time, focused checks, final verification, provider calls and duplicate work separately.
Tests in `scripts/development-plan.test.mjs` cover docs, UI, API, shared contracts, tooling, metadata,
review-only and epic/resumed delivery cases. These are deterministic simulations, not evidence of
live Linear/GitHub/monitor execution or end-to-end delivery latency.
