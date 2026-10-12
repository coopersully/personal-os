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

## Current implementation after the October 12 main merge

The current source now implements vendor-specific schedules, setup UI, encrypted trigger
credentials, accepted-answer continuations, dispatch and recovery. Preserve this delivered behavior
and its safety checks. These are optional existing integrations, not prerequisites of the agreed
toolkit target. Generic discovery and authorized cross-connection resumption remain completion work;
the current host-specific path must not be described as satisfying them.

### Existing Finance answer continuation setup

Finance settings may prepare a connection-bound local declaration and provide the prompt needed
for a person to create a Codex desktop automation or Claude Code routine in its owning host. The
person binds that host's identifier after setup; unfinished setup may be cancelled and active access
may be revoked. Local declaration changes never create, edit, or pause the external automation.

Accepted app and SMS answers create durable pending continuations. When an original invocation
has a bound schedule, the answer inherits that destination. Otherwise the app asks the person to
choose an active host. A bound destination cannot silently move to another connection. The original
host reads the current schedule version, answer evidence, and continuation run handle through
`get_finance_continuations`; `maintain_finances` with operation `continue` creates or resumes only
that review case's canonical run. Acceptance, host-session creation, and verified financial
completion remain distinct states.

Human host settings and host continuation reads use owner-bound cursor pages; host reads also bind
each cursor to its schedule. Settings loads every answer page. Routine dispatch selects eligible
same-case wake-ups before limiting schedules, so an older unrelated answer cannot block a waiting
case. Resuming an existing run requires its exact original connection and schedule; only explicit
human recovery may change that binding. Terminal run evidence settles the
continuation regardless of whether the final operation was `continue`, `resume` or background
verification. Stale submitting claims become uncertain without another provider call. Invalid
credentials disable only the affected routine delivery.

After inspecting the owning host, the person may explicitly release an uncertain pending delivery
for another attempt. This preserves the original answer and records an audit event; it cannot move
a submitted run. Separately, a person who has stopped the original host may move an idle waiting
run to another currently authorized polling Codex schedule. Recovery fences the original schedule, connection,
run timestamp and absence of an execution lease, preserves the run's checkpoint and financial
questions/approvals, and rejects active execution. The new host resumes that saved run; the old
connection loses authority for it. Host state is checked by the person, never inferred from a
missing response.


The setup prompt targets a five-minute Codex check interval and a five-minute Claude continuation
budget. These are declarations, not measured delivery proof. Codex requires its machine and app to
be available; Claude requires a configured routine, live connector permissions, and a valid trigger.
Unconfirmed routine delivery directs the person to inspect the owning host without automatic
re-firing. A host may resume the saved answer through its normal polling path. These built-in setup defaults are existing implementation details, not toolkit release requirements.
Optional vendor integrations still require real evidence before advertising their own capability;
nohmi does not guarantee external-agent execution or response time.

## Finance host repair after the maintenance cutover

Old protocol payloads and direct judgment/audit submissions are unsupported. Refresh tool
discovery or reconnect the host, then explicitly grant `finances:maintain`. Read and write
access remain separate grants; neither migration nor reconnect grants permission automatically.
Resume persisted work with `maintain_finances` using `operation: resume` and the run ID.
Follow typed challenge next actions and inspect any blocked legacy recovery before starting a
new scope. Required action approval and final verification remain part of the same durable run.


A host-accepted session with no observed nohmi maintenance run remains pending. After the
registered routine's expected maximum latency (at least two minutes), explicit human reconciliation
may release that answer only after the person checks no session is running. A coalesced delivery
requires separately reconciling every still-pending sibling; a sibling attached to a run stays fenced.
This does not imply the provider failed to create its original session. Original session evidence
is preserved in the audit. Safe handoff diagnostics distinguish accepted, uncertain and unavailable
transport outcomes without recording credentials, routine IDs, answers or provider response bodies.


Routine dispatch claims one exact answer per host session. Other cases remain pending while a
session is unobserved or its case run remains open. A new answer for the same original waiting
case can wake its bound routine; it cannot adopt an unrelated open run. Human movement of an
existing run is offered only for a polling Codex schedule, since an event-only Claude routine
would otherwise receive no wakeup. Ending a schedule clears its stored encrypted trigger token.
