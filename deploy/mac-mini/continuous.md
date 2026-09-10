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
  Encrypted backups and Docker build cache accumulate until attended cleanup;
  no automatic pruning or deletion of production recovery material is performed.

Run `pnpm test:mac-production` and `pnpm verify` before publishing. Behavior tests
exercise release eligibility, real state-file switches, maintenance, restart
budgets and process-group cleanup. Installation, real public CI availability,
dedicated-engine build capacity, provider/network function, a successful merged
main deployment, and physical reboot recovery need separate live evidence. Green
tests cannot prove these production boundaries or offsite recovery.
