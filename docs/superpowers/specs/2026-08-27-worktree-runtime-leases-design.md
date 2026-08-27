# Worktree Runtime Leases Design

**Status:** Approved for implementation
**Date:** 2026-08-27
**Owner:** Cooper
**Repository:** `coopersully/personal-os`

## Summary

Allow the primary checkout and multiple Codex-managed ilo worktrees to run and
be tested concurrently without sharing ports, host processes, Docker Compose
projects, networks, or PostgreSQL data. Extend the existing runtime-tier work
into a repository-owned lease manager stored in Git's shared common directory.

The checked-in Codex Start action remains the entry point. On first Start, the
current checkout atomically acquires a stable four-port lease and a unique
runtime identity, then launches its isolated local stack. Setup, Start, Status,
and a lightweight background reconciler garbage-collect allocations whose Git
worktrees no longer exist. Archiving or deleting a Codex-managed chat therefore
causes its runtime to stop and its ports to become reusable even though Codex
does not expose a precise repository callback for worktree deletion.

## Goals

- Run the primary checkout and at least eight linked worktrees concurrently.
- Preserve one stable URL and port set for the lifetime of a worktree.
- Allocate safely when multiple Codex worktrees start at the same time.
- Keep PostgreSQL, Docker resources, processes, logs, and runtime ownership
  isolated by checkout.
- Automatically stop and unregister resources after a managed worktree is
  deleted.
- Recover safely from stale registry state, interrupted starts, PID reuse,
  Docker restarts, and ports occupied by unrelated processes.
- Keep `pnpm env:start`, the checked-in Codex actions, and existing health
  checks as the public developer workflow.

## Non-goals

- Kubernetes or a general-purpose local orchestration platform.
- Moving the API, MCP, and Vite development servers into containers.
- Treating a chat ending, becoming idle, or losing its UI subscriber as proof
  that its worktree should be deleted.
- Making production-runtime access automatic or less explicit.
- Sharing one PostgreSQL database between worktrees.
- Providing friendly local hostnames or a reverse proxy in the first version.

## Current system

The repository lifecycle script starts PostgreSQL through Docker Compose and
runs the API, MCP server, and Vite web server as host processes. It records PID
and log files below the checkout's ignored `.codex/run/` directory, waits for
health endpoints, and keeps the Start action attached to a supervisor.

The newer runtime-tier implementation on `origin/main` stores tier-to-root
assignments below the Git common directory, shifts the web, API, MCP, and
PostgreSQL ports as a unit, synchronizes the primary checkout's `.env`, and
sets a worktree-specific Compose project. It prevents several direct ownership
mistakes, but it does not serialize allocation, store process ownership outside
the disposable worktree, or garbage-collect deleted worktrees. Its single
`active-root` pointer is useful for a personal launcher but is not a concurrency
primitive.

## Decisions

### 1. One repository-owned runtime manager

The public commands remain subcommands of `.codex/scripts/environment.sh`.
Allocation and reconciliation logic moves into a focused Node.js helper under
`.codex/scripts/` so structured records, atomic validation, process execution,
and deterministic tests do not continue expanding the shell controller.

The helper owns these operations:

- `acquire`: return or create the current worktree's allocation;
- `record-process`: persist process ownership outside the worktree;
- `release`: clean one allocation after its resources are stopped;
- `gc`: reconcile every allocation against Git, processes, listeners, and
  Docker;
- `list`: print all registered runtimes and their state; and
- `config`: print one checkout's assigned URLs and Compose identity.

The shell lifecycle continues to own toolchain checks, environment loading,
service commands, health waits, attached supervision, and user-facing logs.

### 2. Git common directory as the durable registry

All worktrees share the repository's Git common directory, while Codex-managed
worktree directories are disposable. Runtime state therefore lives under:

```text
<git-common-dir>/ilo-runtime/
  lock/
  allocations/<runtime-id>.json
  roots/<root-hash>
  retained-volumes/
```

An allocation record contains a schema version, immutable runtime ID,
canonical root, Git administrative directory, explicit ports, Compose project,
state, timestamps, and verified process identities. Records are written to a
temporary file, fsynced where practical, and atomically renamed.

Registry mutations use an atomic directory lock with bounded retry and stale
owner recovery. macOS does not provide `flock` by default, so the repository
does not acquire a new system dependency. The lock record includes PID,
process-start identity, and creation time; a live owner cannot be stolen.

