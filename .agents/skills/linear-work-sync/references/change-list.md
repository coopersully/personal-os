# PR, Branch, and Change-List Mode

Use this reference when creating or updating Linear coverage from a Nohmi branch, PR, local diff, or
git change list.

The checked-out repository is authoritative for routing: changes from this repository may create or
update only issues in the live `Nohmi` Project. Never infer another Project from feature names or
shared code. Do not put `{TEAM}-NEW` in a PR. Create the issue directly in `Nohmi` through the
guarded sync workflow, then link its existing issue key in the branch name and required PR Work map.

## Evidence

Resolve the open PR first when one exists and use its live base. Without a PR, compare against the
repository's default branch, currently `main`. Fetch only when needed and do not overwrite local
changes.

```bash
git status --short
git diff --stat origin/<base>...HEAD
git diff --name-status origin/<base>...HEAD
git log --oneline --decorate origin/<base>..HEAD
```

Also gather the PR title, body, URL, review state, and changed-file list when available. Follow
`docs/engineering/pr-rubric.md`; do not attribute unrelated or user-owned changes to the issue.

## Grouping

- Group by user-facing feature, defect, migration, integration, or operational outcome.
- Ignore generated output, formatting churn, and lockfile-only changes unless they are the work.
- Prefer one issue for tightly coupled changes that ship together; split independently shippable
  outcomes.
- If more than 10 issues are proposed or grouping is ambiguous, return the plan before writing.

## Matching

Search exact Linear keys and URLs, PR URL/number, branch, distinctive commit/title nouns, and
meaningful app/package names. Filter candidate matches to the `Nohmi` Project. Matching intent is
required; vocabulary overlap is insufficient. If an exact key or URL belongs to another Project or
no Project, report it as a routing conflict and do not mutate it.

```markdown
| Source | Candidate work | Product | Existing issue | Action | Status | Type | Link |
| --- | --- | --- | --- | --- | --- | --- | --- |
| branch/pr/diff | <outcome> | Nohmi | <key/link or none> | update/create/skip | In Progress | Improvement | <url> |
```

Use concise outcome-based titles, not paths. A comment should summarize material progress and its
verifiable source; it must not contain command transcripts.
