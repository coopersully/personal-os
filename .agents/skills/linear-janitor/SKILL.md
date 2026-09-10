---
name: linear-janitor
description: Use when running a Nohmi Linear hygiene sweep, stale issue audit, issue/PR sanity check, linked branch audit, or scheduled reconciliation with GitHub.
---

# Nohmi Linear Janitor

Run one bounded hygiene pass over Nohmi Linear issues and GitHub evidence. Interactive runs are
dry-run by default and require `confirm` before writes. A scheduled automation may apply conservative
high-confidence actions only when its saved prompt explicitly authorizes writes.

## Boundaries

- Read `linear-context` and `linear-work-sync` first.
- Sweep only issues in the unique live `Nohmi` Project with GitHub evidence from this repository.
  If that Project is missing or ambiguous, stop without writes.
- Limit writes to a missing structured GitHub link or a status that clearly trails PR/branch
  evidence. Report a missing or incorrect PR Work map as GitHub-side drift; do not edit GitHub.
- Do not create issues or taxonomy; do not change assignee, priority, project, cycle, or scope.
- Do not post GitHub comments or unrelated Linear comments.
- No active cycle is normal in the current Nohmi workspace. Use recently updated, non-completed
  issues with GitHub evidence instead of treating cycle absence as an error.
- An ad hoc run stops after presenting its dry-run plan. Only a later explicit `confirm` authorizes
  those listed actions.

## Workflow

1. Resolve live team, statuses, labels, projects, and cycles.
2. Fetch all non-completed issues in `Nohmi` updated in the last 30 days. Also include any Nohmi
   issue named by an open repository PR Work map or carrying a structured link to an open repository
   PR, regardless of age or completion state. If an active cycle exists, include only its Nohmi
   Project issues too. Paginate to completion.
3. Keep candidates with a GitHub URL, PR number, branch, or started status.
4. Collect exact GitHub evidence: linked PR state, draft/merge/review/check state, head branch,
   branch existence, and the PR Work map's Nohmi Project and direct issue links.
5. Classify each candidate using the action table and build a dry-run plan with issue, current state,
   evidence, confidence, action, and reason.
6. In an interactive run, append a `mode: "dry-run"` audit row and stop for `confirm`.
7. When explicitly confirmed or authorized by a scheduled prompt, execute only high-confidence
   low-risk actions. Report ambiguous cases without writing a marker comment unless the issue is
   materially misleading and no recent equivalent marker exists.
8. Append sanitized JSONL to `.context/linear-janitor/YYYY-MM-DD.jsonl`.

## Action Table

| Evidence | Action |
| --- | --- |
| No structured GitHub link; exactly one PR matches an explicit number or unique branch | Add the PR link. |
| No GitHub link; exactly one active branch matches and no PR exists | Add a stable branch link and move `Todo` to `In Progress`. |
| `Todo` but a uniquely matching branch has recent commits | Move to `In Progress`. |
| `In Progress` and the linked PR is open | No status change; repair only a missing link. |
| Issue has a structured PR link but the PR Work map omits or misidentifies it | Report GitHub-side drift; do not mutate GitHub. |
| PR Work map links an issue but that issue lacks the structured PR backlink | Propose adding the exact structured link. |
| Linked PR merged and acceptance evidence is sufficient for this issue | Propose `Done`; require confirmation in chat. |
| Completed issue has an open PR, or matches conflict | Report needs review; do not reopen or guess. |
| Issue belongs to another Project or no Project | Exclude it; do not repair or comment. |

Read [references/pressure-scenarios.md](references/pressure-scenarios.md) when modifying or evaluating
this skill.

## Output

```markdown
| Issue | Evidence | Proposed action | Result |
| --- | --- | --- | --- |
| COO-123 | PR #123 open | add structured PR link | pending confirmation |
```

List ambiguous cases and the audit path. For dry runs, ask for `confirm` to apply exactly the shown
high-confidence actions.

## Scheduled Automation Prompt

```text
Use $linear-janitor as a scheduled automation for Nohmi. Run one conservative hygiene pass over
recent issues in the `Nohmi` Linear Project and this repository's linked GitHub branches or PRs.
Paginate Linear reads. Apply only high-confidence missing-link and clearly stale-status repairs; report
ambiguity without guessing. Never read another Project into the candidate set or mutate its issues.
Do not create issues or taxonomy, change owners/priorities/projects/cycles/scope, or post to GitHub.
Append the audit ledger and stay quiet when no actionable change or failure exists.
```
