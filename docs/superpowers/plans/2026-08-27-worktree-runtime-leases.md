# Worktree Runtime Leases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every ilo checkout acquire, run, inspect, and automatically clean up an isolated local runtime without port, process, Compose, or PostgreSQL collisions.

**Architecture:** Keep `.codex/scripts/environment.sh` as the public lifecycle entry point while moving structured registry, ownership, reconciliation, and supervision behavior into dependency-free Node 22 modules. Persist allocation state in the Git common directory, identify every runtime independently from its reusable slot, and install an explicitly authorized per-repository LaunchAgent bundle for cleanup after a Codex-managed worktree disappears.

**Tech Stack:** Bash 3.2-compatible shell, Node.js 22 built-ins, Node test runner, Git worktrees, Docker Compose v2, macOS launchd, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-08-27-worktree-runtime-leases-design.md`

## Global Constraints

- Implement against this branch. Use `origin/main` only as a behavioral reference for primary `.env` synchronization and stable tier ports; do not merge or rebase unrelated mainline commits.
- Use no new runtime or test dependency. Lifecycle tests must run with Node 22 and the checked-in shell before `pnpm install` succeeds.
- Tier 1 belongs to the primary checkout. Linked worktrees may acquire tiers 2 through 16.
- Use these exact port formulas: web `8081 + 5 * (tier - 1)`, API `8788 + 5 * (tier - 1)`, MCP `8789 + 5 * (tier - 1)`, PostgreSQL `55433 + 5 * (tier - 1)`.
- Keep the primary checkout `.env` authoritative. A linked worktree receives an ignored `.env` copy and generated `.env.codex.local` overlay.
- Bind every host service and published container port to `127.0.0.1`.
- Use `docker compose -p ilo-wt-<runtime-id>` explicitly. Never derive Docker ownership from a directory name or tier.
- Never stop a PID, process group, container, network, or volume unless runtime ID, repository identity, root hash, and available start/command evidence agree.
- Automatic orphan cleanup requires an absent root plus absent-or-prunable unlocked Git state, two observations, and at least 60 seconds.
- Do not install a `SessionEnd` hook. Do not silently install a LaunchAgent from Setup.
- `stop` preserves the allocation and database. Confirmed orphan cleanup and explicit `purge` delete the owned database volume.
- Keep `activate`, `active-root`, and `config` backward compatible with `/Users/cooper/.codex/skills/cooper-run/scripts/cooper-run.sh`; registry correctness must not depend on `active-root`.
- Run the nearest Node or shell test after each change and `pnpm verify` before final handoff.

## File Structure

- Create `.codex/scripts/runtime-registry.mjs`: schema validation, repository context, atomic locking/writes, legacy-tier migration, slot allocation, root index, and audit rotation.
- Create `.codex/scripts/runtime-registry.test.mjs`: deterministic registry and allocation tests using temporary Git repositories.
- Create `.codex/scripts/runtime-resources.mjs`: listener inspection, process identity, Docker label inspection/removal, and Compose command construction.
- Create `.codex/scripts/runtime-resources.test.mjs`: injected-command tests for process and Docker fail-closed behavior.
- Create `.codex/scripts/runtime-reconciler.mjs`: Git porcelain parsing, orphan classification, state transitions, cleanup ownership, and reconciliation reports.
- Create `.codex/scripts/runtime-reconciler.test.mjs`: locked, prunable, grace, recovery, interrupted-cleanup, and dry-run tests.
- Create `.codex/scripts/runtime-supervisor.mjs`: detached runtime process-group bootstrap, API/MCP/web child lifecycle, readiness, logging, and shared process records.
- Create `.codex/scripts/runtime-supervisor.test.mjs`: child failure, signal, readiness, and ownership-record tests.
- Create `.codex/scripts/runtime-manager.mjs`: user-facing CLI and lifecycle orchestration over the four modules above.
- Create `.codex/scripts/runtime-manager.test.mjs`: CLI output, exit status, configuration overlay, migration, purge, and compatibility tests.
- Create `.codex/scripts/runtime-reaper-install.mjs`: idempotent LaunchAgent bundle installation, refresh, doctor, and removal.
- Create `.codex/scripts/runtime-reaper-install.test.mjs`: temporary-home and fake-launchctl tests.
- Create `.codex/scripts/environment.test.sh`: end-to-end shell contract tests in temporary linked worktrees.
- Create `.codex/scripts/environment.test-docker.sh`: deterministic Docker CLI fixture used only by the shell contract test.
- Create `.codex/runtime/compose.yaml`: labeled, loopback-only development PostgreSQL project.
- Create `docs/local-development.md`: runtime tiers, lifecycle, OAuth callbacks, cleanup, doctor, and recovery documentation.
- Modify `.codex/scripts/environment.sh`: retain toolchain/secret setup and dispatch runtime operations to the manager.
- Modify `.codex/scripts/check.sh`: syntax-check every lifecycle module and run the focused Node/shell suites.
- Modify `.codex/environments/environment.toml`: add List, Doctor, GC Dry Run, Purge, Enable Automatic Cleanup, and Disable Automatic Cleanup actions.
- Modify `package.json`: add matching `env:*` scripts without changing application dependencies.
- Modify `AGENTS.md` and `README.md`: replace single-runtime assumptions with the registered-runtime workflow.

---

### Task 1: Durable Registry and Deterministic Slot Allocation

**Files:**
- Create: `.codex/scripts/runtime-registry.mjs`
- Create: `.codex/scripts/runtime-registry.test.mjs`

**Interfaces:**
- Consumes: Node built-ins `node:crypto`, `node:fs/promises`, `node:path`, `node:child_process`, and `node:util`.
- Produces: `SCHEMA_VERSION`, `REAPER_PROTOCOL_VERSION`, `portsForSlot(tier)`, `resolveRepositoryContext(root)`, `withRegistryLock(context, operation)`, `acquireAllocation(context, options)`, `getAllocationForRoot(context, root)`, `listAllocations(context)`, `replaceAllocation(context, allocation)`, `deleteAllocation(context, runtimeId)`, `appendAuditEvent(context, event)`, and `migrateLegacyTiers(context, options)`.

The allocation record contract is:

```js
{
  schemaVersion: 1,
  runtimeId: '12 lowercase hex characters',
  repositoryId: '32 lowercase hex characters',
  root: '/canonical/checkout',
  rootHash: '64 lowercase hex characters',
  gitDir: '/absolute/git-admin-directory',
  tier: 2,
  ports: { web: 8086, api: 8793, mcp: 8794, postgres: 55438 },
  composeProject: 'ilo-wt-<runtime-id>',
  state: 'allocated',
  createdAt: 'ISO-8601 timestamp',
  updatedAt: 'ISO-8601 timestamp',
  orphanedAt: null,
  cleanup: null,
  processes: {}
}
```

- [ ] **Step 1: Write failing registry tests**

Cover exact tier formulas and bounds, tier 1 primary ownership, lowest-free linked allocation, stable reacquisition, occupied-port skipping, pool exhaustion, parallel acquisition under one lock, stale-lock recovery, live-lock refusal, malformed-record quarantine, newer-schema refusal, reverse-index consistency, audit rotation, and legacy `tiers/<n>` import.

Use a temporary repository helper that initializes one primary checkout and two linked worktrees, and inject deterministic `now`, `randomBytes`, `probePort`, and process-identity functions. The central assertions must include:

```js
assert.deepEqual(portsForSlot(1), {
  web: 8081,
  api: 8788,
  mcp: 8789,
  postgres: 55433,
});
assert.deepEqual(portsForSlot(16), {
  web: 8156,
  api: 8863,
  mcp: 8864,
  postgres: 55508,
});
assert.throws(() => portsForSlot(0), /tier must be between 1 and 16/i);
assert.equal(first.runtimeId, second.runtimeId);
assert.equal(first.tier, 2);
assert.notEqual(parallelA.tier, parallelB.tier);
```

Legacy migration must preserve a live valid tier, ignore a missing stale root, refuse two roots claiming one tier, and rename the migrated directory to `tiers.migrated` only after every imported record and root index is durable.

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run: `node --test ./.codex/scripts/runtime-registry.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `runtime-registry.mjs`.

