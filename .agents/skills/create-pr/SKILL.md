---
name: create-pr
description: Use when preparing, publishing, opening, or materially refining a GitHub pull request for Nohmi repository work.
---

# Create a Nohmi Pull Request

Create or refine one review-ready pull request whose GitHub and Linear records agree. This workflow
grants the bounded Linear write authority defined below unless the user explicitly says to skip
Linear. It never grants authority to merge, auto-merge, or mutate another Linear Project.

## Read first

1. Read `AGENTS.md`, `docs/engineering/pr-rubric.md`, and
   `docs/engineering/work-context.md`.
2. Read `linear-context`, its workspace conventions, and `linear-work-sync`.
3. Read the nearest current product, architecture, engineering, and testing docs for the changed
   surface.

## Boundaries

- Target `main`. Never commit on or push directly to `main`, merge the PR, enable auto-merge, or
  alter branch protection.
- Preserve unrelated and user-owned changes. Do not broaden the diff to make the PR look complete.
- Reuse and refine the current branch's open PR when one exists; do not create a duplicate.
- Repository work may write only to issues in the unique live `Nohmi` Project. Resolve that Project
  before every write. If it is missing or ambiguous, make no Linear mutation, keep any PR draft,
  and report the blocker.
- Never use `{TEAM}-NEW`. Resolve or create a Nohmi issue before relying on an issue key in GitHub.
- Treat current source, verification output, GitHub state, and live Linear metadata as evidence.
  Never publish private reasoning, secrets, PII, transcripts, local-only URLs, or stale docs.

## Workflow

### 1. Inspect and classify

- Inspect repository status, diff, branch, base, commits, and any existing PR.
- Explain the independently shippable outcome represented by the diff. Split unrelated work before
  continuing or report why it cannot safely be represented by one PR.
- Derive a concise outcome-focused title from the diff and linked Linear work. Do not add an issue
  key to the title merely as decoration.

### 2. Resolve Linear before PR creation

Invoke `linear-work-sync` in its pre-PR phase with this bounded authority:

- resolve the unique live Nohmi Project, current user, statuses, labels, milestones, and cycles;
- search for duplicates in confidence order, including exact key/URL, existing PR evidence, branch,
  and distinctive outcome;
- reuse high-confidence Nohmi issues, ask or stop on ambiguous matches, and create only concrete
  shippable work with no confident match;
- place new issues directly in Nohmi with one live type label and one primary live Area leaf;
- preserve existing owner, priority, milestone, and cycle unless the evidence supports a change;
- set actively implemented work to the least advanced compatible live status.

If a new branch is needed, include the primary issue key when possible:
`cooper/coo-123-short-description`. For multiple issues, use one primary key in the branch and list
every direct issue in the PR body. Do not rewrite an existing pushed branch solely to add a key;
record the exception and rely on the exact Work map and structured backlinks.

### 3. Validate the change

- Update the nearest current documentation for changed behavior, APIs, architecture, operations,
  integrations, MCP behavior, authorization, or deployment.
- Run focused verification appropriate to the diff.
- Run `pnpm verify` before opening the PR unless the user explicitly authorizes a narrower check.
  Report failures exactly; never convert a failed or unrun check into a pass.
- Re-inspect the final diff for unrelated changes, secrets, generated output, and accidental
  formatting churn.

### 4. Compose and publish

- Follow `docs/engineering/pr-rubric.md` and `.github/pull_request_template.md`. The body begins with
  `Overview` and the mandatory `Work map`, then covers Why, What changed, Documentation,
  Verification, risks, and follow-up.
- Link the live Nohmi Project, the live milestone when present, every direct issue, and one to three
  current source-of-truth references. Explain how the PR advances each item.
- Push the feature branch and open a draft PR against `main`. Mark it ready only when required
  verification passes and no Work map or Linear blocker remains.
- If an open PR already exists, update its title/body and continue with the same post-PR audit.

### 5. Link the PR back to Linear

After GitHub returns the PR URL, invoke `linear-work-sync` in its post-PR phase:

- add the exact PR URL to every direct issue using Linear's structured link or attachment field;
- keep draft and open PR work `In Progress` while no compatible live review status exists;
- add at most one concise issue comment when the PR opening conveys material scope, verification,
  progress, or a blocker not already represented by metadata;
- append sanitized success, failure, and skip records to the Linear audit ledger.

A PR URL present only in an issue comment or description is not a complete backlink.

### 6. Reconcile before handoff

Re-read the published PR and every direct Linear issue. Confirm that:

- the PR targets `main` from the intended feature branch;
- the Work map links the live Nohmi Project, milestone when present, and every direct issue;
- each issue has the structured PR backlink and remains in the least advanced supported status;
- title, body, diff, verification, docs, and Linear comments make no unsupported claim.

Repair in-scope drift. If a required tool is unavailable or identity remains ambiguous, leave the PR
draft, describe the exact missing link, and do not substitute another Project or issue.

Read [references/pressure-scenarios.md](references/pressure-scenarios.md) when modifying or evaluating
this skill.

## Output

Use the PR workflow output contract in `docs/engineering/pr-rubric.md`. Always report:

- the linked PR with draft/open state, base, and head;
- the Nohmi Project, milestone when present, direct Linear issues, final statuses, and structured
  backlink results;
- exact verification results and relevant artifact links;
- the Linear audit path, skipped ambiguities, unavailable tools, and blockers.

Do not claim a PR, Linear write, link, comment, or check succeeded without verifying it.
