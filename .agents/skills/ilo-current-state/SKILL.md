---
name: ilo-current-state
description: "Produce a read-only, public-safe snapshot of Personal OS delivery work: the current goal, staffed and unstaffed lanes, blockers, merge order, and one next action. Use for questions about what Personal OS work is in flight, blocked, unowned, ready to merge, or should happen next."
---

# Personal OS Current State

Produce a point-in-time delivery snapshot. This is orientation and triage, not coordination:
do not write to GitHub, message people or agents, modify branches or code, or expose personal data.

## Collect evidence

1. Read `$ilo-knowledge-base` and only the current product/architecture/delivery documents
   needed to name the active goal and constraints.
2. Resolve the repository, confirm that it is public, and resolve the authenticated GitHub identity.
   Via `github:github`, query every open PR (including drafts) and every relevant open issue in that
   public repository; these are the completeness sources. Discard results from private or restricted
   repositories before classification, retention, or output. Use `$pr-briefing` only as a
   supplemental view, then inspect live review-thread, mergeability, and required-check evidence
   needed to substantiate each finding.
3. When the host exposes active repository work sessions, read only sessions that match this
   repository or a live issue, PR, or branch in the collected evidence. Treat a matching session as
   **staffed** only when its public delivery artifact is linked; otherwise report `Missing public
   delivery artifact`. If the host exposes no such sessions, state that staffing evidence is
   unavailable rather than inferring it.
4. Reconcile contradictions explicitly. GitHub is the delivery-state source of truth; current docs
   define scope. Treat an unlinked branch, local commit, worktree, or uncommitted change as local
   context only—not as product status, staffing, or merge evidence.

## Classify

- **Staffed lanes:** a matching active repository session with a linked live PR or issue in the
  confirmed public repository and its status. When no public artifact is linked, state `Missing
  public delivery artifact`.
- **Unstaffed lanes:** a live, relevant GitHub issue or PR with no matching active repository
  session when host session data is available. Do not infer ownership from author, assignee,
  branch, local checkout, or a stale/completed session.
- **Blockers:** only current conflicts, failed/required checks, unresolved actionable review,
  explicit session wait states, or evidenced dependencies. State the evidence or say it is unknown.
- **Merge order:** list only evidence-backed dependencies. Otherwise say `No dependency evidence;
  merge independently when each PR is ready.` Never turn recency, branch naming, or local work
  into an ordering constraint.

## Output contract

Always return this exact heading structure. Use `None found` or `Unknown` rather than omitting a
section. Link public GitHub artifacts when available; keep session identifiers and summaries
public-safe.

```markdown
## Personal OS Current State

**As of:** <timestamp and timezone>
**Current goal:** <current documented delivery goal, or Unknown>
**Evidence coverage:** <docs read; GitHub PR/issue/review/check coverage; matching sessions read; gaps>

### Staffed lanes

- <PR or issue> — <session, if available> — <current evidence-backed status>

### Unstaffed lanes

- <PR or issue> — <why it is relevant and lacks a matching active task>

### Blockers

- <artifact or lane> — <blocker and live evidence>

### Merge order

1. <PR or `No dependency evidence; merge independently when each PR is ready.`>

### Next action

<one highest-leverage, evidence-backed, read-only recommendation>
```

Finish by stating that no mutations were performed. If evidence is unavailable, still return the
contract and identify the unavailable source; do not substitute local unpublished work or private
data.
