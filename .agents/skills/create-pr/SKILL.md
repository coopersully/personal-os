---
name: create-pr
description: Prepare, verify, publish, open, or refine a GitHub pull request from local Personal OS changes. Use when creating a PR, pushing a review branch, drafting a PR title/body, or repairing an existing current-branch PR.
---

# Create PR

Create or refine a Personal OS pull request only after the changelist is scoped, verified, documented, and
described according to the repository rubric.

## Core rules

- Target `main` unless the user explicitly names another base.
- Follow the repository's documented branch convention. If no convention exists, use
  `feature/<short-kebab-description>` or `feature/<issue-number>-<short-description>`.
- Never push directly to `main`, stage unrelated user changes, or rename a shared branch merely for
  cosmetics.
- Default new PRs to draft unless the user asks for ready-for-review.
- Detect an open PR for the current branch before creating one. Refine it instead of opening a
  duplicate.
- Treat `pnpm verify` as the required pre-review verifier. A maintainer may explicitly authorize a
  narrower check, but the gap must remain visible.
- Audit GitHub issue coverage automatically unless the user says to skip it. Do not create an issue
  merely to satisfy a template.
- Keep title/body-only drafting requests read-only: report proposed issue relationships, but do not
  create or update issues, branches, commits, or PRs.
- Prefer the connected GitHub app for issue/PR reads and writes. Use local `git` and `gh` for branch,
  commit, push, current-branch PR discovery, Actions logs, and connector gaps.

## Required context

Read:

- `AGENTS.md`
- `docs/engineering/pr-rubric.md`
- `docs/engineering/feature-ownership.md`
- `../github-work-context/SKILL.md`
- `../github-work-sync/SKILL.md`
- the current architecture, product, operations, and feature docs nearest the changed files
- every applicable repo-local implementation or testing skill

## Workflow

### 1. Orient

1. Run `git status -sb`; resolve the repository, remotes, current HEAD, and base.
2. Fetch the target base without overwriting local work.
3. Look for an open current-branch PR and read its title, body, state, base/head, commits, files,
   issue relationships, review state, and checks.
4. Inspect the merge-base diff with `--stat`, `--name-status`, and the full patch. Inspect untracked
   files separately.
5. Group the diff into coherent user, product, engineering, or operational outcomes. Flag mixed
   concerns that should be split.

If an open PR exists, enter refinement mode: keep its number/URL, update the existing PR, and never
call PR creation.

### 2. Audit scope, architecture, and docs

- Map changed files to owners and boundaries in `feature-ownership.md`.
- Read and apply the relevant repo-local skills.
- Fix clear architecture, security, privacy, test, or documentation gaps inside the intended
  changelist.
- Update current docs for behavior, API, authorization, MCP, connector, synchronization,
  deployment, or operational changes.
- Stop for a human decision if a safe fix would materially broaden the requested scope.

### 3. Audit GitHub issue coverage

Use `github-work-sync` with the current request, branch, commits, diff, existing PR, and current docs
as evidence.

1. Search exact issue references, current PR relationships, branch terms, and distinctive work
   nouns before broader searches.
2. Update a confident existing issue rather than creating a duplicate.
3. Create missing coverage only when the `github-work-sync` creation gate passes.
4. Choose `Closes #N` only when this PR fully satisfies the issue; otherwise use `Refs #N`.
5. If no issue is useful, record `No tracking issue needed` and the reason in the PR work map.
6. If the tools fail or multiple issues are plausible, do not guess; record the limitation and
   continue PR preparation.

An invocation that publishes or refines a PR grants PR-scoped GitHub writes for issue
creation/update/linking and one material issue progress comment. A title/body-only drafting request
does not.

### 4. Verify

- Run focused checks while implementing.
- Run `pnpm lint` before pushing.
- Run `pnpm verify` before requesting review or publishing as ready.
- Fix failures and rerun the relevant stage, then the required verifier.
- Record every exact command, outcome, what it proves, and any explicitly authorized gap.

### 5. Commit intentionally

1. Re-run `git status --short`.
2. Create a branch following the repository convention first when HEAD is detached or on `main`.
3. Stage explicit in-scope paths only.
4. Review the staged diff and staged file/line totals.
5. Commit with a concise message describing the actual outcome.
6. Rebase on current target base before publishing. Preserve append-only migrations.
7. Re-run affected verification after conflict resolution.

If the user asked only for a title/body draft or explicitly prohibited commit/push, stop before the
corresponding write and return the draft.

### 6. Write the PR

Follow `docs/engineering/pr-rubric.md` exactly:

- short title with no prefix or trailing punctuation;
- Overview and work map;
- Why this change;
- verifiable What changed bullets;
- Documentation impact;
- Verification with what each check proves;
- Scope and limitations only when material.

Never paste chat transcripts, private reasoning, secrets, PII, or unsupported rationale. In
refinement mode, replace stale title/body/check/issue claims rather than preserving drift.

### 7. Push and publish

1. Push the branch with upstream tracking.
2. Create a draft PR through the GitHub app, or `gh pr create` when needed.
3. In refinement mode, push commits and update the same PR.
4. Re-read the live PR, issue relationships, head SHA, draft state, and checks.
5. Update linked issues with the PR URL and one material progress note when useful.
6. Mark ready only when the user requested it, local required verification passed, the description
   is current, and no known blocker remains.

Do not claim GitHub CI passed until live checks report success. `main` requires strict up-to-date
branches, resolved conversations, linear history, and all checks named in the rubric.

## Final gate

Confirm:

- no duplicate PR or issue was created;
- only intended files were committed;
- architecture and current docs match the change;
- `pnpm verify` passed or the explicit gap is documented;
- issue linkage uses the correct `Closes` or `Refs` relationship;
- live title/body/head/draft/check state was re-read; and
- every reported artifact has a real URL.

## Output

Use the PR workflow output contract in `docs/engineering/pr-rubric.md`. Include mode, branch, base,
commit SHA, PR state/URL, issues found/created/updated, duplicate-search result, checks, docs, risks,
and `.context/github-work-sync/` audit path when writes occurred.
