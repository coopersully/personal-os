# Verification efficiency

Use the smallest check that resolves the current uncertainty, then obtain the complete final
candidate evidence required by [delivery verification](delivery-verification.md). Scoped iteration
is not scoped permission to merge. Required checks, coverage floors and independent review remain.

## Separate the costs

- **Offline decisions:** readiness/acceptance evaluators read sanitized snapshots, perform no network
  requests and launch no tests. Keep them dependency-light and linear in evidence size where possible.
  An operational target is under 100 ms per ordinary CLI decision on the development host; benchmark
  representative inputs and report cold startup separately from warm evaluation. This is a target,
  not permission to skip a gate, and not a claim about all machines.
- **Collection:** fetch only the changed provider record while waiting. Use the existing complete
  collector at initial/final gates and when identity/policy/feedback changes. Final live protections
  and complete collection cannot be replaced by cached JSON. Respect timeouts and backoff.
- **Focused execution:** select tests and typechecks for affected owners and transitive consumers.
  One execution owner runs them once and shares candidate-bound receipts with reviewers.
- **Final verification:** freeze the reviewed candidate, then obtain one complete local or equivalent
  hosted verification set. Never rerun all suites merely because another skill was invoked.

Use [the development handbook](development-handbook.md) and `scripts/development-plan.mjs`
for step dependencies and receipt invalidation. The existing scope planner remains its shared
iteration selector; neither tool waives final verification.

## Iteration planner

Write a JSON array of repository-relative changed paths to a private file. Include committed,
staged/unstaged changes and relevant untracked files for the iteration being checked; include both
old and new paths for renames/deletions. An incomplete path list produces an incomplete plan.

```bash
node scripts/verification-plan.mjs --files .context/changed-files.json
```

The command emits argv arrays, never executes them. It reuses the CI dependency classifier for
package/consumer scope, includes integration/E2E type projects when needed, and directs skill Python
changes to their owning test directory. Unknown/global scope falls back to full typechecking.
Documentation-only changes do not trigger application compilation. During authorized delivery
convergence, use changed-file Biome checks and affected contract checks before a repair push; the
full lint command includes deployment simulations and remains in final verification. Select focused behavior tests,
platform checks, contracts and lint after inspecting the change; the planner is not a full test
selector or acceptance receipt. Zero discovered tests is a gap, not success.

Use `pnpm exec vitest run <specific-test-path>` for a named behavior regression. Use the planner's
package typechecks rather than invoking the root typecheck repeatedly during iteration. A changed
shared domain contract expands to its consumers; one edited file does not mean one package is safe.
Do not install tools or run unrelated test suites merely to inspect a readiness state.

## Evidence reuse and compiler work

A receipt records source inputs, head/base or dirty snapshot, tool/config/dependency versions,
command, environment, elapsed time, result and scope. Reuse only if those inputs remain valid.
Recheck affected consumers after contract changes. Do not reuse successful logs from a different
checkout, policy, dependency graph or integration base as current proof.

For slow TypeScript checks, first measure with `--extendedDiagnostics` on the affected project.
Inspect costly types, include scope and repeated project work before changing configuration.
Incremental caches/project references need their own correctness and cold/warm measurements; they
are not introduced globally by this policy. Do not weaken strictness or skip required projects.

Fix a demonstrated bottleneck. Never parallelize expensive full verifiers on this shared host;
use the existing runner lock. Do not trade complete pagination, policy authentication, fsync/atomic
checkpoints or final protected merge enforcement for speed. Report latency and source gaps honestly.

## Hosted browser shards

Browser acceptance uses four file shards per browser project, each with its own Ubuntu runner,
application processes and PostgreSQL container. `fullyParallel: false` and one worker preserve
ordering within a test file; no shared local worker increase is introduced. Every matrix member
remains required. Failure artifacts include project and shard to avoid concurrent name collisions.
Local `pnpm test:e2e` and complete `pnpm verify` retain their unsharded behavior.

The boundary owner is the CI workflow. GitHub-hosted capacity and normal test dependency downloads
remain required; repository permissions remain read-only. Jobs retain their existing timeouts,
cancellation and retry policy. Missing, failed or canceled selected jobs block acceptance. Local
discovery proves the test partition, not hosted scheduling, installation reliability or elapsed time.

