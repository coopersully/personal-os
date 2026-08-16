---
name: ilo-knowledge-base
description: Find, apply, and update Personal OS's authoritative engineering-facing product, architecture, design, deployment, release, MCP, and development documentation. Use when implementation, review, planning, or debugging needs durable repository context or reveals behavior future engineers and agents must know.
---

# Personal OS knowledge base

Use current repository docs as durable product and engineering truth. Do not infer behavior from
code names, an old PR, or a historical plan when a current document exists.

## Route to the narrowest current docs

| Need | Read |
| --- | --- |
| System boundary and technology | `docs/architecture/0001-system-shape.md`, `0002-technology.md` |
| Finance invariants | `docs/architecture/0003-finance-intelligence.md` |
| Workspace Ilo product doctrine | `docs/product/ilo-workspace-stewardship.md` |
| New workspace Ilo charter | `docs/product/workspace-ilo-charter-template.md` |
| Workspace stewardship architecture | `docs/architecture/0004-workspace-ilo-stewardship.md` |
| Product scope and acceptance | `docs/product/mvp.md`, then the relevant master-plan section |
| Product model and interaction contract | `docs/product/master-design.md`, `experience-standards.md` |
| Challenged assumptions and safety gates | `docs/product/assumptions-audit.md` |
| Current delivery record | `docs/product/implementation-log.md` |
| Brand and experience principles | `docs/design/foundations.md` |
| UX refinement and design-rule governance | `docs/design/governance.md` |
| UI system and page behavior | `docs/design/system.md`, relevant file under `docs/design/pages` |
| Feature ownership and composition seams | `docs/engineering/feature-ownership.md` |
| Database rollout | `docs/engineering/database-migrations.md` |
| Settings UI | `docs/engineering/settings-ui-standards.md` |
| PR author/reviewer rules | `docs/engineering/pr-rubric.md` |
| Public MCP contract | `docs/mcp.md` |
| Hosted operations | `docs/deployment.md`, `infra/README.md` |
| Releases | `docs/releasing.md` |

Read only the relevant sections and the repo-local implementation skills for the changed surface.

## Keep durable truth current

Update the nearest current doc in the same change when behavior, source-of-truth ownership, API/MCP
contracts, authorization, policy levels, connector capability/freshness, synchronization,
deployment, recovery, or established engineering patterns change.

Durable knowledge is information a future contributor needs to avoid guessing. Keep transient
progress in GitHub Issues/PRs; keep commands and operational contracts in current docs; keep
implementation detail in code and tests.

Do not promote `docs/product/master-plan.md` intent to shipped truth without checking the
implementation log and code. When docs disagree, identify the conflict, resolve it from current code
and authoritative contracts, then update the misleading current doc rather than silently choosing.

The workspace-stewardship doctrine is a target product contract. When applying it, name the target
capability separately from the current implementation slice. A client prompt, coding-agent skill,
or proposed plan is not evidence that the runtime Ilo capability has shipped.

## Completion gate

- Read the current docs that govern the change.
- Confirm code, tests, and docs describe the same contract.
- Update the implementation log only for meaningful delivered capability or changed project state,
  not routine refactors.
- Keep secrets, PII, provider payloads, private reasoning, and ephemeral debugging evidence out of
  docs.
- Link updated current docs in the PR work map.
