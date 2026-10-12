# Finance and Texting spec reconciliation

Reviewed 2026-10-12 against `origin/main` at
`f918b63a91fd8a997af75e9f14b02f53f4305b49`. Merge `03b9886a` incorporated 25 incoming commits
into the design branch. This is a source audit and revised implementation roadmap, not a production
activation record or authorization to send messages.

The target remains the [shared toolkit](../superpowers/specs/2026-09-28-shared-agent-toolkit-design.md),
[Finance](../superpowers/specs/2026-09-28-finance-toolkit-design.md), and
[Texting](../superpowers/specs/2026-09-28-texting-toolkit-design.md) designs. nohmi stores the account's
knowledge and supplies deterministic workflows and tools. External agents reason and manage that
knowledge across runs. No built-in agent, required vendor, cloud host, guaranteed wakeup, or required
agent schedule is introduced. One person's USD finances remain the release scope.

## Requirements satisfied or advanced in source

| Requirement | Evidence and remaining boundary |
| --- | --- |
| Compose Finance questions with SMS delivery | Implemented discovery, resolution and delivery in `apps/api/src/finance-notification-runtime.ts` and `apps/api/src/app.ts`. Consent, notification policy and configuration still gate delivery. |
| Accept exact Finance answers and bounded approvals | Implemented signed reply admission, canonical questions and exact reversible categorization approve/reject. Bare `yes` is not approval; broader proposal kinds remain app-bound. See `apps/api/src/finance/sms-context-completion.integration.test.ts`. |
| Recover interrupted reply and notification work | Startup/tick composition, durable receipts, acknowledgments and independent dispatch stages exist in `apps/api/src/main.ts`, `texting-recovery-runtime.ts`, and `finance-notification-runtime.ts`. Do not rebuild these queues. |
| Capture prospective Finance context | Signed `Finance:` messages preserve verbatim notes and provenance. This does not perform semantic financial interpretation or establish shared typed knowledge. |
| Continue accepted Finance answers | Optional host setup and persisted dispatch exist. `get_finance_continuations` requires a schedule; original connection/grant authority remains enforced by `finance/host-run-authority.ts`. General same-account work retrieval and explicit transfer are still needed. |
| Inspect Finance history and exact evidence | Bounded case history, immutable evidence and deletion handling exist. Retain these records and extend references rather than duplicating history. |
| Manage Finance through agent tools | Actual MCP policy management, contextual questions, settings, approvals and bank handoffs have expanded. Execution scopes plus owner-enabled bypass apply to registered operations; owner security controls remain owner-only. See [capability boundaries](workspace-agent-capabilities.md). |
| Compute qualified position and preview policy | Position is wired into budget evaluation and maintenance checkpoints. Dollar limits and protected floors exist. Usage is unavailable, execution is false, and first-plan setup still reports unavailable position. |
| Configure Finance and use Reviews | Editable settings and scoped Reviews are implemented. Unified review navigation, complete first-plan funding and remaining target preferences are not. |
| Share knowledge between agents and runs | Profiles, notes and Finance context are useful foundations, but no complete typed shared knowledge lifecycle, search, conflict handling or management UI was found. |
| General Texting work inbox | Existing read/send and exact Finance status tools are foundations. General pending-work discovery, claims, routing and maintenance handoff remain unimplemented. |

Read actual route and composition registrations as well as declarative manifests. In particular,
`packages/domain/src/finance/workflow-contracts.ts` still describes a narrower registration set than
current runtime composition. A static declaration alone is neither proof of delivery nor proof of absence.

Detailed remaining-work contracts and task-level plans are now available in the
[completion specification](../superpowers/specs/2026-10-12-finance-texting-completion-design.md) and
[implementation map](../superpowers/plans/2026-10-12-finance-texting-completion.md). These are planning
artifacts, not additional delivered capability.

The existing `agent-access-work-items.ts` service already provides cross-workspace review/attention
listing with snapshot pagination. Reuse those native projections. The missing layer is durable generic
claims, general SMS work and authority-preserving resumption, not all cross-workspace listing.

## Revised implementation order

Each stage is a bounded implementation outcome with its own acceptance evidence. The detailed
contracts remain in the three specs; this order replaces plans to rebuild completed source slices.

### 1. Finish generic work retrieval and the minimum shared knowledge lifecycle

Owners: domain contracts and database storage, domain API services, then thin MCP adapters.
Reuse Finance case/answer history, current receipts and transport recovery. Introduce account-owned,
cursor-based work discovery with inspect, claim, renew, release and completion semantics; maintain
exact evidence references. Add explicit authority-preserving transfer where another authorized agent
may resume work. Existing schedule/connection fences must remain until a reviewed replacement exists.

Build typed knowledge records with source, author, timestamps, revision, status and supersession;
distinguish user facts, inference and preference from permission. Expose scoped retrieval, correction,
conflict resolution and deletion. Another authorized agent on the same account must retrieve prior
knowledge without access to another account. Do not store private agent reasoning as required state.