Measure the slowest shard, setup time, queueing and total runner minutes separately. Four shards
trade more runner capacity for lower elapsed time; a large single file or slow browser dependency
installation can limit gains. Five-minute ordinary PR CI remains a target, not a coverage exception.

Node quality retains one unsharded `pnpm test:coverage` execution. The local `pnpm check:node`
command remains `pnpm typecheck && pnpm test:coverage && pnpm build`. Vitest 3.2.7 blob
aggregation merges post-conversion Istanbul maps, which can infer hits for an uncovered nested
branch from an enclosing covered range in another shard. A measured trial changed unchanged-source
branch coverage from 94.00% to 96.61%; it is not equivalent evidence. Future coverage distribution
must demonstrate branch-hit equivalence against the single-run raw-V8 aggregation, including nested
uncovered branches, before replacing the existing coverage gate. Unchanged threshold numbers alone
do not prove equivalent enforcement.

Draft PRs defer both hosted matrices; see the draft fast lane in
[delivery verification](delivery-verification.md). Every matrix member remains required once the PR
is ready for review.

Hosted Vitest uses one worker fewer than the runner's available cores, never fewer than two. The
shared development host stays at two workers, where four made setup flows time out under full
`pnpm verify` load. A hosted runner is dedicated to one job, and the spare core is left for the
integration-test PostgreSQL containers. This changes scheduling only: the single unsharded coverage
run, its raw-V8 aggregation, thresholds and test timeouts are unchanged. Compare the hosted
`pnpm test:coverage` duration against the 989 seconds recorded on run 43508749100 before claiming
a speedup, and revert to two workers if hosted timeouts appear.

## Node phase budgets

The hosted Node quality job runs type checking, coverage tests and production builds as separate,
blocking steps on the same runner after one frozen install and production audit. Their budgets are
5, 30 and 10 minutes respectively; the outer job allows 50 minutes for these phases plus setup and
diagnostics. The test execution budget remains 30 minutes. A failed or canceled phase blocks the
job and later source steps retain the default `success()` condition. The required aggregate still
uses the actual job result. This split changes neither assertions, test timeouts, coverage floors,
V8 aggregation, dependency caching nor job selection.

Historical source run 42154693945, attempt 1, reported 7,381 passing tests across 650 files and
all coverage floors passing, with Vitest taking 1,645.47 seconds (27m25s). Type checking took about
2m17s and setup about 26s. The former combined 30-minute job limit canceled the job after builds
started; API and web build completion was unconfirmed. Separate budgets keep that non-test work
outside the test execution allowance. This is execution headroom, not a measured speedup or proof
that a future candidate's builds will complete. Hosted verification must still prove every phase.

Attempt-bound diagnostics record each phase outcome and preserve `sourceSteps.node` as an
aggregate: only three successful phases produce Node success. A successful test phase followed by
a failed, canceled, skipped or unknown build remains unsuccessful. Legacy callers supplying only
`NODE_OUTCOME` retain their original manifest shape. Missing reports after successful coverage
remain an incomplete diagnostic even when builds fail; artifacts never replace the required job.

## Early production audit

Node quality runs the unchanged `pnpm audit --prod` immediately after frozen dependency
installation and before type checking. An audit failure stops that job before expensive
type, coverage and build work; successful candidates still run every existing check. The same
Node job and required aggregate gate enforce failure. Other parallel jobs are not canceled by
this reorder, so earlier detection does not imply lower whole-workflow elapsed time or runner cost.

Measure time to the audit result separately from complete elapsed time and aggregate runner
minutes. In historical run 40040586614, installation finished 17 seconds after Node job start,
then `check:node` took 22m45s before a one-second audit failure. Moving that audit earlier would
have detected that failure roughly 22m45s sooner; this is a counterfactual from recorded timings,
not a measured candidate speedup. Preserve the single-run sharding comparison separately and
record actual current-candidate setup, audit and execution timings before making further claims.

## Coordination and trustworthy reuse

The normal repair loop is inspect the owner/contract/consumers, edit, run the smallest behavioral
check, batch coherent repairs, then assemble complete frozen-candidate evidence once. Retry failed
or invalidated checks within the existing recovery rules. Independent reviewers consume receipts;
they do not each run broad verification. One owner holds heavy shared-host capacity, while cheap
independent checks and isolated hosted runners can proceed. Use checked-in lifecycle commands;
never reset another owner’s database or kill their server to repair a test resource collision.

### Classify observed work before admission

