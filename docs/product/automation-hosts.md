# External callers and automation interoperability

- Status: Target toolkit contract; reconciled with Cooper's decisions on 2026-09-28
- Scope: Authenticated access, shared knowledge, durable work and optional event delivery.
  This is not an agent hosting or scheduling product.

## Product decision

nohmi is the account's persistent brain, storage, workflows and tools. External agents manage its
knowledge and use its entropy-reducing automations to reason, triage, converse and act. Authorized
agents on the same account can retrieve permitted knowledge and work from other agents and earlier
runs. nohmi will never have a built-in agent.

No specific vendor, host surface, local/cloud runtime, schedule declaration, automatic wake-up,
agent availability or response time is required to use the toolkit or release Finance/Texting.
Callers connect through authenticated API/MCP. The person and external platform control their own
execution, cadence and scheduling. nohmi does not create, modify or certify those schedules.

The [shared toolkit design](../superpowers/specs/2026-09-28-shared-agent-toolkit-design.md) and
[Texting design](../superpowers/specs/2026-09-28-texting-toolkit-design.md) describe completion work
and await written-spec review. Canonical knowledge, domain calculations, policy, work state,
idempotency, recovery and verified effects belong to nohmi. Reasoning belongs to external agents.

## Caller identity and concurrent use

Authenticate every operation and derive the account and connection from current credentials.
Caller labels or optional host/run metadata are attribution only; they cannot grant authority.
Do not require a local schedule ID or allowlisted model vendor before accessing workspace tools.
Keep bearer credentials and provider secrets out of work records and metadata.

Multiple agents, sessions and schedules may overlap. Account knowledge remains readable according
to scope rather than becoming owned by a claim holder. Expiring fenced work claims, revision checks
and stable operation receipts prevent duplicate effects. A replacement agent can resume with its
own current permissions; it never inherits the original caller's revoked or broader authority.

Remote connections use HTTPS, including the production MCP-to-API hop. The existence of a token
or a configured tool does not prove runtime transport, permission or production capability.

## Work access and recovery

1. Inspect identity, capabilities, scopes and workspace status using currently advertised tools.
2. Retrieve bounded knowledge, source evidence, workflow guidance and pending work for the purpose.
3. Start or resume an operation with a stable identity and scope. Claim work when coordination is
   needed; claims do not replace commit-time permission or revision checks.
4. Let deterministic tools perform their supported steps. When judgment is needed, the external
   agent reasons and selects a permitted next action or records a question for the person.
5. Verify results from authoritative receipts and domain state. Preserve partial outcomes and
   distinguish answers recorded, effects applied, delivery uncertain and work waiting for an agent.
6. A later authorized session can discover and resume unfinished work without the original chat,
   host, schedule or private memory.

Polling is a supported first-class pattern, including a caller's independently scheduled polling.
A discovery cursor does not complete or acknowledge work. Optional authenticated events announce
committed work availability and permit a receiver to fetch it. Event delivery is not an agent
wake-up guarantee, nor proof that any agent processed the work. Polling remains the recovery path.

Internal synchronization, approved deterministic rules, queues, leases, retries and recovery may
continue under explicit domain authority. This infrastructure reduces entropy or completes
accepted operations; it does not instantiate a reasoning agent or originate an agent schedule.

## Guidance for external agents

A caller can use a short intent and retrieve the current playbook, knowledge and workflow from
nohmi. It need not reproduce provider logic, financial calculations, policy or the person's whole
profile in a saved prompt. It may reason freely within its authority and use granular tools.

Expose communication preferences, including adaptive coaching and optional daily check-ins, and
prior notification history. Agents or people choose when to invoke these workflows. A saved
preference neither schedules a caller nor promises a daily message.

## Optional interoperability examples

Named vendor walkthroughs may document a particular client and observed permissions, limitations,
network path and test date. They are examples, not exclusive caller types or release gates. Verify
current official vendor documentation and the actual integration before publishing such claims.
A working API client does not prove a vendor desktop or cloud task can run unattended.

The toolkit's release evidence instead exercises real provider transport, durable work, a fresh
authorized session, overlapping callers, revocation, interruption and visible app results. A
controlled authenticated test client can establish these contracts without hosting a model.

## Reconciliation with the earlier host plan

The September 14 H0 exploration and H1–H3 plan treated separate Codex and Claude journeys as launch
requirements and required host declarations, schedule identity, runtime dispatch and timing proof.
Cooper superseded those requirements on September 28. They must not block the toolkit or be revived
as an implied requirement by an old handoff prompt. Original source evidence remains in Git history.

The inspected source still contains a host-continuation domain schema with vendor-specific types;
this documentation does not remove it or assert that a generic replacement has shipped. Future
implementation inventories live callers and persisted state before any contract cutover. Preserve
accepted work and current permissions; do not delete data or modify external schedules to reconcile
the target architecture.

## Finance host repair after the maintenance cutover

Old protocol payloads and direct judgment/audit submissions are unsupported. Refresh tool
discovery or reconnect the host, then explicitly grant `finances:maintain`. Read and write
access remain separate grants; neither migration nor reconnect grants permission automatically.
Resume persisted work with `maintain_finances` using `operation: resume` and the run ID.
Follow typed challenge next actions and inspect any blocked legacy recovery before starting a
new scope. Required action approval and final verification remain part of the same durable run.
