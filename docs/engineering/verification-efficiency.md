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

Browser acceptance uses six file shards per browser project, each with its own Ubuntu runner,
application processes and PostgreSQL container. `fullyParallel: false` and one worker preserve
ordering within a test file; no shared local worker increase is introduced. Every matrix member
remains required. Failure artifacts include project and shard to avoid concurrent name collisions.
Local `pnpm test:e2e` and complete `pnpm verify` retain their unsharded behavior.

The boundary owner is the CI workflow. GitHub-hosted capacity and normal test dependency downloads
remain required; repository permissions remain read-only. Jobs retain their existing timeouts,
cancellation and retry policy. Missing, failed or canceled selected jobs block acceptance. Local
discovery proves the test partition, not hosted scheduling, installation reliability or elapsed time.

With four shards the slowest job set the length of the whole run. Six shards split the heaviest
file groups; the hosted list reporter records each test's duration so a later change can balance
shards from measurements. Each job carries about 90 seconds of setup and application start, so
more shards cost more runner time. Draft PRs defer both hosted matrices; see the draft fast lane
in [delivery verification](delivery-verification.md).

Running two application stacks on one runner was tried locally and works, but was not adopted: a
hosted Vitest trial showed a four-vCPU runner doing more total work with three workers than with
two, so a second stack is unlikely to pay for itself there.

## Sharded Node tests with one coverage gate

Node tests run as six `Node tests` shards. `Node quality` waits for all six and for `Node build`,
merges the shards' coverage and enforces the unchanged floors over the whole suite. It remains the
canonical hosted result for types, tests, coverage and builds: a shard or build that fails, is
canceled or goes missing skips `Node quality`, which the required gate rejects. The local
`pnpm check:node` command remains `pnpm typecheck && pnpm test:coverage && pnpm build`.

An earlier trial with Vitest 3.2.7 blob aggregation was rejected. `--merge-reports` merges shards
after each has been converted to Istanbul maps, which can credit an uncovered nested branch from an
enclosing covered range in another shard; that trial changed unchanged-source branch coverage from
94.00% to 96.61%. The current design does not use it. A single run merges the raw V8 results of
every test file per transform mode and converts once. `scripts/coverage-shard-provider.mjs` keeps
that order:

- A shard exports each test file's raw V8 result untouched. It converts nothing and checks no floor.
- The merge combines every shard's raw results per transform mode in one pass with the same V8
  merge library the provider uses, then hands the result to the unmodified upstream
  `generateCoverage`. Conversion, untested files, reports and floors are the same code a single
  run executes.
- The merge requests each source file's transform in the mode its tests used, because no test ran
  in that process to populate the cache a single run converts from.
- The merge refuses a missing, repeated or mixed shard, another tool version or checkout, and any
  difference between the shards' test files and the suite's own test list.

A single run does not merge in one pass. It folds raw results together one test file at a time, in
the order its tests happened to finish, re-merging its own output. That fold is order-sensitive
and can leave a spurious covered range, so two single runs of the same source do not always agree.
The one-pass merge has no order: the same suite yields the same report on any shard count.

Acceptance evidence, in the form the earlier rejection required:

- On a subset covering both transform modes, the one-pass merge is byte-identical to a single
  run's `coverage-final.json`, identical between shard counts, and identical with the inputs
  reversed. The fold over the same data adds a covered branch in some orders.
- On the whole suite, a version that still folded read slightly higher than a single run, which
  is what prompted the one-pass merge. The one-pass merge read equal or lower on every metric and
  met every floor.

Reproduce the subset check by running `pnpm test:coverage` and then the shard and merge scripts
with the same path filters, and comparing with `scripts/compare-coverage.mjs`. Exact figures for
each whole-suite comparison are in that workflow run's summary.

Branch coverage sits within a hundredth of a point of its 94% floor, so this matters. The
`Coverage equivalence` workflow runs the suite once on one machine, runs the same six shards,
merges them and fails if a file is missing from either report, if any metric is more than 0.01
points higher or 0.05 points lower in the merge than in the single run, or if more than 0.2% of
all counters change across the files that differ. The bounds are asymmetric on purpose: the merge
must not make the gate easier to pass. It runs on pull requests that change the coverage
machinery, Vitest configuration, `package.json`, the lockfile or the CI workflow, weekly, and on
request. It is not part of `CI required`: treat a failure on a pull request that changes those
files as blocking.

The provider depends on Vitest internals: the base provider's `readCoverageFiles`,
`coverageFiles`, `pendingPromises` and `cleanAfterRun`, the Vitest instance's
`initCoverageProvider`, vite-node's `fetchResult`, and the `@bcoe/v8-coverage` package resolved
through `@vitest/coverage-v8`. A Vitest upgrade that changes them fails
the merge or the equivalence workflow rather than passing silently; repair the provider in that
upgrade.

Vitest keeps two workers everywhere. A hosted trial with three workers was about a fifth slower
than two, with total per-worker time nearly doubling: the runner was oversubscribed, not
underused. Shards add machines instead.

Hosted DOM tests also get five seconds for Testing Library's asynchronous waits instead of one,
set in `vitest.setup.ts` alongside the existing hosted test timeout. A wait still has to succeed;
it is only allowed longer on a busy runner. A sharded run exposed a one-second wait that timed out
in two of eight executions of the same shard.

## Node phase budgets

`Node build` runs a frozen install, the production audit, type checking and production builds, with
5- and 10-minute budgets for the last two inside a 20-minute job. Each `Node tests` shard has a
15-minute test budget inside a 20-minute job. `Node quality` has a 10-minute merge budget inside a
15-minute job. A failed or canceled phase blocks its job and later source steps retain the default
`success()` condition. The required aggregate still uses the actual `Node quality` result.

Before sharding, the single job spent roughly sixteen minutes in tests, a minute and a half in
type checking and a minute in builds. With six shards each takes three to six minutes and the
merge about a minute. The shards are uneven, so balancing them is the next gain. Elapsed time for
a whole run also depends on the account's 20-job limit: a full run starts 24 jobs.

Attempt-bound diagnostics still record each phase. `Node quality` reports install and coverage from
its own steps, and audit, type checking and builds from the `Node build` result it waited for; it
cannot run unless that job succeeded as a whole. Missing reports after a successful merge remain an
incomplete diagnostic; artifacts never replace the required job.

A partial rerun does not work for the Node jobs: `Node quality` merges only shards uploaded by its
own attempt, so rerun the whole workflow, as the source receipt already requires.

## Early production audit

`Node build` runs the unchanged `pnpm audit --prod` immediately after frozen dependency
installation and before type checking. An audit failure fails that job within seconds and skips
`Node quality`. Other parallel jobs are not canceled, so earlier detection does not lower
whole-workflow runner cost.

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
