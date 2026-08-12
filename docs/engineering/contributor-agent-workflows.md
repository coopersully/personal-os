# Personal OS contributor agent workflows

This repository keeps public contributor workflows in `.agents/skills`. They make the handoff between product thinking, implementation, verification, and GitHub delivery explicit, even when contributors are working asynchronously.

## Choose the narrowest workflow

| Situation | Start with | Outcome |
| --- | --- | --- |
| Need established product or engineering context | `$ilo-knowledge-base` | Current authoritative docs and the right implementation boundary |
| Natural-language product outcome needs a delivery map | `$ilo-product-planning` | Read-only, public-safe proposal and duplicate check |
| Need a point-in-time delivery snapshot | `$ilo-current-state` | Read-only GitHub-first delivery state |
| Implement domain changes | `$personal-os-architecture`, then the matching database, frontend, MCP, or testing skill | Domain-owned code and verification |
| Validate a user-facing flow | `$personal-os-qa` | Local browser acceptance evidence paired with committed tests |
| Create or update GitHub delivery work | `$github-work-context`, then `$github-work-sync` | Conservatively linked, non-duplicated Issues and PRs |
| Prepare or update a pull request | `$create-pr` | Scoped, documented, verified draft or ready PR |
| Review feedback, stale bases, or a PR queue | `$resolve-pr-comments`, `$catchup`, `$pr-shepherd`, or `$pr-briefing` | One bounded, evidence-backed maintenance action |
| Review a pull request | `$review-pr` | Read-only findings unless posting is explicitly authorized |
| Check the live release | `$ilo-deploy-status` | Read-only release provenance and health evidence |

The `ilo-*` spellings above are stable invocation identifiers. In documentation and user-facing output, call the product **Personal OS**.

## Delivery loop

1. **Orient.** Read the narrowest current documentation and inspect live GitHub artifacts before inferring intent, ownership, or status.
2. **Plan.** Propose independently shippable work with observable acceptance and verification. Search open and recently closed work before creating an Issue.
3. **Implement.** Keep domain rules in their owning package. Update docs whenever contracts, ownership, operations, or recovery behavior changes.
4. **Verify.** Run focused tests early, then the repository verifier before review. Browser-facing behavior also needs appropriate visible QA.
5. **Deliver.** Link the PR and Issue with `Closes` only when the PR fully completes the Issue; otherwise use `Refs`. Keep the PR body truthful about scope and verification.
6. **Maintain.** Treat checks, conflicts, and actionable reviews as evidence. A maintenance pass takes at most one planned action and never guesses at external state.

## Public-safety rules

GitHub Issues and PRs are a public delivery record, not a personal productivity log. Record only product behavior, engineering constraints, acceptance, verification, and material blockers. Do not include personal content, credentials, raw provider payloads, private reasoning, automation details, or local paths.

Repository documentation is durable engineering truth. GitHub is the source of truth for independently shippable delivery work. Local branches, worktrees, and uncommitted files are useful context but are not delivery evidence.

## Prompt-quality regression rubric

Before changing a workflow, exercise it against these three prompts and confirm the expected boundary:

| Prompt | Expected route | Must not happen |
| --- | --- | --- |
| “Map a desktop companion into public delivery work.” | `$ilo-product-planning` then `$ilo-knowledge-base` and live duplicate search | No Issue, branch, implementation, or recurring-work write without later explicit authorization |
| “What is in flight and what should happen next?” | `$ilo-current-state` with live GitHub evidence | No mutation, inferred ownership, or local-only work presented as shipped status |
| “This PR has a failed check and a review thread.” | `$pr-shepherd`, which selects one next action | No blind push, force-push, routine comment, or unrelated implementation |

The static check below verifies the published skill manifest, metadata, and the highest-risk public-safety exclusions:

```bash
pnpm test:public-agent-skills
pnpm check:public-agent-skills
```

Use the rubric as a review aid; live state still needs to be gathered when a workflow runs.
