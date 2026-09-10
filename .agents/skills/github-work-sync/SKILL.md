---
name: github-work-sync
description: Use when explicitly auditing, migrating, closing, or annotating legacy nohmi GitHub issues as source evidence.
---

# GitHub work sync

Reconcile legacy GitHub issue evidence without creating a parallel delivery graph. Current delivery
work belongs in the live `Nohmi` Linear Project through `linear-work-sync`.

## Ground rules

- Read `../github-work-context/SKILL.md` before any issue write.
- Read `../linear-context/SKILL.md` and `../linear-work-sync/SKILL.md` before mapping GitHub evidence
  to current work.
- Write only when the user explicitly asks for the exact legacy GitHub issue mutation. No PR skill
  grants GitHub issue write authority.
- Never create a new GitHub issue for repository delivery work. Resolve or create the corresponding
  Nohmi Linear issue instead.
- Prefer a confident existing issue over creating a duplicate.
- Create an issue only when the work is concrete, durable, independently shippable, and useful to
  discover outside its PR.
- Use the least advanced state supported by evidence. GitHub's native issue state is open/closed;
  do not invent workflow labels or Project statuses.
- Add a concise issue comment only for a material change in scope, implementation, verification,
  blocker, decision, review state, or completion. Do not comment for a read, duplicate search, or
  metadata-only refresh.

## Workflow

1. Resolve the repository, authenticated user, live labels, milestones, issue state, PR state, and
   available Project metadata.
2. Identify the source and split it into independently shippable work items.
3. Sanitize evidence. Retain only necessary issue/PR/doc links, behavior, constraints, status
   signals, and blockers.
4. Search before creating:
   - exact issue number or URL;
   - closing/reference links on the PR;
   - branch name and PR number;
   - distinctive title nouns and feature terms;
   - open issues first, then recently closed issues.
5. Build a write plan with source, proposed action, issue/PR target, confidence, title, body or
   changed fields, label, assignee, milestone/Project placement, relationship, and comment.
6. Execute explicitly authorized high-confidence legacy rows only:
   - preserve existing metadata unless evidence shows it is stale;
   - use one supported type label when a live exact match exists;
   - set assignee or milestone only with confident ownership/placement;
   - add `Closes #N` only when the PR fully completes the issue, otherwise `Refs #N`;
   - close only with explicit completion evidence and reopen only with explicit regression or
     incomplete-acceptance evidence.
7. Re-read every changed issue and PR relationship from GitHub.
8. Append one JSONL record to `.context/github-work-sync/YYYY-MM-DD.jsonl`.

## Match confidence

| Confidence | Evidence | Action |
| --- | --- | --- |
| High | Exact issue URL/number; PR already closes/references it; unique branch plus matching intent | update |
| Medium | Same distinctive feature terms and owner/milestone context | ask or skip |
| Low | Generic words, same app area only, or a stale closed issue | skip |

Never merge separate work items into one issue merely because they touch the same feature.

## Creation boundary

GitHub issue creation is disabled for repository delivery work. If durable coverage is missing, use
`linear-work-sync` and record the GitHub issue as optional source evidence only when one already
exists.

## Material comments

Write like a teammate:

```markdown
Opened PR #123 for review. It completes the session-expiry behavior in this issue while preserving
the existing token revocation contract. `pnpm verify` passes.
```

Link the relevant PR or doc. Do not emit automation markers, field-by-field receipts, raw command
logs, private reasoning, secrets, or PII.

## Output

```markdown
| Work | GitHub issue | Relationship/state | Action |
| --- | --- | --- | --- |
| <title> | [#123](url) | Closes / open | updated |
```

Include the canonical Nohmi Linear issue when known, skipped ambiguities, tool failures, and the
legacy GitHub audit ledger path.
