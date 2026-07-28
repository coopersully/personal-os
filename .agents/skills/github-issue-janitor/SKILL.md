---
name: github-issue-janitor
description: Audit ilo GitHub issue and pull request hygiene, including missing links, stale open issues, merged work, duplicate candidates, branch evidence, milestones, assignees, and labels. Use for a bounded GitHub work-tracking cleanup or scheduled hygiene pass.
---

# GitHub issue janitor

Run one bounded reconciliation pass. Interactive runs are dry-run by default and require
`c` or `confirm` before GitHub writes.

## Boundaries

- Read `../github-work-context/SKILL.md` and `../github-work-sync/SKILL.md`.
- Inspect open issues, issues updated in the last 30 days, open PRs, and recently merged PRs unless
  the user supplies a narrower scope.
- Paginate to complete the chosen scope.
- Do not create issues, labels, milestones, Projects, branches, or PRs.
- Do not change issue scope, ownership, milestone, or Project placement.
- Never close solely because an issue is old.
- Do not post PR comments.

## Workflow

1. Resolve live repository metadata and branch protection.
2. For each candidate issue, gather explicit PR references, closing references, branch names,
   acceptance criteria, labels, assignee, milestone, comments, and recent events.
3. For each candidate PR, gather issue relationships, state, draft state, checks, reviews, merged
   date, base/head, and branch existence.
4. Classify only from evidence:

| Evidence | Proposed action |
| --- | --- |
| Open issue, unique merged PR with a true completing relationship, acceptance satisfied | close issue |
| Open issue, unique open PR clearly implementing it, no link | add one concise issue comment with the PR link or propose a PR body relationship |
| PR body says `Closes` but the PR only makes partial progress | change to `Refs` |
| Closed issue, completing PR still open or acceptance visibly incomplete | needs review; never reopen automatically |
| Exact duplicate with a clear canonical issue | propose duplicate label/closure; require confirmation |
| Multiple plausible PRs/issues, deleted branch, stale closed PR, or conflicting scope | needs review; no write |

5. Produce a dry-run plan with artifact links, evidence, confidence, proposed action, and reason.
6. After confirmation, apply only the listed high-confidence actions and re-read their state.
7. Append the plan/result to `.context/github-issue-janitor/YYYY-MM-DD.jsonl`.

Use existing labels only. Treat issue closure, duplicate classification, and PR relationship edits
as human-significant even when confidence is high; never apply them in an interactive run without
confirmation.

## Output

```markdown
| Issue/PR | Evidence | Proposed action | Confidence |
| --- | --- | --- | --- |
| [#123](url) | [PR #456](url) merged and acceptance complete | close | high |
```

List needs-review items and the audit path. Ask for `c` or `confirm` only when the plan contains
post-ready writes.
