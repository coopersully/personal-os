---
name: create-pr
description: Use when preparing, publishing, opening, or materially refining a GitHub pull request for nohmi repository work.
---

# Create a nohmi Pull Request

Create or refine one review-ready pull request whose diff, documentation, GitHub state, and Linear
records agree. Publishing or materially refining a PR grants the bounded Linear write authority
defined below unless the user explicitly skips Linear. It never grants authority to merge,
auto-merge, or mutate another Linear Project.

## Core rules

- Target `main` unless the user explicitly names another base.
- Use a `cooper/<short-kebab-description>` branch by default. For a new branch with a known primary
  issue, prefer `cooper/coo-123-<short-description>`.
- Never push directly to `main`, stage unrelated user changes, rename a shared branch for cosmetics,
  merge the PR, enable auto-merge, or alter branch protection.
- Default new PRs to draft unless the user asks for ready-for-review. Preserve the state of an
  existing PR unless the readiness gate supports changing it.
- Detect an open PR for the current branch before creating one. Refine it instead of opening a
  duplicate.
- Treat `pnpm verify` as the required pre-review verifier. A maintainer may explicitly authorize a
  narrower check, but the gap remains visible.
- Keep title/body-only drafting requests read-only: report proposed relationships, but do not create
  or update Linear issues, branches, commits, or PRs.
- Prefer connected GitHub and Linear tools for their records. Use local `git` and `gh` for branch,
  commit, push, current-branch PR discovery, Actions logs, and connector gaps.
- Repository-derived Linear writes may target only issues in the unique live `Nohmi` Project. Never
  use `{TEAM}-NEW`, adopt an unprojected issue, or route work to another Project.

## Required context

Read:

- `AGENTS.md`
- `docs/engineering/pr-rubric.md`
- `docs/engineering/work-context.md`
- `docs/engineering/feature-ownership.md`
- `../linear-context/SKILL.md` and its workspace conventions
- `../linear-work-sync/SKILL.md`
- the current architecture, product, operations, and feature docs nearest the changed files
- every applicable repository implementation or testing skill

## Workflow

### 1. Orient

1. Run `git status -sb`; resolve the repository, remotes, current HEAD, and base.
2. Fetch the target base without overwriting local work.
3. Look for an open current-branch PR and read its title, body, state, base/head, commits, files,
   Linear relationships, review state, and checks.
4. Inspect the merge-base diff with `--stat`, `--name-status`, and the full patch. Inspect untracked
   files separately.
5. Group the diff into coherent user, product, engineering, or operational outcomes. Flag mixed
   concerns that should be split.

If an open PR exists, enter refinement mode: keep its number/URL, update that PR, and never call PR
creation.

### 2. Audit scope, architecture, and docs

- Map changed files to owners and boundaries in `feature-ownership.md`.
- Read and apply the relevant repository skills.
- Fix clear architecture, security, privacy, test, or documentation gaps inside the intended
  changelist.
- Update current docs for behavior, API, authorization, MCP, connector, synchronization,
  deployment, or operational changes.
- Stop for a human decision if a safe fix would materially broaden the requested scope.

### 3. Resolve Linear before PR creation

Invoke `linear-work-sync` in its pre-PR phase with this bounded authority:

1. Resolve the unique live Nohmi Project, current user, statuses, labels, milestones, and cycles.
2. Search exact issue keys/URLs, existing PR evidence, branch terms, and distinctive outcome nouns.
3. Reuse a high-confidence Nohmi issue. Ask or stop on ambiguity; create only concrete,
   independently shippable work with no confident match.
4. Create directly in Nohmi with one live type label and one primary live Area leaf. Preserve an
   existing owner, priority, milestone, and cycle unless evidence supports a change.
5. Put active implementation in the least advanced compatible live status and return exact
   issue/project/milestone URLs for the PR Work map.

For multiple direct issues, use one primary key in a new branch and list every issue in the Work
map. Do not rewrite an existing pushed branch solely to add a key; record the exception and preserve
traceability through the Work map and structured backlinks.

GitHub issues are source evidence only for this repository's work graph. Do not create or update a
GitHub issue as a substitute for required Nohmi Linear coverage.

### 4. Verify

- Run focused checks while implementing.
- Run `pnpm lint` before pushing.
- Run `pnpm verify` before requesting review or publishing as ready.
- Fix failures and rerun the relevant stage, then the required verifier.
- Record every exact command, outcome, what it proves, and any explicitly authorized gap.
- Re-inspect the final diff for unrelated changes, secrets, generated output, and accidental churn.

### 5. Commit intentionally

1. Re-run `git status --short`.
2. Create the intended `cooper/` branch first when HEAD is detached or on `main`.
3. Stage explicit in-scope paths only; review the staged diff and file/line totals.
4. Commit with a concise message describing the outcome.
5. For an unpublished branch, rebase on current base before publishing. For a published/shared
   branch, use the repository catch-up workflow and merge the base without rewriting history unless
   the user explicitly authorizes a rebase and force-push.
6. Preserve append-only migrations and rerun affected verification after conflict resolution.

If the user asked only for a title/body draft or prohibited commit/push, stop before that write and
return the draft.

### 6. Write and publish the PR

- Follow `docs/engineering/pr-rubric.md` and `.github/pull_request_template.md` exactly.
- Use a short, outcome-focused title with no conventional-commit prefix or trailing punctuation.
- Include Overview, the required Work map, Why this change, verifiable What changed bullets,
  Documentation, Verification, conditional boundary analysis, and material limitations.
- The Work map links the live Nohmi Project, live milestone when present, every direct Linear issue,
  and one to three current references. Explain how the PR advances each item.
- Push with upstream tracking and create a draft PR, or update the same PR in refinement mode.
- Never paste transcripts, private reasoning, secrets, PII, local-only URLs, or unsupported claims.

### 7. Link the PR back to Linear

After GitHub returns the PR URL, invoke `linear-work-sync` in its post-PR phase:

1. Add the exact PR URL to every direct issue using Linear's structured link or attachment field.
2. Keep draft and open PR work `In Progress` while no compatible live review status exists.
3. Add at most one concise issue comment when the PR opening or material refinement records scope,
   verification, progress, or a blocker not already represented by metadata.
4. Append sanitized success, failure, and skip records to the Linear audit ledger.

A PR URL present only in a comment or description is not a complete backlink.

### 8. Reconcile before handoff

Re-read the published PR, head SHA, checks, and every direct Linear issue. Confirm:

- the PR targets the intended base and branch, and no duplicate PR or issue was created;
- only intended files were committed and current docs match the change;
- the Work map links the live Nohmi Project, milestone when present, and every direct issue;
- every direct issue has the structured PR backlink and least advanced supported status;
- `pnpm verify` passed or the explicitly authorized gap is documented;
- title, body, diff, verification, docs, and Linear comments make no unsupported claim; and
- every reported artifact has a real URL.

Repair in-scope drift. If a required tool is unavailable or identity remains ambiguous, keep the PR
draft, describe the exact missing link, and never substitute another Project or issue. Do not claim
GitHub CI passed until live checks report success.

Read [references/pressure-scenarios.md](references/pressure-scenarios.md) when modifying or evaluating
this skill.

## Output

Use the PR workflow output contract in `docs/engineering/pr-rubric.md`. Include mode, branch, base,
commit SHA, PR state/URL, Nohmi Project and milestone, every direct Linear issue, final status,
structured backlink result, duplicate-search result, checks, docs, risks, audit path, and blockers.

Do not claim a PR, Linear write, link, comment, or check succeeded without verifying it.