Use `.codex/scripts/verification-admission.py` for the reusable, pure inventory classifications.
It supplements the caller's admission checks; it neither probes the host nor grants capacity.
The shared `verification-runner.py` still owns the OS lock and candidate freeze. Private one-off
admission scripts must explicitly adopt the classifier; adding it does not repair their old copies.

- Supply actual tokenized argv, PID, parent PID and observed presence from the same fresh snapshot.
  `pnpm verify:pr`, `verify-pr.mjs` and the Jest CLI are material verification. Attribute worker
  descendants through an observed verifier parent chain; a filename or keyword in reader output is
  not executable identity. Seven queried PIDs do not mean seven active verifiers. Absent identities
  cannot contribute stale argv or ancestry. Unknown live roles still require attribution.
- Retain the complete container baseline, including exited and created resources. Classify activity
  from actual Docker state, not existence in `docker ps -a` or a human-readable status substring.
  Exited/created containers alone do not establish active verification. Running, restarting and
  paused resources remain active for ownership/activity assessment; missing/unknown states stay
  unresolved. Existing baseline-role, current activity, process-chain and resource checks still apply.
- Never stop or delete another owner's process/container to obtain admission. Classification fixtures
  prove these decisions only; they are not fresh host inventory, pressure samples or eligibility.

### Complete authoring checks before hosted publication

Before a push or PR creation can trigger hosted source verification, complete applicable native
changed-file formatting/import checks with the candidate's own configuration and pinned existing
tool. Record actual completion and final input hashes; a proposed command, later check or successful
tool installation is not pre-publication proof. When a formatter writes, check the resulting final
file before publication. Validate the exact proposed Work map with
`.codex/scripts/check-pr-body.sh` and verify its live Nohmi project/direct issues before creating the PR.
Metadata-only corrections revalidate the changed body without a source retry.

For fixture changes, bundle the existing owner/reviewer's review of mock defaults, storage/clock
state, async settlement/cleanup and assertion/error/timeout preservation with those authoring checks.
Do not create a separate review panel or substitute authoring checks for behavior evidence.

Reuse a completed applicable authoring receipt when file bytes, selected command, native tool and
configuration/dependencies remain identical and no newer relevant failure exists. A new commit ID
or base alone does not require repeating unchanged file formatting/import/lint checks. Reconcile
changed file selection, comparison-sensitive checks and unknown dependencies explicitly. This narrow
reuse does not waive the delivery contract's complete frozen-candidate verification.

Allocate a finite conditional sequence once: setup only if missing, named focused checks, required
type/contract closure, then the selected final local **or** equivalent hosted gate. Preserve each
stage's command, bounds, preconditions and stop conditions. Do not request scheduling approval again
for every unchanged authorized stage or repeat full local and hosted suites for the same closure.
Fresh admission and the OS lock remain required at their existing boundaries; old capacity samples
are never source-reuse evidence. A denial, unexpected failure or changed scope stops the sequence;
continue only under the applicable recovery condition, not speculative reruns.

The current planner binds whole-step receipts conservatively. It does not implement automatic
per-check result reuse, a semantic test selector or narrower final readiness. Any future per-check
reuse must bind command/arguments, working directory, policy/config/tool/runtime, relevant environment
without exposing values, source/tests/fixtures and transitive consumers. Include dirty, untracked,
renamed, deleted and symlinked inputs; check input stability during execution. Base-sensitive checks
also bind the comparison. Unknown dependencies broaden scope; malformed/missing/stale receipts do
not pass, and newer failure supersedes an older pass for the same inputs. A selected execution success
must be reported separately from complete readiness with every required check accounted for.

Preparation reuse is distinct from test-result reuse. Healthy prepared resources require matching
application/build, runtime/configuration, schema/fixture identity and proven ownership. Mutable
external state that cannot be fingerprinted needs fresh test execution even if preparation is reused.
Record discovery, pass/skip counts and actual environment; required skipped or undiscovered tests
are evidence gaps. Do not implement these capabilities by writing optimistic planner receipts.

The [acceleration plan](../superpowers/plans/2026-08-26-ci-hardening-and-acceleration.md#current-follow-up-plan-october-23-2026)
records staged owners, measured evidence and acceptance. The canonical delivery contract now permits
only its Git-verified prose exception; other candidates retain full verification. Path-only planning,
optimistic receipts and future cache proposals cannot narrow final acceptance.
