# Nohmi Linear Workspace Conventions

This is a checked-in policy snapshot, not live metadata. Prefer live Linear results whenever they
differ.

## Current Snapshot

- Workspace: `Cooper Sullivan` (`https://linear.app/coopersully`)
- Team: `Cooper Sullivan`
- Human owner: `Cooper Sullivan`
- Statuses: `Backlog`, `Todo`, `In Progress`, `Done`, `Canceled`, `Duplicate`
- Type labels: `Bug`, `Feature`, `Improvement`
- Area label group: `Area`
- Area leaves: `Desktop`, `Mobile`, `Platform`, `Integration`, `Workspace/Today`,
  `Workspace/Finance`, `Workspace/Mail`, `Workspace/Calendar`, `Workspace/Tasks`
- Projects: `Nohmi`, `Cooper Sullivan Games`, `Notepad++ for Mac`, `Portfolio`, `Upper Thought`
- Cycles: none configured as of 2026-09-09

Do not hardcode UUIDs. Resolve every identifier through live tools before a write. Issue examples in
these skills use the workspace key form `COO-123`; examples are placeholders, not lookup evidence.

## Portfolio Model

Keep the single `Cooper Sullivan` team and use the five ongoing Projects as the top-level work
containers. Every issue belongs to exactly one of those Projects. The existing `Bug`, `Feature`, and
`Improvement` labels classify work type. Nohmi issues also carry one leaf from the `Area` group to
identify the primary owning surface; do not duplicate Project identity with product labels.

Use project views and issue filters for portfolio navigation. Initiatives are optional and should be
introduced only for a broader objective that intentionally spans Projects. Cycles are optional; if
enabled, one shared team cycle can represent Cooper's near-term commitments across Projects.

## Repository Isolation

This repository is permanently mapped to the exact live Project named `Nohmi`.

- Repository evidence includes this checkout, `coopersully/personal-os`, its branches, commits,
  pull requests, docs, and Codex task history.
- Before any repository-derived Linear write, resolve exactly one live, non-archived `Nohmi`
  Project. Never hardcode its UUID.
- Create repository issues directly in `Nohmi`. Update only issues whose live Project is `Nohmi`.
- Do not update an issue assigned to another Project or no Project, even when its title resembles
  the repository work. Report the collision and continue without mutation.
- Do not use the GitHub `{TEAM}-NEW` magic word: it creates into the shared team before the Nohmi
  Project boundary can be guaranteed. Create and validate an issue in `Nohmi` first, then use its
  existing key in the branch or PR.
- Workspace-wide read-only portfolio requests may inspect other products. Repository-scoped task,
  bug, sprint, sync, and janitor workflows return only issues in the `Nohmi` Project.

## Source-of-Truth Model

| Concept | Source |
| --- | --- |
| Work state, owner, priority, and queue | Linear issue |
| Product scope and acceptance criteria | `docs/product/` |
| Architecture and engineering constraints | `docs/architecture/` and `docs/engineering/` |
| Implementation truth | Current repository and GitHub PR |
| Material progress or blocker | Concise Linear comment |

## Pull Request Linking Contract

- Before opening a repository PR, resolve or create every direct issue in the live `Nohmi` Project.
  Search for duplicates first. Never use `{TEAM}-NEW`.
- Put the primary issue key in a new branch name when possible, for example
  `cooper/coo-123-short-description`. When one PR advances several issues, use one primary key in the
  branch and link every direct issue in the PR Work map.
- The PR Work map links the live Nohmi Project, each direct issue, the live milestone when present,
  and current source-of-truth documentation. It describes how the PR advances each item.
- After the PR URL exists, add it to every direct issue using Linear's structured link or attachment
  field. A URL mentioned only in a comment or description is not a complete backlink.
- Keep open or draft PR work `In Progress` while the live workspace has no review-specific status.
  Do not create a status to imitate another workspace.
- Add at most one concise comment per issue when the PR opening records a material scope,
  verification, progress, or blocker event. Metadata-only linking belongs only in the audit ledger.
- Before handoff, re-read both systems and verify that project, milestone, task coverage, branch,
  structured backlinks, and status agree.
- A branch created for the work should use the primary key. Do not rewrite the history of an
  existing pushed branch merely to add it; record that exception and rely on the exact Work map and
  structured backlinks for traceability.

## Live Lookup Rules

- Call `get_workspace`, `list_teams`, and `get_user("me")` to establish scope and identity.
- Call `list_issue_statuses` and map by status category before exact name.
- Call `list_issue_labels`; resolve one live type label and one live `Area` leaf for Nohmi issue
  writes. Never create or repair taxonomy unless the user explicitly requests it.
- Call `list_projects` before repository-scoped reads or writes and resolve one exact, non-archived
  Project named `Nohmi`.
- Resolve live project milestones when a matched issue or PR Work map has one. Preserve the existing
  milestone, omit it when absent, and never create or guess one as part of routine work sync.
- Call `list_cycles` only when scheduling or cycle reporting is relevant. No cycle is a valid current
  state.
- Paginate list operations until Linear reports no next cursor.

## Status Mapping

Use live names. Choose the least advanced state definitely supported by evidence.

| Evidence | Preferred current status/category |
| --- | --- |
| Planned or not started | `Backlog` or `Todo` |
| Active implementation or branch work | `In Progress` |
| PR open or awaiting review | `In Progress` unless a live review status is added |
| Acceptance criteria met, merged, shipped, or explicitly completed | `Done` |
| Deliberately abandoned | `Canceled` |
| Confirmed duplicate | `Duplicate` |

Never infer completion from plans, future-tense wording, or “should be fixed.” For release-specific
work, require the release signal; otherwise a merged PR plus passing required verification can be
completion evidence.

## Labels and Placement

- Use exactly one best-supported type label: `Bug`, `Feature`, or `Improvement`, subject to live
  availability.
- Use exactly one primary `Area` leaf on every Nohmi issue:
  - `Desktop` for the native desktop app, packaging, installers, and desktop-only behavior.
  - `Mobile` for the native mobile shell, mobile-only infrastructure, and mobile release work.
  - `Platform` for shared application infrastructure, operations, security, and repository maintenance.
  - `Integration` for cross-workspace behavior and agent-guided orchestration.
  - `Workspace/Today`, `Workspace/Finance`, `Workspace/Mail`, `Workspace/Calendar`, or
    `Workspace/Tasks` for behavior primarily owned by that product workspace. Reminders belong to
    `Workspace/Tasks` while retaining their distinct domain semantics.
- When several areas are affected, label the issue by the surface that owns the outcome and express
  other involvement with issue relations or sub-issues. If ownership is genuinely ambiguous, do not
  guess; leave the issue unchanged and report the ambiguity.
- Prefer Linear's native priority field over priority labels.
- Every repository issue belongs to `Nohmi`; never create or update repository work in a different
  or missing Project. Do not invent a cycle.

## Comment Voice

Write like a teammate: lead with the meaningful change, include only the constraint or decision a
person needs, and add a verifiable PR, branch, or doc link when available. One material event gets at
most one comment per issue.

Do not comment for reads, duplicate searches, or metadata-only repairs. Never paste transcripts,
private reasoning, secrets, credentials, PII, local-only URLs, or restricted source payloads.

## Issue Creation Template

```markdown
## Outcome
<What should be true when this is done.>

## Context
- Source: <stable link or concise sanitized origin>
- Relevant docs: <only the files needed to act or review>
- Constraints/non-goals: <only material boundaries>

## Verification
- <observable acceptance signal>
```

Create one issue per independently shippable concern, not per file or implementation step.
