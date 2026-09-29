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
| Admin can bypass protection while one check is pending | Do not merge; admin changes only the final mechanism after all gates pass. |
| Immediate merge is unavailable and auto-merge is supported | Enable squash auto-merge only after readiness passes, then monitor it. |
| Auto-merge was enabled and the head changes | Re-audit the new head; disable/cancel when the previous authorization no longer applies. |
| A safe fix requires unrelated product or security judgment | Stop with the exact decision needed; autonomy does not broaden scope. |
| Merge command succeeds | Re-read the PR and merge commit, then reconcile Nohmi issue completion truthfully. |
