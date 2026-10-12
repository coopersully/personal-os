# Finance and Texting Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining Finance, Texting and shared toolkit requirements without rebuilding delivered foundations or introducing an internal agent.

**Architecture:** Three domain-owned plans share typed knowledge, native work references and existing authorization. Integration owns composition seams. Land small complete slices; retain native receipts and expose unavailable capabilities until their real implementation is ready.

**Tech Stack:** Existing TypeScript/Zod, Hono, PostgreSQL/Drizzle, React, MCP, Vitest and Playwright; no new model runtime or vector database.

**Spec:** [Detailed completion specification](../specs/2026-10-12-finance-texting-completion-design.md), refining the September [shared toolkit](../specs/2026-09-28-shared-agent-toolkit-design.md), [Finance](../specs/2026-09-28-finance-toolkit-design.md), and [Texting](../specs/2026-09-28-texting-toolkit-design.md) designs.

## Global Constraints

- nohmi is the account's persistent brain, storage, workflows and tools; it never contains a built-in agent.
- One person's USD finances and calendar months; no multi-person financial planning, money movement or required agent host.
- Scopes, consent, owner approval, revisions and domain receipts remain authoritative. Knowledge and work claims never confer execution rights.
- Existing Finance SMS, history, recovery, position, management and agent-access capabilities are reused.
- Shared migration journals and composition roots require coordinated Integration ownership; published migrations are append-only.
- Every new task stays unchecked until it has implementation and fresh acceptance evidence. Planning is not delivery.
- Technical defaults in the completion spec are proposed implementation decisions, not saved account preferences or production settings.

## Review Focus

- Cross-agent retrieval after scope revocation must respect current access, even with an old cursor (S3/S5).
- Duplicate provider evidence and pending replacements must not double count cash or erase corrections (F2/F9).
- Two concurrent effects must not spend the same policy capacity or goal cash (F3/F7).
- Reply ambiguity and uncertain provider acceptance must never become invented approval or blind resend (T3/T4/T7).
- Late source changes, period boundaries and timezone edits must preserve original approvals and cumulative usage (F5/F6/T6).

## Read and execute

1. Read the [source reconciliation](../../engineering/finance-texting-spec-reconciliation.md) and the detailed specification.
2. Follow the owning subsystem plan; its task IDs are stable references, not issue-tracker IDs.
3. At execution, inspect current main again. If a task's acceptance already passes through the real registered path, preserve it and record evidence instead of rewriting it.
4. Implement, test and review each slice before its dependent slice. Each task contains a failing-test step, implementation contract, focused verification and proposed commit.
5. Run full `pnpm verify` for a reviewable implementation slice and follow repository PR/Linear requirements if opening a PR. This planning request does not itself create issues, PRs, deployments or external messages.

| Plan | Tasks | Deliverable |
| --- | --- | --- |
| [Shared toolkit](2026-10-12-shared-toolkit-completion.md) | S1–S8 | Typed knowledge, lifecycle/context, durable work claims, safe resumption, app controls and optional events |
| [Finance](2026-10-12-finance-completion.md) | F1–F11 | Initial plan, qualified truth, goal funding, budget modes, carryover, automatic execution, context, imports and reports |
| [Texting](2026-10-12-texting-completion.md) | T1–T8 | General inbox, child operations, responses, approvals, Reviews, coaching preferences, recovery and end-to-end evidence |

## Dependency and release map

| Milestone | Required tasks | Observable result |
| --- | --- | --- |
| Shared persistent brain | S1–S3 | A second authorized agent retrieves and revises sourced knowledge from an earlier run |
| Generic work access | S4–S5 | Pending native work is discoverable and resumable without a mandatory schedule; legacy host fences remain |
| First usable planning | F1–F4 | Qualified monthly plan and distinct actual goal funding, available in existing app/tool paths |
| First complete conversation | Shared brain/access; F1/F2/F8; T1–T3/T5–T7 | New text, knowledge-aware authored question, exact answer, later-session pickup and visible result |
| Bounded budget automation | F5–F7, policy controls in F11 | Owner-approved limits enforced atomically across races, reversals and monthly usage |
| Broader exact SMS approvals | T4 after F7 | One bound reversible reallocation can be approved, without granting standing policy |
| Full app and domain completion | S6/S8, F8–F11, T8 | Correction/source/reporting/knowledge/recovery journeys pass across app and MCP |
| Optional events | S7 after S4–S5 | Authenticated minimal events complement working polling; external boundary evidence required separately |

