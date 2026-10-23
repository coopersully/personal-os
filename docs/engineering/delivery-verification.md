# Delivery verification

Ship one frozen candidate with complete evidence. Use [verification efficiency](verification-efficiency.md)
for focused iteration and [acceptance](acceptance-contract.md) for review/production gates. This contract applies to ship-it and its
create-pr, catchup, review-remediation, and network callers. Focused checks run during implementation;
full verification runs after review findings converge. A full run against a changing checkout is
not acceptance evidence. Stage and commit the candidate before starting it; keep external metadata
and private evidence outside the source tree.

Draft publication and early review require focused evidence, not a separate full run. This sequencing
applies to ordinary contributions as well as handoff/network callers; see the
[development handbook](development-handbook.md). Final acceptance still requires every stage below.

## Verification equivalence

`pnpm verify` remains the complete local verifier. For shipping, current-candidate hosted CI can
satisfy equivalent stages without a duplicate local full run. Record the exact head, base/integration
context, workflow revision, provider, run/attempt, command/configuration, result, and source URL.
Compare the workflow against the candidate's verifier inputs; check names alone are insufficient.

| Local stage | Hosted equivalent |
| --- | --- |
| `pnpm check:repo` | Repository contracts |
| `pnpm lint` | Lint and format |
| `pnpm check:node` (types, coverage, builds) | All four Coverage shard jobs **and** Node quality (complete merged coverage, types, builds) |
| `pnpm test:e2e` | All four Browser acceptance shards for **each** of desktop-chromium and mobile-chromium |

Every row must name distinct stage jobs, include every matrix member, and be successful for hosted full equivalence, even if scoped CI omitted
an unaffected stage. Omission is not evidence: if any core hosted stage is missing, use the
complete local verifier. Native/platform, live-provider, and issue-specific acceptance remain
additional requirements when relevant. Preserve all coverage floors, assertions, and required checks.

A local failure must be diagnosed before hosted evidence can replace its result. Record the trigger,
failure classification, source evidence, and focused reproduction/recovery result. A changed assertion
or unexplained failure is not an environment diagnosis. If the defect is real, fix and reverify the
new candidate. If isolated reproduction passes and evidence establishes runner contention, use
successful equivalent hosted gates; do not keep rerunning the whole local suite to obtain lucky green.

## Opt in to complete hosted verification

Apply the repository label `ci:full` to the PR before its next genuine opened, reopened, or
synchronize event (normally the final source or catchup push). CI reads the label from that PR
event payload and selects full scope: repository contracts, lint, Node quality, both browser
projects, Terraform, and the existing macOS/Windows native matrix. The normal PR merge checkout,
head/base association, read-only permissions, source aggregate and metadata gate remain unchanged.
Other PRs retain their classified scope.

Adding or removing a label alone starts no workflow, cancels no source run and supplies no evidence.
Do not create empty commits or close/reopen a PR solely to trigger CI. A retry retains its original
event payload: labeling an already frozen candidate and rerunning an earlier unlabeled event does
not opt it in. Use the complete local verifier when there is no genuine next candidate event.
Labels are operator-managed; CI neither creates nor applies them. Removing the label affects only
future genuine PR events and never cancels an existing full run.

A full-scope configuration is not successful execution. Collect every distinct successful job,
matrix member and exact candidate identity required above, then check the normal metadata gate.
Hosted capacity, permissions, provider outages and native dependencies can still block delivery.
Existing failure diagnosis and bounded retry rules continue to apply; a failed metadata gate after
source recovery needs the documented metadata rerun, not a PR-body edit.

## Shared local capacity

`pnpm verify` enters `.codex/scripts/verification-runner.py` before expensive work. One verifier per
host/user holds an OS file lock at `~/.cache/nohmi/verification/verification.lock`, across repository
worktrees. Exit 75 means queued, not failed verification: persist the next trigger and retry after
release. The holder records PID/worktree/time. The child inherits the lock, so coordinator death
does not free a still-running child. Never delete the lock or kill another task to acquire it.
The OS releases ownership after all holders exit; stale text in the file is not a live claim.
Exit 78 means an uncommitted or changed candidate cannot supply acceptance evidence.