- [ ] **Step 3: Implement the schema, tier calculation, and repository context**

Start the module with these exact constants and validation rules:

```js
export const SCHEMA_VERSION = 1;
export const REAPER_PROTOCOL_VERSION = 1;
export const MIN_TIER = 1;
export const MAX_TIER = 16;

export function portsForSlot(tier) {
  if (!Number.isInteger(tier) || tier < MIN_TIER || tier > MAX_TIER) {
    throw new Error(`Runtime tier must be between ${MIN_TIER} and ${MAX_TIER}.`);
  }
  const offset = 5 * (tier - 1);
  return {
    web: 8081 + offset,
    api: 8788 + offset,
    mcp: 8789 + offset,
    postgres: 55433 + offset,
  };
}
```

`resolveRepositoryContext(root)` must canonicalize with `realpath`, obtain absolute `--git-common-dir` and `--git-dir`, derive the primary root from the common directory, create `<git-common-dir>/ilo-runtime`, and create one durable random `repository-id` with mode `0600`. Reject roots containing NUL and retain NUL-safe Git parsing elsewhere.

- [ ] **Step 4: Implement atomic registry mutation and allocation**

Use `mkdir(<registry>/lock)` as the exclusive lock. Write `owner.json` containing PID, normalized process start, and acquisition time. Retry for five seconds with 50 ms to 250 ms bounded jitter. Remove a lock only when its recorded PID/start pair is no longer live; a timeout must name the live owner.

Write JSON through a sibling temporary file opened with mode `0600`, call `FileHandle.sync()`, rename it over the destination, then sync the parent directory when supported. Validate every field before and after reading. Quarantine malformed records under `quarantine/<filename>.<timestamp>` and reserve their referenced tier if it can be decoded safely. A record with a schema version greater than `SCHEMA_VERSION` raises `UnsupportedRegistrySchemaError` and leaves the entire registry untouched; an older reaper must never quarantine or rewrite newer state.

Allocate under one lock. Tier 1 is returned only for the primary root. Linked roots scan tiers 2 through 16, exclude every valid, releasing, cleanup-failed, quarantined-known, and legacy-unmigrated tier, call the injected probe on all four ports, and commit the allocation plus `roots/<sha256-root>.json` before releasing the lock. `deleteAllocation` removes the reverse index and clears `active-root` only when that file names the deleted allocation's exact root.

- [ ] **Step 5: Implement audit rotation and legacy migration**

