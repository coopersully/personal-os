# Worktree Runtime Leases Design

**Status:** Red-team reviewed; ready for implementation
**Date:** 2026-08-27
**Owner:** Cooper
**Repository:** `coopersully/personal-os`

## Summary

Allow the primary checkout and multiple Codex-managed ilo worktrees to run and
be tested concurrently without sharing ports, host processes, Docker Compose
projects, networks, or PostgreSQL data. Extend the existing runtime-tier work
into a repository-owned runtime registry stored in Git's shared common
directory.

The checked-in Codex Start action remains the normal entry point. On first
Start, the current checkout atomically acquires a stable runtime slot and a
unique runtime identity, then launches its isolated local stack. Every
lifecycle action reconciles stale records. An optional, explicitly installed
per-user macOS reaper performs the same reconciliation after Codex deletes a
managed worktree, when no process remains able to run code from that worktree.

The design deliberately does not call these OS-level port reservations. The
registry prevents two ilo runtimes from choosing the same slot; a listener
probe and strict bind/readiness checks handle unrelated applications that race
for a port.

## Goals

- Run the primary checkout and at least eight linked worktrees concurrently.
- Preserve one stable URL and port set for the lifetime of a worktree.
- Allocate safely when multiple Codex worktrees start at the same time.
- Keep PostgreSQL, Docker resources, processes, logs, and runtime ownership
  isolated by checkout.
- Automatically stop and unregister resources after a managed worktree is
  deleted when automatic cleanup has been enabled once for the repository.
- Recover safely from stale registry state, interrupted starts, PID reuse,
  Docker restarts, and ports occupied by unrelated processes.
- Keep `pnpm env:start`, the checked-in Codex actions, and existing health
  checks as the public developer workflow.

## Non-goals

- Kubernetes or a general-purpose local orchestration platform.
- Moving the API, MCP, and Vite development servers into containers in v1.
- Treating a chat ending, becoming idle, or losing its UI subscriber as proof
  that its worktree should be deleted.
- Making production-runtime access automatic or less explicit.
- Sharing one PostgreSQL database between worktrees.
- Preserving a deleted managed worktree's PostgreSQL volume without a defined
  restoration workflow.
- Providing friendly local hostnames, a reverse proxy, or an OAuth callback
  broker in v1.

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

Live inspection during design found stale tier records and a stale
`active-root`, which confirms that cleanup cannot depend on another future
worktree action alone.

## Red-team conclusions

The initial design was directionally sound but had five gaps:

1. A successful port probe cannot reserve a port against an unrelated process.
   The registry provides ilo-to-ilo serialization; process bind and readiness
   remain the final authority.
2. A seven-day retained database had no adoption or restore command. Retention
   without recovery only accumulates sensitive local state, so confirmed
   managed-worktree deletion now removes the owned volume.
3. Automatically installing a user LaunchAgent from every worktree Setup was
   an intrusive, racing host mutation. Installation is now an explicit,
   one-time repository action; Setup only reports or refreshes an already
   authorized installation.
4. Cleanup after deletion cannot depend on a Compose file inside the deleted
   directory. Docker resources now carry explicit runtime and repository labels
   and are removable from an installed, self-contained reaper.
5. OAuth providers require exact callback URIs. Arbitrary ephemeral API ports
   would make connector behavior misleading, so v1 uses a finite documented
   slot table and exposes which callback URLs must be registered.

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
- `gc [--dry-run]`: reconcile every allocation against Git, processes,
  listeners, and Docker;
- `list [--json]`: print all registered runtimes and their state;
- `doctor`: report registry drift, occupied slots, stale reaper versions,
  callback-registration requirements, and safe recovery commands; and
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
  audit.ndjson
