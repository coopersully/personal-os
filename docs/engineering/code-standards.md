# Personal OS code standards

- Status: Accepted policy
- Policy revision: 4
- Adopted: 2026-10-18

These standards give authors and reviewers a common engineering bar. Apply them through the
[acceptance contract](acceptance-contract.md), including its material-change boundary and explicit
migration exceptions. Existing documents linked below retain their domain authority. The rules
establish required direction; they do not assert that all legacy code already conforms.

Each standard is required for new and materially changed behavior. Rows marked **invariant** also
apply to the relevant unchanged execution/data path. Evidence below is illustrative of the required
proof, not a mandate to run every kind of test for every edit. Deterministic enforcement is identified
where it already exists; semantic conformance still requires review.

## Ownership and contracts

| ID | Required standard | Acceptance evidence |
| --- | --- | --- |
| CS-01 Domain ownership | Keep schemas/invariants in domain contracts, data access in the database owner, provider protocols in connectors, authenticated behavior in the API, typed calls in the API client, and presentation in feature modules. MCP remains a stateless API adapter. Shared infrastructure must not acquire workspace judgment. | Trace a changed operation through its owners and affected consumers against [system shape](../architecture/0001-system-shape.md) and [feature ownership](feature-ownership.md). |
| CS-02 Thin composition | Composition roots wire dependencies and register features; they do not implement domain decisions or construct alternate policy paths. Coordinate Integration-owned edits. | Show the owning service/feature and its injected dependencies. Review registration changes and unchanged consumers; do not infer conformance from an import alone. |
| CS-03 One authoritative contract | Extend canonical schemas and typed interfaces rather than inventing competing client/MCP shapes, policy copies or authoritative records. Validate untrusted inputs at the owning boundary; preserve stable provenance and revision semantics. | Contract tests, consumer/type checks and inspection of source-of-truth ownership. Derived view models remain explicitly derived. |
| CS-04 Responsibility and abstraction | Give modules/functions a coherent responsibility and explicit inputs, outputs and side effects. Extract shared behavior when it has a real shared owner and invariant; keep distinct domain semantics separate. Avoid boolean mode combinations or generic frameworks that conceal different workflows. | Demonstrate a concrete call path and maintenance task. A reader should not reconstruct hidden policy from unrelated modules. No arbitrary file-length, function-count or abstraction quota. |

## Correctness and safety

| ID | Required standard | Acceptance evidence |
| --- | --- | --- |
| CS-05 Tenant isolation — invariant | Bind reads, mutations, caches, searches, jobs, notifications, audits and links to the authenticated owner. Provider IDs, display names and model inference cannot establish ownership. | Negative cross-owner tests at the actual boundary and inspection of storage/query/claim keys; a happy-path fixture is insufficient. |
| CS-06 Action authority — invariant | Enforce scopes and declared action policy in the API/domain. Preview, approval and execution use verified identity and intended scope. Knowledge, external text and inferred intent cannot grant mutation authority. | Denied-scope/policy tests and the actual authorization-to-effect path, including changed consumers. Follow [feature ownership](feature-ownership.md) and [MCP contracts](../mcp.md). |
| CS-07 State and concurrency | Model meaningful lifecycle states and legal transitions explicitly. Bound duplicate effects through idempotency, concurrency control or reconciliation. Preserve independently successful work and distinguish partial failure. | Tests for relevant retries, stale versions, concurrent claims and interrupted transitions; identify transaction boundaries and who owns recovery. |
| CS-08 External and durable work | Persist accepted work before it can outlive its caller. Define deadlines, downstream timeouts, capability/freshness, recovery and observation. No fire-and-forget promise may stand in for durable delivery. | Apply [external-boundary reliability](external-boundary-reliability.md) and [connector reliability](connector-reliability.md), including a production-disconfirming case and remaining live proof. |
| CS-09 Persistence integrity — invariant | Preserve published migration history and existing data. Schema, SQL and journal describe the same transition. Use bounded, resumable backfills and compatible rollout when required. | Generated SQL review, fresh migration checks and relevant existing-row preservation tests under [database migrations](database-migrations.md). |
| CS-10 Audit and privacy — invariant | Preserve required mutation audit identity, policy, source and redacted changes. Keep credentials and sensitive payloads out of logs, reports, URLs and review artifacts. Errors must remain actionable without disclosing secrets. | Inspect effect/audit consistency and redaction; test relevant failure paths and sensitive-field handling under [system shape](../architecture/0001-system-shape.md). |

## Experience and maintainability

