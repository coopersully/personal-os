---
name: ship-it
description: "Compatibility entrypoint for ship it: hand off a nohmi worktree or PR through acceptance, protected merge and verified production delivery."
---

# Ship It

Policy version: read `VERSION` and record it as `policyVersion` before acting.

Start with the repository [handoff](../handoff/SKILL.md) ownership procedure, then use this delivery
engine. Carry one authorized Nohmi outcome through verified squash merge, production acceptance
and tracker reconciliation. Invocation authorizes in-scope edits, tests, commits, non-force pushes, handled
thread resolution, PR metadata, bounded Nohmi Linear writes, factual review replies and review
requests needed for this PR, and normal protected merge. It does not authorize scope expansion,
force pushes, protection changes, administrator bypass, deferred auto-merge, or other Projects.

Read `docs/engineering/delivery-verification.md`, `AGENTS.md`, `docs/engineering/pr-rubric.md`, `docs/engineering/work-context.md`, and
[execution and recovery](references/execution.md). Preserve existing network roles: an assigned
orchestrator delegates implementation to its worker; a worker never merges. Ordinary contribution
invocations may implement and merge within their authorized scope.

## Ownership and resumption

Resolve exactly one repository, open PR, authenticated actor, head, base, and authorized scope.
If no PR exists or substantial implementation remains, finish that implementation and the create-pr
phase first; report it as implementation, not merge waiting. Reload when the recorded policy version
differs from the checked-in VERSION; do not assume another chat uses this checkout’s instructions.
Claim the PR using `scripts/checkpoint.py` with the stable task/host owner identity. Its private
registry lives in the Git common directory so it survives worktree removal. Preserve unrelated
local edits; use an isolated checkout if needed. Never steal a claim on elapsed time alone.

On every resume, read the checkpoint and live PR first. Reconcile any pending external mutation
before repeating it. A merged PR goes directly to production acceptance and post-merge reconciliation. A closed, unmerged PR
ends delivery without reopening it. Revalidate issue eligibility, requirements, policy, and owner.

One pass performs bounded useful work and persists its next trigger. During active work continue
without asking for routine confirmation. While external work runs, use bounded waits or a verified
heartbeat on this same chat. The execution reference defines scheduling, backoff, and recovery.
Do not report completion when merely waiting or after enabling some external operation.

## Convergence loop

1. **Collect.** Run `scripts/collect_evidence.py --repo <owner/repo> --pr <number> --output
   .context/ship-it/github.json`. Use `resolve-pr-comments` to collect all review surfaces,
   including resolved/outdated threads. Inspect live Linear, current workflow scope, rules,
   dependencies, acceptance criteria, and actual diff. Collection gaps remain unknown.
2. **Reconcile.** Use `create-pr` and `linear-work-sync` for title/body, docs, Nohmi Work map,
   direct issue eligibility, statuses, and structured backlinks. Batch necessary metadata edits
   before final hosted checks. Their non-merging phases do not remove this invocation's merge
   authority. Necessary in-scope protected-surface fixes already in this PR inherit this direction.
3. **Repair.** Use `catchup` if the fetched base is not contained in the head, and
   `resolve-pr-comments` for verified findings. Inspect failures before retrying CI; fix root
   causes with focused tests. Resolve only handled or demonstrably inapplicable threads.
   Preserve reviewer disagreements for judgment. Group related fixes to avoid needless CI churn.
4. **Converge review.** Run the repository `deep-review` with fresh read-only reviewers against the acceptance contract and collect current feedback.
   Batch accepted in-scope fixes with focused tests. Re-review affected requirements until all applicable acceptance criteria are satisfied;
   do not start expensive final verification while review fixes are still changing the checkout.
5. **Freeze and verify.** Commit and push the reviewed candidate after focused checks, changed-file formatting/lint,
   and affected contract checks. Full lint remains part of the single final verification set.
   Request substantive CodeRabbit coverage once per candidate and collect eligible approvals.
   Obtain one complete verification set: `pnpm verify` through the shared runner, or evidenced
   equivalent current-candidate hosted stages under the delivery-verification contract. Diagnose
   any local failures; green CI never excuses an unexplained defect. Do not edit a running verifier’s
   checkout. If a new finding requires a change, stop the owned run, retire that candidate, fix it,
   and refresh affected evidence. Metadata changes refresh only metadata checks. Sub-skills inherit
   this verification policy instead of each launching another full suite.