```

An allocation record contains a schema version, immutable runtime ID,
repository identity, canonical root, Git administrative directory, explicit
slot and ports, Compose project, state, timestamps, and verified process
identities. Records are schema-validated and written with write-temp,
file-sync, rename, and parent-directory sync where the platform supports it.
Malformed records are quarantined; they are never silently replaced.

The registry creates one random repository identity per clone and hashes
canonical roots with SHA-256 for the reverse index. The redacted audit log is
size-bounded and rotates locally so an unattended reaper cannot grow Git
metadata without limit.

Registry mutations use an atomic directory lock with bounded retry and stale
owner recovery. macOS does not provide `flock` by default, so the repository
does not acquire a new system dependency. The lock record includes PID,
process-start identity, and creation time; a live owner cannot be stolen.

### 3. Explicit runtime slots from a bounded pool

The primary checkout keeps the registered tier-one ports from `origin/main`:

| Service | Tier 1 | Formula for tier `n` |
| --- | ---: | ---: |
| Web | 8081 | `8081 + 5 * (n - 1)` |
| API | 8788 | `8788 + 5 * (n - 1)` |
| MCP | 8789 | `8789 + 5 * (n - 1)` |
| PostgreSQL | 55433 | `55433 + 5 * (n - 1)` |

V1 supports tiers 1 through 16. Tier 1 is permanently assigned to the primary
checkout; linked worktrees atomically acquire the lowest free tier from 2
through 16. This provides fifteen linked-worktree slots while keeping every
URL deterministic and the pool reviewable.

The allocator confirms that no registry allocation owns the entire slot and
probes all four ports before committing it. A slot occupied by an unrelated
listener is skipped and reported, never killed. A process can still claim a
port after this probe; Start therefore treats successful binds and readiness as
the final check and retains the allocation for a stable retry on conflict.

Port assignments do not depend on `git worktree list` order, path ordinals, or
hashes. Stop preserves a worktree's slot so Restart keeps stable URLs. Only an
explicit purge or garbage collection makes the tier reusable.

### 4. OAuth callback compatibility is explicit

Google and X callbacks are exact external configuration boundaries. Each tier
uses its own API callback URL, for example tier 2 uses:

```text
http://127.0.0.1:8793/v1/connectors/google/callback
http://127.0.0.1:8793/v1/x-bookmarks/callback
```

The repository documents the generated callback URLs for tiers 1 through 16.
`doctor` reports the current tier's required values, but it does not claim that
a provider dashboard is configured merely because client credentials exist.
The developer registers the subset of tiers that need live connector testing;
other application behavior remains fully isolated. A stable callback broker is
a possible later improvement if maintaining several provider redirect URIs
becomes burdensome.

The external-boundary record for this change is:

| Concern | Contract |
| --- | --- |
| Capability and owner | The API owns Google/X authorization start and callback handling; the runtime manager only supplies its local origin. |
| Configuration and authority | `GOOGLE_REDIRECT_URI` and `X_REDIRECT_URI` must exactly match both the acquired tier and the provider dashboard. Credentials alone do not prove this. |
| Transport | The browser/provider returns over loopback HTTP to the tier's API port; no non-loopback listener is opened. |
| Degraded behavior | A missing provider registration fails the connector authorization flow but does not make the local runtime unhealthy. Start and Doctor print the evidence gap. |
| Recovery and evidence | Register the printed URI, start a fresh authorization attempt, and exercise the real provider redirect. Mock tests or a present secret are insufficient evidence. |

### 5. Runtime identity is separate from reusable ports

Each allocation receives an immutable random runtime ID. Its Compose project is
`ilo-wt-<runtime-id>`, not `personal-os-tier-N`. Containers, networks, and
volumes therefore remain attached to one allocation even after its former
ports are leased to another worktree.

Development PostgreSQL moves to a minimal tracked Compose file under
`.codex/runtime/compose.yaml`; the repository's full Compose stack remains a
separate production-like workflow. The dev container, network, and volume carry
labels for the runtime ID, repository identity, and root hash in addition to
Compose's project labels. Cleanup requires all expected labels to agree and
fails closed when they do not.

The lifecycle always supplies the project explicitly with `docker compose -p`;
directory-derived Compose project names are never part of ownership.

Every published container port and every host service binds to `127.0.0.1`.

### 6. Process ownership survives worktree deletion

PID files under `.codex/run/` remain useful for local logs and compatibility,
but one runtime-specific supervisor owns a process group and writes shared
ownership before services are considered started. A checked-in wrapper places
the runtime ID and root hash in its argument vector. The registry records the
supervisor and service PID, process group, normalized process-start identity,
expected command marker, and canonical working directory.

The normal stop path signals the verified supervisor and lets it terminate its
children. Garbage collection signals the verified process group. If the
supervisor is already gone, a child is stopped only when its PID, start
identity, command marker, and other available identity evidence all match. A
recycled PID or an unowned process listening on a leased port is never
terminated automatically.

### 7. Reconciliation proves deletion conservatively

The manager parses `git worktree list --porcelain -z`, including `locked` and
`prunable` attributes, as the authoritative Git view. Automatic destructive
cleanup becomes eligible only when:

- the canonical worktree directory is absent; and
- the worktree is either absent from Git's list or is explicitly `prunable`;
  and
- the Git record is not `locked`; and
- the same condition has been observed by at least two reconciliations and for
  at least 60 seconds.

The first observation moves the allocation to `orphan-pending` and retains its
slot. A reappearing worktree clears that state. A present directory that is no
longer registered, or a missing locked worktree, becomes `drifted` and requires
`doctor`/manual recovery rather than destructive guessing.

Every Setup, Start, Stop, Status, allocation, and explicit list operation runs
a bounded reconciliation first. Codex `SessionEnd` is not used in v1: it also
runs on normal close and idle timeout, currently exposes no deletion-specific
reason, and has too short a synchronous budget to be the cleanup authority.

### 8. Automatic cleanup is an explicit host integration

The checked-in Codex environment adds **Enable Automatic Cleanup** and
**Disable Automatic Cleanup** actions. Enable installs one user LaunchAgent for
this repository and a self-contained, versioned reaper below the user's
application-support directory. The reaper is copied out of the worktree, pins
the Git common directory and repository identity, and can therefore operate
after every checkout path in an allocation has disappeared.

The LaunchAgent watches Git's shared worktree-administration directory and uses
a 60-second `StartInterval` backstop. It never watches the runtime registry
itself, avoiding a write-trigger loop. Repeated enable is idempotent. Disable
unloads the exact matching agent and removes only its known installed files.

Setup never creates a new LaunchAgent without that explicit action. If the
agent is already installed for the repository, Setup may safely refresh the
installed reaper after verifying repository identity, schema compatibility,
and a non-decreasing reaper protocol version; a feature worktree cannot
silently downgrade it. Otherwise Setup prints one concise opt-in message.
Unsupported platforms retain reconciliation on ordinary lifecycle actions and
report that deletion cleanup is not automatic.

### 9. Two-phase cleanup deletes confirmed owned infrastructure

After the orphan grace, garbage collection transitions an allocation to
`releasing` under the registry lock. No allocator may reuse a releasing slot.
Slow cleanup then occurs outside the lock with an operation token so a retry
cannot release a newer allocation. The record also identifies the cleanup
owner process and start time; another reconciler takes over only after proving
that owner is gone. Cleanup:

1. re-verifies the orphan predicate and operation token;
2. verifies and stops the recorded supervisor/process group;
3. removes only containers and networks with the matching runtime, repository,
   root, and Compose labels;
4. removes the matching PostgreSQL volume;
5. verifies that no owned listener remains on the four ports;
6. removes reachable checkout-local runtime metadata; and
7. atomically removes the allocation and releases the slot.

This matches Codex-managed worktrees' disposable lifecycle. `stop` preserves
the allocation and PostgreSQL volume while the worktree exists. `purge`
performs the same owned data deletion for the current stopped worktree after an
explicit acknowledgement.

If cleanup cannot prove ownership or cannot stop a resource, the allocation
enters `cleanup-failed`, keeps its slot reserved, appends a redacted audit
event, and reports exact recovery guidance. It never silently releases a slot
that may still have live resources.

### 10. Codex and personal launchers

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
3. Run bounded registry reconciliation.
4. Refresh an already-authorized compatible reaper, or report how to enable it.
5. Validate lifecycle scripts and registry schema.

Setup does not allocate ports, start infrastructure, or silently install a
user service.

### Start

1. Run reconciliation.
2. Acquire or reuse this worktree's slot.
3. Generate `.env.codex.local` from the explicit allocation.
4. Confirm listener and Docker ownership.
5. Start the allocation-specific PostgreSQL project.
6. Start the owned supervisor, API, MCP, and web source processes and persist
   shared ownership.
7. Wait for health endpoints and print URLs plus callback requirements.
8. Remain attached as the supervisor.

If any readiness step fails, Start stops resources created by that attempt but
retains the allocation for stable retry.

### Stop and purge

Stop verifies and stops only this allocation's processes and containers. It
preserves both the slot and PostgreSQL volume. Restart therefore keeps the same
URLs and database.

Purge is explicit, requires the runtime to be stopped, deletes its verified
PostgreSQL volume and allocation, and returns its slot to the pool. It never
targets an allocation by tier alone.

### Status, list, doctor, and GC

Status reports allocation state, canonical root, runtime ID, URLs, Compose
project, PID ownership, service health, callback requirements, and whether
cleanup is pending or failed. List shows every live and stale allocation.
Doctor explains inconsistencies without mutating them. `gc --dry-run` prints
the exact candidate predicate and owned resources without stopping or deleting
anything. Machine-readable output is available for tests and personal tooling.

## Failure handling

- Concurrent allocation is serialized; a lock timeout reports the owner and
  does not guess.
- A port taken between probe and bind causes Start to stop its partial runtime,
  keep the slot, and report the conflicting PID without killing it.
- A transiently missing worktree receives a grace period and remains reserved.
- A missing locked worktree or present unregistered directory fails closed as
  drift.
- PID reuse fails ownership verification and preserves the allocation for
  manual recovery.
- Missing or conflicting Docker labels fail closed.
- Docker being unavailable defers Docker cleanup and keeps the slot reserved.
- An interrupted `releasing` or `cleanup-failed` record is retried using its
  operation token on the next reconciliation.
- Registry corruption is quarantined and reported; it is never overwritten by
  a new allocation.
- An old reaper refuses a newer registry schema and directs the user to refresh
  it.
- Exhausted slots report every owner/conflict and the safe `list`, `doctor`,
  and `purge` options.

## Security and data boundaries

- The primary ignored `.env` remains the authoritative secret source.
- Generated worktree overlays contain local URLs and ports but introduce no new
  secret authority.
- Registry and audit files are local Git metadata and are never committed.
- Cleanup validates canonical paths and repository identity and refuses broad
  or unresolved recursive targets.
- Docker cleanup requires the full expected label set and a per-release
  operation token; project-name similarity is insufficient.
- All development listeners are loopback-only.
- Automatic volume deletion occurs only for a confirmed orphan after the grace
  period or an explicitly acknowledged purge.
- Production-runtime commands remain separately acknowledged and are not
  discoverable as ordinary development allocations.

## Modern alternatives considered

Docker Compose already recommends unique project names for running multiple
feature-branch environments, and v1 adopts that isolation boundary. Docker can
also assign ephemeral host ports, but deterministic slots are preferable here
because Codex actions must print stable URLs and OAuth callbacks require exact
redirect URIs.

Moving the whole dev stack into Compose with Compose Watch would reduce host
PID ownership and is now a credible modern option. It is deferred because it
would change the inner loop, image build strategy, debugger behavior, and file
watching for every ilo app. The hybrid model—containerized stateful dependency,
host-native source servers—keeps the current fast development path while the
runtime manager addresses its real lifecycle gaps.

Dev Container lifecycle hooks were also considered, but environment stop and
deletion timing remains implementation-specific and Codex already provides the
repository's worktree Setup/Action surface. A repo-scoped reconciler therefore
remains the narrowest portable ownership layer.

## Testing

Deterministic tests use temporary Git repositories, linked worktrees, fake
process identities, fake listener inspection, and a fake Docker command. They
cover:

- simultaneous allocation and lock contention;
- stable reuse by one worktree and exact tier bounds;
- non-overlapping runtime slots and pool exhaustion;
- unrelated occupied ports and the probe-to-bind race;
- deleted, prunable, locked, permanent, transiently missing, and restored
  worktrees;
- the two-observation orphan grace and orphan cancellation;
- PID reuse, process-group cleanup, and missing ownership evidence;
- Docker label mismatch, Docker unavailability, and volume deletion;
- interrupted release and operation-token retry;
- unique Compose and volume identities after slot reuse;
- reaper install/update/uninstall idempotence and schema refusal;
- dry-run/doctor non-mutation; and
- stale reaper invocations against live worktrees.

An integration acceptance test starts at least three real worktrees
concurrently, proves independent health endpoints and PostgreSQL data, removes
one worktree, runs two reconciliations across the grace interval, and proves
the survivor is unaffected and the released slot can be reacquired without
inheriting the deleted allocation's database.

Repository handoff requires the focused lifecycle tests plus `pnpm verify`.

## Rollout

1. Selectively port the runtime-tier lifecycle and test files from
   `origin/main` into this branch; do not rebase or merge unrelated mainline
   work into the feature.
2. Add the structured lease manager and deterministic tests behind the existing
   `environment.sh` commands.
3. Split development PostgreSQL into the minimal labeled Compose file and move
   host process ownership to the shared runtime supervisor.
4. Add conservative reconciliation, dry-run, doctor, purge, and status/list
   visibility.
5. Add explicit macOS reaper enable/disable actions and installed-version
   checks.
6. Update `environment.toml`, package scripts, `AGENTS.md`, README, callback
   documentation, and `cooper-run` integration.
7. Run focused fault-injection tests, three-worktree acceptance, and the full
   repository verification.

## Acceptance criteria

- Clicking Start in three different Codex worktrees starts three healthy,
  isolated ilo runtimes with stable, non-overlapping URLs.
- Starting two previously unallocated worktrees concurrently cannot assign the
  same slot or Compose identity.
- Stopping one runtime does not affect another and restarting preserves its
  URLs and PostgreSQL data.
- After automatic cleanup is enabled once, archiving a managed worktree causes
  its verified processes, containers, network, PostgreSQL volume, and registry
  allocation to disappear within the grace period plus two reaper intervals.
- A normal SessionEnd, idle chat, transient path loss, locked worktree, or
  permanent worktree does not trigger destructive cleanup.
- Reusing a released slot never mounts the former worktree's database.
- Unowned processes and mismatched Docker resources are never terminated.
- `gc --dry-run`, `list`, and `doctor` make pending and failed cleanup
  understandable without inspecting internal files.
- The current tier's external callback requirements are printed honestly; a
  present client secret is never reported as proof that provider redirects are
  registered.

## Research basis

- Codex local-environment Setup runs when a managed worktree is created and
  actions run in the integrated terminal:
  <https://learn.chatgpt.com/docs/environments/local-environment>
- Codex-managed worktrees are disposable, can be removed on archive or
  retention cleanup, and can later be restored from a snapshot:
  <https://learn.chatgpt.com/docs/environments/git-worktrees>
- `SessionEnd` also runs for normal close and idle sessions, currently reports
  only `other`, and has a maximum three-second synchronous timeout:
  <https://learn.chatgpt.com/docs/hooks>
- Git's `--porcelain -z` worktree format is stable for machine parsing and
  exposes `locked` and `prunable` state:
  <https://git-scm.com/docs/git-worktree>
- Compose project names are the supported isolation mechanism for multiple
  feature-branch environments:
  <https://docs.docker.com/compose/how-tos/project-name/>
- Docker supports ephemeral published ports, but published ports bind every
  interface unless an explicit loopback host address is used:
  <https://docs.docker.com/get-started/docker-concepts/running-containers/publishing-ports/>
- Compose Watch supports sync, rebuild, and restart workflows for containerized
  local development:
  <https://docs.docker.com/compose/how-tos/file-watch/>
- A per-user LaunchAgent can run periodically or monitor a directory:
  <https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html>
