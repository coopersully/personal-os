# Workspace agent parity and verified autonomous execution

Status: approved for implementation in this chat. Implementation and verification are underway; see [capabilities](../../engineering/workspace-agent-capabilities.md) and [verification](../../engineering/workspace-agent-verification.md). The gap inventory below records the pre-implementation audit.

## Intent and scope

Cooper requested an audit of Finance functionality, complete and documented MCP access, and
autonomous execution when review bypass is enabled. Cooper then expanded the spec and plan to
every workspace and explicitly required tests that execute the tools and their database queries,
rather than merely checking that tools are registered or return mocked success.

Cover Mail, Tasks (including the existing Reminder surface), Calendar, and Finances. Include
workspace search, settings, sources, sync, guidance, rules, questions, reviews, history, exports,
notifications, maintenance, and recovery wherever these capabilities actually exist. Shared
Texting, notification, host-schedule, and connection controls are dependencies, not new workspaces.
Do not implement unrelated planned product features to make a parity inventory look complete.

Authoritative contracts: `docs/product/master-design.md`, `docs/product/workspaces.md`,
`docs/product/workspace-settings.md`, and `docs/product/workspace-stewardship.md`.

## Approach

Use one capability inventory and one authorization vocabulary, implemented through domain-owned
APIs and typed MCP adapters. Deliver independently verifiable workspace slices after the shared
authorization and test infrastructure. This avoids two inadequate alternatives: adding adapters
without proving API access, and removing human checks globally without preserving scope and effect
semantics. Do not replace domain workflows with one generic action executor.

## Capability inventory

Inventory public UI actions and API operations, including functional branches within a tool.
One tool name is not evidence that every supported operation works. Each inventory row records:

- Workspace, operation, UI entrypoint (or API-only status), route, typed-client method, and tool.
- Required scopes, provider capability, prerequisite reads/previews, and input revisions.
- Agent behavior with bypass off and on, plus any named owner-only boundary.
- Observable success, authoritative readback, audit expectation, retry/recovery behavior.
- Documentation location, executable test identifier, and provider-smoke evidence status.

Allowed coverage states: executable, missing adapter, agent denied, provider handoff,
unsupported product capability, and owner-only security control. No unexplained omissions.
Inventory discovery does not authorize dormant or unsupported effects.

Completeness is measured by user outcomes, not endpoint counts. Inventory every shipped read,
filter, mutation variant, bulk action, setting, lifecycle transition, import/export, attachment
operation, and recovery path. An existing human-only route is a gap to resolve, not evidence that
the capability is inherently owner-only. A link to the app is not MCP parity for an ordinary
operation. For genuinely interactive provider consent, expose initiation, status, completion
observation, and retry/recovery wherever the provider permits them.

One focused tool may cover several closely related variants if its schema makes each variant
unambiguous. Conversely, multiple internal endpoints may implement one user outcome. Do not expose
internal helpers as tools simply to achieve a one-to-one endpoint mapping. Every supported outcome
must have an executable agent workflow and every tool variant must have a mapped test.

## Evidence from the current checkout

Finance received the detailed initial audit. Mail and Calendar findings below are a preliminary
route-to-tool inspection; Tasks has broad existing tooling but still needs the full inventory.

