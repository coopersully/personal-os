# Personal OS contributor skills design

- Status: Approved
- Date: 2026-08-12

## Outcome

Publish reusable Personal OS contributor workflows in `.agents/skills` so independent
people and agents can make repository changes with the same architecture, quality,
GitHub-tracking, and pull-request conventions.

## Public bundle

The branch adds these skills and their required `agents`, `references`, and `scripts`
files from the reviewed contributor-skill source:

| Area | Skills |
| --- | --- |
| Repository guidance | `ilo-knowledge-base`, `ilo-product-planning`, `ilo-current-state` |
| Product QA | `personal-os-qa` |
| GitHub delivery | `github-work-context`, `github-work-sync`, `github-issue-janitor` |
| Pull-request lifecycle | `catchup`, `create-pr`, `pr-briefing`, `pr-shepherd`, `resolve-pr-comments`, `review-pr` |
| Release visibility | `ilo-deploy-status` |

The names that begin with `ilo-` remain technical repository identifiers. Human-facing
metadata calls the product **Personal OS** consistently.

## Exclusions

- Maintainer-only project coordination and scheduled-task workflows.
- Personal cross-repository branch-ownership and worktree workflows.
- Individual work-queue views that are not shared contributor standards.
- Personal task IDs, automation prompts, local paths, credentials, and private delivery context.

The pre-existing implementation and design skills already on `main` remain unchanged.

## Safety and quality contract

- Every public workflow uses repository evidence and keeps secrets, provider payloads, personal data,
  and private reasoning out of public output.
- GitHub-mutating workflows retain explicit authorization gates and re-read changed public artifacts.
- Quality and deployment workflows distinguish local validation from live production evidence.
- Scripts ship only with their focused tests and are validated before the PR is opened.

## Verification

1. Validate every included skill's frontmatter and directory structure.
2. Run focused tests for included Python helpers.
3. Run repository checks proportionate to this documentation-and-script-only change.
4. Inspect the PR diff to confirm it contains only the approved bundle and no excluded workflow.
