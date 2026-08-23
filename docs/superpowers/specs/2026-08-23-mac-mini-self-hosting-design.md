# Mac Mini Self-Hosting and AWS Cutover Design

**Status:** Hardened proposal for implementation
**Date:** 2026-08-23  
**Owner:** Cooper  
**Repository:** `coopersully/personal-os`

## Summary

Move ilo production from AWS ECS, RDS, ALB, WAF, S3, and CloudFront to the always-on Mac Mini while preserving the existing hostnames and automatic deployment after successful CI on `main`. Optimize for one user, fast cutover, deterministic recovery, and low cost rather than high availability or zero downtime.

The Mac will run the Linux containers in a dedicated Colima profile. Cloudflare Tunnel will provide ingress without inbound router ports. GitHub-hosted Actions will publish an attested release bundle containing exact multi-architecture image digests. A fixed Mac bootstrap will verify and install the bundle's matching deployment controller. That controller will reconcile deployments through a durable state machine, create an immutable offsite backup, replace services, and prove the expected revision is public before recording success.

PostgreSQL will run locally with hourly encrypted backups and independently escrowed recovery keys. AWS will remain stopped but recoverable for 72 hours. New local releases will be held during that window so frozen RDS and the AWS images remain a coherent fallback. AWS retirement occurs only after deployment, attended reboot recovery, clean-room restore, and return-to-AWS procedures pass.

## Goals

- Serve `app.ilo.coopersully.me`, `api.ilo.coopersully.me`, and `mcp.ilo.coopersully.me` from the Mac.
- Deploy every eligible successful `main` commit without interactive Mac access after the 72-hour recovery window.
- Begin an eligible deployment within 30 seconds of release publication.
- Require no inbound router forwarding or static residential IP.
- Preserve data, sessions, connected-account credentials, OAuth callbacks, and URLs.
- Provide deterministic provenance, crash recovery, rollback, backup, and AWS return.
- Make setup executable by Codex on the Mac from checked-in documentation and scripts.
- Remove steady-state AWS application cost after the recovery window.

## Non-goals

- Zero downtime, blue/green deployment, clustering, or automatic failover.
- Multiple API or MCP replicas.
- Kubernetes, Watchtower, or a self-hosted platform control plane.
- Running pull-request jobs on the production Mac.
- Removing every AWS resource during cutover.
- Changing public product APIs, domain packages, or schema solely for hosting. Narrow changes for revision reporting, client identity, scheduler control, and graceful shutdown are in scope.
- Unattended recovery from a full power cycle. FileVault unlock and login remain attended.

## Constraints and service levels

- Cooper is the only production user and accepts a maintenance window.
- FileVault remains enabled, automatic login disabled, and production runs under a dedicated non-admin macOS account.
- The public repository and application packages remain public. No write-capable GitHub credential is stored on the Mac.
- The Mac has outbound HTTPS access to required providers, monitoring, and backup storage.
- Existing hostnames remain unchanged.
- Migrations follow `docs/engineering/database-migrations.md`.
- Recovery-point objective is one hour; target recovery time is four hours.
- The Mac, disk, home power, connection, and tunnel form one availability zone.

## Decisions

### 1. Dedicated and explicitly sized Colima production runtime

Release images include `linux/arm64` and `linux/amd64`. Production uses a dedicated Colima profile and socket selected through explicit `DOCKER_HOST`, never the global Docker context. Its Compose project is `ilo-production`; volumes, networks, and runtime directories cannot overlap development Compose or `.codex` lifecycle actions.

The checked-in profile sets CPU, memory, data-disk, root-disk, architecture, and runtime. Bootstrap verifies the effective allocation inside the VM and leaves at least 25% host memory and 20% host disk free.

Colima starts at user login through Homebrew services. Restart policies and reconciliation recover process, container, and VM service failures. A power cycle requires FileVault unlock and login; after that step, no shell command is allowed. A controlled reboot rehearsal, including Colima `Broken` recovery, is a cutover gate. If unreliable, use a small Linux VM or VPS rather than weakening disk or login security.

### 2. Keep GitHub execution off production

The Mac is not a self-hosted Actions runner. GitHub-hosted Actions run CI, builds, and attestations. The Mac runs only a fixed bootstrap plus controller code from a verified bundle. Forked code therefore cannot execute on the host containing production data and secrets.

### 3. Attested release manifest with exact digests

