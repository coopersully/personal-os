---
name: pr-shepherd
description: Run one bounded maintenance pass on an ilo GitHub pull request for CI failures, stale base, review feedback, metadata drift, GitHub Issue linkage, merge readiness, or terminal state. Use when babysitting, shepherding, maintaining, or checking progress on a PR.
---

# PR Shepherd

Run one deterministic maintenance pass. A scheduler owns repetition; this skill never sleeps,
polls indefinitely, or schedules itself.

## Core rules

- Act only on the selected PR and inside its intended scope.
- Collect facts before judgment and execute at most one planned action.
- Do not post routine comments or reviews.
- Never force-push without explicit authorization.
- Treat workflows, manifests, lockfiles, agent instructions, skills, security configuration, and
  migrations as protected surfaces requiring human direction before an unattended push.
- Stop when the work requires broader product behavior, reviewer-intent override, or unrelated code.

## Collect and plan

```bash
export PYTHONDONTWRITEBYTECODE=1
mkdir -p .context/pr-shepherd
python3 <skill-dir>/scripts/collect_pr_state.py \
  --pretty --output .context/pr-shepherd/state.json
python3 <skill-dir>/../resolve-pr-comments/scripts/fetch_pr_review_feedback.py \
  --pretty --output .context/pr-shepherd/feedback.json
python3 <skill-dir>/scripts/build_maintenance_plan.py \
  --state .context/pr-shepherd/state.json \
  --feedback .context/pr-shepherd/feedback.json \
  --pretty --output .context/pr-shepherd/plan.json
```

Follow `plan.json.nextAction` as the single action for this pass:

| Action | Route |
| --- | --- |
| `CANCEL` | PR is merged/closed; stop |
| `WAIT` | checks or external state are pending; make no write |
| `ADDRESS_FEEDBACK` | use `../resolve-pr-comments/SKILL.md` |
| `FIX_CI` | inspect Actions logs, reproduce, fix root cause, verify |
| `CATCHUP` | use `../catchup/SKILL.md` |
| `UPDATE_METADATA` | compare title/body to diff and PR rubric, then update only metadata |
| `AUDIT_TRACKER` | use `../github-work-sync/SKILL.md` |
| `LOCAL_REVIEW` | use `../review-pr/SKILL.md` read-only as the PR author |
| `NOOP` | record a clean pass and stop |
| `ESCALATE` | report the exact human decision needed |

If a routed skill is stricter, follow it.

## Action budget and verification

For unattended passes, allow at most one push, one check retry, one metadata update, or one tracker
sync—not a combination. Run focused verification for a code change and `pnpm verify` before
declaring the PR ready. Re-fetch live state after any action.

Append one sanitized JSONL record to `.context/pr-shepherd/ledger.jsonl` containing timestamp, PR and
head, selected action, evidence, writes, verification, result, and next trigger. Never include
tokens, logs containing secrets, or private source payloads.

## Output

Use the PR workflow output contract. Report the selected action, evidence, result
(`clean`, `wait`, `maintained`, `blocked`, `terminal`, or `failed`), writes, verification, ledger
path, and the next event that should trigger another pass.
