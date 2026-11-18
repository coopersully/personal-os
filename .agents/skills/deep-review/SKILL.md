---
name: deep-review
description: Review nohmi proposals, local changes or PRs against repository acceptance gates and code standards with independent specialists; also use for PR refinement.
---

# nohmi deep review

Read `docs/engineering/acceptance-contract.md`, `code-standards.md`, `code-placement.md`, and the
relevant canonical domain/design documents routed by `agent-context.md`. This repository workflow
owns nohmi acceptance; it does not require a personal skill installation. Review is read-only,
except for requested private evidence artifacts. It does not authorize repairs, external posts,
tracker writes, merges or deployments. Assigned network roles remain in force.

## Product intent is a required review lane

Read the mission, product promise, motivations and target user jobs in `docs/product/master-design.md`,
then the relevant workstream/dependency sections of `docs/product/master-plan.md`. Apply current
`workspaces.md`, `workspace-stewardship.md` and `user-knowledge.md` where relevant. Follow
`agent-context.md` for source precedence: proposed plans are direction, not shipped facts or permission
to expand this PR. Resolve conflicts against current canonical decisions; report unresolved conflicts.

Record under AC-02 which user outcome/motivation this change serves, how it fits the master plan,
which established behavior must remain, and any deviation with decision evidence. Tooling changes
explain how they support trustworthy, bounded agent execution rather than invent a new product feature.
Reject implementation that passes tests but contradicts accepted intent. Do not require unrelated
future roadmap work in the PR. Include this product-intent assessment in the experience lane and
final report; missing alignment evidence is incomplete, not implicitly passed.

## Pin and scope

Record repository, worktree, PR title/URL when present, source head, base/merge-base, policy revision
from `acceptance-policy.json`, and any explicitly included dirty-file snapshot. Establish intended
behavior, direct issue criteria, relevant human decisions, impacted contracts and unchanged consumers.
A proposal review can judge the proposal but cannot produce implementation acceptance. A local dirty
review is useful feedback; shipping requires rebinding evidence to a committed, pushed candidate.

Assign every CS ID a concrete applicability rationale. Group related standards into lanes; do not
run a separate agent or test suite for every ID. New/materially changed behavior must comply;
legacy exceptions follow the contract and cannot be self-approved. Treat missing evidence as
incomplete, never as a clean pass. Identify the production acceptance criteria and their owner now.

## Independent assessment

For substantive changes, dispatch fresh read-only internal specialists in bounded batches:

- Architecture/maintainability: placement, domain ownership, DRY, SOLID, contracts and consumers.
- Correctness/security: identity, authorization, data integrity, state, retries and privacy.
- Experience: user job, shared patterns, honest states, keyboard/focus and responsive behavior.
- Verification/operations: meaningful tests, external boundaries, migration, recovery and release proof.

Give reviewers raw target facts, applicable requirements and source locations, not the implementer's
verdict or another model's conclusions. Reviewers do not edit, post or spawn nested reviewers.
For a narrow change, combine lanes with explicit coverage reasons; do not skip a required concern
because the first reviewer found nothing. If independent delegation is unavailable, report useful
self-review but leave AC-03 incomplete for shipping. Honor no-delegation requests.

Assign one verification owner. Reuse valid current-candidate check receipts. Other reviewers request
only a named missing check; they do not each rerun types, coverage or E2E. Follow
`docs/engineering/verification-efficiency.md`. Use focused execution only for an unresolved question.

## Adjudicate and record

Validate every finding against a named standard, actual trigger or maintenance consequence, affected
consumer and bounded remedy. Resolve disagreements from evidence, not votes or model prestige.
Keep optional design suggestions separate from required violations. Do not use DRY as a reason to
merge different domain rules into a generic utility. Preserve intentional documented tradeoffs.

Return severity-ordered findings and coverage with pass/fail/incomplete/not_applicable dispositions.
Save the `acceptance` record described in `../ship-it/references/acceptance-state.md` when requested
by handoff. Reviewer identities must be distinct from implementers; a bot check or author claim is
not independent acceptance. Inspect exception authority/expiry/containment and link the actual
records. The local validator checks shape and binding; it cannot authenticate a reviewer or proof.

Recheck head/base and relevant policy before finalizing. After repairs, inspect affected standards
and consumers again; retain valid unaffected evidence with an explicit carry-forward rationale in
the new report. Do not loop entire reviews until every model reports zero findings. A failed or
incomplete required standard blocks acceptance even if no additional defect was found.

Publish only through the repository review-pr workflow under matching authority. Send accepted
findings to the owning worker for fixes; independent reviewers never become implementers of the
candidate they are certifying. Report exact remaining evidence and production-only gates.