### 3. Explicit port leases from a bounded pool

The primary checkout keeps the established tier-one ports. Linked worktrees
receive a whole four-port block from a documented bounded pool. The allocator
chooses the lowest free block, confirms no registry allocation owns it, and
probes every port before committing the lease. A block in use by an unrelated
listener is skipped rather than killed.

Port assignments do not depend on `git worktree list` order, path ordinals, or
hashes. Stop preserves a worktree's lease so Restart keeps stable URLs. Only
release or garbage collection makes the block reusable.

### 4. Runtime identity is separate from reusable ports

Each allocation receives an immutable random runtime ID. Its Compose project is
`ilo-wt-<runtime-id>`, not `personal-os-tier-N`. Containers, networks, and
volumes therefore remain attached to one allocation even after its former
ports are leased to another worktree.

Compose ownership validation requires both the expected project label and the
recorded checkout/config identity. Cleanup fails closed when labels are
missing or inconsistent.

### 5. Process ownership survives worktree deletion

PID files under `.codex/run/` remain useful for local logs and compatibility,
but the registry also stores the supervisor and service PID, process-start
identity, canonical working directory, and runtime ID. A process is stopped
only when all available identity evidence matches. A recycled PID or an
unowned process listening on a leased port is never terminated automatically.

The shared record is updated as each process starts and is cleared after a
verified stop. Garbage collection can therefore stop an orphaned runtime after
Codex has removed the worktree directory.

### 6. Reconciliation, not SessionEnd, proves deletion

A runtime is stale only when its canonical root is absent or is no longer a
registered Git worktree. The manager parses `git worktree list --porcelain -z`
as the authoritative membership list.

Every Setup, Start, Status, and allocation operation runs a bounded `gc` first.
A project `SessionEnd` hook may request reconciliation, but it never directly
releases its current checkout because SessionEnd also occurs on normal close
and after idle sessions. The hook must finish quickly and is only an
optimization.

For cleanup independent of future Codex actions, setup installs or refreshes a
user LaunchAgent on macOS. It invokes the repository manager every 60 seconds
and at login. The installed launcher contains only stable discovery logic; the
checked-in manager remains authoritative. Platform-specific setup leaves a
clear message on unsupported systems rather than pretending cleanup is
automatic.

Permanent worktrees remain allocated when their chat is archived because the
directory and Git worktree membership remain present. Codex-managed worktrees
become eligible once Codex deletes them.

### 7. Two-phase cleanup and volume retention

Garbage collection transitions a stale allocation to `releasing` before slow
cleanup begins. No allocator may reuse a releasing block. Cleanup then:

1. verifies and stops the recorded supervisor and children;
2. removes owned Compose containers and networks;
3. verifies that no owned listener remains on the four ports;
4. removes local runtime metadata that remains reachable;
5. releases the port lease; and
6. records any retained PostgreSQL volume for later pruning.

Named PostgreSQL volumes are retained for seven days by default, then removed
by garbage collection. `environment.sh purge` deletes the current stopped
runtime's retained data immediately after an explicit confirmation or explicit
non-interactive acknowledgement. Retained volumes keep their runtime-specific
Compose identity and can never attach to a new allocation merely because its
ports were reused.

If cleanup cannot prove ownership or cannot stop a resource, the allocation
enters `cleanup-failed`, keeps its port block reserved, and reports exact
recovery guidance. It never silently releases possibly live ports.

### 8. Codex and personal launchers

The checked-in Start action executes in the current project's or worktree's
integrated terminal and therefore starts that checkout directly. Concurrent
worktree actions do not route through one global active pointer.

The personal `cooper-run` dispatcher may retain an active selection for the
saved primary-checkout project, but that selection is only a convenience alias.
It resolves one allocation without stopping or invalidating other live
runtimes. Registry correctness never depends on `active-root`.

## Command behavior

### Setup

1. Check the toolchain and synchronize the primary `.env`.
2. Install locked dependencies.
3. Run registry garbage collection.
4. Install or refresh the macOS reconciler.
5. Validate lifecycle scripts and registry schema.

Setup does not allocate ports or start infrastructure.

### Start