S1 and S4 may proceed independently; F1 can proceed alongside both. F2 feeds goal funding and policy
safety. T5 can repair navigation once work references are stable, without waiting for automatic budgets.
F11 and T8 are final acceptance slices, but each earlier task must expose enough app/tool affordance
to inspect its own results; do not leave migrations or privileged operations advertised without a usable path.
Optional events do not block the first conversation, but remain part of the full toolkit target.

## Requirement coverage

| Requirement in original designs | Owning tasks |
| --- | --- |
| Shared toolkit §§1–4: boundaries and reuse | All tasks; S4/S5/S8 enforce composition |
| Shared toolkit §5: typed lifecycle, cross-agent reuse, conflicts | S1/S2/S3/S6 |
| Shared toolkit §6: relevant context and self-contained tools | S3/S8; F8/F11; T3 |
| Shared toolkit §7: claim, receipt, safe handoff | S4/S5; T2/T3/T7 |
| Shared toolkit §8: polling and optional events | S5/S7 |
| Shared toolkit §§9–10: migration/deletion/verification | S1/S2/S6/S8; every new persistence slice |
| Finance §4: sources, imports, corrections, economic recognition | F2/F9 |
| Finance §5: one qualified position, scenarios and forecasts | F1/F2/F3/F10 |
| Finance §6: progressive setup, exact plans, groups/envelopes/zero-based | F1/F4/F11 |
| Finance §7: carryover, late corrections and period identity | F5/F6 |
| Finance §8: bounded allocation, exact approval and usage | F6/F7/F11 |
| Finance §9: goals, prospective context, knowledge and future rules | F3/F8; S3/S6 |
| Finance §10: maintenance, questions, reviews, advice, reports and UI | S5/S8; F8/F10/F11; T5/T6 |
| Finance §11: integrated tests and source/provider distinction | F11/T8 |
| Texting §§3–4: new requests, shared discovery and child work | T1/T2/T3; S4/S5 |
| Texting §5: exact approvals and provenance | T4; existing categorization retained |
| Texting §6: adaptive/check-in preference and delivery policy | T6 |
| Texting §7: restart, partial outcomes, uncertain effects, retention | T2/T3/T7 |
| Texting §8: status, unified Reviews and recovery | T5/T7 |
| Texting §9: rollout and real-boundary evidence | T8; S7 optional boundary |

The detailed spec adds concrete choices the broad designs did not fix: five-minute leases,
knowledge bounds and scopes, a narrow deterministic promotion rule, exact automatic percentage math,
explicit transfer eligibility, reply/check-in timing, and optional event delivery limits. These choices
are reviewable here before implementation; none requires an external agent to be hosted or online.

## Definition of done and evidence

- [ ] Every row in the coverage table has fresh passing implementation evidence or an explicit source-backed preexisting implementation.
- [ ] Domain schemas, migration validators, API/client/MCP and app agree on available behavior and authorization.
- [ ] Real PostgreSQL tests cover owner isolation, revocation, concurrent writes, stale revisions, idempotency and deletion.
- [ ] Normal-discovery MCP calls prove the supported workflow, not only tool registration or a successful blocked result.
- [ ] Desktop/mobile acceptance covers initial planning, knowledge correction, replies, approval and recovery.
- [ ] Full repository verification passes; the previous audit's 62 focused passes and busy full-suite attempts do not satisfy future implementation checks.
- [ ] External-boundary records identify actual configuration/authority/transport/recovery evidence and remaining production gaps.
- [ ] No source-ready milestone is presented as a deployed SMS/connector capability without authorized real-path evidence.

Recommended execution method: subagent-driven implementation with one owner per bounded slice and
independent review, because authorization, concurrency and persistence defects have consequences across
subsystems. Shared composition and migration edits must still be serialized. No implementation agents
are dispatched by this planning document; select the execution method after reviewing the documents.