| ID | Required standard | Acceptance evidence |
| --- | --- | --- |
| CS-11 Honest outcomes — invariant | Represent pending, stale, blocked, failed and confirmed outcomes truthfully. OS acceptance, a queued request or healthy process is not proof of the promised external effect. | Inspect state transitions and failure/recovery behavior through the user and agent surfaces; verify what each success claim actually proves. |
| CS-12 Shared experience | Use the owning design tokens, primitives, semantic icon registry and domain patterns. Settings errors and discrete action feedback use Sonner; successful background autosaves stay silent. Preserve native semantics, keyboard/focus access and responsive task priority. | Existing theme/icon checks plus focused behavior and realistic visual/accessibility evidence under [design governance](../design/governance.md), [system](../design/system.md), and [feedback](../design/feedback.md). Sonner regressions assert delivery and absence of inline action-result copy. |
| CS-13 Explicit failure and dependencies | Make failure, cancellation and dependency behavior visible at the owning boundary. Do not swallow exceptions, manufacture success/empty results for failed reads, or hide dependencies in mutable globals. Translate errors where the caller can act on them. | Trace a failure from dependency through service to caller, including redaction and recovery. Preserve documented partial-result contracts rather than globally failing healthy siblings. |
| CS-14 Behavioral verification | Test observable invariants at the narrowest effective layer, including meaningful negative and recovery cases. Mocks must not implement the protection being tested. Keep tests deterministic; preserve coverage floors and required assertions. | Demonstrate why a missing/broken guard would fail its regression test. Use integration tests for persistence/auth boundaries and desktop/mobile acceptance for cross-surface user flows when relevant; see [delivery verification](delivery-verification.md). |
| CS-15 Change clarity | Name concepts consistently, keep control/data flow understandable, and document non-obvious constraints at their owner. Remove obsolete paths made unnecessary by this change. Do not mix unrelated refactors into a behavioral fix or introduce speculative compatibility aliases. | A concrete explanation of changed behavior, affected callers, retained compatibility and why an abstraction or exception exists. Formatting/style is enforced by configured tooling, not reviewer taste. |
| CS-16 Durable truth | Update the nearest canonical contract when durable behavior or architecture changes. Keep planned direction, implemented behavior, verified runtime capability and temporary delivery state distinct. | Current docs match the accepted scope and evidence; link them through the [PR rubric](pr-rubric.md). Do not claim a target capability shipped merely because its document exists. |

## Reuse and verification efficiency

| ID | Required standard | Acceptance evidence |
| --- | --- | --- |
| CS-17 Owned reuse and SOLID | Reuse authoritative domain operations and common mechanics at their existing owner. Keep responsibilities coherent, interfaces consumer-sized and dependencies explicit; interchangeable adapters preserve contract semantics. Follow [code placement](code-placement.md). | Name the shared invariant, owning module, real consumers and preserved behavior. Explain intentional duplication where domain semantics differ. No generic utils dumping ground or speculative inheritance/framework. |
| CS-18 Efficient verification | Choose checks from affected behavior and dependency closure, assign one execution owner, and reuse valid candidate-bound evidence. Keep offline decisions separate from provider collection. Measure cost before optimizing. | Check selection rationale, inputs/revision, elapsed time and result; follow [verification efficiency](verification-efficiency.md). Faster iteration never waives complete final verification or weakens assertions. |

The [research rationale](standards-research.md) links primary engineering guidance and explains
its adaptation to nohmi. These standards are enforceable review criteria, not a claim that every
enterprise principle is mechanically detectable.

## Product identity (CS-15)

Apply the [naming contract](../product/naming.md) in every implementation and review:

- Internal engineering prose calls the application **Personal OS**. Repository, package and
  infrastructure identifiers use `personal-os`; code uses `PersonalOs` / `personalOs` when an
  application-specific name is needed, and constants/environment variables use `PERSONAL_OS`.
  Neutral domain names remain appropriate; do not add a product prefix to every symbol.
- All product-facing text uses **nohmi**, lowercase, including signed-in screens, accessibility
  labels, browser/PWA/native display names, notifications, exports, downloads, public pages,
  provider consent and agent-facing instructions. The signed-in app is a user-facing surface.
- Keep implementation names separate from displayed values: a `PersonalOsBrandMark` component
  displays `nohmi`; a Finance download is named `nohmi-finances-…csv`.
- Inspect both definitions and consumers after a rename, including generated metadata, native
  targets/bridge symbols, build scripts, query keys and tests. Verify displayed names through
  the relevant existing behavior tests and build checks.
- Persisted keys, serialized values and deployed integration identifiers require the explicit
  migration described in the naming contract. Preserve existing state and reachability while
  that migration is pending; do not silently reset data, rewrite historical evidence, or invent
  compatibility aliases to make a source-only rename appear complete.

This makes the existing accepted naming contract explicit under CS-15; it adds no new standard ID
and does not claim the documented runtime migration is complete.

## Introducing and changing patterns

Before making a new pattern required, record the problem, concrete consequence, owning layer,
applicability, reference implementation or proposed example, verification method and adoption
boundary in the nearest canonical document. A pattern can become required for future changes before
legacy migration finishes; label examples as proposed until implemented and verified. Track the
legacy migration separately. Accepted standards cannot be overridden by a convenient existing
implementation or by a model's preferred framework.

Do not require speculative layering, universal factories, blanket repository rewrites, arbitrary
size thresholds, or tests that merely repeat implementation syntax. A stricter bar means stronger
behavioral contracts and evidence, not more boilerplate. Proposed improvements stay advisory until
the maintainer adopts them; reviewers may still report independently demonstrated defects.

Changes to these standards must explain their applicability and adoption impact. Preserve stable
IDs; retire rather than reuse them for unrelated requirements. Update policy revisions when changing
normative requirements and retain the historical policy through Git. A candidate changing its own
governing rule needs independent assessment and explicit maintainer adoption before that rule can
justify its acceptance. Mechanical check additions and deep-review/handoff integration must state
what they actually enforce instead of claiming all semantic standards are automated.