1. Run garbage collection.
2. Acquire or reuse this worktree's lease.
3. Generate `.env.codex.local` from the explicit allocation.
4. Confirm Docker and Compose ownership.
5. Start the allocation-specific PostgreSQL project.
6. Start API, MCP, and web source processes and record shared ownership.
7. Wait for health endpoints and print URLs.
8. Remain attached as the supervisor.

If any readiness step fails, Start stops resources created by that attempt but
retains the allocation for stable retry.

### Stop

Stop verifies and stops only this allocation's processes and containers. It
preserves both the lease and PostgreSQL volume. `restart` therefore keeps the
same URLs and database.

### Status and list

Status reports allocation state, canonical root, runtime ID, URLs, Compose
project, PID ownership, service health, and whether cleanup is pending or
failed. A registry-wide list command shows every live and stale allocation so
ghost infrastructure is visible without inspecting internal files.

## Failure handling

- Concurrent allocation is serialized; a lock timeout reports the owner and
  does not guess.
- A port taken between allocation and bind causes Start to stop its partial
  runtime, keep the lease, and report the conflicting PID without killing it.
- A missing worktree with live verified processes is cleaned from shared state.
- PID reuse fails ownership verification and preserves the allocation for
  manual recovery.
- Missing or conflicting Docker labels fail closed.
- Docker being unavailable defers Docker cleanup and keeps ports reserved.
- An interrupted `releasing` or `cleanup-failed` record is retried on the next
  reconciliation.
- Registry corruption is quarantined and reported; it is never overwritten by
  a new allocation.
- A stale LaunchAgent or hook cannot release a registered worktree.

## Security and data boundaries

- The primary ignored `.env` remains the authoritative secret source.
- Generated worktree overlays contain local URLs and ports but introduce no new
  secret authority.
- Registry files are local Git metadata and are never committed.
- Cleanup validates canonical paths and refuses broad or unresolved recursive
  targets.
- No cleanup command uses `--volumes` except the explicit retention-prune or
  purge path.
- Production-runtime commands remain separately acknowledged and are not
  targeted by ordinary development garbage collection.

## Testing

Deterministic tests use temporary Git repositories, linked worktrees, fake
process identities, fake listener inspection, and a fake Docker command. They
cover:

- simultaneous allocation and lock contention;
- stable reuse by one worktree;
- non-overlapping four-port blocks;
- unrelated occupied ports;
- deleted, prunable, permanent, and restored worktrees;
- PID reuse and missing ownership evidence;
- Docker label mismatch and Docker unavailability;
- interrupted release and retry;
- unique Compose and volume identities after port reuse;
- retained-volume expiry and explicit purge boundaries; and
- stale hook and reconciler invocations against live worktrees.

An integration acceptance test starts at least two real worktrees concurrently,
proves independent health endpoints and PostgreSQL data, removes one worktree,
runs reconciliation, and proves the survivor is unaffected and the released
ports can be reacquired without inheriting the deleted allocation's database.

Repository handoff requires the focused lifecycle tests plus `pnpm verify`.

## Rollout

1. Rebase or transplant the current `origin/main` runtime-tier implementation
   into this worktree's baseline without overwriting unrelated branch work.
2. Add the structured lease manager and deterministic tests behind the existing
   `environment.sh` commands.
3. Move Compose and process ownership to runtime IDs and shared records.
4. Add garbage collection, retention, and status/list visibility.
5. Add the Codex SessionEnd reconciliation hint and macOS LaunchAgent.
6. Update `environment.toml`, `AGENTS.md`, README, and `cooper-run` integration.
7. Run focused fault-injection tests and the full repository verification.

## Acceptance criteria

- Clicking Start in three different Codex worktrees starts three healthy,
  isolated ilo runtimes with stable, non-overlapping URLs.
- Starting two previously unallocated worktrees concurrently cannot assign the
  same port or Compose identity.
- Stopping one runtime does not affect another and restarting preserves its
  URLs and PostgreSQL data.
- Archiving a managed worktree causes its verified runtime and Docker resources
  to disappear and its ports to become reusable within two reconciliation
  intervals.
- A normal SessionEnd or idle chat does not stop a still-registered worktree.
- Reusing released ports never mounts the former worktree's retained database.
- Unowned processes and mismatched Docker projects are never terminated.
- Registry, process, Docker, and retention failures are visible and recoverable.