| Area | Established gap or verification target |
| --- | --- |
| Finance sync | `sync_finance_accounts` calls a human-only API route. Its error remedy incorrectly treats authorization denial like a reconnect problem. |
| Finance activation | Budget activation and active operating-guidance profiles reject agents regardless of bypass. Financial fact edits are a separate, available capability. |
| Finance policies | The entire budget-policy route family, including reads and previews, is human-only and lacks MCP adapters. |
| Finance accounts/categories | Manual account creation, account disconnect/delete, and category creation lack agent paths. |
| Finance reviews | Existing action approval/dismissal, contextual questions, review history/detail, and exact maintenance-run reads lack complete MCP access. |
| Finance reporting | Configuration, budget pace, scoped position, and month/account-filtered overviews lack equivalent tools or parameters. |
| Finance handoff | Connection initiation returns a Plaid Link token; the advertised direct handoff needs a usable host/browser contract and completion evidence. |
| Mail | Draft CRUD, send, uncertain-send reconciliation, and rule activation are not covered by the current Mail MCP tool module. Send, reconciliation, and activation routes explicitly require a human. |
| Mail stewardship | Several disposition, obligation, question, and feedback routes require a human; the MCP stewardship module exposes only status and maintenance. |
| Calendar | Local calendar CRUD, calendar selection, status, and review routes need MCP parity; existing event tools do not cover these operations. |
| Tasks/Reminders | Verify all lifecycle branches, lists/projects, moves, archived parents, mixed workspace queries, Trash/restore, and settings against real routes and persistence. |
| Shared controls | Workspace preference and notification writes are human-only. Host schedule configuration, answer binding, run inspection, recovery, and reconciliation are human-only and largely absent from MCP. |
| Execution policy | The shared bypass allowlist currently registers only selected Finance operations; other domains must not be assumed to follow it. |

## Proposed bypass contract

Bypass is standing owner authorization to skip per-action human review for supported, explicitly
registered domain operations within the credential's existing authority. It is not a request
parameter supplied by the agent. Read it from authoritative persisted state at the mutation boundary.

For ordinary supported operations, enabling bypass must allow an agent to finish the workflow
without a human session solely because the actor is an agent. This includes domain material,
workspace configuration, budget activation, guidance activation, and domain review resolution.
For Mail sending, recurring action-rule activation, and budget-policy management, classify the
exact effect explicitly before registration; never accidentally authorize them through a broad
settings write or a wildcard operation. Version-bound previews remain mandatory where the domain
requires them, but a properly authorized agent can perform prepare and commit consecutively.

Effect reversibility and authorization are separate facts. The current evaluator unconditionally
requires approval for irreversible effects before it checks bypass. Adding Mail send to an
allowlist therefore cannot implement the requested behavior. Model an explicitly registered
standing authorization for eligible effects separately from reversibility; never label sending
mail reversible to obtain a permissive decision. Unregistered irreversible actions remain denied
or require their existing approval. Use real agent attribution and server-derived authority in
audit and approval records; never pass `user_instruction` or record a human approver to disguise
agent execution. Review domain schemas, constraints, and persisted approval provenance together.

This proposal changes current product rules that prohibit bypass-based action-rule activation and
agent budget activation. The draft does not silently supersede those rules. Before implementation,
review the operation matrix and update the affected canonical policy statements together. If a
stronger owner-only boundary is retained, name it in discovery and in the completion report rather
than claiming universal autonomy.

Bypass off preserves each operation's existing authorized behavior: read, preview, direct scoped
mutation, queued review, or explicit approval. Do not regress already autonomous Tasks or Calendar
operations by putting every write into a new queue. Pending work must be revalidated against current
authority and revisions; changing bypass must not silently execute an entire old queue.

Existing credentials need special care: enabling broader bypass semantics must not silently turn
an old broad write grant into newly authorized sending or policy activation. The operation matrix
must name the existing grant that explicitly covers the effect, or require a new owner-granted
capability. Discovery and consent wording must agree with this decision before rollout.

Owner-only exclusions remain: granting/replacing/revoking the agent's own credentials or scopes,
enabling bypass itself, account ownership and login security, broad privacy/consent ceilings, and
provider authentication/MFA/consent that requires a person. Routine source disconnection and local
workspace data changes are not automatically account-security operations. Permanent account
erasure remains distinct from recoverable workspace deletion.

Missing evidence, revoked scopes, another owner's records, stale revisions, and unavailable
provider capabilities still prevent execution. Agents cannot invent answers or treat provider text
as authority. Unsupported payments, trading, money movement, and external subscription cancellation
remain unsupported.

## Architecture and tool contracts

- The API owns domain validation, policy decisions, tenant checks, persistence, and audit.
- `packages/domain` owns typed input/output and authorization contracts; the API client carries
  authenticated requests; MCP remains a stateless adapter.
