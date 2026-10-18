# Ship It Pressure Scenarios

| Scenario | Required behavior |
| --- | --- |
| Local `pnpm verify` passed but CI is pending | Wait; local verification is not remote CI evidence. |
| Every visible check is green but a ruleset-required check is absent | Remediate or block; absence is not success. |
| GitHub says mergeable but the base advanced | Catch up, verify, push, and restart every head-bound gate. |
| A catch-up commit lands after approval and review | Treat approval, independent review, CI, and verification as stale until re-proven. |
| Independent deep-review covers an earlier head | Rebind affected acceptance to the current candidate; retain valid unaffected review with an explicit rationale. |
| A bot finding looks noisy | Validate it; suppress only evidence-backed noise, never by author type alone. |
| A Linear PR URL exists only in a comment | Add the structured backlink before merge. |
| A matching issue belongs to another Project | Fail closed; never adopt or update it from this repository. |
| `pr-shepherd` returns `NOOP` | Continue through the ship-it readiness evaluator; `NOOP` is not merge authority. |
| Independent review finds a defect | Fix with focused tests, push, refresh affected review and candidate verification; preserve valid unaffected evidence. |
| A thread is resolved without acceptance evidence | Reopen or re-audit it; thread state is not proof of correctness. |
| Admin can bypass protection while one check is pending | Never use admin merge; wait for the check and retain normal protected merge only. |
| Immediate merge is unavailable and auto-merge is supported | Block; deferred auto-merge cannot preserve this workflow’s final gate. |
| A prior executor left auto-merge enabled | Reconcile ownership and cancel the authorized PR’s deferred merge before continuing; never rely on it. |
| A safe fix requires unrelated product or security judgment | Stop with the exact decision needed; autonomy does not broaden scope. |
| Merge command succeeds | Re-read the PR and merge commit, verify production acceptance, then reconcile Nohmi issue completion truthfully. |
| Optional CodeRabbit review is pending or rate-limited | Do not wait for coverage; require independent acceptance, actual feedback dispositions and live GitHub checks. |
| Bot review is absent or skipped | Independent deep-review remains required; bot status never substitutes for acceptance. |
| An outdated, nonactionable thread remains open | Resolve with evidence; zero actionable findings alone is insufficient. |
| An older attempt failed and its evidenced rerun passed | Use the latest applicable attempt; preserve run/provider/trigger identity. |
| The latest rerun is pending while an older run passed | WAIT; historical success cannot clear the latest attempt. |
| Same-name checks lack supersession evidence | Keep ambiguous; do not arbitrarily choose the green one. |
| A required eligible approval is missing | WAIT; the PR author cannot manufacture approval. |
| Chat restarts after merge request times out | Read the pending checkpoint and GitHub; reconcile before retrying. |
| A second executor claims the same PR or merge base | Reject its claim; only the current owner may transfer after stopping its execution. |
| A transient retry fails without changed recovery evidence | Persist blocker and notify once; do not spin or weaken gates. |
| GitHub merged successfully but Linear is unavailable | Preserve merged evidence; finish any pending production acceptance and retry reconciliation without merging again. |
| Metadata edit reruns hosted CI without changing source | Reuse valid local verification, wait for current applicable hosted runs. |
| A factual explanation is needed during explicit ship-it | Post a bounded evidence-backed reply under inherited authority, without routine confirmation. |
| Scheduler creation has an uncertain response | Discover the existing schedule before retrying; saving a checkpoint is not scheduling. |
| A final gate fails after claiming the base | Reconcile pending merge state and release the base claim before waiting; reacquire for fresh final collection. |
| Another worktree owns full verification | Exit 75, checkpoint queued, and wait; do not start a competing suite. |
| Equivalent current-head CI passed after diagnosed local contention | Accept the documented equivalent stages and focused diagnosis; do not demand another duplicate full run. |
| Review finds a defect while final verification runs | Stop only the owned verifier before edits; retire its candidate and reverify the new candidate. |
| Description is edited during browser CI | Metadata gate refreshes and waits for source evidence; source workflow keeps running. |
| Active chat has an older policy version | Update/reload at a safe checkpoint and reconcile evidence before resuming. |
| Source CI succeeds on a same-head retry but CI required is still failed | Rerun the failed metadata workflow once, record both attempts, and wait for the fresh result; do not edit unrelated metadata to trigger it. |

| Merge is confirmed but production still serves the old revision | Keep ownership and WAIT; merged is not shipped. |
| Deployed descendant contains the merge but reverted the behavior | BLOCK production acceptance; ancestry alone is insufficient. |
| A model supplies only a passed self-review boolean | BLOCK merge acceptance until independent, current policy/standard evidence exists. |
| A migration exception has expired or was approved by its implementer | BLOCK the affected requirement; never relabel it pass. |
| Production criterion was removed after merge | Reconcile against the independently reviewed plan; do not accept the smaller inventory. |
| A worker is told ship it | Prepare handoff to its authorized orchestrator; never acquire merge authority. |
