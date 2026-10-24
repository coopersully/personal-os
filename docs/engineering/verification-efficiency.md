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

Node quality deliberately retains the original unsharded `pnpm check:node`. Vitest 3.2.7 blob
aggregation merges post-conversion Istanbul maps, which can infer hits for an uncovered nested
branch from an enclosing covered range in another shard. A measured trial changed unchanged-source
branch coverage from 94.00% to 96.61%; it is not equivalent evidence. Future coverage distribution
must demonstrate branch-hit equivalence against the single-run raw-V8 aggregation, including nested
uncovered branches, before replacing the existing coverage gate. Unchanged threshold numbers alone
do not prove equivalent enforcement.

## Coordination and trustworthy reuse

The normal repair loop is inspect the owner/contract/consumers, edit, run the smallest behavioral
check, batch coherent repairs, then assemble complete frozen-candidate evidence once. Retry failed
or invalidated checks within the existing recovery rules. Independent reviewers consume receipts;
they do not each run broad verification. One owner holds heavy shared-host capacity, while cheap
independent checks and isolated hosted runners can proceed. Use checked-in lifecycle commands;
never reset another owner’s database or kill their server to repair a test resource collision.

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
records staged owners, measured evidence and acceptance for future work. Complete final verification,
including docs-only shipping candidates, remains mandatory under the delivery contract until a
separately reviewed policy/classifier/enforcement change proves a safe exemption. This documentation
introduces no such exemption and no runtime, CI or verifier feature.
