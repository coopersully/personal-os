# nohmi acceptance contract

- Status: Accepted policy
- Policy revision: 3
- Adopted: 2026-10-18

This contract defines how nohmi changes earn acceptance. It applies to human and agent authors
and reviewers equally. The [code standards](code-standards.md) define engineering requirements;
the [PR rubric](pr-rubric.md) defines work identity and review presentation. Domain, product,
design, security, and operational documents remain authoritative for their specific contracts.
This index does not replace them or grant permission to implement, publish, merge, or deploy.

## Adoption and applicability

The default is **required for new and materially changed behavior, with explicit migration
exceptions**. Material change means changing an observable result, contract, authorization or
ownership boundary, persistence, dependency, side effect, lifecycle, recovery path, or user
interaction. A mechanical rename or formatting change alone does not require redesigning a module.
A shared-contract change requires examining affected unchanged consumers as well as the diff.

For each requirement, identify the actual affected behavior and consumers. New code may not copy
a legacy violation merely for consistency. A small fix need not migrate an entire surrounding
subsystem: enforce the standard on the changed responsibility and inspect its dependencies for
correctness. If compliance needs a larger migration, use the explicit exception process below.
Moving code without changing its responsibility does not erase an existing migration obligation.

| Adoption state | Acceptance effect |
| --- | --- |
| Proposed | A documented candidate pattern; cannot block acceptance solely on its own authority. |
| Required for new/materially changed behavior | Applies to the changed responsibility and affected contracts; unrelated legacy divergence is recorded separately. |
| Required invariant | Applies across the relevant execution and data path, including unchanged dependencies. |
| Migration exception | An approved, bounded departure from a named requirement; never an implicit exemption for a whole directory. |

Existing tenant isolation, authorization, privacy, data integrity, migration immutability, and
truthful operation-state requirements remain invariants. This adoption policy does not weaken
existing requirements or retrospectively declare current implementation compliant. Discovering an
unrelated pre-existing defect creates a separately owned follow-up; a defect the change relies on,
exposes, or worsens is part of its acceptance. Active security or production incidents follow their
incident process regardless of PR scope.

Design maturity (trial, established, required, deprecated) continues to follow
[design governance](../design/governance.md). A trial is not promoted to a required standard by a
reviewer's preference. An established rule's rollout into legacy code still needs an explicit
applicability decision.

## Acceptance gates

Gate IDs are stable. Each gate is assessed for the candidate and milestone, with specific standard
IDs where applicable. A gate applies only to its named surface; explain non-applicability rather
than manufacturing irrelevant work. Evidence depth follows risk, not changed-line count.

| Gate | Requirement and evidence | Required milestone |
| --- | --- | --- |
| AC-01 Scope and identity | Observable outcome, acceptance criteria, repository/branch/PR identity, direct Nohmi issues and reciprocal links agree. Use the [work-context contract](work-context.md). | Before merge |
| AC-02 Product and standards | Mission, motivations, target user jobs, master-design and relevant master-plan alignment are explicit; applicable product and code standards are mapped to changed responsibilities and consumers. Evidence demonstrates the intended behavior; exceptions are valid and bounded. | Before merge |
| AC-03 Independent assessment | A reviewer distinct from the implementer examines the candidate and applicable concerns, validates findings, and states coverage gaps. Author self-review and bot coverage alone do not satisfy independent acceptance. | Before merge |
| AC-04 Verification | Focused behavior/negative-case evidence plus complete candidate verification under [delivery verification](delivery-verification.md). Required scoped/platform checks also pass. No unexplained failure or weakened check. | Before merge |
| AC-05 Operational readiness | Relevant migration, external-boundary, release, recovery and production observation plans identify owners, safe actions and required evidence. Post-deploy-only evidence is explicitly pending. | Before merge |
| AC-06 Protected merge | Current head/base, required checks, eligible approvals, substantive CodeRabbit coverage, resolved conversations and normal merge authority satisfy the existing ship-it gates. No bypass or self-approval. | Before merge |
| AC-07 Production acceptance | Release provenance establishes that the deployed revision contains the accepted change; required deployment checks, health and change-specific smoke/observation evidence pass. | Before claiming shipped to production |
| AC-08 Reconciliation | Issue status reflects its full acceptance scope; remaining work and ownership are explicit. Delivery evidence and authorized cleanup are reconciled. | Before closing delivery ownership |

The repository deep-review skill supplies AC-03 evidence. The offline readiness evaluator checks
its revision, independent identities, complete standard dispositions and production plan before
MERGE; it does not authenticate reviewer identity or replace protected server checks. Record the reviewer identity/role and what it actually
inspected. Fresh-context agent reviewers receive requirements, raw sources and relevant human
decisions, not the author's verdict as evidence. Apply the existing network role boundaries.
Review findings need a named requirement, concrete trigger or maintenance consequence, affected
consumer, and proportionate remedy. An applicable required-standard violation can block without
being an observed production bug; unsupported style opinions cannot.

