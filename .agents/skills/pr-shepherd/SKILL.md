---
name: pr-shepherd
description: Use when babysitting, shepherding, maintaining, or checking a nohmi pull request for CI, stale base, feedback, metadata, Linear linkage, or merge readiness.
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
- Read `AGENTS.md`, `docs/engineering/pr-rubric.md`, `../linear-context/SKILL.md`, and
  `../linear-work-sync/SKILL.md` before tracker judgment or mutation.

## Collect and plan

```bash
export PYTHONDONTWRITEBYTECODE=1
mkdir -p .context/pr-shepherd
python3 <skill-dir>/scripts/collect_pr_state.py \
  --pretty --output .context/pr-shepherd/state.json
python3 <skill-dir>/../resolve-pr-comments/scripts/fetch_pr_review_feedback.py \
  --pretty --output .context/pr-shepherd/feedback.json
```

Before planning, resolve every issue key in the `## Work map` through live Linear. Confirm that each
issue belongs to the unique live `Nohmi` Project, has a structured backlink to this exact PR, and has
a status compatible with the PR state. Then replace `state.json.linearCoverage` with sanitized
evidence only:

```json
{
  "verified": true,
  "project": "Nohmi",
  "directIssueKeys": ["COO-123"],
  "structuredBacklinksComplete": true,
  "statusesCompatible": true
}
```

Leave `verified` false when Linear is unavailable, pagination is incomplete, any identity is
ambiguous, an issue belongs to another Project, or reciprocal coverage is missing. The planner must
select `AUDIT_TRACKER` in those cases.

```bash
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
| `AUDIT_TRACKER` | use `../linear-work-sync/SKILL.md` for the Nohmi Work map, structured backlink, and status |
| `LOCAL_REVIEW` | use `../review-pr/SKILL.md` read-only as the PR author |
| `NOOP` | record a clean pass and stop |
| `ESCALATE` | report the exact human decision needed |

If a routed skill is stricter, follow it.

## Action budget and verification

For unattended passes, allow at most one push, one check retry, one metadata update, or one Linear
sync—not a combination. The selected tracker action grants only high-confidence PR-scoped repair on
issues already in the live Nohmi Project; it does not grant cross-Project or GitHub issue writes.
Run focused verification for a code change and `pnpm verify` before declaring the PR ready. Re-fetch
live GitHub and Linear state after any action.

Append one sanitized JSONL record to `.context/pr-shepherd/ledger.jsonl` containing timestamp, PR and
head, selected action, evidence, writes, verification, result, and next trigger. Never include
tokens, logs containing secrets, or private source payloads.

## Output

Use the PR workflow output contract. Report the selected action, evidence, result
(`clean`, `wait`, `maintained`, `blocked`, `terminal`, or `failed`), writes, verification, ledger
path, Nohmi Linear coverage/audit path, and the next event that should trigger another pass.
