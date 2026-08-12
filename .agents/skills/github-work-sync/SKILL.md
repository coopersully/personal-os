---
name: github-work-sync
description: Create, update, link, close, or audit Personal OS GitHub Issues from a request, branch, commit, pull request, review, or code changelist. Use for GitHub-native task creation, task status updates, duplicate checks, PR issue coverage, and work-tracking synchronization.
---

# GitHub work sync

Synchronize real delivery work to GitHub Issues in one bounded, auditable pass.

## Ground rules

- Read `../github-work-context/SKILL.md` before any issue write.
- Write only when the user explicitly asks to update work tracking or a calling skill grants the
  bounded write.
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
6. Execute high-confidence rows only:
   - preserve existing metadata unless evidence shows it is stale;
   - create with the issue template in `github-work-context`;
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

## Creation gate

Create missing coverage automatically for a PR only when at least one is true:

- it introduces or materially changes user-facing capability;
- it fixes a non-trivial bug, security, privacy, data-integrity, or operational problem;
- it has acceptance criteria or follow-up value beyond the current diff; or
- the user explicitly asked to track it.

Do not auto-create for routine dependencies, generated changes, formatting, copy-only edits, or a
self-contained docs/skill maintenance PR. Record the reason instead.

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

Include skipped ambiguities, reasons no issue was needed, tool failures, and the audit ledger path.
