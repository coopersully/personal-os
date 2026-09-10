---
name: my-tasks
description: Use when Cooper asks to view assigned Nohmi Linear issues, current work, backlog work, or issues filtered by status.
---

# My Tasks

Show the current user's assigned Nohmi Linear issues.

1. Read `linear-context` and its workspace conventions.
2. Resolve the current user, team, statuses, and unique live `Nohmi` Project from Linear metadata.
3. Fetch only assigned issues in `Nohmi` with status, priority, labels, cycle, and PR links when
   available; paginate to completion. Prefer Linear's structured PR links. Clearly label a source
   fallback when no structured backlink exists; never present the two as equivalent. Never mix other
   Projects into this repository's task view.
4. Treat `$ARGUMENTS` as an optional live status name or category. If invalid, list the valid values.
5. Without a filter, exclude completed, canceled, and duplicate issues unless requested.

Group by status and show a concise table:

```markdown
| Issue | Status | Priority | Labels | Project | Cycle | PR |
| --- | --- | --- | --- | --- | --- | --- |
| COO-123 Improve reminder capture | In Progress | High | Improvement | Nohmi | — | [#123](<url>) |

**Total**: 1 issue
```

Use `—` for optional metadata that is not configured. If no issues match, say so clearly.
If the `Nohmi` Project is missing or ambiguous, report the configuration gap instead of returning a
workspace-wide task list.
