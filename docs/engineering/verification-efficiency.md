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
