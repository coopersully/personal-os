# External automation hosts

- Status: Target interoperability contract; H0 feasibility completed, launch proof still blocked
- Last verified against official platform documentation: 2026-09-14

## Product decision

The [Finance MVP](finance-workspace-plan.md) requires separate end-to-end maintenance and SMS
continuation evidence for both Codex and Claude. The capability descriptions below are candidates,
not interchangeable proof: document the exact supported product surface, unattended permissions,
continuation mechanism, runtime availability, measured latency and cost. A successful initial MCP
call does not prove a later SMS reply will wake or resume the host.

nohmi does not own maintenance schedules. The person chooses an external platform and configures
where and when an automation runs there; the host connects to nohmi through MCP or another
authenticated API surface and invokes one high-level intent such as `maintain_finances`.

Every remote host connection requires public HTTPS, including the production MCP-to-API hop. Bearer
credentials and User Knowledge must never cross a plaintext remote connection.

The external host is the sole authority for cadence, wake-up, pausing, resuming, and delivery of
the invocation. nohmi owns the meaning of the tool, purpose-bound User Knowledge retrieval, source
synchronization, policy, durable run state, idempotency, resumability, questions, approvals,
recovery, audit, and the verified result. nohmi must not create, edit, activate, or execute a
recurring maintenance schedule.

“The external host” describes authority for each individual schedule, not an exclusive owner for a
workspace. The person may configure multiple hosts, multiple schedules on one host, or overlapping
invocations of the same maintenance intent. nohmi must not reject that topology merely to simplify
coordination. It records the invoking connection, host-declared automation identity when available,
non-secret credential reference, trigger, requested scope, and idempotency identity, then coalesces
or resumes compatible durable work and isolates incompatible scopes without duplicating external
effects. Bearer tokens and provider credentials never enter durable schedule metadata.

Every declared schedule receives an immutable nohmi-owned local identity. When the host exposes a
stable automation identity, nohmi binds it to that local identity; when it does not, setup creates
the local identity before the first invocation. Invocation, run, health, revocation, idempotency,
and coalescing records carry that identity so schedules remain distinguishable and independently
revocable without requiring a host-specific identifier.

nohmi may store a user- or host-declared expected cadence, the last observed invocation, and an
expected, overdue, or unknown check-in state so the person can see whether an external automation
appears healthy. This metadata is observational only: changing it does not update the external
platform, and reaching an expected time does not enqueue or start maintenance. The UI must direct
the person to the owning platform or provide setup instructions when a schedule needs to change.
When several schedules exist, health and repair are shown per declared schedule rather than reduced
to one workspace-level owner.

## Supported scheduling patterns

| Host pattern | How it invokes nohmi | Product constraint |
| --- | --- | --- |
| ChatGPT scheduled task | A web or mobile task runs on a time schedule or supported app event and may use the connected tools, plugins, and skills available to its chat. | Plan and workspace availability vary. Direct invocation of a custom remote nohmi MCP server from this surface is an unverified target pattern and must not be advertised until production-tested. |
| Codex project automation | A desktop scheduled task runs in its configured local project or isolated worktree and may use configured plugins or skills to invoke a nohmi adapter. | The machine and desktop app must remain available for local work. End-to-end nohmi MCP or API invocation remains a target pattern until the exact plugin, skill, credentials, network access, and unattended permissions are verified. |
| Claude recurring task in Cowork | A scheduled Claude session uses its configured connectors, tools, skills, or plugins to call nohmi. | Availability differs between local and cloud scheduling; nohmi must resume safely after missed or duplicated invocations. |
| Claude Code routine | A schedule, API call, or webhook starts a routine that invokes nohmi MCP. | The routine is an adapter and must not reproduce the workspace playbook or retain private state as the only memory. |
| Gemini scheduled action | Gemini invokes a configured action on a recurring schedule. | Account, region, plan, and application availability may vary; the nohmi run remains authoritative. |
| Gemini CLI headless automation | A script or operating-system scheduler launches Gemini CLI with nohmi configured as an MCP server. | Use bounded non-interactive input, explicit credentials, stable exit handling, and nohmi idempotency. |
| Generic cron, launchd, systemd, or automation service | The scheduler invokes a small authenticated CLI or HTTP/MCP adapter. | Never embed provider credentials, a copy of the user's memory, or workspace orchestration in the schedule. |

## Saved prompt contract

A scheduled prompt should contain only:

- the nohmi maintenance intent;
- the immutable nohmi-owned local schedule identity created during setup;
- a bounded scope when the person selected one;
- whether the host should report only actionable results or every completed run; and
- an instruction to return the durable nohmi state rather than guessing after an interruption.

It should not contain the domain procedure, personal profile, category rules, confidence
thresholds, provider credentials, or a promise that the host will remember prior runs. Those belong
to nohmi's API-owned playbook, User Knowledge, rulebook, and run state.

## Invocation and recovery contract

1. Authenticate with least-privilege workspace and knowledge-purpose scopes.
2. Read `get_nohmi_context` and the relevant workspace status when orientation is required.
3. Invoke `maintain_<workspace>` once with the declared local schedule identity and an idempotency
   identity or resumable scope. nohmi validates that schedule against the authenticated connection
   before associating it with health, revocation, or run state.
4. If the result is active or waiting, retain the returned run handle and follow only the reported
   next action.
5. If the host repeats the schedule, nohmi resumes, coalesces, or verifies the compatible run rather
   than starting duplicate work.
6. Notify the person only when the configured host policy calls for it and the result is actionable,
   blocked, failed, or complete.

The tool may create nohmi questions and reviews that outlive the host session. The person answers
them in the app or through an authorized agent, and later maintenance uses those answers and
reinforced knowledge to reduce unnecessary questions.

`maintain_texting` is a valid scheduled catch-up and recovery intent for the general SMS inbox, but
normal inbound messages should enqueue the same durable coordinator at webhook arrival. A schedule
must not become the only mechanism for replying to the person.

Internal queues, leases, retries, delayed authorized effects, and recovery timers may continue work
that nohmi already accepted. They are execution infrastructure, not maintenance schedulers, and
must never originate a new recurring maintenance invocation.

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

Neither required host is launch-certified. Current official evidence establishes two bounded proof
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
`claude_code_routine` with an event trigger. It validates a connection-bound declaration,
`finances:maintain` authority, immutable local identity boundaries, and observational health.
Persistence, API/client/MCP registration, setup UI, maintenance-input schedule identity, Texting's
accepted-reply event, encrypted trigger credentials, dispatch/outbox behavior, and production proof
are not implemented by that contract. Until those dependencies land, runtime dispatch remains
disabled and health metadata must never originate, pause, repair, or reschedule host work.

## Finance host repair after the maintenance cutover

Old protocol payloads and direct judgment/audit submissions are unsupported. Refresh tool
discovery or reconnect the host, then explicitly grant `finances:maintain`. Read and write
access remain separate grants; neither migration nor reconnect grants permission automatically.
Resume persisted work with `maintain_finances` using `operation: resume` and the run ID.
Follow typed challenge next actions and inspect any blocked legacy recovery before starting a
new scope. Required action approval and final verification remain part of the same durable run.
