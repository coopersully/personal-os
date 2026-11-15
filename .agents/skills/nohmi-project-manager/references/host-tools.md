# Host tool mapping

This skill runs in OpenAI Codex (through `.agents/skills`) and Claude Code (through the
`.claude/skills` link). The workflow names host-neutral actions; use the current host's tools below.
Discover the live tool list before acting. An action the current host does not support is reported
as a named gap in the check-in and blocks what depends on it. Never simulate it with notes, renamed
files, a parallel tracker or a claim that it happened. Host tools never widen authority: every
grant, limit, platform approval and verification rule in this skill still applies.

| Action | Codex app | Claude Code desktop |
| --- | --- | --- |
| List chats/sessions and read owner, title, section, archived state | Codex app thread/project tools | `mcp__ccd_session_mgmt__list_sessions` (`include_archived` for archived), `get_session` |
| Create a user-owned chat (needs creation authority) | Codex app thread creation tool | `mcp__ccd_session__start_session` |
| Send an instruction to an oversight owner | Codex app thread messaging tool | `SendMessage` to the target's session id |
| Name a chat | Codex app thread rename tool | `mcp__ccd_session_mgmt__set_session_title` |
| Inspect or place chats in a sidebar section | Codex app project/sidebar section tools | `mcp__ccd_sidebar__list_sections`, `create_section`, `move_sessions` |
| Archive a completed chat | `set_thread_archived` | `mcp__ccd_session_mgmt__archive_session` |
| Heartbeat or bounded wait, where authorized | Codex app automations | `ScheduleWakeup` where available, or a scheduled task (`mcp__scheduled-tasks__*`) |
| Pause a dedicated heartbeat | Codex automation update | `mcp__scheduled-tasks__update_scheduled_task` for a scheduled task; `ScheduleWakeup` with `stop: true` for a self-paced loop |

## Manager state location

Exactly one manager continuity directory exists. Resolve it before every read or write:

1. If `~/.codex/nohmi-network/project-manager` exists, use it, in either host.
2. Otherwise use `${NOHMI_NETWORK_STATE:-~/.nohmi-network}/project-manager`.

Never copy, mirror or fork the state into the other location. Record the resolved path in each
check-in. If both locations exist, stop state writes, report the duplicate as a gap and reconcile
it to one copy under the existing single-writer claim before continuing.

## Claude Code cautions

- `archive_session` cleans up the session's worktree by default and asks the user to approve each
  call outside auto/bypass modes. Archive only after dirty, unpushed and ignored local work is proven preserved.
  If preservation is uncertain, do not archive. A host approval prompt is a platform approval; the
  standing cleanup authority does not bypass it.
- `archive_session` also archives that session's finished side sessions and any sessions sharing its
  worktree, and it refuses a session that is working, pinned or open on screen. Before archiving,
  prove each such session's own completion (its acceptance, settled PRs, and preserved dirty, unpushed
  and ignored local work); otherwise do not archive. A refusal is a lifecycle gap.
- Read back `list_sessions` after every title, section or archive write.