Acceptance: concurrent claims cannot duplicate effects; expired claims recover; grant revocation stops
writes; a new authorized session retrieves an accepted answer and prior knowledge without the original
host; account isolation and deletion hold; knowledge cannot widen action authority. Polling must work
without event delivery. Optional authenticated events can follow after this durable contract is stable.

### 2. Finish the first usable financial plan

Owners: Finance setup, position and planning services; API/client/MCP contracts; Finance UI.
Connect qualified position to first-plan setup rather than creating a second calculation. Complete
income, obligations, reserves, goals and category allocations with visible uncertainty and freshness.
Keep planned goal contributions distinct from funded or explicitly reserved money. Preserve existing
editable configuration and manual use without an agent or SMS.

Acceptance: a person with incomplete or stale sources can understand what is missing; a qualified
position produces a feasible initial plan; reserved cash is not counted twice; edits invalidate stale
previews; all relevant operations work through both app and authorized agent tools.

### 3. Complete bounded automatic budget adjustment

Owners: Finance domain policy/evaluator, additive database migrations, transactional commit service,
API/MCP and policy UI. Reuse existing immutable policy versions, preview, baseline and proposal storage.
Add category carryover modes (none, surplus only, surplus plus deficit), percentage limits alongside
dollar limits, cumulative monthly usage, protected minima and explicit selected-category authority.
Current contracts admit only `rollover: none`; published validators/migrations must not be rewritten.
Wire fresh position, usage and policy revisions into one commit fence with audit and idempotent receipts.

Acceptance: both percentage and dollar limits apply; repeated small changes cannot evade the monthly
cap or policy-version accounting; stale previews and concurrent commits cannot over-allocate; protected
minimums hold; disable/revoke blocks execution; month boundaries and all carryover modes are tested.
Do not expose execution as available until real usage and the commit fence are wired. Current
`executionAvailable:false` is correct, even though management tools and pure evaluation exist.

### 4. Complete general Texting and adaptive Finance workflows

Owners: Texting domain inbox/routing and notification services, workspace work adapters, Finance
question/workflow tools, settings and Reviews UI. Depend on stage 1 for durable generic handoff;
use stages 2–3 where workflows require planning or adjustment. Preserve existing exact Finance answers,
provider uncertainty handling and acknowledgments. Add new requests, ambiguity clarification,
work status and routing without internal model inference. Agents select questions and advice.

Expose adaptive preferences, including an optional daily check-in, as agent-readable guidance and
notification policy. Saving a preference does not schedule or host an agent. Complete contextual
question deduplication, pending answers and relevant knowledge retrieval. Extend SMS approvals only
with exact reversible proposals, current authority and bounded disclosure.

Acceptance: fresh inbound work survives an absent agent and process restart; ambiguous replies grant
no authority; replays do not repeat actions or acknowledgments; quiet hours, STOP, consent epochs and
privacy ceilings apply; a subsequent authorized run can pick up the conversation with its evidence.
A daily external-agent scenario can be demonstrated, but external runtime availability is not a
nohmi release prerequisite.

### 5. Complete the remaining app surfaces and integration evidence

Owners: shared Reviews navigation, Finance/knowledge settings, API-client schemas, MCP link producers
and domain integration tests. Retain current responsive workspace-scoped Reviews. Fix producers and
consumers together: Finance notification links already use `/finances?review=open`, while legacy
`/reviews` and `/settings?section=reviews` fall back to Account. Do not label that a shipped global queue.
Finish the full Finance spec's remaining lifecycle and correction workflows, carryover/goal reporting,
knowledge management, and agent-readable capability discovery. Keep one-transaction corrections
separate from explicitly approved future categorization rules.

Acceptance: every emitted review link reaches its exact evidence; all target workflows have app and
agent coverage or an explicit documented boundary; stale/conflicting knowledge is inspectable;
discrete action failures use the current feedback contract. Verify consent, delivery, callbacks,
recovery and observation against authorized production-equivalent transport separately from mocks.
Optional host integrations require their own evidence, never mandatory vendor certification.

## Verification and release boundaries

Fresh checks in this reconciliation:

- Focused Vitest run passed **62 tests in 3 files**: Finance budget policy evaluator, Finance
  notification runtime, and Texting recovery runtime.
- Full `pnpm verify` was attempted twice but returned **75** because another local verifier held the shared
  host slot. This is not a full-suite pass.
- `git diff --check`, conflict-marker inspection and changed-document local file links passed.
- No application, database, MCP or test implementation changes were made beyond merging main.

The [workspace agent verification record](workspace-agent-verification.md) contains prior integrated
local evidence, including successful tool invocations with legitimate blocked/needs-input results.
Those are historical results, not new checks from this audit or proof that every target workflow works.
`FINANCE_SMS_ENABLED` defaults to false in source. Production configuration, real SMS delivery and
optional external-host completion were not inspected or activated here.

The immediate next implementation slice is stage 1's generic discovery/resumption contract and minimum
knowledge persistence. Finance first-plan integration can proceed independently; budget execution must
wait for its usage and authority prerequisites. None of these stages calls for a built-in agent.
