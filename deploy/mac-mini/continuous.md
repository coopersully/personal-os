# Continuous Mac production

The controller polls the public `coopersully/personal-os` main branch and accepts
only a descendant of the deployed commit with a successful exact-SHA `push` run
of `.github/workflows/ci.yml` on `main`. It needs no GitHub token, paid runner,
inbound port or additional service. Main is checked again after the build and
after backup. A force-pushed ancestor or divergent history is never deployed.

Stable controller code lives outside the user's checkout and the source it
builds. Merges update API/MCP/web images only; controller upgrades remain an
attended installation. The existing dedicated Colima socket, PostgreSQL volume,
encryption/provider env files, tunnel token, gateway configuration and ancillary
image digests are retained. Changes requiring a new production environment value,
gateway or Compose contract need an attended controller/configuration update.

## Installation

Install an inspected, tested controller revision under the production account's
private `/Users/nohmi-production/controller/` directory, preserving the repository
relative `deploy/mac-mini/` tree. Include **all** files in that directory because
the existing command module imports its safety, Compose, task-repair and gateway
dependencies. Do not install candidate code over the running controller.

As `nohmi-production`, create the initially empty source repository:

```sh
umask 077
mkdir -p /Users/nohmi-production/releases
git init --bare /Users/nohmi-production/releases/continuous.git
git -C /Users/nohmi-production/releases/continuous.git fetch --no-tags https://github.com/coopersully/personal-os.git +refs/heads/main:refs/heads/main
```

The deployed commit must be an ancestor of eligible main for normal updates. If
the initially deployed migration branch is not merged, the controller waits; it
never downgrades to an older main. The source directory must be owned by
`nohmi-production`, mode 0700, and canonical (no symlink). Use the existing
`sudo -n -H -u nohmi-production` operator access. Confirm `node`, `docker` (with
Compose), `git`, `tar` and `age` are on the fixed LaunchAgent PATH and that disk
space can hold builds and a local encrypted backup alongside the live services.

The exact controller interfaces are:

```sh
node /Users/nohmi-production/controller/deploy/mac-mini/continuous-cli.mjs status /Users/nohmi-production/nohmi-production/config.json
node /Users/nohmi-production/controller/deploy/mac-mini/continuous-cli.mjs once /Users/nohmi-production/nohmi-production/config.json /Users/nohmi-production/releases/continuous.git
node /Users/nohmi-production/controller/deploy/mac-mini/continuous-cli.mjs run /Users/nohmi-production/nohmi-production/config.json /Users/nohmi-production/releases/continuous.git
```

`once` is a real controller pass and may deploy/restart; `status` is read-only.
For the first transition from the attended migration release, a squash merge may
contain its changes without retaining its commit as an ancestor. After reviewing
the merged main SHA and its successful push CI, an operator can authorize **that
one exact target only**:

```sh
node /Users/nohmi-production/controller/deploy/mac-mini/continuous-cli.mjs adopt /Users/nohmi-production/nohmi-production/config.json /Users/nohmi-production/releases/continuous.git EXPECTED_RUNNING_SHA EXACT_REVIEWED_MAIN_SHA --attended-bootstrap
```

Replace both SHAs with inspected full commits. This refuses a stale running
revision, an older ancestor, absent CI, a target other than current main, or an
already completed controller deployment. It stores a one-use exact-SHA allowance
without changing runtime configuration or claiming the target is already deployed.
A later merge does not inherit the allowance. Success consumes it, and all later
updates require normal ancestry. The source reader can fetch the original public
migration commit by its full SHA to verify ancestry after a squash merge.

## Attended one-release CI exception

The normal exact-main CI gate is unchanged. For COO-208 — One-release deployment,
there is one supported exception pinned in source to
`76de239aa764cc0642c4b0a15375766353213c16`. Only an explicitly authorized production
operator may install the independently reviewed controller source and authorize it:

```sh
node /Users/nohmi-production/controller/deploy/mac-mini/continuous-cli.mjs override-ci /Users/nohmi-production/nohmi-production/config.json /Users/nohmi-production/releases/continuous.git EXPECTED_RUNNING_SHA 76de239aa764cc0642c4b0a15375766353213c16 --attended-ci-override "Cooper-authorized one-release CI exception; COO-208"
```

Replace `EXPECTED_RUNNING_SHA` with the inspected full serving revision. This is
an attended production write, not part of source review or a read-only check. Do
not include secrets or personal data in the bounded reason. Authorization holds
the normal operation lock, requires matching state/config/activation revisions,
idle/non-maintenance operation, exact current main and normal descendant history,
and checks the existing prepared runtime. It refuses an already recorded override
and refuses when exact-main CI already succeeded: use the normal path then.