For each eligible successful `main` commit, Actions builds API, MCP, and web images. Tags are locators, not security or immutability boundaries. The workflow records the platform manifest digest for each image and publishes a versioned OCI release bundle containing:

- schema version and full commit SHA;
- exact API, MCP, web, PostgreSQL, and `cloudflared` manifest digests;
- `compose.production.yaml` and matching deployment-controller files;
- checksums for every bundle file;
- minimum fixed-bootstrap version;
- schema before and after migration; and
- machine-readable rollback compatibility with the prior production release, derived from CI compatibility tests.

Actions generates artifact attestations for the bundle and application images. The privileged workflow uses only `contents: read`, `packages: write`, `attestations: write`, and `id-token: write`; pins third-party actions to reviewed commits; consumes no untrusted cache or artifact; and receives no production runtime secret.

The mutable `production` reference points only to the bundle and moves last. Immediately before moving it, the workflow verifies the candidate is still protected `main` HEAD, preventing a slow older workflow from moving production backward. A newer untested `main` commit may intentionally cause an older successful release to be skipped.

The Mac verifies attestations against the exact repository, branch, workflow, and commit; verifies checksums; and deploys `image@sha256:...`. Labels and SHA-shaped tags never prove authenticity. State records digests, not only SHAs.

Before AWS publishing changes, a transition release both deploys AWS and publishes the exact live AWS SHA as a complete attested GHCR bundle. Cutover requires identical content to be proven live on AWS and available for the Mac architecture.

### 4. Transactional deployment state machine

Only the bootstrap, watcher launcher, and attestation verifier are fixed locally. Each release carries compatible Compose and controller files. Bootstrap atomically installs the verified controller, retains its predecessor, and rejects a bundle requiring a newer bootstrap.

Durable states are:

- `stable`: current and previous digests are verified;
- `deploying`: candidate, prior release, backup, schema, controller version, and completed step are recorded before mutation;
- `failed`: attempted digest, failure class, retries, and rollback outcome are recorded; and
- `recovery-required`: rollback is unsafe or incomplete and public ingress remains disabled.

State writes are atomic and fsynced. The controller locks, writes `deploying` before service replacement, and records each completed step. On startup it reconciles non-stable state before `cloudflared` starts: resume an idempotent step, roll the whole application back when safe, or enter `recovery-required`. It never serves a mixed release after restart.

Transient failures get at most three bounded retries. A terminally failed or rolled-back digest is quarantined until the pointer changes or Cooper explicitly retries it. An unchanged failed pointer cannot repeatedly create backups or outages.

### 5. Cloudflare Tunnel as the only ingress

A remotely managed Tunnel routes the three existing hostnames to pinned internal containers. No database, API, MCP, web, Docker, SSH, or deployment port is published to the router or LAN.

Cloudflare enforces Always Use HTTPS, HSTS at least matching the current two-year policy, the available managed WAF ruleset, and a coarse rate-limit rule covering authentication and MCP abuse. Actual plan capabilities are recorded. Application authentication and per-token controls remain authoritative.

The current first-value `X-Forwarded-For` behavior is not trusted. Declared Cloudflare mode uses `CF-Connecting-IP` only for requests arriving through the private tunnel network and ignores caller forwarding headers. Tests prove forged `X-Forwarded-For` cannot affect API authentication or MCP rate-limit identity.

The production VM or host firewall denies container access to RFC1918, link-local, multicast, router, NAS, and host-gateway addresses except the internal application-to-PostgreSQL path. Required DNS and outbound HTTPS remain available. An isolated VLAN or verified host/VM egress rules is acceptable; container probes proving denial are mandatory.

### 6. Pin PostgreSQL and migrate through SSM only

Local PostgreSQL uses the same major and an equal or newer tested minor than RDS, pinned by digest. PostgreSQL and `cloudflared` upgrades require backup and clean restore rehearsal.

RDS is never made public. A temporary EC2 transfer host in an existing public application subnet uses an SSM role and current agent, accepts no inbound traffic, has minimal outbound access, and uses a dedicated security group allowed into RDS. The Mac reaches RDS only with Session Manager remote-host port forwarding.

Connections validate the RDS CA and hostname. Dump tools are the same or newer PostgreSQL major. Create local application/migration roles first, restore with `--no-owner --no-acl` into an empty database owned by the intended role, apply explicit grants, and run `ANALYZE`. Rehearsal verifies extensions, sequences, grants, counts, and encrypted data. Remove the host and temporary rules after the final dump.

