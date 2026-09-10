# External automation hosts

- Status: Target interoperability contract
- Last verified against official platform documentation: 2026-09-10

## Product decision

nohmi does not require one scheduling provider. The person chooses where and when an automation
runs; the host connects to nohmi through MCP or another authenticated API surface and invokes one
high-level intent such as `maintain_finances`.

The host owns cadence, wake-up, and delivery of the invocation. nohmi owns the meaning of the tool,
purpose-bound User Knowledge retrieval, source synchronization, policy, durable run state,
idempotency, resumability, questions, approvals, recovery, audit, and the verified result.

## Supported scheduling patterns

| Host pattern | How it invokes nohmi | Product constraint |
| --- | --- | --- |
| ChatGPT or Codex scheduled task | A scheduled task runs with the configured project, tools, plugins, or skills and calls the remote nohmi MCP server. | Local-project work depends on the desktop host and machine being available; cloud tasks cannot assume local files. Keep the saved prompt to intent and scope. |
| Claude recurring task in Cowork | A scheduled Claude session uses its configured connectors, tools, skills, or plugins to call nohmi. | Availability differs between local and cloud scheduling; nohmi must resume safely after missed or duplicated invocations. |
| Claude Code routine | A schedule, API call, or webhook starts a routine that invokes nohmi MCP. | The routine is an adapter and must not reproduce the workspace playbook or retain private state as the only memory. |
| Gemini scheduled action | Gemini invokes a configured action on a recurring schedule. | Account, region, plan, and application availability may vary; the nohmi run remains authoritative. |
| Gemini CLI headless automation | A script or operating-system scheduler launches Gemini CLI with nohmi configured as an MCP server. | Use bounded non-interactive input, explicit credentials, stable exit handling, and nohmi idempotency. |
| Generic cron, launchd, systemd, or automation service | The scheduler invokes a small authenticated CLI or HTTP/MCP adapter. | Never embed provider credentials, a copy of the user's memory, or workspace orchestration in the schedule. |

## Saved prompt contract

A scheduled prompt should contain only:

- the nohmi maintenance intent;
- a bounded scope when the person selected one;
- whether the host should report only actionable results or every completed run; and
- an instruction to return the durable nohmi state rather than guessing after an interruption.

It should not contain the domain procedure, personal profile, category rules, confidence
thresholds, provider credentials, or a promise that the host will remember prior runs. Those belong
to nohmi's API-owned playbook, User Knowledge, rulebook, and run state.

## Invocation and recovery contract

1. Authenticate with least-privilege workspace and knowledge-purpose scopes.
2. Read `get_nohmi_context` and the relevant workspace status when orientation is required.
3. Invoke `maintain_<workspace>` once with an idempotency identity or resumable scope.
4. If the result is active or waiting, retain the returned run handle and follow only the reported
   next action.
5. If the host repeats the schedule, nohmi resumes, coalesces, or verifies the compatible run rather
   than starting duplicate work.
6. Notify the person only when the configured host policy calls for it and the result is actionable,
   blocked, failed, or complete.

The tool may create nohmi questions and reviews that outlive the host session. The person answers
them in the app or through an authorized agent, and later maintenance uses those answers and
reinforced knowledge to reduce unnecessary questions.

## Platform references

- [OpenAI Codex automations](https://developers.openai.com/codex/app/automations)
- [OpenAI Codex MCP configuration](https://developers.openai.com/codex/mcp/)
- [Claude recurring tasks in Cowork](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork)
- [Claude Code routines](https://claude.com/blog/introducing-routines-in-claude-code)
- [Gemini scheduled actions](https://support.google.com/gemini/answer/16316416?hl=en)
- [Gemini CLI MCP servers](https://geminicli.com/docs/tools/mcp-server/)
- [Gemini CLI headless automation](https://geminicli.com/docs/cli/tutorials/automation/)

Platform behavior is an external boundary and must be reverified before nohmi advertises a setup
flow as currently supported. A passing nohmi test cannot prove that a third-party plan, account,
machine, connector, or scheduler is available to the person.
