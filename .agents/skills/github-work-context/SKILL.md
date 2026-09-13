---
name: github-work-context
description: Use when explicitly inspecting, migrating, or annotating legacy nohmi GitHub issues or their pull-request relationships.
---

# GitHub work context

Use GitHub Issues only as historical or source evidence. The live `Nohmi` Linear Project is this
repository's delivery graph, and current repository docs are durable product and engineering truth.
Read `../linear-context/SKILL.md` before relating GitHub evidence to current work.

## Resolve live context

1. Resolve the repository from the local checkout or supplied URL.
2. Read live issues, labels, milestones, assignees, PR state, and branch protection before relying
   on a remembered name or workflow.
3. Use a milestone or GitHub Project only when it already exists and the source confidently places
   the work there. Do not create planning structure merely to fill a field.
4. Never guess issue numbers, node IDs, labels, milestone numbers, assignees, Project fields, or PR
   relationships.

Prefer the connected GitHub app for issue, PR, comment, label, and relationship reads/writes. Use
local `git` and `gh` for current-branch discovery, branch/commit/push work, Actions logs, GraphQL
surfaces the connector does not expose, and other documented gaps.

## Source-of-truth model

| Concept | Source |
| --- | --- |
| Product scope and acceptance | current files under `docs/product` |
| Architecture and engineering rules | current files under `docs/architecture` and `docs/engineering` |
| Independently shippable delivery work | Nohmi Linear issue |
| Time-bound release or outcome | Nohmi Linear milestone, when used |
| Historical request or source evidence | GitHub issue |
| Implementation and review snapshot | pull request |
| Code evidence | branch, commit, checks, and deployed release |

Issue comments record material progress or decisions; they are not a second knowledge base.

## Issue rules

- Default to read-only. Do not create a new GitHub issue for repository delivery work; use
  `linear-work-sync` to resolve or create the Nohmi Linear issue instead.
- Search open and recently closed issues before creating.
- Prefer a confident existing issue over a duplicate. Report ambiguity instead of guessing.
- Create one issue per independently shippable concern, not per file, log line, or review comment.
- Skip issue creation for tiny self-contained chores, routine dependency PRs, and docs-only edits
  unless follow-up, coordination, or durable acceptance criteria make tracking useful.
- Use only live configured labels. Prefer one best-supported type label:
  `bug`, `enhancement`, `documentation`, `dependencies`, or `github_actions`.
- Do not automatically apply `invalid`, `duplicate`, `wontfix`, `help wanted`, or
  `good first issue`; those labels carry a human judgment.
- Preserve existing assignees, milestone, labels, and Project placement unless evidence clearly
  supports changing them.
- Assign the authenticated user only for active work they own; leave planning work unassigned when
  ownership is unclear.
- Never close an issue from intent or a local diff. Require an explicit human request, a merged PR
  that fully satisfies it, or equivalent completion evidence.

## Linking work

- Link a relevant legacy GitHub issue as source evidence from the Nohmi Linear issue. It never
  replaces the PR Work map or Linear's structured PR backlink.
- Use `Closes #123` in a PR only when merging it fully completes the issue.
- Use `Refs #123` when the PR is partial progress, a dependency, or contextual evidence.
- Do not add both for the same issue.
- Keep parent or follow-up issues open until their own acceptance criteria are complete.
- Use a branch name such as `cooper/123-short-description` when an issue is already known; do not
  rename a shared branch solely to add an issue number.

## Issue body

```markdown
## Outcome

<What should be true when this is complete.>

## Context

- <Current docs and necessary source links>
- <Constraints, safety rules, or non-goals>

## Acceptance

- [ ] <Observable result>

## Verification

- <Command, manual check, or acceptance signal>
```

Keep the body actionable without copying a PR diff, chat transcript, secret, PII, or private
reasoning.

## Write safety and audit

Write only when the user explicitly requests a bounded legacy GitHub issue mutation. `create-pr`,
`catchup`, `pr-shepherd`, and `resolve-pr-comments` grant no GitHub issue writes; they synchronize
delivery work through `linear-work-sync`.

For a write run, append sanitized JSONL under `.context/github-work-sync/` with the source, issue and
PR URLs, changes, duplicate-search result, skipped ambiguities, and tool failures. Never store
credentials or private source payloads.