The private state retains expected/target revisions, reason, authorization time
and CI observation. No run or CI result is invented or changed. The next eligible
tick checks CI normally; success takes precedence. Otherwise only that exact
unused allowance may satisfy eligibility, including bounded CI transport failure.
It is durably consumed **before** runtime checking or building, so failure, crash
or lost response cannot authorize another attempt. `status` exposes its receipt
and the transaction's actual eligibility source. A later target, changed serving
revision, or replay does not inherit it. No automatic retry/reset or new target
allowance is provided; preserve the receipt for attended diagnosis.

All existing build/image checks, maintenance gates, current-main rechecks, writer
drain, encrypted backup, health/start/publication and blocked failure recovery
remain active. There is still no automatic schema/config rollback. Authorization
changes neither serving revision nor runtime configuration. Confirm the actual
deployed revision and public/provider acceptance separately after completion.

**Release ordering:** target `76de239a` must still be current main at authorization
and both switch rechecks. Merging this controller change first advances main and
correctly invalidates the allowance. A separately authorized attended installation
from reviewed source may precede that release; do not weaken the main checks to
compensate. If the original CI succeeds first, stop this exception path and let the
normal controller deploy. Installation, capacity and real transaction behavior
remain production evidence gaps until the assigned operator verifies them.

Install `me.coopersully.nohmi.continuous.plist` in the existing operator's
`/Users/anchor/Library/LaunchAgents/`. Verify UID and executable paths before
bootstrapping, as for the Colima supervisor:

```sh
launchctl bootstrap gui/501 /Users/anchor/Library/LaunchAgents/me.coopersully.nohmi.continuous.plist
launchctl print gui/501/me.coopersully.nohmi.continuous
```

The controller starts after operator login, alongside the existing Colima
supervisor. An unavailable engine yields a bounded retry, without restarting
Colima or affecting Docker Desktop, Halara or other Mac services.

## Transaction, maintenance and recovery

Each operation holds the existing `operation.lock`. Builds run while the old app
is live, using the existing clean-archive builder and explicit dedicated socket.
The controller saves `quiescing` before stopping application writers and ingress,
checks database connections, makes a local age-encrypted backup, then saves the
previous/next configuration and activation receipt before switching files. It
starts and waits for the new app, then republishes the existing tunnel. No
database restore or automatic schema/config rollback occurs.

A changed main or failed Git recheck after backup resumes the untouched old
release while no configuration/schema has changed. A maintenance marker leaves
that old release intentionally stopped. A failure to resume it is blocked.
Other failures after quiescing record `blocked` and make one bounded attempt to stop
application/ingress containers, preventing migration restart loops. It requires
attended diagnosis even if the failure happened before migration began. A process
kill retains the operation lock. SIGTERM also terminates owned builder process
groups; a SIGKILL can leave child/daemon work running, which is why the lock is
never automatically broken. Before removing that exact lock, inspect its PID,
descendants and in-flight Docker operations, and confirm all have ended.

Use the installed `cli.mjs stop CONFIG` for intentional maintenance. It writes
`maintenance.json` **before** acquiring the lock, cancelling a pending build's
switch. If another operation holds the lock, wait for it to finish and retry the
same stop command. A successful manual `start` or `publish` clears maintenance.
Direct `docker stop` or unloading Colima is not a maintenance signal: record
maintenance first. Unload the controller LaunchAgent before replacing its code.

For a blocked/torn switch, preserve `continuous-state.json`, the encrypted backup
and current files privately. Its `previousConfig`, `nextConfig` and
`previousActivation` describe the transaction; they do not authorize restoring an
older database. Inspect the migration ledger and current images, reconcile a
compatible config/Compose/activation set, then use the attended `cli.mjs check`
and `publish` commands and verify public health. Only after successful attended
recovery, with the controller unloaded and no active operation/children, archive
the failed `continuous-state.json` outside its active path. The next controller
start seeds its deployed revision from the repaired active configuration. Never
clear a lock/state receipt merely to repeat a failed migration.

## Docker disk headroom

On 2026-11-14 the dedicated VM's 24 GiB Docker disk filled with about 208 old
release images (roughly 820 MB per revision) and build cache. PostgreSQL failed
with ENOSPC while a deploy was quiescing, blocking it for attended recovery. The
controller now bounds that growth itself, under the same operation lock:

- **Headroom preflight.** Before building it requires 6 GiB free on the VM's
  `/var/lib/docker` (4 GiB plus a 2 GiB build allowance, because the build grows
  the disk the live PostgreSQL uses). After building, and before quiescing, it
  requires 4 GiB. The probe runs `df` from the pinned local PostgreSQL image
  through the dedicated socket with `--pull never`, no network, a read-only root
  and a read-only mount. When space is short, or the probe itself fails (a full
  disk can prevent creating the probe container), it reclaims (below) and
  measures again. A partial reclaim failure is recorded but still re-measured.
  Still short: the attempt ends `idle` with `error: insufficient-docker-disk`
  and the normal fifteen-minute backoff. Still unmeasurable: `prepare-failed`.
  Either way no writer is stopped and the live release keeps serving. `status`
  shows the last measurement as `dockerFree`.
