---
name: linear-context
description: Use when working with Nohmi Linear issues, projects, cycles, PR links, labels, statuses, comments, or Linear read/write tools.
---

# Nohmi Linear Context

Use Linear as Nohmi's live work tracker and this repository's current documentation and code as the
source of truth for product and implementation details. Before reading or updating Linear, read
[references/workspace-conventions.md](references/workspace-conventions.md).

For PR- or branch-linked work, also read `docs/engineering/pr-rubric.md`,
`docs/engineering/work-context.md`, and the nearest current product or architecture document.
Linear should link to durable context rather than duplicate it.

## Operating Rules

- Read Linear first for work state, ownership, priority, status, and issue/PR coverage.
- Treat this repository as Nohmi-only. Repository-scoped reads filter to the unique live `Nohmi`
  Project, and repository-derived writes may not target another Project or an unprojected issue.
- Resolve teams, statuses, labels, users, projects, and cycles with live Linear tools. Never guess
  identifiers or assume the checked-in snapshot is current.
- Prefer a confident existing issue over a duplicate. If multiple issues plausibly match, report the
  ambiguity and do not write.
- Linear reads are allowed for an in-scope request. Creating, assigning, relabeling, moving, or
  commenting requires explicit user authority or a calling skill with an explicit, bounded grant.
- Preserve the current human assignee unless the user requests a change. Do not assign work to an
  agent account merely because an agent performs the implementation.
- The five portfolio Projects are ongoing containers. Every repository issue must belong to the
  unique live `Nohmi` Project. A missing or ambiguous Nohmi Project blocks repository-derived writes.
  Cycles remain optional.
- For write runs, append a sanitized audit record under `.context/linear-*` containing the source,
  issue IDs, changes, skipped ambiguities, and tool failures.