Append one JSON object per line with only timestamp, action, runtime ID, repository ID, tier, state, and safe error code. Rotate `audit.ndjson` to `audit.ndjson.1` at 1 MiB and keep only `.1`, `.2`, and `.3`.

`migrateLegacyTiers` reads `<registry>/tiers/[1-16]`, canonicalizes roots that still exist, verifies Git membership through the injected callback, imports non-conflicting records with their old tier, and preserves `active-root`. A successful migration atomically renames `tiers` to `tiers.migrated`; any conflict leaves the original directory untouched and reports recovery through Doctor.

- [ ] **Step 6: Run focused registry verification**

Run: `node --test ./.codex/scripts/runtime-registry.test.mjs`

Expected: PASS with all registry tests passing and no files written outside each test temporary directory.

- [ ] **Step 7: Commit the registry**

```bash
git add .codex/scripts/runtime-registry.mjs .codex/scripts/runtime-registry.test.mjs
git commit -m 'feat: add durable worktree runtime registry'
```

---

### Task 2: Owned Process, Listener, and Docker Resources

**Files:**
- Create: `.codex/scripts/runtime-resources.mjs`
- Create: `.codex/scripts/runtime-resources.test.mjs`
- Create: `.codex/runtime/compose.yaml`

**Interfaces:**
- Consumes: Task 1 `Allocation` records and injected `execFile`, `kill`, `now`, and filesystem adapters.
- Produces: `probePort(port)`, `inspectListener(port)`, `inspectProcess(pid)`, `processMatches(record, observed)`, `stopOwnedProcessGroup(allocation, adapters)`, `composeCommand(allocation, root, args)`, `inspectOwnedDockerResources(allocation, adapters)`, and `removeOwnedDockerResources(allocation, adapters)`.

- [ ] **Step 1: Write failing ownership tests**

Use injected command results instead of real host processes or Docker. Cover a matching PID/start/command/cwd, PID reuse, missing cwd after worktree deletion, wrong runtime marker, an unrelated listener, complete Docker label agreement, one missing label, a foreign Compose project, Docker unavailable, removal ordering, and failure preservation.

The required ownership predicate is:

```js
assert.equal(processMatches(record, {
  pid: record.pid,
  startIdentity: record.startIdentity,
  command: `node runtime-supervisor.mjs --runtime-id ${allocation.runtimeId}`,
  cwd: allocation.root,
}), true);
assert.equal(processMatches(record, {
  pid: record.pid,
  startIdentity: 'different-start',
  command: record.commandMarker,
  cwd: allocation.root,
}), false);
```

Docker tests must prove that no `rm` command runs after a label mismatch and that successful cleanup removes containers first, networks second, and volumes last.

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run: `node --test ./.codex/scripts/runtime-resources.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `runtime-resources.mjs`.

- [ ] **Step 3: Implement listener and process inspection**

Probe a candidate port by opening a temporary `node:net` server on `127.0.0.1`, closing it in `finally`, and returning a structured unavailable result on `EADDRINUSE`. Use `lsof -nP -iTCP:<port> -sTCP:LISTEN -Fpctn` only for diagnostics; never infer ownership from its result.

Normalize process identity from PID, `ps -o lstart=`, `ps -o command=`, and `lsof -a -p <pid> -d cwd -Fn`. Require PID, start identity, and `--runtime-id <id>` command marker. When cwd still exists, also require the canonical root. When cwd is unavailable because the directory was deleted, retain the stricter PID/start/command requirements.

- [ ] **Step 4: Add the minimal labeled PostgreSQL Compose file**

Create this development-only Compose shape:

```yaml
services:
  postgres:
    image: postgres:17.5-alpine
    environment:
      POSTGRES_DB: personal_os
      POSTGRES_PASSWORD: personal_os
      POSTGRES_USER: personal_os
    healthcheck:
      test: [CMD-SHELL, pg_isready -U personal_os -d personal_os]
      interval: 3s
      timeout: 3s
      retries: 20
    labels: &runtime-labels
      app.ilo.runtime.id: ${ILO_RUNTIME_ID:?}
      app.ilo.runtime.repository: ${ILO_REPOSITORY_ID:?}
      app.ilo.runtime.root: ${ILO_ROOT_HASH:?}
    ports:
      - 127.0.0.1:${LOCAL_POSTGRES_PORT:?}:5432
    volumes:
      - postgres-data:/var/lib/postgresql/data

networks:
  default:
    labels: *runtime-labels

volumes:
  postgres-data:
    labels: *runtime-labels