- **Rollback release.** On each completed switch the controller records the
  replaced release's revision and API/MCP/web image IDs as `rollback` (shown by
  `status`). Only completion sets it, so a resumed or failed attempt never
  displaces it. A first controller install has none until its first switch.
- **Retention.** After a successful switch (skipped while maintenance is
  requested) it keeps the new revision and the rollback release; a preflight
  reclaim keeps the serving revision, the candidate and the rollback release.
  Every other `ilo-local/{api,mcp,web}:<40-hex SHA>` tag is removed in batches
  of 50. Images referenced by any container (running or stopped), the active
  configuration's image IDs and the rollback image IDs are excluded, under any
  tag. A container whose image identity is not an exact ID fails the reclaim
  before anything is removed. Removal is by tag without `--force`: removing an
  image's last tag deletes it (Docker still refuses one a container uses);
  otherwise it is only untagged. It then runs `docker builder prune --force
  --keep-storage 3GB`. Volumes, containers, digest-pinned ancillary images and
  other repositories are never touched. Dangling untagged images are not pruned.
- A reclaim failure records `retentionError: image-retention-failed` in `status`
  and never blocks or rolls back a release; the next reclaim retries and clears it.
- Pruning build cache means the next build re-downloads and re-verifies pinned
  remote files such as the AWS RDS CA bundle. A rotated upstream file then fails
  that build (`prepare-failed`, live release unaffected) until its checksum pin
  is updated.

If the preflight keeps failing, inspect `docker system df` through the dedicated
socket. Space held by the kept revisions, PostgreSQL data or non-release images
needs an attended decision; do not delete volumes to make room.

**Attended installation verification.** Tests cannot prove the live daemon's
behavior. When installing this controller, before loading the LaunchAgent and
again after its first completed switch, record on the tracking issue: `docker
version`; `docker info --format '{{.Driver}} {{.DriverStatus}}'` (overlay2 or
the containerd image store, which keeps image content under `/var/lib/containerd`
and may sit on a different filesystem than the probe measures); `docker buildx
ls` and `docker builder du` (the builder pruned through the dedicated socket);
`docker system df`; and `colima ssh -- df -h /var/lib/docker /var/lib/containerd`
compared with the controller's `dockerFree`. Also confirm `docker builder prune
--keep-storage` is still accepted (newer releases deprecate it for
`--reserved-space`). With a large existing backlog, the first reclaim may hold
the operation lock for several minutes; an attended prune of old `ilo-local`
tags at installation avoids that.

## Bounds and evidence

- Health observations run at most once per minute. Only label-matching, running
  unhealthy API/MCP containers qualify after three observations. Restarts have a
  ten-minute cooldown and a maximum of three per container per rolling hour;
  lost responses still consume that budget. Exited processes retain their Docker
  restart policies. Healthy dependencies and an available daemon are not proof of
  connector functionality.
- Public Git and GitHub require outbound HTTPS/443. Main/CI polling is every five
  minutes (normally at most 12 anonymous API requests/hour), with a fifteen-minute
  backoff on preparation/network failures. Git commands have a two-minute timeout;
  CI has a 30-second deadline, a 1 MiB body cap and no redirects. Network failure
  leaves the live release running. Health checks continue during network backoff.
- Each of three Docker builds has a one-hour timeout; the enclosing process group
  has a four-hour deadline and is killed on completion/failure. Runtime stop,
  backup and startup use the existing bounded command implementations. A backup
  can take up to the existing dump/encryption deadlines while writers are stopped.
- `continuous-state.json` records phase, candidate, deployed revision, freshness,
  bounded restart history, one latest transaction and redacted failure codes.
  `continuous-errors.log` retains at most 100 sanitized outer errors. Both are
  owner-only. This is local observability; there is no offsite alert or backup.
  Encrypted backups accumulate until attended cleanup; no production recovery
  material is pruned or deleted automatically. Release images (about 820 MB per
  revision) and Docker build cache are bounded as described in **Docker disk
  headroom**.

Run `pnpm test:mac-production` and `pnpm verify` before publishing. Behavior tests
exercise release eligibility, real state-file switches, maintenance, restart
budgets and process-group cleanup. Installation, real public CI availability,
dedicated-engine build capacity, provider/network function, a successful merged
main deployment, and physical reboot recovery need separate live evidence. Green
tests cannot prove these production boundaries or offsite recovery.
