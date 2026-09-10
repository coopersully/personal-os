---
name: bugs
description: Use when Cooper asks about Nohmi Linear bugs, open defects, bug priority, bug status, linked issue coverage, or bug triage.
---

# Bugs

Show Nohmi bug issues from Linear.

1. Read `linear-context` and its workspace conventions.
2. Resolve live teams, statuses, labels, and the unique live `Nohmi` Project; fetch only its issues
   and paginate to completion.
3. Prefer the live `Bug` label. Use title or description evidence only as a clearly identified
   fallback when an issue lacks a type label.
4. Treat `$ARGUMENTS` as an optional live status name or category.
5. Without a filter, exclude completed, canceled, and duplicate issues.

Exclude every issue assigned to another Project or no Project. If `Nohmi` is missing or ambiguous,
report that gap rather than falling back to workspace-wide bugs.

Report counts by status, then a table:

```markdown
| Issue | Status | Priority | Assignee | Project | PR / source |
| --- | --- | --- | --- | --- | --- |
```

Show every linked PR as an inline link. Use the source fallback only when no structured PR link is
available; do not imply a source URL is a complete Linear backlink.

Sort by native priority (`Urgent`, `High`, `Medium`, `Low`, `No priority`), then oldest first.

For requested updates, validate the exact issue and every new field against live metadata. Never
create labels or statuses unless the user explicitly asks to change Linear taxonomy.
