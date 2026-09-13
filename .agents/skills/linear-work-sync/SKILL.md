---
name: linear-work-sync
description: Use when explicitly syncing Nohmi work to Linear from a PR, branch, current task, git changes, issue links, status changes, or coverage audit.
---

# Nohmi Linear Work Sync

Sync concrete Nohmi work to Linear in one auditable pass.

## Boundaries

- Read `linear-context` and its workspace conventions before using Linear.
- This repository is hard-routed to the unique live `Nohmi` Project. Resolve it before every write.
  If it is missing or ambiguous, make no repository-derived Linear mutations.
- Linear mutation requires explicit user authority or a calling skill that clearly grants a bounded
  write scope. The repository `create-pr` skill grants PR-scoped authority to match or create direct
  Nohmi issues, update their active status, add the resulting structured PR links, add material
  progress comments, and audit those writes unless the user explicitly skips Linear. A request to
  inspect a branch or PR alone remains read-only.
- Prefer a confident existing issue. Create only concrete, durable work with no confident match.
- Preserve existing owner, priority, project, and cycle unless evidence clearly supports a change.
- Create repository issues directly in `Nohmi` and update only issues already assigned to `Nohmi`.
  Never update another Project or an unprojected issue from repository evidence. Similar wording is
  a cross-project collision, not a match.
- Sanitize evidence before comments or audit records. Exclude private reasoning, credentials, PII,
  restricted URLs, and unnecessary source text.
- Comment only for issue creation or a material outcome, blocker, scope, review, or completion change.
  Record metadata-only updates in the audit without adding comment noise.
- Append one JSON object per attempted write to `.context/linear-work-sync/YYYY-MM-DD.jsonl`.

## Workflow

1. Resolve live workspace, team, current user, statuses, labels, projects, project milestones, and
   cycles relevant to the request. Paginate all list queries. Require exactly one live, non-archived
   `Nohmi` Project before a repository-derived write. Resolve milestones within that Project when a
   matched issue or PR Work map names one; absence is valid and does not authorize creating one.
2. Gather the narrowest reliable source evidence: exact issue key/URL, PR URL/number, branch, commit
   titles, changed behavior, affected domain, verification, and relevant current docs.
3. Search in confidence order: exact issue key/URL, existing PR URL, PR number plus branch, branch,
   then distinctive outcome nouns and active issues. Accept only issues in the `Nohmi` Project as
   repository matches. Report other-project and unprojected collisions without writing. Search
   completed work only when checking history or duplicates.
4. Group changes by independently shippable outcome, not file. If more than 10 issues are proposed
   or grouping is ambiguous, return a plan and ask before creating anything.
5. Build a write plan containing source, action, issue/proposed title, confidence, assignee, status,
   required `Nohmi` Project, existing milestone when present, type label, optional cycle, links, and
   proposed comment.
6. Choose the least advanced live status supported by evidence. Use one best-supported live type
   label (`Bug`, `Feature`, or `Improvement`) and one primary live `Area` leaf according to the
   workspace conventions. Do not create missing taxonomy.
7. Execute only high-confidence Nohmi rows. Create new issues directly in the resolved `Nohmi`
   Project and use the template in the workspace conventions. Assign Cooper only when live identity
   resolution is unambiguous.
8. For a PR creation or refinement flow, synchronize in two phases:
   - Before the PR exists, resolve or create direct issues, place active work in the least advanced
     compatible live status, and return exact issue keys/URLs for the branch and Work map.
   - After GitHub returns the PR URL, add a structured Linear link or attachment to every direct
     issue. The structured link is the canonical backlink; a URL mentioned only in a comment or
     description does not satisfy this requirement.
9. Add one concise comment only when it passes the material-update gate. Opening a PR merits a
   comment only when the comment records material scope, verification, progress, or a blocker not
   already clear from structured metadata. Then append a sanitized audit row recording success,
   failure, or skip.
10. Re-read the PR Work map and every direct issue after the post-PR phase. Report any disagreement
    in project, milestone, issue coverage, structured PR link, branch identity, or status.

## Match Confidence

| Confidence | Evidence | Action |
| --- | --- | --- |
| High | Exact key/URL; PR URL already linked; PR number plus matching branch and intent; or one unique active Nohmi issue whose outcome, Area, acceptance signal, and diff evidence all match with no conflicting candidate | update |
| Medium | Same owner plus distinctive outcome and repository area, but incomplete acceptance or diff evidence | ask, or skip unattended |
| Low | Generic vocabulary, same app area only, or stale completed issue | skip |
| Denied | Issue belongs to another Project or no Project | skip and report isolation collision |

Never merge separate shippable concerns into one issue merely because they touch the same feature.

## Status Mapping

| Evidence | Current Nohmi status |
| --- | --- |
| Planned, future intent | `Backlog` or `Todo` |
| Active implementation, branch, or open PR | `In Progress` |
| Acceptance met and merged, shipped, or explicitly completed | `Done` |
| Deliberately abandoned | `Canceled` |
| Confirmed duplicate | `Duplicate` |

Live metadata wins if the workspace changes. When evidence conflicts, choose the earliest definitely
true state.

## Source Modes

- Current conversation/task: use the user's request and work actually completed in this task.
- PR or branch inspection: read [references/change-list.md](references/change-list.md); remain
  read-only unless the user or calling workflow grants writes.
- PR creation or material refinement through `create-pr`: run both synchronization phases and
  return the exact links needed by the PR body and Linear issues.
- Batch change list: use the same reference and keep the proposed batch small.

## Output

```markdown
| Work | Project / milestone | Linear | PR link | Status | Action |
| --- | --- | --- | --- | --- | --- |
| <title> | Nohmi / <milestone or —> | <issue key/link> | linked | In Progress | updated |
```

Include skipped ambiguities, tool failures, and the audit path. Do not claim a write that did not
succeed.