```

Always call it with `docker compose -p <composeProject> -f <root>/.codex/runtime/compose.yaml` and pass all four interpolation variables explicitly.

- [ ] **Step 5: Implement fail-closed Docker inspection and removal**

Discover resources by all four labels: Compose project, runtime ID, repository ID, and root hash. Inspect the returned resource again before mutation. Return `docker-unavailable`, `docker-label-mismatch`, or `docker-remove-failed` without deleting the registry allocation.

For confirmed ownership, signal the verified process group with `process.kill(-pgid, signal)`, stop/remove containers, remove the labeled project network, and remove the labeled PostgreSQL volume. Treat already-absent owned resources as idempotent success. Never use an unfiltered `docker compose down`, `docker system prune`, or tier-only lookup.

- [ ] **Step 6: Run focused resource verification**

Run: `node --test ./.codex/scripts/runtime-resources.test.mjs`

Run: `ILO_RUNTIME_ID=test12345678 ILO_REPOSITORY_ID=0123456789abcdef0123456789abcdef ILO_ROOT_HASH=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef LOCAL_POSTGRES_PORT=55438 docker compose -p ilo-wt-test12345678 -f ./.codex/runtime/compose.yaml config --quiet`

Expected: both commands exit 0; the Node suite records no mutation for unowned resources.

- [ ] **Step 7: Commit resource ownership**

```bash
git add .codex/scripts/runtime-resources.mjs .codex/scripts/runtime-resources.test.mjs .codex/runtime/compose.yaml
git commit -m 'feat: isolate owned runtime resources'
```

---

### Task 3: Conservative Reconciliation State Machine

**Files:**
- Create: `.codex/scripts/runtime-reconciler.mjs`
- Create: `.codex/scripts/runtime-reconciler.test.mjs`

**Interfaces:**
- Consumes: Task 1 registry mutations and Task 2 process/Docker inspection and removal.
- Produces: `parseWorktreePorcelain(buffer)`, `classifyAllocation(allocation, snapshot, now)`, `reconcileAllocation(context, allocation, options)`, and `reconcileRegistry(context, options)`.

The classification result is one of `live`, `orphan-pending`, `orphan-ready`, `drifted-present-unregistered`, `drifted-missing-locked`, `releasing`, or `cleanup-failed`.

- [ ] **Step 1: Write failing reconciliation tests**

Build NUL-delimited Git fixtures containing normal, detached, locked-with-reason, and prunable records. Cover these exact decisions:

```js
assert.equal(classifyAllocation(allocation, {
  rootExists: true,
  worktree: registered,
}, now).kind, 'live');
assert.equal(classifyAllocation(allocation, {
  rootExists: false,
  worktree: locked,
}, now).kind, 'drifted-missing-locked');
assert.equal(classifyAllocation(allocation, {
  rootExists: true,
  worktree: null,
}, now).kind, 'drifted-present-unregistered');
```

Also prove first missing observation marks `orphan-pending`, a reappearing root clears it, a second observation at 59 seconds stays pending, a second observation at 60 seconds becomes ready, dry-run never mutates, a live cleanup owner blocks takeover, a dead owner permits takeover, cleanup failure retains the tier, and an operation-token mismatch cannot delete a newer allocation.

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run: `node --test ./.codex/scripts/runtime-reconciler.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `runtime-reconciler.mjs`.

- [ ] **Step 3: Implement NUL-safe Git parsing and classification**

Invoke `git worktree list --porcelain -z --expire now`. Parse records separated by an empty NUL field. Preserve `worktree`, `HEAD`, `branch`, `detached`, `locked` reason, and `prunable` reason. Do not parse the human-readable Git format.

Use this decision order:

1. Existing root plus registered worktree is live and clears `orphanedAt`.
2. Existing root plus no matching Git worktree is drifted and never cleaned.
3. Missing root plus locked Git worktree is drifted and never cleaned.
4. Missing root plus normal non-prunable Git worktree is pending, because Git still considers it live.
5. Missing root plus absent or prunable unlocked Git worktree begins or continues the orphan grace.
6. Two observations and 60 seconds make the orphan eligible.

- [ ] **Step 4: Implement two-phase reconciliation and cleanup ownership**

Under the registry lock, transition ready records to `releasing` and store:

```js
cleanup: {
  operationToken: randomUUID(),
  ownerPid: process.pid,
  ownerStartIdentity: await currentProcessStart(),
  startedAt: now.toISOString(),
}
```

Release the lock before process and Docker cleanup. Reacquire it afterward and delete the allocation only if runtime ID and operation token still match. On failure, store `cleanup-failed`, a safe error code, and the same reserved tier. Another reconciler may take over only after verifying the cleanup owner PID/start pair is dead.

Dry-run returns candidate predicate, elapsed grace, process decision, Docker resources, and intended mutations without writing allocation, audit, or lock-recovery state.

- [ ] **Step 5: Run focused reconciliation verification**

Run: `node --test ./.codex/scripts/runtime-reconciler.test.mjs`

Expected: PASS, including locked/prunable fixtures and the operation-token race test.

- [ ] **Step 6: Commit reconciliation**

```bash
git add .codex/scripts/runtime-reconciler.mjs .codex/scripts/runtime-reconciler.test.mjs
git commit -m 'feat: reconcile deleted worktree runtimes'
```

---

### Task 4: Runtime-Owned Attached Supervisor

**Files:**
- Create: `.codex/scripts/runtime-supervisor.mjs`
- Create: `.codex/scripts/runtime-supervisor.test.mjs`

**Interfaces:**
- Consumes: Task 1 allocation records and Task 2 process inspection; inherited primary secrets plus explicit runtime URLs.
- Produces: `buildServiceSpecs(allocation, root, inheritedEnv)`, `runSupervisor(options)`, and CLI `runtime-supervisor.mjs --allocation <absolute-record-path> --runtime-id <id>`.

- [ ] **Step 1: Write failing supervisor tests**

Inject `spawn`, readiness probes, timers, and registry record callbacks. Assert exact loopback arguments and runtime variables for API, MCP, and Vite. Prove that the bootstrap child uses `detached: true`, its PID is recorded as both supervisor PID and PGID, children inherit the group, all three readiness probes must pass, one child exit terminates the others, SIGTERM performs bounded cleanup, and a failed readiness probe prints the final 80 service log lines.

