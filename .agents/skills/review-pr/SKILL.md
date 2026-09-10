---
name: review-pr
description: Use when reviewing one nohmi pull request for correctness, architecture, scope, tests, security, privacy, data integrity, documentation, deployment, or maintainability.
---

# Review PR

Review as a senior maintainer. This skill reviews; it does not implement fixes unless the user asks.
Default to a read-only review draft. Post to GitHub only when the user explicitly authorizes posting.

## Collect context

1. Resolve the PR and fetch live metadata, files, commits, issue relationships, checks, reviews, and
   review threads through the GitHub app or `gh`.
2. Read the full patch and surrounding code for every possible finding.
3. Read `AGENTS.md`, `docs/engineering/pr-rubric.md`, `docs/engineering/work-context.md`,
   `../linear-context/SKILL.md`, `../ilo-knowledge-base/SKILL.md`, the current docs it routes to,
   and applicable implementation/testing skills.
4. Build a concise context: intent, linked Nohmi issue acceptance/status, Work map and reciprocal
   structured backlink coverage, changed surfaces, public contracts, migration/deployment impact,
   existing feedback, and CI state.

Do not review from the diff alone when behavior depends on neighboring abstractions or composition.

## Review lanes

Check in this order:

1. **Correctness and data integrity** — failure paths, races, stale state, transactions, recurrence,
   provider reconciliation, and audit behavior.
2. **Security and privacy** — authn/authz, policy enforcement, secret/PII exposure, injection,
   cross-account boundaries, and unsafe agent capability.
3. **Architecture** — domain ownership, provider boundaries, API-client parity, thin composition
   roots, MCP statelessness, and duplicated rules.
4. **Experience** — immediate user job, information hierarchy, design-rule ownership, shared
   primitives/tokens, honest states, accessibility, responsive priority, and agreement with the
   relevant design foundation, system, governance, and page contracts.
5. **Tests** — focused contract coverage, negative cases, responsive UI flows, migrations, and no
   weakened thresholds.
6. **Operations and compatibility** — migration order, rollout, health, recovery, observability,
   environment contracts, and backward compatibility.
7. **Scope and docs** — diff matches title/body/direct Linear issues, the Work map and backlinks
   agree, the diff excludes churn, and current docs remain true.

Treat bot findings and resolved threads as signals, not proof. Verify the pushed head.

## Finding standard

Report only actionable, evidence-backed findings:

- priority `P0`–`P3`;
- tight file/line anchor when possible;
- concrete failure or future defect;
- why it matters in ilo;
- smallest sound remediation.

Block only for correctness, security/privacy, data loss, architecture, accessibility, broken
design-system contracts, migration/rollback, verification, required Nohmi Linear coverage, or
durable-doc gaps that should not merge. Separate pre-existing issues unless this PR worsens or
depends on them. Drop style nits without material user or maintenance value.

Use `::code-comment{...}` for local inline findings when supported. For a proposed GitHub review,
show the exact inline body and target before posting.

## Posting

- “Review” without posting language stays read-only.
- “Review and post” authorizes one scoped GitHub review after a fresh collision check.
- Request changes only for blocking findings.
- Do not approve unless explicitly asked.
- Prefer inline comments; use one concise top-level comment only when no changed line is a valid
  anchor.
- Re-read head SHA, checks, and existing human feedback immediately before any write.

## Output

Use the PR workflow output contract in `docs/engineering/pr-rubric.md`. Lead with findings ordered by
priority, then open questions, Linear coverage, verification performed, and residual risk. Say
clearly when no actionable finding exists. Review remains read-only unless the user separately
authorizes a GitHub review post; never mutate Linear during review.
