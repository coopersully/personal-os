---
name: sprint
description: Use when Cooper asks about a Nohmi Linear cycle or sprint, cycle progress, active-cycle issues, owners, estimates, or completion.
---

# Cycle Overview

Show the current Linear cycle and its issues. Nohmi currently has no configured cycle, so an empty
live result is normal and must not be replaced with stale or invented data.

1. Read `linear-context` and its workspace conventions.
2. Resolve live teams, cycles, statuses, the unique live `Nohmi` Project, and issues; paginate issue
   results to completion.
3. Prefer the active cycle for the relevant team. If no active cycle exists, report `No current
   Linear cycle exists` and stop. Put optional recent-cycle information under `Stale context`.
4. When a cycle exists, fetch only issues in `Nohmi` with assignee, status, priority, labels,
   estimate, and PR links where available. Prefer Linear's structured PR links and clearly label a
   source fallback when no structured backlink exists. Exclude all other Projects.
5. Use only live status names and categories.

If the `Nohmi` Project is missing or ambiguous, report the configuration gap instead of showing a
cross-Project cycle summary.

```markdown
## Cycle: <name>
Team: <team>
Timeline: <start> → <end>

### Progress
- Total issues: X
- Completed: Y / X (Z%; use N/A when X is 0)
- Started: ...
- Estimate: ...

### Issues by Assignee
| Assignee | Issue | Status | Priority | Estimate | Project | PR |
| --- | --- | --- | --- | --- | --- | --- |
```

Sort active work first, then unstarted, then completed.