The service contract must include:

```js
assert.equal(api.env.PORT, String(allocation.ports.api));
assert.equal(api.env.GOOGLE_REDIRECT_URI, `${apiUrl}/v1/connectors/google/callback`);
assert.equal(api.env.X_REDIRECT_URI, `${apiUrl}/v1/x-bookmarks/callback`);
assert.equal(mcp.env.HOST, '127.0.0.1');
assert.deepEqual(web.args, [
  '--filter',
  '@personal-os/web',
  'exec',
  'vite',
  '--host',
  '127.0.0.1',
  '--port',
  String(allocation.ports.web),
  '--strictPort',
]);
```

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run: `node --test ./.codex/scripts/runtime-supervisor.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `runtime-supervisor.mjs`.

- [ ] **Step 3: Implement detached bootstrap and service specifications**

The initial process spawns one copy of itself with `detached: true`, inherited stdio, and `ILO_RUNTIME_SUPERVISOR_CHILD=1`, then waits for its exit so the Codex Start terminal remains attached. The child is the runtime process-group leader. Spawn API, MCP, and web without `detached`, redirect each service to `.codex/run/logs/<service>.log`, and include `--runtime-id <id>` in the supervisor command line.

Construct API/MCP/web URLs exclusively from the allocation. API receives the inherited secrets plus runtime-specific database, origins, OAuth, MCP, migration, and port variables. MCP receives the runtime API URL and loopback host. Vite receives its proxy target, loopback host, assigned port, and `--strictPort`.

- [ ] **Step 4: Implement shared process records and attached failure behavior**

Record supervisor identity before spawning services and record every child after spawn using Task 1 `replaceAllocation`. A record includes PID, start identity, command marker, canonical cwd, and PGID. Do not report ready until PostgreSQL, API, MCP, and web probes pass.

On INT, TERM, readiness failure, or child exit, stop the verified process group with TERM, wait up to ten seconds in 250 ms condition checks, then use KILL only for still-matching identities. Clear process records only after exit is observed. Preserve the allocation and database for retry.

- [ ] **Step 5: Run focused supervisor verification**

Run: `node --test ./.codex/scripts/runtime-supervisor.test.mjs`

Expected: PASS with no surviving fixture children after the test runner exits.

- [ ] **Step 6: Commit the supervisor**

```bash
git add .codex/scripts/runtime-supervisor.mjs .codex/scripts/runtime-supervisor.test.mjs
git commit -m 'feat: supervise worktree source processes'
```

---

### Task 5: Lifecycle Manager and Shell Integration

**Files:**
- Create: `.codex/scripts/runtime-manager.mjs`
- Create: `.codex/scripts/runtime-manager.test.mjs`
- Create: `.codex/scripts/environment.test.sh`
- Create: `.codex/scripts/environment.test-docker.sh`
- Modify: `.codex/scripts/environment.sh:6-539`

**Interfaces:**
- Consumes: Tasks 1 through 4 and inherited environment variables loaded by `environment.sh`.
- Produces CLI commands `acquire`, `start`, `stop`, `restart`, `status`, `config`, `list`, `doctor`, `gc`, `purge`, `activate`, and `active-root`.

- [ ] **Step 1: Write failing manager and shell contract tests**

Manager tests must cover JSON and human output, non-allocating Setup/Status, Start allocation, generated `.env.codex.local`, exact Compose project arguments, startup rollback, Stop preservation, Purge acknowledgement, Doctor diagnostics, GC dry-run non-mutation, legacy tier migration, requested-tier conflict, and `active-root` fallback errors.

The shell test must initialize a temporary Git repository with two linked worktrees, copy every runtime module and the minimal Compose file, inject the fake Docker executable, and assert:

```text
  Tier:      2
  App:       http://localhost:8086
  API:       http://127.0.0.1:8793
  MCP:       http://127.0.0.1:8794
  PostgreSQL 127.0.0.1:55438
```

It must also prove adding a third worktree does not change an assigned tier, two parallel `acquire` calls return different tiers, `activate 2` writes the compatible `active-root`, an unowned PID is not terminated, and one fake Docker label mismatch makes Stop/Purge fail closed.

- [ ] **Step 2: Run the tests and verify the missing manager failure**

Run: `node --test ./.codex/scripts/runtime-manager.test.mjs`

Run: `bash ./.codex/scripts/environment.test.sh`

Expected: the Node test fails with `ERR_MODULE_NOT_FOUND`; the shell test fails because the new commands do not exist.

- [ ] **Step 3: Implement the manager CLI**

Use one explicit command table and reject unknown options with exit 2. `start` performs: reconcile, migrate legacy tiers, acquire, sync primary `.env`, write `.env.codex.local`, probe all ports, verify Docker ownership, start labeled PostgreSQL with explicit `-p`, wait for `pg_isready`, and invoke the attached supervisor.

`stop` resolves only the current root allocation, verifies/stops its process group, and stops its PostgreSQL container without removing its volume or allocation. `purge --acknowledge-data-loss` requires a stopped allocation and uses runtime ID plus labels; without the flag it exits 2 without mutation. After verified purge, remove the current checkout's generated overlay and PID/owner metadata, clear matching `active-root`, and preserve ordinary service logs. `status` on an unallocated root prints `State: unallocated` and does not acquire.

Setup, Start, Stop, Status, List, and allocation commands run bounded reconciliation first. Doctor reports malformed/quarantined records, legacy migration conflicts, root/Git drift, process-identity mismatches, Docker-label mismatches, occupied ports, current callback URIs, and reaper installation/version state without mutating them.

`config` retains the labels expected by `cooper-run`: Root, Tier, App, API, MCP, PostgreSQL, and Compose. `activate [tier]` acquires or reuses the requested free tier and atomically writes `<git-common-dir>/ilo-runtime/active-root`. `active-root` validates existence and NUL-safe Git membership before returning it. Neither command stops another runtime.

- [ ] **Step 4: Port primary environment synchronization into the shell**

Keep Bash responsible for toolchain checks, generating `APP_ENCRYPTION_KEY` and `MCP_INTERNAL_SECRET` in the primary `.env`, copying that file into linked worktrees with mode `0600`, sourcing it, installing dependencies, logs, tests, build, and verify.

Replace fixed port globals and PID ownership logic with manager dispatch:

```bash
command_start() {
  check_toolchain
  load_env
  require_docker
  exec node "$ROOT/.codex/scripts/runtime-manager.mjs" start --root "$ROOT"
}