### 7. Independent immutable recovery

PostgreSQL is internal-only. Its volume and local backup staging live outside the disposable Colima VM disk, or are bind-mounted to protected host storage, so VM loss cannot remove both data and backups.

Create compressed logical dumps hourly, before each eligible deployment, and after cutover or infrastructure upgrades. Verify each dump, encrypt before upload, and use a unique immutable key. The Mac credential may create objects and complete its uploads but cannot delete, overwrite, shorten retention, change policy, or disable Object Lock/bucket lock.

Retention is 24 hourly and seven pre-deploy backups locally, 48 hourly and 30 daily offsite, plus the final RDS snapshot through retirement.

Escrow `APP_ENCRYPTION_KEY`, the backup key, and the recovery-secret inventory independently. The clean-room restore gate uses another machine, the offsite object, and escrow; it cannot read from the production Mac. Backup or upload failure blocks deployment and is remotely reported.

Runtime secrets live outside the repository in a file readable only by the dedicated production account. GitHub receives build-time public values only. Preserve `APP_ENCRYPTION_KEY` unchanged; preserve OAuth and email credentials initially; generate a new local database password and Tunnel token; and rotate `MCP_INTERNAL_SECRET` only when API and MCP change together. File permissions, absence from Compose output, and absence from process arguments are verification gates.

### 8. Revision health, graceful shutdown, rehearsal safety, and monitoring

API and MCP health expose a non-secret build revision, and the web image exposes the same revision through a static version endpoint or response header. Verification must observe the expected candidate, not any healthy response. GitHub waits with a bounded timeout for the expected public revision after moving the pointer.

On SIGTERM the API stops accepting requests and scheduling jobs, awaits in-flight HTTP and tracked background work with a bounded timeout, then closes PostgreSQL. Compose provides a matching `stop_grace_period`. Cutover verifies zero sessions before declaring a write freeze.

Rehearsal mode disables scheduled jobs and blocks provider mutations, email, and external side effects. Individual connector reads may be deliberately enabled for recorded tests. A restored rehearsal database cannot run Plaid synchronization, automations, finance backfills, callbacks, or email.

A mandatory remote sink receives deployment, backup, tunnel, disk, and watcher-heartbeat status. It alerts on explicit failure and missing heartbeat.

## Repository boundaries

### Release and Compose

`.github/workflows/deploy.yml` keeps its successful-CI-on-`main` trigger but replaces AWS publication with GHCR images, the bundle, attestations, the current-head guard, and expected-revision verification. `workflow_run` privileges are isolated from untrusted content.

`compose.production.yaml`, versioned in the bundle, defines pinned PostgreSQL, API, MCP, web, and `cloudflared`; internal database/application/tunnel networks; health/revision checks; host-protected storage; and delayed Tunnel startup until reconciliation. It contains no `build:`, development password, published database port, mutable tag, or secret.

### Narrow application hardening

Only composition and transport edges change: health revision, trusted-edge client identity, scheduler and external-side-effect switches, and graceful draining. Business rules remain in existing packages; MCP stays a stateless API adapter; hosting concerns do not enter domain or schema packages.

### Mac deployment files

Files under `deploy/mac-mini/` have one responsibility:

- `bootstrap.sh`: verify account, FileVault, architecture, profile/resources, disk, commands, directories, isolation, and startup;
- `watch.sh`: serialize checks and enforce holds and quarantine;
- `verify-release.sh`: verify provenance, checksums, branch, commit, bootstrap compatibility, and digests;
- `deploy.sh`: execute the state machine;
- `reconcile.sh`: recover interrupted state before ingress;
- `backup.sh`: create, verify, encrypt, upload, and report backups;
- `restore.sh`: restore a named backup only into a verified empty target;
- `verify.sh`: test exact revisions, database, Tunnel, HTTPS/HSTS, isolation, and monitoring; and
- launchd definitions: recover Colima after login, reconcile, start the stable stack/Tunnel, watch, and schedule hourly backup.

State, logs, secrets, controller versions, and metadata live outside the checkout in permission-restricted directories.

### DNS ownership and runbook

