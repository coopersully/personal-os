---
name: resolve-pr-comments
description: Resolve outstanding GitHub pull request review threads, review summaries, top-level comments, and actionable bot feedback for the current Personal OS branch. Use when addressing PR feedback, requested changes, review comments, or re-review follow-up.
---

# Resolve PR comments

Act as the PR author. Prioritize a correct, maintainable pull request over literal or mechanical
comment handling. A resolved thread is not proof that its acceptance criteria are satisfied.

## Write safety

An explicit invocation grants permission to edit, test, commit, push, and resolve inline threads for
the current PR. Do not post GitHub comment replies during the initial pass. Draft useful replies and
wait for `c` or `confirm` before posting them. Thread resolution after a verified pushed fix does not
need separate confirmation.

## Workflow

### 1. Resolve the PR and instructions

1. Run `gh pr view --json number,url,headRefName,baseRefName,title,author`.
2. Stop if the current branch has no open PR.
3. Read `AGENTS.md`, `docs/engineering/pr-rubric.md`, the applicable repo-local skills, and the
   current docs named by or relevant to the feedback.

### 2. Gather every review surface

Run:

```bash
mkdir -p .context
python3 <skill-dir>/scripts/fetch_pr_review_feedback.py \
  --pretty --output .context/pr-feedback.json
```

Also inspect:

- the base-to-head diff and changed-file list;
- live mergeability, draft/review state, head SHA, and checks;
- linked GitHub issues and their acceptance criteria; and
- resolved threads with `--include-resolved` when checking prior fixes or completing the final audit.

The collector covers inline review threads, top-level PR comments, and non-empty review summaries.
Do not rely on only one GitHub API surface.

### 3. Build a feedback ledger

Give every non-noise item an entry:

- `surface`, `author`, and `authorType`;
- `intent`;
- concrete `acceptanceCriteria`;
- `severity`: critical, high, medium, or low;
- `resolutionLevel`: comment, file, module, PR-wide, or repository follow-up;
- `classification`: fix, improvement, scope creep, outdated, erroneous, or clarification needed;
- `action` and `status`;
- source URL/path/thread or review ID;
- verification;
- whether a GitHub reply is useful.

Human top-level comments and review summaries are first-class requirements. Bot feedback is
actionable when it identifies a real correctness, security, architecture, test, docs, or
maintainability issue; generated status output is noise.

### 4. Analyze before editing

For each pending entry:

1. Read the referenced code and nearby context.
2. Search the PR for the same pattern.
3. Decide the resolution level before changing code.
4. Compare the request with current docs, architecture, tests, and linked issue acceptance.
5. Choose code/docs/tests, a factual no-op, deferral, or clarification.

Treat duplicated helpers, wrong-layer access, lifecycle patterns, naming conventions, missing error
handling, and comments containing “also,” “theme,” or “pattern” as at least PR-wide until proven
otherwise.

### 5. Implement by comment cluster

- Fix root causes at the selected resolution level without broadening the PR.
- Add or update focused tests and current docs when behavior changes.
- Run targeted verification for each cluster.
- Commit and push one comment or tightly related cluster at a time with
  `address review: <concise cluster>`.
- Do not mark an entry handled until the fix is pushed and verification passed or a gap is explicit.

If review feedback materially changes scope, verification, a blocker, or completion of a linked
issue, use `../github-work-sync/SKILL.md` to add one concise material update. Do not create an issue
for each review comment.

### 6. Resolve inline threads

Resolve only after the corresponding fix or evidence is pushed:

```bash
gh api graphql -f query='
  mutation($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread { id isResolved }
    }
  }
' -f threadId='<thread-node-id>'
```

Classify outdated or erroneous feedback with evidence before resolving it. Top-level comments and
review summaries cannot be resolved as threads.

### 7. Verify the complete PR

1. Run focused checks for affected behavior.
2. Run `pnpm verify`.
3. Re-fetch feedback with `--include-resolved`.
4. Re-audit every human item, including resolved threads, against current code.
5. Confirm no actionable unresolved thread remains unless explicitly blocked/deferred.
6. Confirm the branch is pushed, the worktree is clean apart from known user changes, and live PR
   metadata matches the head.

### 8. Draft only useful replies

Do not reply merely to say “fixed” when the pushed code and resolved thread are sufficient. Draft a
short factual reply when:

- the reviewer proposed one approach and the PR intentionally uses another;
- a scope boundary, deferral, or blocker needs to be explicit;
- a top-level thematic comment needs a consolidated answer; or
- repo-specific context will prevent repeated bot feedback.

Show each draft with its real target URL. Ask for `c` or `confirm` only when at least one post-ready
reply exists. After confirmation, post only the confirmed text and return the resulting comment URLs.

## Final gate

- Every non-noise item has a ledger entry and source evidence.
- Every acceptance criterion was checked against the pushed head.
- Same-pattern occurrences were audited at the right level.
- Focused checks and `pnpm verify` passed or the blocker is explicit.
- Inline threads were resolved only after adequate handling.
- Linked issue state/context remains accurate.
- No GitHub replies were posted without confirmation.

## Output

Use the PR workflow output contract in `docs/engineering/pr-rubric.md`, then include:

- feedback themes and outcomes;
- commits pushed;
- resolved/unresolved thread counts;
- the compact comment ledger;
- exact verification;
- linked issue updates;
- proposed GitHub replies, or `None`; and
- blockers requiring reviewer or user judgment.