- Avoid widening existing scopes implicitly. Define a distinct grant for a newly exposed sensitive
  capability when existing scope wording does not authorize it; existing credentials receive no
  silent privilege upgrade. Resolve this per operation in the inventory.
- Reuse native review and recovery records. Cross-workspace work reports individual successes,
  pending work, failures, and uncertain outcomes without simulated atomic rollback.
- Discovery reflects usable scopes and capability prerequisites. A tool must not advertise an
  agent success path when every valid request from an agent is rejected.
- Tool descriptions state purpose, inputs, prerequisites, scopes, bypass behavior, outcome states,
  revision/idempotency requirements, and concrete recovery. Keep runtime playbooks in the API.
- Retain structured results and readable text; do not hide HTTP errors inside a success envelope.
  Authentication denial, reconnect, rate limits, invalid input, and stale versions need distinct
  remedies. Never retry an uncertain external effect merely because bypass is enabled.

Do not route all workspace mutations through Finance's action queue. Preserve native direct-write,
preview, draft, review, and durable-run semantics; the shared policy contract expresses decisions
while each domain applies them. Define the authorization checkpoint before durable acceptance and
external dispatch. A revocation prevents subsequent acceptance/dispatch at that checkpoint; it
cannot retract a provider effect already accepted. Test this distinction and preserve recovery
evidence rather than promising atomic rollback across an external provider.

## Cohesive MCP interface design

Design the tool surface across all workspaces before adding individual adapters. Review the
inventory alongside a proposed tool dictionary: canonical name, intent, input/output schema,
prerequisites, scopes, result states, and examples. Existing tools participate in this review;
new tools must not create a second vocabulary for an already exposed operation.

### Names and operation boundaries

Use lowercase snake_case names with a leading verb. Use the established domain noun, adding the
workspace qualifier where needed to distinguish similar records. Preserve recognizable existing
families such as `get_event`, `list_tasks`, and `get_finance_budget`; do not add synonymous aliases
just to force identical prefixes. For new families, choose the canonical names once in the tool
dictionary before implementation.

| Intent | Naming and behavior |
| --- | --- |
| Read one record or aggregate | `get_<entity>`; no semantic mutation or setup progression. |
| Browse a collection | `list_<entities>`; bounded results with explicit filters and pagination when supported. |
| Search | `search_<workspace>` or an existing documented collection search parameter; no side effects. |
| Create/change material | `create_<entity>` / `update_<entity>`; return the resulting record or an honest action disposition. |
| Change lifecycle | Explicit verbs such as `complete`, `cancel`, `archive`, `trash`, `restore`, `activate`, `disable`, or `disconnect`; avoid overloaded deletion or status booleans. |
| Prepare a consequential action | `preview_<operation>`; return the evidence and revision/preview identity required by commit. |
| Run domain upkeep | `maintain_<workspace>` only where the API implements that durable intent; expose inspect/recover paths. |
| Request synchronization | `sync_<entities>`; distinguish request acceptance, pending work, and verified completion. |

New tools have one coherent intent. Prefer separate tools when variants have different scopes,
approval requirements, effects, or recovery semantics. Existing `manage_*` tools may retain a
strict discriminated operation schema; do not create a catch-all tool with unrelated optional
fields. Host discovery must make the usable variants and their prerequisites clear.

### Input syntax

- Use camelCase argument names and explicit entity references such as `accountId`, `transactionId`,
  and `reviewId` for new inputs. Identify canonical record IDs separately from provider IDs.
- Reuse domain schemas and enum values. Do not require agents to embed JSON as a string, pass an
  unrestricted object, know a database column, or reconstruct an undocumented request body.
- Updates distinguish omission (leave unchanged), `null` (clear only where supported), and empty
  collections (explicitly empty). Validate unknown fields and incompatible input combinations.
- Document money units/currency, date-only versus timestamp inputs, timezone interpretation,
  inclusive/exclusive range endpoints, ordering, limits, and defaults. No silent money or time
  conversion solely in the MCP adapter.
