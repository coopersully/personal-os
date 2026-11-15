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

### Current server instructions

Approved target policy (November 10, 2026): Finance schedules save a stable bootstrap that loads
current approved, API-owned instructions at every invocation. The workflow version is independent
of the bootstrap version. Loading or acknowledging a new workflow never changes the host's cadence,
schedule identity, grants or financial approval policy. If current instructions cannot be loaded or
acknowledged, the invocation stops and reports the failure instead of running cached procedures.

nohmi records exact served instructions and the original credential's explicit adoption report
separately from issued setup prompts. Neither issuance, delivery nor acknowledgment proves that the
host followed instructions. Historical receipts remain bounded and pageable. Only server-controlled
workflow text supplies instructions; chat content and other source evidence cannot expand authority.
Existing routines need one explicit bootstrap upgrade; subsequent approved server workflow changes
should not require repeated manual prompt updates.

Fresh Finance conversation processing is independent of an unchanged bookkeeping blocker. The
original verified host receives a bounded, immutable turn, acknowledges exact delivery and commits
causal replies before advancing to later messages. Acknowledgment alone is not a reply or completion.
Conversation turns do not rebind old maintenance runs, refresh financial evidence cutoffs, grant
financial execution authority or imply that any ledger action happened. This policy is a target
contract; code, migrations, tests and post-deploy host evidence establish delivered behavior.

Finance Chat replies lead with a short result or one concrete question. Structured references open
owned records, the exact saved budget proposal, or the exact grouped review in the app. The person
reviews both transfer legs before applying a group and approves a budget by its displayed version.
A draft can be revised before approval. Inbox cleanup counts only resolved work. Exceptions remain
visible and retain their source evidence for a later decision.

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


The event-continuation setup targets a five-minute Codex check interval and a five-minute Claude
API-event continuation budget. Scheduled-only Claude routines instead wait for their next local
scheduled invocation, potentially hours later. These are declarations, not measured delivery proof.
Codex requires its machine and app to be available; Claude requires a configured routine and live
connector permissions. Only API-event routines require an API trigger and bearer.
Unconfirmed routine delivery directs the person to inspect the owning host without automatic
re-firing. A host may resume the saved answer through its normal polling path. Optional integrations retain their own evidence requirements; these do not gate generic toolkit use.

## Platform references

