---
name: my-issues
description: Use when explicitly viewing the authenticated user's legacy nohmi GitHub issues or their linked pull requests.
---

# My issues

Show the authenticated user's legacy GitHub issue queue without changing it. Use `my-tasks` for the
canonical Nohmi Linear work queue.

## Workflow

1. Read `../github-work-context/SKILL.md`.
2. Resolve the current repository and authenticated GitHub login.
3. Query open issues assigned to the user and open issues authored by the user. Exclude pull
   requests and deduplicate results.
4. Apply a supplied filter only after validating live labels, milestones, and supported states.
5. For each issue, inspect linked open or merged PRs when available.
6. Derive a display-only delivery signal:
   - `in review`: linked non-draft open PR;
   - `draft PR`: linked draft PR;
   - `merged`: linked completing PR merged but issue remains open;
   - `active branch`: unique linked branch with no PR;
   - `planned`: no active code evidence.

Do not write a status label or Project field from this derived signal.

## Output

Group `in review`, `draft PR`, `active`, then `planned`:

```markdown
| Issue | Signal | Labels | Milestone | Pull request | Updated |
| --- | --- | --- | --- | --- | --- |
| [#123 Title](url) | in review | enhancement | — | [#456](url) | 2026-07-27 |
```

End with the unique issue count and state that Linear remains authoritative for current delivery
status. If no issues match, say so clearly.