command_stop() {
  node "$ROOT/.codex/scripts/runtime-manager.mjs" stop --root "$ROOT"
}
```

Setup runs `runtime-manager.mjs gc --root "$ROOT"`, reports automatic-cleanup status, installs dependencies, and runs `.codex/scripts/check.sh`; it must not call `acquire`. Route `config`, `list`, `doctor`, `gc`, `purge`, `activate`, and `active-root` directly to the manager. Keep Logs checkout-local under `.codex/run/logs`.

- [ ] **Step 5: Implement the generated runtime overlay**

For linked worktrees, atomically write `.env.codex.local` with mode `0600` containing exactly:

```dotenv
CODEX_RUNTIME_TIER=<tier>
ILO_RUNTIME_ID=<runtime-id>
ILO_REPOSITORY_ID=<repository-id>
ILO_ROOT_HASH=<root-hash>
LOCAL_WEB_PORT=<web-port>
LOCAL_API_PORT=<api-port>
LOCAL_MCP_PORT=<mcp-port>
LOCAL_POSTGRES_PORT=<postgres-port>
APP_BASE_URL=http://localhost:<web-port>
API_BASE_URL=http://127.0.0.1:<api-port>
DATABASE_URL=postgres://personal_os:personal_os@127.0.0.1:<postgres-port>/personal_os
MCP_PUBLIC_URL=http://127.0.0.1:<mcp-port>
GOOGLE_REDIRECT_URI=http://127.0.0.1:<api-port>/v1/connectors/google/callback
X_REDIRECT_URI=http://127.0.0.1:<api-port>/v1/x-bookmarks/callback
```

Add the existing ALLOWED_ORIGINS, MCP resource, OAuth authorization-server, and Vite variables derived from those same URLs. Never copy provider secrets into the shared Git registry or audit log.

- [ ] **Step 6: Run lifecycle integration verification**

Run: `node --test ./.codex/scripts/runtime-manager.test.mjs`

Run: `bash ./.codex/scripts/environment.test.sh`

Run: `bash -n ./.codex/scripts/environment.sh && node --check ./.codex/scripts/runtime-manager.mjs`

Expected: all commands exit 0; the temporary worktrees retain stable, non-overlapping tiers and the fake Docker log contains only fully labeled project operations.

- [ ] **Step 7: Commit lifecycle integration**

```bash
git add .codex/scripts/environment.sh .codex/scripts/environment.test.sh .codex/scripts/environment.test-docker.sh .codex/scripts/runtime-manager.mjs .codex/scripts/runtime-manager.test.mjs
git commit -m 'feat: integrate isolated worktree runtimes'
```

---

### Task 6: Explicit macOS Automatic-Cleanup Integration

**Files:**
- Create: `.codex/scripts/runtime-reaper-install.mjs`
- Create: `.codex/scripts/runtime-reaper-install.test.mjs`
- Modify: `.codex/scripts/runtime-manager.mjs`
- Modify: `.codex/scripts/runtime-manager.test.mjs`
- Modify: `.codex/environments/environment.toml:8-51`

**Interfaces:**
- Consumes: Task 1 repository ID/protocol version and Tasks 1 through 3 as the installed reaper bundle.
- Produces: `installReaper(options)`, `refreshInstalledReaper(options)`, `uninstallReaper(options)`, `inspectInstalledReaper(options)`, plus manager commands `reaper-enable`, `reaper-disable`, and `reaper-status`.

- [ ] **Step 1: Write failing install/update/uninstall tests**

Use a temporary home and injected platform, UID, Node executable, tool paths, and launchctl recorder. Cover first install, idempotent reinstall, safe refresh, refusal to downgrade protocol 2 with protocol 1, refusal to read registry schema 2 with reader schema 1, repository-ID mismatch, missing installed files, unsupported platform, and exact uninstall scope.

Assert the plist contains the absolute installed manager path, absolute `process.execPath`, pinned Git common directory, pinned repository ID, `RunAtLoad`, `StartInterval` 60, and `WatchPaths` containing only `<git-common-dir>/worktrees`.

- [ ] **Step 2: Run the tests and verify the missing installer failure**

Run: `node --test ./.codex/scripts/runtime-reaper-install.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `runtime-reaper-install.mjs`.

