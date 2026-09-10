---
name: pr-briefing
description: Use when auditing nohmi's open pull request queue, summarizing review work, or deciding which PR needs attention next.
---

# PR briefing

Produce a GitHub/chat-native queue briefing. This is triage, not code review: do not deeply review
diffs or mutate GitHub.

## Collect

1. Resolve the repository and list every open PR, including drafts and Dependabot.
2. Gather compact metadata first: number, title, URL, author, draft, base/head, timestamps,
   mergeability, review decision, labels, and check rollup.
3. Read `AGENTS.md`, `docs/engineering/pr-rubric.md`, and `../linear-context/SKILL.md`. For every
   human-authored PR, validate the Nohmi Project and direct issue links in its Work map against the
   issues' structured PR backlinks and live statuses.
4. For non-draft human-authored PRs, gather unresolved review threads and the latest human review,
   author commit, and non-bot comment only when needed for classification.
5. Treat GitHub as source of truth for PR state and Linear as source of truth for delivery state.
   Do not infer readiness or issue coverage from branch names or chat.

## Buckets

Apply first match:

1. **Need author** — conflicts, failed checks, newer changes-requested review, unresolved actionable
   threads, missing/incorrect Nohmi Work map, or missing reciprocal structured PR backlink.
2. **Checks running** — required checks queued or in progress and no author action is yet known.
3. **Reviewer action needed** — a human engaged, the author pushed/responded, and reviewer follow-up
   is now the next action.
4. **Reviewer required** — non-draft human PR with no non-author human engagement.
5. **Dependency updates** — Dependabot PRs without a higher-priority failure/conflict condition.
6. **Merge ready** — current head, required checks green, mergeable, conversations resolved,
   accurate metadata, reciprocal Nohmi Linear coverage, and review expectations satisfied.
7. **Drafts** — include only when the user asks for all PRs or a draft has a blocker worth surfacing.

Exclude terminal PRs. Bots include Dependabot and logins ending in `[bot]`.

## Summary

For every included PR, write one actionable sentence and an age based on the newest meaningful
commit/review/comment/update. Use `(<1h)`, `(3h)`, `(2d)`.

```markdown
## PR Briefing

### Need author

1. (2d) [#123 Title](url) — merge conflicts block review.

### Reviewer required

1. (6h) [#124 Title](url) — no non-author human has reviewed this head.
```

Include each PR's direct Linear issue link when available, counts, source-coverage gaps, and the
single best next action. If Linear is unavailable, mark readiness unknown rather than treating the
gap as complete coverage. This workflow is read-only.
