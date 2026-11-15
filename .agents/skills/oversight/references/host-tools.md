# Host tool mapping

This skill runs in OpenAI Codex (through `.agents/skills`) and Claude Code (through the
`.claude/skills` link). The workflow names host-neutral actions; use the current host's tools below.
Discover the live tool list before acting. An action the current host does not support is reported
as a named setup or lifecycle gap and blocks what depends on it. Never simulate it with notes,
renamed files, a parallel registry or a claim that it happened. Host tools never widen authority:
every grant, limit, platform approval and verification rule in this skill still applies.

| Action | Codex app | Claude Code desktop |
| --- | --- | --- |
| List chats/sessions and read identity, title, section, archived state | Codex app thread/project tools | `mcp__ccd_session_mgmt__list_sessions` (`include_archived` for archived), `get_session` |
| Create a user-owned chat (needs creation authority) | Codex app thread creation tool | `mcp__ccd_session__start_session` |
| Message an existing chat | Codex app thread messaging tool | `SendMessage` to the target's session id |
| Name a chat | Codex app thread rename tool | `mcp__ccd_session_mgmt__set_session_title` |
| List, create or rename a sidebar section | Codex app project/sidebar section tools | `mcp__ccd_sidebar__list_sections`, `create_section`, `rename_section` |
| Place chats in a section | Codex app sidebar membership tool | `mcp__ccd_sidebar__move_sessions` with `section_id` |
| Order members inside a section | Codex app sidebar ordering | Not supported by `move_sessions`; record an ordering gap |
| Archive a completed chat | `set_thread_archived` | `mcp__ccd_session_mgmt__archive_session` |
| Scoped subagent (no sidebar row) | Codex subagent tool | `Agent` |
| Heartbeat or bounded wait, where authorized | Codex app automations | `ScheduleWakeup` where available, or a scheduled task (`mcp__scheduled-tasks__*`) |
| Pause a dedicated heartbeat | Codex automation update | `mcp__scheduled-tasks__update_scheduled_task` |
| Implementation model preference | Codex chat model and `thinking` settings | Not available for the recorded GPT model; record the gap, which blocks dispatch under the existing rule |

## Claude Code cautions

- `archive_session` cleans up the session's worktree by default and asks the user to approve each
  call outside auto/bypass modes. Archive only after the completion procedure has proven dirty and
  unpushed work preserved. If preservation is uncertain, do not archive. A host approval prompt is a
  platform approval; the standing cleanup grant does not bypass it.
- Moving a session other than the current one asks the user first in default mode. A declined move
  is a setup gap, not a completed step.
- Sections are custom sidebar groups. Read back `list_sections` and `list_sessions` (`group`)
  after every write.