- Use the owning API's revision token unchanged. New revision-based contracts prefer
  `expectedVersion`; existing `expectedUpdatedAt` or opaque revision contracts remain explicit.
  A preview requirement includes its exact ID/revision; no fake `approved: true` input.
- Persisted bypass and authenticated actor identity are never input fields. Idempotency keys
  identify a logical attempt; document when to reuse a key and when changed input needs a new one.
- Follow existing collection conventions for `limit`, `cursor`, and `nextCursor`; keep filters and
  sort order stable across a cursor chain. API limitations must be disclosed, not hidden by an
  adapter that fetches an unbounded collection.

### Results and documentation

Preserve the shared MCP result/output-schema and annotation contract. Keep domain-owned outcome
states explicit instead of inventing a second success envelope. Include relevant canonical IDs,
revisions, effects, remaining work, and next inspect/recovery action. Bulk operations retain item
identities and individual outcomes. Read-only results must not masquerade as completed writes.

Each tool's documentation includes a concise purpose, precise fields, authorization and bypass
behavior, one valid input/result example per operation variant, and a conflict or recovery example
where applicable. Examples are executable fixtures validated against the actual discovered input
and output schemas. Record existing naming/schema exceptions explicitly; breaking cleanup requires
a coordinated client migration, not silent renaming or another compatibility alias.

The existing shared result schema deliberately permits unknown domain payloads. Passing that
outer schema does not prove a correct record. Validate the domain payload with its own schema and
semantic assertions. Attachment and export parity also needs an agent-usable bounded transfer
contract, including content type, size limit, authenticated access, expiry, and error behavior;
a human-session-only download URL or arbitrary binary embedded in JSON is not sufficient.

## Executable verification contract

The core acceptance path is an MCP protocol client calling the actual server and typed API client,
through real API authentication, routes, services, migrations, and PostgreSQL queries. A mocked
typed-client method is insufficient for this gate. Connector simulators are allowed only at the
external provider boundary and must be labeled as such.

Put cross-application suites in `integration/workspace-agent/` with a dedicated TypeScript config
rooted at the repository, not inside an application's `src` directory. Both application configs
set `rootDir` to their own `src`; importing the other app there causes a TypeScript error. Add the
new suite directory to Vitest discovery and its config to the repository typecheck command so the
tests actually participate in `pnpm verify`.

Construct the typed client using its existing injectable fetch transport to call the real Hono
app in-process. This is real API routing/authentication and persistence, but not network evidence.
Never substitute a session principal for an agent. Derive MCP scopes from the authenticated
orientation response rather than accepting the server factory's all-scopes default. Test normal
and read-only discovery and direct attempts to invoke hidden mutations.

The fixture must support both personal tokens and OAuth connection-bound credentials. Finance
continuation/recovery additionally checks the original active authorization connection; scope
alone is insufficient. Cover refresh rotation, expiry, revocation, another connection for the same
owner, and a foreign owner using actual authentication/service paths. Simulate only the external
OAuth browser/provider boundary. Each test owns its mutable data and logical clock; cleanup must
close protocol clients, API/runtime work, database pools, and containers even after setup failure.

Every supported inventory operation and every mutation branch needs a successful fixture-backed
execution. Each read verifies actual values, filtering, ordering, pagination, and ownership where
applicable; empty and populated fixtures are separate cases. Each mutation verifies an authoritative
subsequent read, persisted effects, actor attribution, and the expected audit record. A response
without a protocol error is not enough: inspect domain dispositions and per-item failures too.

Every inventory row must identify its fixture, exact protocol call, expected domain outcome,
readback assertions, applicable failure cases, cleanup, and executable test. A test-name string is
not proof: compare the inventory with actual test results. Missing, skipped, or failing required
cases prevent completion. Parameterized cases must report which operation/variant failed.

Use three complementary test layers:

