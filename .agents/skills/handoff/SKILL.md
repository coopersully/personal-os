---
name: handoff
description: Take delivery ownership of a nohmi worktree or PR through independent acceptance, protected merge and verified production delivery. Use for ship it, land this, or take this worktree through production.
---

# nohmi delivery handoff

“Ship it” delegates responsibility for the agreed outcome through verified production delivery.
It is not a claim that the work is ready or already deployed. Use the repository ship-it engine
and its checkpoint/evaluator scripts; do not create a competing merge procedure or registry.

Use `docs/engineering/development-handbook.md` and its offline planner to identify missing steps
and reusable receipts. This does not replace this skill's authority, role or acceptance gates.

## Accept responsibility safely

Read `AGENTS.md`, `docs/engineering/acceptance-contract.md`, `delivery-verification.md`, and
`../ship-it/SKILL.md`. Resolve the actual worktree, branch, dirty/untracked work, source/base,
PR (if one exists), scope, direct issues, existing owner, active children and verification processes.
Preserve uncommitted work and pending operations. Never reset or clean the tree as a handoff step.

Use the current chat as delivery owner unless the user explicitly requests a different existing or
new chat. A role change is not an automatic UI/worktree move. No other owner may keep editing after
transfer. Have the current owner stop its workers/processes and use checkpoint transfer with
stopped evidence; the receiver reads and acknowledges the claim before writing. No takeover on age.
If the owner is unavailable, retain the ownership blocker; do not forge its identity.

Before a PR exists, claim `<repository-url>#worktree:<canonical-absolute-path>` using the same
checkpoint registry. Record scope, checkout, worker and authority. After PR creation, acquire its
canonical URL claim, carry forward the checkpoint/evidence, and release the worktree claim only
after both records agree and pending operations are reconciled. Never release a claim to evade
an active owner. Claims are cooperative local coordination, not cross-host authentication.

## Preserve roles and deliver

An assigned orchestrator retains delivery/acceptance/merge ownership and delegates every code,
test, configuration, conflict and documentation repair to its worker. A worker receiving “ship it”
prepares the handoff to its authorized orchestrator; it does not acquire merge authority. Ordinary
contribution chats may implement under the existing ship-it scope, but need independent reviewers.
Do not adopt an automation-head/network role merely because this skill is invoked.

The receiving owner executes the ship-it convergence/final-merge gates unchanged, using repository
deep-review for AC-02/03 and focused verification while repairing. Reuse valid evidence; run the
complete final verification once per stable candidate. No admin bypass, deferred auto-merge,
self-approval, waived CodeRabbit coverage, or relaxed conversation resolution.

After verified merge, keep the claim and wakeup active. Follow
`../ship-it/references/production-delivery.md` to verify deployed provenance, health and the
reviewed production criteria, then reconcile the full issue scope. Report merged, awaiting release,
blocked, shipped, or complete-without-runtime-deployment accurately. Completion requires the local
production evaluator and inspected provider evidence. A saved checkpoint alone is not a wakeup.

Only explicit merge intent (such as “ship it” or “get this merged”) permits normal protected merge
and observation of the configured production deployment
path within scope. It does not grant ad hoc production writes, provider effects, manual migrations,
rollback, secret changes or protection bypass. Prepare scoped recovery and route those operations
to their existing authorized operator when needed. Never manufacture production traffic/effects
for a smoke test without corresponding authorization.

A request merely to transfer context or prepare a handoff does not grant merging. Preserve an existing
explicit scoped grant without re-confirming it later; record it in the checkpoint. Without that grant,
prepare reviewed work and report readiness. Later user pauses/revocations supersede earlier authority.
