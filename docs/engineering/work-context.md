# Work Context and Traceability

Use the smallest durable artifact that owns each kind of information. A pull request is a review
snapshot, not a replacement for product documentation or Linear.

## Mandatory tracking lifecycle

This is the canonical tracking contract for every nohmi entrypoint: ordinary implementation,
documentation maintenance, prerequisite repairs, review fixes, delivery and assigned network work.
The standing repository instruction authorizes bounded tracking of assigned durable work; invoking
a different skill does not postpone intake until PR creation or require the same permission again.

1. Before implementation, resolve exactly one live, non-archived `Nohmi` Project and search existing
   issues, linked PRs and owners. Reuse a confident direct issue; create only missing independently
   shippable work in that Project. A review fix can use its existing direct issue; neither each file
   nor each review comment needs a new issue. Reconcile already-started work immediately.
2. Resolve the unique live Project again before every write and verify each target issue belongs to
   it. Preserve human assignees, priorities, cycles and unrelated taxonomy. Record implementation
   and acceptance owners separately; an agent doing work does not become the human assignee.
3. Keep active work in the least advanced compatible status. Record material scope, progress,
   blockers and acceptance changes once, linking durable evidence. Unchanged heartbeats, reads,
   metadata-only corrections and repeated failures do not justify repetitive status comments.
4. Follow `create-pr` before publication: direct issues in the Work map, then the actual returned PR
   URL as a structured link on every direct issue. Re-read both systems before handoff. An upstream
   prerequisite PR is a related reference, not a direct backlink for an unpublished child.
5. Close only when the issue's full acceptance is evidenced, including required release/adoption
   criteria. A merge or green aggregate alone does not complete an issue or its parent.

Pure discussion and read-only inspection/review create no issue or tracker mutation. If they yield
assigned durable follow-up, start this lifecycle before that work. This contract does not turn a
review-only role into an implementer or grant unrelated external actions.

An unavailable Project, ambiguous issue match or failed tracker write is a visible traceability gap:
make no guessed/cross-project mutation, retain the last verified IDs and intended change in the
existing checkpoint, and reconcile partial effects before retrying. Preserve source work and continue
independent authorized work; oversight's kickoff gate still blocks new dependent dispatch and no
merge may proceed until traceability is restored. Use `linear-context` and `linear-work-sync` for
live lookup, sanitized audit and readback mechanics.

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
