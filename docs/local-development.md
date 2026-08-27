# Local development runtimes

Every ilo checkout can run concurrently. `pnpm env:start` acquires a stable repository-wide tier for the current checkout, starts its labeled PostgreSQL project, and runs its API, MCP, and web source on loopback. Start remains attached; use another terminal or Codex action for Status, Logs, or Stop.

Stop preserves the allocation and database. Restart reuses them. Purge is the explicit destructive operation and requires `pnpm env:purge`. Registry records live under `<git-common-dir>/ilo-runtime`; checkout logs live under ignored `.codex/run/logs/`, and generated non-secret values live in ignored `.env.codex.local`.

## Ports

Tier 1 is reserved for the primary checkout. Linked worktrees use the lowest free tier from 2 through 16 unless an existing stable allocation is being reused.

| Tier | Web | API | MCP | PostgreSQL |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 8081 | 8788 | 8789 | 55433 |
| 2 | 8086 | 8793 | 8794 | 55438 |
| 3 | 8091 | 8798 | 8799 | 55443 |
| 4 | 8096 | 8803 | 8804 | 55448 |
| 5 | 8101 | 8808 | 8809 | 55453 |
| 6 | 8106 | 8813 | 8814 | 55458 |
| 7 | 8111 | 8818 | 8819 | 55463 |
| 8 | 8116 | 8823 | 8824 | 55468 |
| 9 | 8121 | 8828 | 8829 | 55473 |
| 10 | 8126 | 8833 | 8834 | 55478 |
| 11 | 8131 | 8838 | 8839 | 55483 |
| 12 | 8136 | 8843 | 8844 | 55488 |
| 13 | 8141 | 8848 | 8849 | 55493 |
| 14 | 8146 | 8853 | 8854 | 55498 |
| 15 | 8151 | 8858 | 8859 | 55503 |
| 16 | 8156 | 8863 | 8864 | 55508 |

For a tier with API port `<api-port>`, register both connector callbacks when needed:

- `http://127.0.0.1:<api-port>/v1/connectors/google/callback`
- `http://127.0.0.1:<api-port>/v1/x-bookmarks/callback`

Doctor prints the concrete callbacks for registered runtimes, but cannot prove that an external provider dashboard contains them.

## Commands and recovery

- `pnpm env:start`, `env:stop`, `env:restart`, `env:status`, and `env:logs` operate only the current checkout.
- `pnpm env:config` prints its stable allocation; `pnpm env:list` shows the repository registry.
- `pnpm env:doctor` reports Git/root drift, ownership mismatches, occupied ports, callbacks, quarantine, and reaper status without taking destructive action.
- `pnpm env:gc` is dry-run only. Normal lifecycle actions perform conservative reconciliation.
- `pnpm env:purge` deletes the stopped current runtime's labeled PostgreSQL volume and releases its tier.
- `pnpm env:reaper:enable` and `pnpm env:reaper:disable` explicitly install or remove the repository-scoped macOS LaunchAgent.

Automatic cleanup requires a missing checkout, absent-or-prunable unlocked Git state, two observations, and at least 60 seconds. Locked, present-but-unregistered, ambiguous-process, and Docker-label-mismatch cases fail closed and retain the tier. Use Doctor, repair the reported ownership or Git state, and rerun GC. Never delete registry records or Docker resources by tier alone.

The primary checkout `.env` is authoritative for secrets. Setup creates it when absent; linked worktrees receive a mode-`0600` copy. Every published port binds to `127.0.0.1`. `cooper-run activate <tier>` only selects a saved project root and does not stop other runtimes.