Cloudflare hostname records move out of AWS Terraform state into a separate authoritative Cloudflare DNS state before cutover. Remove existing record addresses from old state without deleting live records, import them into new state, and prove neither the old plan nor AWS destruction can modify Tunnel routes. All production DNS changes use reviewed Terraform.

`docs/deployment/mac-mini.md` documents bootstrap, escrow, state/quarantine, monitoring, restore, attended reboot, rollback, AWS return, SSM, Cloudflare, DNS ownership, and AWS removal. Commands are labeled development Mac, AWS, or Mac Mini.

## Steady-state deployment flow

1. A commit lands on protected `main`; CI succeeds.
2. Release builds exact images without untrusted artifacts.
3. It resolves digests, creates the bundle, tests migration rollback compatibility, and attests artifacts.
4. It rechecks current `main`, then moves the bundle pointer last.
5. Within 30 seconds the watcher sees a new digest; hold/quarantine causes an auditable skip.
6. The Mac verifies provenance/digests and atomically installs the compatible controller.
7. Controller locks, records `deploying`, checks capacity, and uploads an immutable backup.
8. It pulls digests and gracefully replaces API; migrations run and readiness reports the candidate.
9. It replaces MCP/web and proves all local revisions.
10. It starts or retains Tunnel ingress and proves HTTPS, HSTS, authentication, representative behavior, and public revisions.
11. It records `stable`, current/previous digests, schema, and backup; reports remotely; and prunes only unreferenced images outside recovery.
12. GitHub observes the expected revision and marks release success.

## Failure and migration policy

- Build, attestation, publication, or current-head failure leaves the pointer unchanged.
- Provenance, digest, stale-release, bootstrap, backup, isolation, disk, or lock failure prevents replacement.
- Pre-migration failure leaves stable production serving.
- Post-replacement failure rolls all services back only when attested compatibility proves the previous release supports the resulting schema.
- If rollback is unsafe, disable ingress, record `recovery-required`, and require a forward fix or explicit database restore.
- Never restore database contents silently or automatically.
- Quarantine terminal failures; retry classified transient failures at most three times.
- Report all outcomes remotely; a missing heartbeat is an alert.

## Cutover

### Phase 0: Release and DNS ownership

1. Add hardened publication while retaining AWS deployment.
2. Publish and attest the exact AWS SHA/content for both architectures.
3. Require protected `main`, CI, privileged-workflow review, and no force pushes.
4. Create separate Cloudflare DNS state; non-destructively transfer/import records and prove ownership plans.
5. Create Tunnel and temporary validation hostnames without changing production.

### Phase 1: Prove the Mac

1. Verify FileVault/no auto-login and create the non-admin account.
2. Bootstrap the dedicated profile, resources, socket, storage, isolation, monitoring, and launchd jobs.
3. Install secrets, preserve `APP_ENCRYPTION_KEY`, and complete independent escrow.
4. Deploy the AWS release with disposable data and rehearsal mode.
5. Verify local/tunneled revisions, forged-header rejection, isolation, logs, disk, HTTPS/HSTS, and deliberate read-only provider access.
6. Back up and restore on another machine using only offsite storage and escrow.
7. Rehearse release failure, controller interruption at every boundary, and quarantine.
8. Reboot, unlock/login once, and prove full automatic post-login recovery without a shell.

### Phase 2: Rehearse RDS migration

1. Create the no-inbound SSM transfer instance and least-privilege groups.
2. Snapshot RDS; use SSM forwarding for a CA/hostname-verified non-final dump.
3. Create roles/empty database, restore ownership/grants, and run `ANALYZE`.
4. Start the exact AWS SHA with schedulers and side effects disabled.
5. Verify extensions, sequences, grants, login, counts, encrypted data, deliberate reads, and MCP.
6. Delete rehearsal data and record dump/restore/verification duration against the four-hour RTO.

### Phase 3: Freeze and cut over

1. Record AWS, GitHub, Cloudflare, SSM, monitoring, and Mac health; put watcher in `hold`.
2. Disable AWS jobs, scale MCP then API to zero, and wait for ECS running and pending counts to reach zero.
3. Verify zero application sessions, active transactions, and writers. Only then declare the freeze.
4. Take final RDS snapshot and verified SSM logical dump from that frozen state.
5. Restore into an empty local database with roles, grants, sequences, extensions, and `ANALYZE`.
6. Start the exact AWS release; do not combine cutover with a new application release.
7. Verify counts, credentials, login, revisions, assets, callbacks, email, and a local mutation.
8. Apply reviewed Cloudflare DNS state from AWS targets to Tunnel targets.
9. Verify HTTPS/HSTS, WAF/rate limits, sign-in, public revisions, mutation, MCP, email, and callbacks.
10. Upload the first post-cutover immutable backup and confirm heartbeat.