- [ ] **Step 3: Implement the versioned installed bundle**

Install below `~/Library/Application Support/ilo-runtime/<repository-id>/` with mode `0700` directories and `0600` files. Copy the registry, resources, reconciler, and manager modules plus a manifest containing repository ID, schema version, reaper protocol version, source commit, Git common directory, absolute Node/Git/Docker/lsof/ps executable paths, and installation time. The manager must dynamically import the supervisor and installer only for commands that need them so the installed GC bundle has no worktree-local import. Installed GC loads every external executable from the verified manifest instead of relying on launchd's minimal PATH.

Write `~/Library/LaunchAgents/app.ilo.runtime-reaper.<first-12-repository-id>.plist`. Its command is `<absolute-node> <installed-manager> gc --git-common-dir <absolute-common-dir> --repository-id <repository-id> --installed-reaper`. This installed-only GC mode accepts no checkout root and refuses a repository-ID mismatch. Bootstrap with `launchctl bootstrap gui/<uid> <plist>` and kickstart once. Refresh only when repository ID matches, checked-in protocol is not lower than installed protocol, and the registry schema is supported.

- [ ] **Step 4: Implement safe disable and Setup refresh**

Disable with `launchctl bootout gui/<uid> <plist>`, then remove only the exact plist and exact repository-ID application-support directory after their manifests match. Missing files are idempotent success; mismatched files fail closed.

Setup calls `reaper-status`. When not installed, print one line naming the Enable Automatic Cleanup action. When installed and compatible, refresh it. Never install a new LaunchAgent from Setup. Linux and Windows return a clear unsupported status while ordinary action-triggered reconciliation remains available.

- [ ] **Step 5: Add the explicit Codex actions**

Add these action commands to `.codex/environments/environment.toml`:

```toml
[[actions]]
name = "Enable Automatic Cleanup"
icon = "run"
command = "bash ./.codex/scripts/environment.sh reaper-enable"

[[actions]]
name = "Disable Automatic Cleanup"
icon = "run"
command = "bash ./.codex/scripts/environment.sh reaper-disable"
```

Also add List Runtimes, Doctor, and GC Dry Run actions using `list`, `doctor`, and `gc --dry-run`. Keep Purge as a CLI/package command rather than a one-click Codex action because it deletes the current database.

- [ ] **Step 6: Run focused reaper verification**

Run: `node --test ./.codex/scripts/runtime-reaper-install.test.mjs ./.codex/scripts/runtime-manager.test.mjs`

Run: `bash ./.codex/scripts/environment.test.sh`

Expected: PASS; the fake launchctl log shows one bootstrap for repeated enable and one exact bootout for disable.

- [ ] **Step 7: Commit automatic cleanup integration**

```bash
git add .codex/scripts/runtime-reaper-install.mjs .codex/scripts/runtime-reaper-install.test.mjs .codex/scripts/runtime-manager.mjs .codex/scripts/runtime-manager.test.mjs .codex/environments/environment.toml
git commit -m 'feat: add opt-in automatic runtime cleanup'
```

---

### Task 7: Repository Checks, Commands, and Developer Documentation

**Files:**
- Modify: `.codex/scripts/check.sh:6-20`
- Modify: `package.json:16-31`
- Modify: `AGENTS.md:7-29`
- Modify: `README.md:27-69`
- Create: `docs/local-development.md`

**Interfaces:**
- Consumes: every public command completed in Tasks 1 through 6.
- Produces: deterministic repository validation and the operator-facing local-development contract.

- [ ] **Step 1: Extend the checked-in environment validator**

Require every new module, test, and `.codex/runtime/compose.yaml`. Run `bash -n` for both shell scripts, `node --check` for every `.mjs`, the six Node test files in one `node --test` invocation, then `environment.test.sh`.

The final commands in `check.sh` must be:

```bash
node --test \
  ./.codex/scripts/runtime-registry.test.mjs \
  ./.codex/scripts/runtime-resources.test.mjs \
  ./.codex/scripts/runtime-reconciler.test.mjs \
  ./.codex/scripts/runtime-supervisor.test.mjs \
  ./.codex/scripts/runtime-manager.test.mjs \
  ./.codex/scripts/runtime-reaper-install.test.mjs
bash ./.codex/scripts/environment.test.sh
```

- [ ] **Step 2: Add package scripts for every safe public operation**

Add `env:config`, `env:list`, `env:doctor`, `env:gc`, `env:purge`, `env:reaper:enable`, and `env:reaper:disable`. Define `env:gc` as dry-run by default; destructive reconciliation remains the internal `gc` invoked by lifecycle actions and the reaper.

Use this exact destructive acknowledgement:

```json
"env:purge": "bash ./.codex/scripts/environment.sh purge --acknowledge-data-loss"
```

- [ ] **Step 3: Document the runtime and recovery workflow**

In `docs/local-development.md`, document Start/Stop/Restart/Status/Logs, stable allocation lifetime, List/Doctor/GC Dry Run/Purge, explicit automatic-cleanup enable/disable, registry location, `.env` authority, loopback binding, failure states, and safe recovery commands.

Include all sixteen tier rows:

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

