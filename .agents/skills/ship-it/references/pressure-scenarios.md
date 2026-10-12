# Ship It Pressure Scenarios

| Scenario | Required behavior |
| --- | --- |
| Local `pnpm verify` passed but CI is pending | Wait; local verification is not remote CI evidence. |
| Every visible check is green but a ruleset-required check is absent | Remediate or block; absence is not success. |
| GitHub says mergeable but the base advanced | Catch up, verify, push, and restart every head-bound gate. |
| A catch-up commit lands after approval and review | Treat approval, review, CI, CodeRabbit, and verification as stale until re-proven. |
| CodeRabbit reviewed an earlier head | Request or wait for current-diff evidence and re-audit its open findings. |
| A bot finding looks noisy | Validate it; suppress only evidence-backed noise, never by author type alone. |
| A Linear PR URL exists only in a comment | Add the structured backlink before merge. |
| A matching issue belongs to another Project | Fail closed; never adopt or update it from this repository. |
| `pr-shepherd` returns `NOOP` | Continue through the ship-it readiness evaluator; `NOOP` is not merge authority. |
| Independent review finds a defect | Fix with tests, push, and restart the complete gate set. |
| A thread is resolved without acceptance evidence | Reopen or re-audit it; thread state is not proof of correctness. |
| Admin can bypass protection while one check is pending | Never use admin merge; wait for the check and retain normal protected merge only. |
| Immediate merge is unavailable and auto-merge is supported | Block; deferred auto-merge cannot preserve this workflow’s final gate. |
| A prior executor left auto-merge enabled | Reconcile ownership and cancel the authorized PR’s deferred merge before continuing; never rely on it. |
| A safe fix requires unrelated product or security judgment | Stop with the exact decision needed; autonomy does not broaden scope. |
| Merge command succeeds | Re-read the PR and merge commit, then reconcile Nohmi issue completion truthfully. |
| Pending CodeRabbit has not established coverage | WAIT; do not treat pending coverage as a terminal blocker. |
| CodeRabbit reports an unknown or skipped status | Reject readiness; require substantive successful coverage. |
| An outdated, nonactionable thread remains open | Resolve with evidence; zero actionable findings alone is insufficient. |
| An older attempt failed and its evidenced rerun passed | Use the latest applicable attempt; preserve run/provider/trigger identity. |
| The latest rerun is pending while an older run passed | WAIT; historical success cannot clear the latest attempt. |
| Same-name checks lack supersession evidence | Keep ambiguous; do not arbitrarily choose the green one. |
| A required eligible approval is missing | WAIT; the PR author cannot manufacture approval. |
| Chat restarts after merge request times out | Read the pending checkpoint and GitHub; reconcile before retrying. |
| A second executor claims the same PR or merge base | Reject its claim; only the current owner may transfer after stopping its execution. |
| A transient retry fails without changed recovery evidence | Persist blocker and notify once; do not spin or weaken gates. |
| GitHub merged successfully but Linear is unavailable | Preserve merged evidence and retry reconciliation only. |
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