This guard coordinates updated callers only. Existing older worktrees and ad hoc `vitest`/Docker
runs do not join it. During rollout inventory active verifiers before admission; wait for existing
owners to finish. Do not claim host exclusivity while legacy runs remain active. Independent focused
checks may proceed when they do not contend for the constrained runner.

## Invalidation and recovery

| Change | Refresh |
| --- | --- |
| Source or verifier inputs change | Affected review plus verification/CI coverage for the new candidate |
| Base changes | Integration assessment, catchup when needed, and resulting candidate verification |
| PR title/body changes | Metadata/Work map validation only |
| Linear link/status changes | Tracker validation only |
| Approval or handled thread changes | Review disposition/approval gate only |
| Provider remains pending | No code or verification; wait on that provider record |

Allow one justified retry for a transient failure. A repeat needs a changed recovery condition,
such as isolated runner ownership, or an explicit blocker. Fingerprint by candidate, stage and root
cause, not test name: different timed-out assertions on an overloaded host are one incident.
Productive fixes are not limited by a pass count. A known failing candidate must not occupy the
runner while code is edited beneath it; stop only the owned run before edits.

## CI metadata isolation

`ci.yml` runs source checks on opened, reopened, synchronize, and supported pushes.
Its aggregate is `Source verification`. `pr-metadata.yml` runs on those PR events plus edits and ready-for-review and owns
`CI required`, preserving the existing protection name/provider. It validates the event's Work map
and waits for the latest applicable successful source workflow for that PR on its exact head and base. Missing, pending,
failed, or canceled source runs cannot pass the gate. Each workflow has a separate concurrency group;
editing a description cancels only a superseded metadata gate, never source tests.

A failed/canceled source run fails its waiting metadata gate. A same-head source retry does not
trigger a new PR event: after source recovery, the shipping controller must rerun the failed/canceled
PR metadata workflow (`gh run rerun <metadata-run-id> --failed`) and wait for the new protected result.
Record both source and metadata run/attempt IDs under the existing bounded retry policy. Do not
edit the PR body to trigger recovery or reuse the failed metadata result. Ignored `.context` evidence
is excluded from source lint so collecting provider records cannot create a formatting failure.

Retargeting a PR changes its integration context: catch up to its actual base and push a new candidate
before merging. Do not reuse a successful run from a different target base. Final ship-it collection
still checks live metadata, head/base, source attempts, reviews, and protections before normal merge.

## Rollout and external evidence

Ship-it records its checked-in VERSION and the loaded policy revision in every checkpoint. Version
changes require re-reading the skill and this contract at a safe checkpoint, then re-auditing
candidate evidence. A merged instruction file does not update a running chat's memory or an old
worktree. Update the checkout and reload explicitly; never overwrite an active owner's local changes.

Fixture tests prove gate selection, lock contention, and checkpoint recovery. Hosted workflow runs
must additionally prove GitHub Actions read permission, source-run discovery, bounded waiting, and
required-check publication. Scheduler creation must be verified on its host; a checkpoint alone
cannot wake a chat. A provider outage, inaccessible fork run, or exhausted review quota can still
block delivery despite green local tests. Persist the exact gap and next trigger, never infer success.

## Ownership through production

The repository handoff skill owns delivery through production acceptance and reconciliation;
ship-it is its protected-merge engine and compatibility entrypoint. Keep all existing merge gates.
Use repository deep-review instead of the retired personal refine-pr workflow. A readiness verdict
of TERMINAL after merge ends only the merge operation. Retain the owner and dedicated wakeup until
the reviewed production plan is verified or explicitly blocked. Offline acceptance and checkpoint
validation do not authenticate provider evidence; inspect the recorded receipts.