AC-07 is not a pre-merge demand to deploy an unmerged candidate. Before merge, AC-05 defines how
production-only proof will be obtained. Afterwards, unavailable or failed proof leaves delivery
pending or blocked. Healthy endpoints alone prove neither revision identity nor feature behavior.
A later deployed descendant may satisfy provenance if it contains the accepted change and has not
reverted it. Record that actual revision. For documentation-only work, explain why runtime
deployment is not applicable; do not invent a production behavior change.

## Evidence and decisions

Use the existing PR/review record and private delivery checkpoint rather than creating a second
task tracker. A compact acceptance record contains:

- Policy revision and the source revision of the applicable standards.
- Candidate head, base/merge-base and, when reviewing local work, the included dirty-file snapshot.
- Gate/standard ID, applicability and affected paths/contracts/consumers.
- Result: `pass`, `fail`, `incomplete`, or `not_applicable`, with rationale.
- Evidence: inspected source/test, check command/environment/run/attempt/result, review identity,
  or deployment revision and observation record, as appropriate.
- Any exception reference, unresolved finding, responsible owner, and next evidence required.

`pass` means demonstrated conformance. `fail` means a demonstrated violation. `incomplete` means
required evidence is missing or cannot establish the result. `not_applicable` requires a concrete
scope reason. No finding, a model's confidence, a resolved thread, or a completed subprocess alone
is proof of a pass. A valid exception is recorded as an explicit **accepted exception**, alongside
the underlying conformance result; it must never be relabeled as proof of conformance.

A milestone is accepted only when every required applicable gate passes or its specific eligible
deviation has a valid approved exception. Missing required evidence is not a pass. An exception
cannot waive another gate or a protected server check. Claim merge readiness, merged, deployed,
and production-accepted separately. Product issues close only when their own full criteria are met.

Source, base/integration context, or policy changes require reassessing affected evidence before
acceptance. Preserve valid unaffected evidence and follow the existing verification invalidation
rules; metadata-only changes do not trigger unrelated test suites. Policy changes cannot silently
reuse receipts from a weaker policy or certify their own enforcement.

## Migration exceptions

An exception is a temporary adoption decision, not an agent's permission to ignore a rule.
The author or reviewer may propose it; the human maintainer must explicitly approve it, unless a
prior human grant specifically delegates that class of standards exceptions. Routine implementation,
review, or shipping authority does not include exception approval. No authoring agent may approve
its own exception. Existing explicit decisions can supply approval if their scope still matches.

Record these fields in the nearest canonical owning document and link that record from the PR:

| Field | Required content |
| --- | --- |
| Identity | Unique exception ID, standard IDs and applicable policy revision |
| Scope | Exact behavior, paths/contracts, consumers and releases covered |
| Reason | Why immediate conformance is impractical; alternatives considered and consequence |
| Containment | Safeguards and verification proving the bounded deviation remains safe |
| Ownership | Accountable migration owner and direct Nohmi follow-up issue |
| Approval | Approver, authority, decision evidence and approval date |
| Exit | Observable conformance condition and an expiry date or explicit release milestone |

Expired, unapproved, expanded, or uncontained exceptions block the affected acceptance. Revalidate
an exception when its behavior or consumers change. Extending one requires a new explicit decision;
an agent cannot reset expiry to pass a gate. Mark it closed only with evidence of conformance.
Keep delivery progress in Linear; keep the durable exception contract in the owning document.

Migration exceptions cannot authorize cross-user access, missing action authority, secret exposure,
known data corruption, rewriting published migrations, false success claims, weakened required
verification, or protection bypass. Changing such an invariant requires a separately approved
product/security/operational decision, not this exception mechanism. No exceptions are granted by
the creation of this document.

## Enforcement boundary

Deterministic properties belong in repository checks, types, tests and server protections.
Semantic behavior and maintainability require evidence-backed review; live capability requires
runtime evidence. A model-generated acceptance record is input to judgment, not an authenticated
check result. Never let the candidate authorize its own waiver or weaken its acceptance policy.

The repository deep-review and handoff skills implement the review and delivery procedures.
The machine-readable [policy inventory](acceptance-policy.json) supplies the current revision,
standard IDs and non-exception requirements to the shared offline evaluator. Ship-it retains all
existing protected merge checks and now requires independent acceptance before MERGE. A merged
result is terminal for merging only. Its completion checkpoint requires production acceptance and
reconciliation, or an independently reviewed non-runtime disposition. Evidence assertions still
require inspection of authentic sources; local fixtures do not prove live provider capabilities.

The serialized acceptance record follows
[acceptance state](../../.agents/skills/ship-it/references/acceptance-state.md). For deterministic
expiry evaluation, serialized exceptions use a concrete ISO expiry date even when the canonical
exception also names a release milestone; the owner verifies the milestone has not already elapsed.
Changing the policy inventory or standards requires explicit maintainer adoption and independent
assessment; the candidate cannot manufacture its own waiver.