6. **Evaluate.** Build the [readiness state](references/readiness-state.md), with supporting
   evidence references rather than unsupported booleans, including the independent acceptance
   record in [acceptance state](references/acceptance-state.md). Run:

   ```bash
   PYTHONDONTWRITEBYTECODE=1 python3 .agents/skills/ship-it/scripts/evaluate_readiness.py \
     --state .context/ship-it/state.json --pretty --output .context/ship-it/decision.json
   ```

   - `REMEDIATE`: perform the indicated in-scope repair, record its outcome, and recollect.
   - `WAIT`: checkpoint the pending provider operation, next trigger, and retry time; resume when
     the state changes. Missing human approval is an external dependency, never self-approval.
   - `BLOCK`: diagnose the exact missing evidence, authority, or decision. Recover transient
     collection failures through the execution reference; do not ask the user to fix routine gaps.
   - `TERMINAL`: reconcile the observed merged PR; never attempt another merge.
   - `MERGE` / `normal`: enter the final gate below. No other verdict authorizes merging.

## Final gate and merge

Claim `<repository-url>#merge:<base>` before final collection, serializing merges into that base.
On a failed final gate, wait, cancellation, or closed PR, reconcile any pending merge and release
the base claim before yielding; reacquire it for the next final collection. On merged resumption,
release a leftover base claim after reconciling the merge. Retain the PR claim while delivery is active.
Freeze the candidate. Re-read PR head/base, rules, selected current check attempts, reviews, every
thread, CodeRabbit coverage, Linear eligibility/acceptance, and dependencies. Rebuild the complete
state and evaluate it again; any changed input requires re-auditing the affected gate.

Require normal actor authority and live server enforcement of up-to-date required checks and
conversation resolution for the normal merge path. Never invoke an administrator bypass. Every selected scoped job must pass;
missing jobs do not disappear from the expected inventory. Every thread must be resolved, including
outdated threads. Substantive CodeRabbit coverage and independent acceptance remain separate gates.
The evaluator checks supplied evidence; it cannot authenticate it or make this multi-service read
atomic. If equivalent final enforcement is unavailable, block unattended merge.

Record a pending merge operation with expected head/base **before** running:

```bash
gh pr merge <PR-URL> --squash --match-head-commit <head>
```

Never use `--admin` or `--auto`. A queue-only path requires a separately proven equivalent gate;
it is not supported by this workflow. On timeout or ambiguous response, re-read GitHub before any
retry. Confirm the audited source head and resulting merge commit, then finish the pending record
and release the base claim. Branch/worktree cleanup is separate from merge and must preserve other
owners' work and unpushed changes.

## After merge

Follow [production delivery](references/production-delivery.md) before releasing delivery ownership.
`TERMINAL` from the merge evaluator means do not merge again, not delivery completion. Keep the
reviewed source candidate and merge receipt distinct.

Checkpoint `reconcile`. Use `linear-work-sync` to mark a direct issue Done only when its acceptance
criteria are satisfied; preserve honest partial completion and parent dependency status. Retry a
failed tracker update independently of merge. Record the verified commit and at most one material
completion comment. Complete the checkpoint only after production acceptance and required reconciliation succeed, then
release ownership and pause this PR's dedicated heartbeat. Never pause a shared network heartbeat.

Use the PR workflow output contract: PR purpose/link, merge commit, verification, independent review,
CodeRabbit, issue/backlink/status results, private evidence/checkpoint locations, and exact blockers.
Notify on meaningful changes or required action; unchanged waiting remains quiet. Merged is not
production deployment evidence; the handoff remains active until the reviewed production plan is proven. Read [pressure scenarios](references/pressure-scenarios.md) when
modifying this skill.