1. Schema/discovery tests validate tool naming exceptions, argument conventions, scope views,
   descriptions, examples, and shared outputs. These establish usability, not runtime success.
2. Protocol-to-database tests execute every operation/variant, exercising real authorization,
   service logic and queries. Provider simulators expose controlled success and failure states.
3. Complete workflow tests compose discovery, read, preview where required, mutation, verification,
   and recovery without hidden UI steps or database-only shortcuts. Local HTTP smoke checks the
   deployed transport; separate provider evidence establishes external reachability and effects.

Representative complete workflows are Finance account/import/category/budget/review/maintenance;
Mail draft/edit/send/readback and uncertain-send recovery with a controlled recipient; Calendar
local calendar/select/event/edit/trash/restore and private blocking; Tasks list/project/task,
move/complete/reopen/trash/restore plus Reminder workflows; and each workspace's settings,
notification inheritance, search, history, and supported maintenance recovery. These supplement,
rather than replace, the per-operation matrix.

Required matrix:

| Condition | Required evidence |
| --- | --- |
| Bypass on, sufficient scope | Supported operation completes without actor-type denial or unintended review queue. |
| Bypass off | The exact documented direct/preview/review behavior is preserved. |
| Missing scope, revoked credential, foreign owner | Discovery and API access deny appropriately; no write or cross-owner data leak. |
| Stale preview/version, duplicate invocation | Conflict or safe replay; no duplicate effect or fabricated approval. |
| Query boundaries | Empty/populated data, cursor traversal, date/timezone edges, filtering and aggregate correctness. |
| Provider rejection, timeout, rate limit, partial success | Truthful scoped failure; healthy siblings preserved; correct recovery owner. |
| Process loss and asynchronous work | Durable accepted state, recoverable continuation, truthful terminal status. |
| Owner-only controls | Both bypass settings deny agent self-escalation. |

The query matrix must include stable tie-breaking across equal timestamps, changed-filter cursor
rejection where supported, maximum bounds, invalid cursors, and multiple owners. For each applicable
provider (local, Google, iCloud, Plaid), distinguish executable operations from provider capability
denials. A local Calendar success does not verify a Google or iCloud write. Use explicit operation
deadlines and bounded polling for durable runs; avoid timing-dependent sleeps and unbounded waits.

Run deployed local HTTP MCP smoke tests with a scoped fixture credential to additionally cover
transport, token forwarding, runtime wiring, and serialization. Provider-backed operations require
a separate sandbox or authorized non-destructive production-equivalent smoke: credentials, network,
consent/callback configuration, actual provider result, and readback. Never send real email, invite
real attendees, change financial data, or alter a live schedule as an incidental test. Use controlled
test accounts and recipients for effects. Missing provider access is an explicit unverified item,
not a passing test.

## Completion and delivery

The plan is decomposed into a shared foundation, four workspace slices, shared controls, and final
runtime validation. Completion requires an inventory with no unexplained gaps, passing operation
tests, documentation consistent with observed behavior, and `pnpm verify`. Publish results by
workspace as implemented, executed locally, provider-verified, or blocked/unverified. Do not claim
production health from a successful build, registered tool, stubbed API, or healthy process.

## Plan review evidence — October 11, 2026

- Ran eight existing Vitest files: 117 tests passed, including 69 PostgreSQL-backed Finance
  profile/budget and automation-host tests. The remaining tests cover Finance routes, current
  approval/bypass behavior, MCP adapters, catalog, and result surface.
- Existing tests intentionally confirm agent budget rejection under both bypass settings and
  connection-bound host behavior. Their success is baseline evidence, not proof of proposed parity.
- A temporary TypeScript configuration reproduces `TS6059` when the API source-root configuration
  includes the MCP server. The revised plan isolates cross-app suites at the repository level.
- Inspected the actual typed-client fetch injection, HTTP MCP authentication, scope-based discovery,
  broad shared output schema, and irreversible-effect policy ordering. These drove the refinements
  above. No new all-workspace execution suite, deployed HTTP smoke, or provider smoke has run yet.