For each registered live-connector tier, document both exact callback paths under `http://127.0.0.1:<api-port>`. State that Doctor prints required URIs but cannot prove provider-dashboard registration.

- [ ] **Step 4: Update concise repository entry points**

Update AGENTS.md with primary tier ports, tier 2 example, persistent allocation semantics, shared-registry location, `.env` synchronization, explicit reaper opt-in, and `pnpm env:doctor`. Update README to link `docs/local-development.md`, show tier 1 URLs, and explain that each Codex worktree Start action runs that worktree directly.

Document that `cooper-run activate <tier>` remains a saved-project selection convenience and does not stop other allocations.

- [ ] **Step 5: Run documentation and repository checks**

Run: `pnpm exec biome format --write .codex/scripts package.json AGENTS.md README.md docs/local-development.md`

Run: `bash ./.codex/scripts/check.sh`

Run: `git diff --check`

Expected: all commands exit 0, all focused lifecycle tests pass, and formatting leaves no additional diff on a second run.

- [ ] **Step 6: Commit checks and documentation**

```bash
git add .codex/scripts/check.sh package.json AGENTS.md README.md docs/local-development.md
git commit -m 'docs: document isolated Codex runtimes'
```

---

### Task 8: Real Three-Worktree Acceptance and Full Verification

**Files:**
- Verify: `.codex/scripts/runtime-*.test.mjs`, `.codex/scripts/environment.test.sh`, and the complete repository through `pnpm verify`.
- No source modification is planned in this task; a traced failure returns to the task that owns the failing file for a red-green fix.
- Record no credentials, runtime registry files, temporary worktrees, or generated overlays in Git.

**Interfaces:**
- Consumes: the complete checked-in lifecycle.
- Produces: evidence for concurrent health, database isolation, automatic orphan cleanup, slot reuse, and repository verification.

- [ ] **Step 1: Run every focused lifecycle test from a clean working tree**

Run: `bash ./.codex/scripts/check.sh`

Expected: `Codex local environment check passed.` with all Node and shell suites green.

- [ ] **Step 2: Create a disposable acceptance clone and three linked worktrees**

Use an explicit temporary root and a cleanup trap. Clone the current committed branch with `--no-hardlinks`, configure a test Git identity, create three detached linked worktrees, and run Setup in the primary so it generates isolated local secrets. Run `pnpm install --frozen-lockfile` in each linked worktree; do not copy real provider credentials.

The temporary paths must all remain below the one `mktemp -d` result. The trap must stop/purge each recorded runtime before removing the temporary directory.

- [ ] **Step 3: Start three runtimes concurrently and prove isolation**

Start each worktree in its own background process with output redirected below the temporary root. Poll `env:config --json` until three distinct runtime IDs and tiers appear, then poll all API, MCP, and web health URLs until ready or a 120-second deadline expires. Record the allocations as runtime A, B, and C; unrelated listeners may cause their tier numbers to skip.

Insert a different marker row into each PostgreSQL database using its labeled container and `psql`. Query every database and assert it contains only its own marker. Inspect Docker labels and assert three different Compose project names, volumes, networks, repository IDs that match the clone, and root hashes that match their allocation records.

- [ ] **Step 4: Prove one runtime can stop and restart without affecting survivors**

Stop runtime A. Assert runtime B and runtime C health remain ready, runtime A source listeners are gone, and runtime A PostgreSQL data still exists. Restart runtime A and assert its URLs, runtime ID, tier, Compose project, and database marker are unchanged.

- [ ] **Step 5: Prove orphan cleanup and slot reuse**

Force-remove runtime A's linked worktree from the disposable clone while its runtime is running. Run GC once and assert the allocation is `orphan-pending`, its tier remains reserved, and its resources still exist.

Poll time in five-second intervals until at least 60 seconds have elapsed, run GC again, and assert the verified process group, container, network, volume, and allocation disappear. Confirm tier 3 and tier 4 remain healthy throughout.

Create a fourth linked worktree and start it. Assert it reuses runtime A's released tier with a new runtime ID and Compose project, and its database does not contain the deleted worktree marker.

- [ ] **Step 6: Exercise the real LaunchAgent lifecycle without leaving host state**

From the disposable clone, enable automatic cleanup and run `reaper-status`. Force-remove the fourth linked worktree while it is running, then poll for up to three reaper intervals without invoking GC manually. Assert the LaunchAgent removes that runtime's process group, container, network, volume, and allocation while leaving runtime B and runtime C healthy. Verify the plist and manifest repository IDs, then disable the reaper. Assert the exact plist and application-support directory are removed and no other ilo LaunchAgent is unloaded or changed.

- [ ] **Step 7: Run complete repository verification**

Back in the implementation worktree, run: `pnpm verify`

Expected: repository checks, lint, type checking, coverage enforcement, builds, and desktop/mobile Playwright acceptance all pass.

- [ ] **Step 8: Review the final diff and commit acceptance fixes if any**

Run: `git status --short`

Run: `git diff --check`

Run: `git log --oneline --decorate -10`

If a traced acceptance failure required a red-green fix in its owning task, rerun the nearest failing test and `pnpm verify`, then stage the runtime feature scope and commit the fix:

```bash
git add .codex/scripts .codex/runtime package.json AGENTS.md README.md docs/local-development.md
git commit -m 'fix: harden worktree runtime acceptance'
```

If no files changed, leave the verified branch clean and do not create an empty commit.
