# Work Context and Traceability

Use the smallest durable artifact that owns each kind of information. A pull request is a review
snapshot, not a replacement for product documentation or Linear.

## Ownership model

| Information | Durable owner |
| --- | --- |
| Product behavior and acceptance criteria | Current `docs/product/` documentation |
| Architecture and engineering constraints | Current `docs/architecture/` and `docs/engineering/` documentation |
| Portfolio and workstream | Live `Nohmi` Linear Project and milestone when one exists |
| Independently shippable work, owner, priority, and status | Live Nohmi Linear issue |
| Reviewable implementation snapshot | GitHub pull request |
| Implementation evidence | Repository diff, tests, checks, commits, and current source |
| Material progress, scope change, or blocker | One concise Linear comment |

Do not copy large specifications into a PR or Linear issue. Link the current source of truth and
describe only the contribution reviewers need to understand.

## Required PR Work map

Every repository PR body contains:

```markdown
## Work map
- Project: [Nohmi](<live-project-url>) — <how this PR advances it>
- Milestone: [<milestone>](<live-milestone-url>) — <contribution> <!-- omit when absent -->
- Task: [COO-123](<live-issue-url>) — <how this PR advances the issue>
- Reference: [<current source of truth>](<repository URL or path>)
```

- `Project` is always the unique live `Nohmi` Project.
- Include the issue's live milestone when present; do not invent one.
- Add one `Task` row for every issue directly advanced by the PR.
- Add one to three current references. Put incidental context under `Related`, not `Task`.
- If Linear is explicitly skipped, unavailable, or ambiguous, record that blocker in the Work map,
  keep the PR draft, and never substitute another Project or an unprojected issue.

## Two-phase synchronization

1. Before PR creation, resolve the live Nohmi Project, search for duplicates, match or create each
   direct issue, set active work to the least advanced compatible live status, and put the primary
   issue key in a new branch name when possible. Do not rewrite an existing pushed branch solely to
   add a key; record the exception and preserve traceability through the Work map and backlinks.
2. After GitHub returns the PR URL, add it to every direct issue using Linear's structured link or
   attachment field. Add at most one concise comment per issue only when opening the PR is a
   material progress, verification, scope, or blocker event.
3. Re-read the PR and direct issues. The Work map, structured backlinks, status, milestone, and
   branch identity must agree. Append the sanitized Linear audit record before handoff.

The current workspace has no review-specific status. An open or draft PR therefore leaves direct
issues `In Progress`; only merged work with issue-specific acceptance evidence moves to `Done`.