### Phase 4: Frozen 72-hour window

Keep ECS at zero; retain RDS, snapshot, exact images, transfer procedure, and state; keep the watcher in `hold`; monitor everything; run an offsite restore; and make no destructive AWS/DNS/escrow change. Bundles may publish but cannot deploy.

An urgent release requires an explicit choice to end simple AWS rollback after proving the post-write return path, or a schema-neutral forward fix. It is never unattended. After 72 healthy hours, remove the hold and deploy only the newest eligible current-`main` bundle.

### Phase 5: Retire AWS

1. Reconcile live/Terraform drift and prove AWS state owns no production DNS.
2. Preserve final snapshot and one downloaded logical backup through agreed retention.
3. Remove traffic resources through reviewed Terraform.
4. Remove GitHub AWS variables and disable OIDC deployment.
5. Remove root keys; retain only intentional least-privilege recovery access.
6. Remove SSM transfer resources.
7. Close AWS only after offsite/escrow recovery succeeds independently.

## Rollback

### Before a local write

Stop local writers, apply Cloudflare DNS state back to AWS, scale API then MCP to one, and verify the frozen AWS revision. RDS remains authoritative.

### After local writes

1. Gracefully stop local writers, disable ingress, and prove the database frozen.
2. Upload a verified immutable backup.
3. Restore the retained snapshot to a **new** RDS instance, or provision a new empty compatible target. Never import over populated frozen RDS.
4. Through SSM, restore local data into that empty target, apply roles/grants, run `ANALYZE`, and validate.
5. Point AWS secrets to the new endpoint; start compatible API then MCP; verify revisions.
6. Apply Cloudflare DNS state back to AWS.
7. Preserve original and returned RDS targets until resolution.

Alternatively, Cooper may explicitly discard identified local writes and return to frozen RDS. Record that decision and discarded interval before DNS changes.

## Verification gates

- `pnpm verify` passes.
- Compose has no secrets, builds, published DB ports, mutable tags, or shared development resources.
- Provenance verifies for repository, workflow, branch, commit, bundle, and image digests.
- Stale workflow, forged tag/label, digest substitution, and failed candidate are rejected.
- Interruption at every transition recovers one coherent release before ingress.
- Native images and explicit Colima resources pass.
- Local/public health reports expected revisions.
- Forged forwarding headers cannot alter identity or limits.
- Containers cannot reach prohibited LAN addresses.
- Shutdown drains requests/jobs; rehearsal creates no external side effect.
- Login, CRUD, MCP, credential decryption, callback, and email pass.
- HTTPS redirect, HSTS, WAF, and edge rate limiting pass.
- Hourly immutable backup and missing-heartbeat alerts pass.
- Another machine restores using only offsite backup and escrow.
- Rollback passes for safe and unsafe migrations.
- Attended reboot needs no post-login shell.
- Final snapshot/dump follow verified freeze.
- Post-write AWS return uses a new empty target.
- Old AWS Terraform cannot revert or delete Tunnel DNS.

## Rejected alternatives

- **Self-hosted Actions runner:** unnecessary execution and secret exposure.
- **Watchtower:** cannot safely gate backup, migration, verification, and rollback.
- **Tailscale Funnel:** does not preserve the current custom hostnames.
- **Kubernetes/Coolify/Dokploy:** control-plane cost without recovery benefit for one host.
- **Public RDS:** current subnets have no public route; SSM is safer and simpler.
- **Cheap Linux VPS:** selected fallback if Colima reboot reliability fails, but not the preferred local-control/cost outcome.

## Accepted single-user risks

- FileVault makes cold boot attended.
- The Mac and home connection are one availability zone.
- In-place replacement can briefly interrupt service.
- Recovery is more manual than RDS PITR, bounded by the one-hour RPO and four-hour target RTO.
- Cloudflare is both DNS and ingress.
- A malicious reviewed commit on protected `main` can publish malicious production code. Provenance prevents registry forgery, not malicious source.

Revisit this architecture before adding users, requiring unattended cold boot, or tightening RPO/RTO.