- [ChatGPT scheduled tasks](https://learn.chatgpt.com/docs/automations)
- [OpenAI Codex automations](https://learn.chatgpt.com/docs/automations?surface=app)
- [OpenAI Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Claude recurring tasks in Cowork](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork)
- [Claude Code routines](https://code.claude.com/docs/en/routines)
- [Claude Code routine trigger API](https://platform.claude.com/docs/en/api/claude-code/routines-fire)
- [Gemini scheduled actions](https://support.google.com/gemini/answer/16316416?hl=en)
- [Gemini CLI MCP servers](https://geminicli.com/docs/tools/mcp-server/)
- [Gemini CLI headless automation](https://geminicli.com/docs/cli/tutorials/automation/)

Platform behavior is an external boundary and must be reverified before nohmi advertises a setup
flow as currently supported. A passing nohmi test cannot prove that a third-party plan, account,
machine, connector, or scheduler is available to the person.

## Finance H0 feasibility outcome

The historical host candidates below are not launch-certified. Current official evidence establishes two bounded proof
candidates, not the complete post-session SMS continuation journey:

- **Codex local desktop app:** use a host-owned recurring follow-up while durable Finance work is
  open. The app's machine/runtime availability, unattended nohmi permissions, schedule delay, idle
  usage, late replies, and restart or sleep behavior still require measurement. Codex CLI, SDK, and
  app-server support are separate developer surfaces and do not prove this app journey.
- **Claude Code cloud routine:** use the supported per-routine API trigger to start a new cloud
  session. The trigger has no idempotency key, so an ambiguous dispatch cannot be retried blindly;
  nohmi must preserve an uncertain outcome for reconciliation even when domain effects themselves
  are idempotent. Account entitlement, least-privilege connector access, latency, usage, revocation,
  rate limits, and recovery still require a real bounded proof.

Claude Cowork is excluded from the current Finance proof because its documented recurring cadence
is hourly or slower and no arbitrary event trigger has been established for that product surface.
Claude Code Desktop, CLI, Channels, and the Agent SDK remain different surfaces; evidence from one
does not certify another. Channels and session-scoped loops also require a running session, so they
do not satisfy continuation after the original process ends.

The domain contract currently recognizes only `codex_desktop` with a recurring trigger and
`claude_code_routine` with either an event trigger or a scheduled daily-local-times trigger.
A create declaration carries a stable, nohmi-owned
tenant authorization-connection ID and requested scopes. That ID must resolve to durable tenant
authorization state; it is not an OAuth access-token row, refreshed credential record, or external
`mcp_client_*` identifier. The schema checks only the shape of the ID and request. Before any record
is stored, the application boundary must authenticate the caller, resolve tenant ownership,
and derive `effectiveScopes` as the permitted subset of the current connection or principal. A
caller-supplied `finances:maintain` request is never proof of authority.

Stored declarations keep only those server-resolved effective scopes and start in
`setup_pending`. Host setup binds the host automation identity exactly once through an atomic
version- and state-guarded null-to-value transition. Generic updates can change only the label; they
cannot replace identity, change authority, or assign host state. Active and paused state comes only
from verified host setup or observation evidence. A recurring pause clears the expected host slot,
and a later observed resume must atomically persist a fresh `nextExpectedAt` later than the
observation time, so stale pre-pause slots cannot report an immediate false overdue state. An
abandoned `setup_pending` declaration uses a separate version- and prior-state-guarded cancellation
operation. Its terminal `cancelled` representation remains unbound with a null host automation ID,
preserving the distinction from a host routine that was created and later revoked. Revocation is a
separate version- and prior-state-guarded local operation for active or paused bound declarations.
Both terminal states carry no host repair owner and require a new declaration and setup before work
can become active. Active, paused, and revoked declarations therefore always retain a non-null host
target, while setup-pending and cancelled declarations remain unbound. Recurring declarations also
persist their timezone-aware recurrence basis and the host's next expected schedule slot. Health is
evaluated against that slot, including before the first observed invocation, rather than shifting
the schedule from a late observation. Advancing a slot uses verified host schedule evidence so
local-time behavior remains honest across daylight-saving changes.

The source implementation persists tenant-bound schedules, resolves current authorization-connection
ownership, registers API/client/MCP operations and setup UI, and binds maintenance runs to their
original schedule. Accepted answers commit a durable continuation before host dispatch; Claude
trigger credentials remain encrypted. Verified host observations advance recurring schedule slots.
Health metadata describes observed state and never originates, pauses, repairs or reschedules host
work by itself. Real Codex and Claude unattended execution, measured latency and offline recovery
still require separate launch evidence. Production Finance SMS remains disabled by default.

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
existing run remains offered only for a polling Codex schedule. Scheduled Claude declarations do
not yet support this cross-host run-replacement operation; an event-only Claude routine
would otherwise receive no wakeup. Ending a schedule clears its stored encrypted trigger token.

## Shared agent identity

Automation presentation uses the account-level identity defined in [Shared agent accounts](agent-accounts.md).
Several surfaces or connections may share that identity after owner-confirmed linking. The schedule's
original authorization connection remains its execution and continuation boundary; profile grouping
never transfers that authority. Finance registration ensures an identity on the authorized connection,
then shares its name and avatar with settings and activity across the account.


## Scheduled-only Claude registration

The current application contract accepts `trigger: { type: "scheduled", localTimes: ["08:00",
"20:00"], timeZone: "America/New_York" }` on `claude_code_routine`. It permits one to eight distinct
24-hour `HH:mm` daily times and validates the IANA timezone. This is a bounded daily declaration,
not an interval, cron parser, or nohmi scheduler. No database migration is needed: the existing
validated schedule JSON carries the additional trigger variant.

Setup keeps the existing authenticated owner, original authorization connection, effective scopes,
agent identity, lifecycle version guards and audit. Create remains `setup_pending`; the person
configures the actual routine in Claude and binds its routine identifier. Scheduled routines do not
need an API trigger ID or API trigger bearer. The API rejects saving trigger credentials for this
variant, and both dispatcher selection and locked dispatch validation exclude it. Existing event
registrations retain their trigger-ID validation, encrypted credentials and dispatch behavior.

At bind the server projects the next future daily slot from the declared timezone wall times.
An active observation advances an outstanding slot only with explicit `invocationObserved: true`
evidence from the original authenticated routine, timestamped at or after that slot. Generic
active-state checks do not prove invocation. The next slot is derived from `observedAt`, never
receipt time; backward observations are rejected. A 07:59 observation received at 08:01 therefore
retains the outstanding 08:00 slot. Clients cannot supply `nextExpectedAt` for Claude. The 08:00
and 20:00 New York slots change UTC offsets across DST, preserving local time. A nonexistent spring
wall time is skipped; a repeated autumn wall time uses its first occurrence. This defines nohmi's
observation expectation, not a guarantee about the provider's DST execution policy. Pausing clears
the slot; observing resume derives a fresh slot from that observation timestamp. Reads never advance it: missed invocations remain
overdue until new evidence arrives. The API health `expectationBasis` distinguishes `declared_cadence` projections from Codex
`host_reported` slots, and the UI labels projected starts explicitly. Neither establishes verified
provider configuration or execution. Health allows **15 minutes** after the expected slot for provider
jitter. Health is not proof of successful financial work.

Saved answers remain durable continuations. The original authorized routine reads them with
`get_finance_continuations` and continues them at its next scheduled invocation. No API wake-up is
sent; the UI and version 3 issued prompt state this latency. Previously issued prompts remain
immutable and are not silently installed or replaced in the external host.

### Boundary evidence and remaining launch proof

On 2026-10-24 an agent directly inspected Claude's native **New routine → Schedule → Custom** UI
and confirmed that it accepts
`CRON_TZ=America/New_York 0 8,20 * * *` and warns that :00 starts can be several minutes late. This
was an unsaved provider configuration; no production nohmi registration or routine was created.
[Official Claude routine documentation](https://code.claude.com/docs/en/routines) describes schedule
and API triggers separately. Provider UI acceptance is not unattended execution evidence.

Claude owns scheduling, runtime availability, timezone execution and connector authorization.
The boundary uses the existing authenticated HTTPS MCP/API connection; no new outbound endpoint,
port, secret or worker is introduced. A revoked/expired grant denies observations and maintenance;
a paused, missed or unavailable provider invocation leaves durable answers waiting. The person
repairs the owning routine and reauthorizes its original connection as needed. The existing run
and continuation guards handle repeated invocations.

The current authorized individual-routine outcome is to configure the user's actual twice-daily
routine, register it in nohmi under its authorized connection, complete a real run, and verify its
next run in the provider. The parent outcome owner owns that setup and its evidence. The unsaved UI
inspection above does not establish completion of those steps.

Broader platform launch certification remains pending separately: observing both daily slots
(including realistic lateness), verifying unattended connector scopes and an answer continuation,
and inspecting recovery after a missed invocation. These are pending platform launch probes, not
additional acceptance requirements for the individual routine setup. Do not invent personal
questions to manufacture answer-continuation QA evidence. Local DST, lifecycle,
authenticated-adapter and no-dispatch tests do not certify those provider capabilities, and neither
individual routine setup nor a successful real run establishes broad Claude or SMS launch
certification.
