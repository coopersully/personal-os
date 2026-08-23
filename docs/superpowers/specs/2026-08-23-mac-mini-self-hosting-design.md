# Mac Mini Self-Hosting and AWS Cutover Design

**Status:** Hardened proposal for implementation; three adversarial review cycles incorporated
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
- Provide deterministic provenance, crash recovery, rollback, backup, time-limited AWS return, and post-retirement alternate-host recovery.
- Make setup executable by Codex on the Mac from checked-in documentation and scripts.
- Remove steady-state AWS application cost after the recovery window.

## Non-goals

- Zero downtime, blue/green deployment, clustering, or automatic failover.
- Multiple API or MCP replicas.
- Kubernetes, Watchtower, or a self-hosted platform control plane.
- Running pull-request jobs on the production Mac.
- Removing every AWS resource during cutover.
- Changing product behavior, domain packages, or schema solely for hosting. Narrow transport changes for revision reporting, client identity, scheduler control, graceful shutdown, and idempotent mutation retries are in scope.
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
- macOS system sleep is disabled on AC power. Display sleep remains allowed.
- Background security-data and rapid-security-response updates remain enabled. Restart-required macOS updates, major OS upgrades, and Colima/Docker/Compose upgrades are attended infrastructure releases rather than unattended package updates.

## Decisions

### 1. Dedicated and explicitly sized Colima production runtime

Release images include `linux/arm64` and `linux/amd64`. Production uses a dedicated Colima profile and socket selected through explicit `DOCKER_HOST`, never the global Docker context. Its Compose project is `ilo-production`; volumes, networks, and runtime directories cannot overlap development Compose or `.codex` lifecycle actions.

The checked-in profile sets CPU, memory, data-disk, root-disk, architecture, and runtime. Bootstrap verifies the effective allocation inside the VM and leaves at least 25% host memory and 20% host disk free. A host-runtime compatibility manifest records the tested macOS build, Colima, Lima, virtualization backend, Docker Engine, Compose, profile schema, and launchd definitions. Bootstrap rejects drift from that manifest.

The dedicated production account is FileVault-enabled and is the required post-boot login identity. A checked-in user LaunchAgent, not the generic Homebrew service definition, starts `colima start ilo-production --foreground` with explicit `COLIMA_PROFILE`, `COLIMA_HOME`, and `DOCKER_HOST`. The fixed launcher, not Docker restart policy, owns API, MCP, web, scheduler, and `cloudflared` startup. Those containers cannot autonomously restart around reconciliation; ingress and writers remain stopped until the launcher has reconciled durable state. PostgreSQL may restart internally, but no application writer or ingress starts merely because Docker or the VM returned. A power cycle requires FileVault unlock and login to that account; after that step, no shell command is allowed. Controlled reboot, Colima `Broken`, sleep/wake, and process-crash rehearsals are cutover gates. If unreliable, use a small Linux VM or VPS rather than weakening disk or login security.

Host-runtime changes are versioned infrastructure releases. They require a fresh immutable backup, export of the prior packages/configuration, an attended reboot rehearsal, volume and network verification, and an explicit rollback target. When macOS itself cannot be safely downgraded, the tested alternate Linux/Mac recovery host is the rollback target. Pending restart-required updates alert remotely and are installed only inside a bounded attended maintenance window.

### 2. Keep GitHub execution off production

The Mac is not a self-hosted Actions runner. GitHub-hosted Actions run CI, builds, and attestations. The Mac runs only a fixed bootstrap plus controller code from a verified bundle. Forked code therefore cannot execute on the host containing production data and secrets.

### 3. Attested release manifest with exact digests

For each eligible successful `main` commit, Actions builds API, MCP, and web images. Tags are locators, not security or immutability boundaries. The workflow records the platform manifest digest for each image and publishes a versioned OCI release bundle containing:

- schema version and full commit SHA;
- exact API, MCP, web, PostgreSQL, and `cloudflared` manifest digests;
- `compose.production.yaml` and matching deployment-controller files;
- checksums for every bundle file;
- minimum fixed-bootstrap version;
- schema before and after migration;
- a canonical before/after migration-journal and schema fingerprint;
- the exact set of predecessor bundle digests against which rollback compatibility was tested; and
- an infrastructure-change class plus attested rehearsal approval when PostgreSQL or `cloudflared` changes.

The protected-main `push` workflow binds CI and release to the same event SHA and workflow definition: the release job has `needs` on every required CI job and runs only for that successful `main` push. It does not use `workflow_run`, `repository_dispatch`, or a later default-branch checkout to release an older run. Therefore A's delayed success still executes and attests A's reviewed workflow at A even if newer B has landed and failed. Actions generates artifact attestations for the bundle and application images. Only the release job receives `contents: read`, `packages: write`, `attestations: write`, and `id-token: write`; it pins third-party actions to reviewed commits, rebuilds from the event SHA without consuming untrusted artifacts or caches, and receives no production runtime secret.

The mutable `production-candidate` reference points only to the newest successful protected-`main` bundle and moves last. The controller's witnessed stable digest, not that mutable reference, is the active production identity. Publication is monotonic by commit ancestry and a signed release sequence; it never requires the successful commit to remain current `main` HEAD. Therefore, if commit A passes and newer commit B fails, A remains eligible rather than production waiting for another merge. A candidate that is not a descendant of the last published successful release is rejected unless an explicit reviewed recovery release authorizes it.

The workflow serializes pointer updates, rereads the pointer before update, and refuses a non-monotonic move. Because the GitHub check and registry update cannot be one atomic operation, the Mac independently resolves the newest successful protected-main release and revalidates ancestry and sequence under its deployment lock immediately before mutation. GitHub concurrency alone is not treated as an ordering guarantee.

The Mac verifies attestations against the exact repository, branch, workflow, and commit; verifies checksums; and deploys `image@sha256:...`. Labels and SHA-shaped tags never prove authenticity. State records digests, release sequence, source ancestry, and schema fingerprints, not only SHAs. Before migration, the controller requires the live schema fingerprint to equal the candidate's `before` fingerprint. A one-shot migration container—with no listener, scheduler, provider, email, or Tunnel credentials—runs migrations and exits. The controller verifies the exact `after` fingerprint before any candidate application service starts. Any mismatch enters `recovery-required`.

Rollback compatibility is evaluated against the controller's actual recorded stable bundle digest. The candidate must list that exact digest as a tested predecessor. If a hold or quarantine skipped releases, CI must either test the direct stable-to-candidate path or the controller deploys the compatible release chain in order. Compatibility with merely the previous published bundle is insufficient.

An ordinary application release must keep the PostgreSQL and `cloudflared` digests unchanged. A changed infrastructure digest requires a distinct attested infrastructure release, successful clean restore and upgrade rehearsal, explicit Cooper approval, and controller verification of that evidence before mutation.

Before AWS publishing changes, a transition release both deploys AWS and publishes the exact live AWS SHA as a complete attested GHCR bundle. Cutover requires identical content to be proven live on AWS and available for the Mac architecture.

### 4. Transactional deployment state machine

Only the bootstrap, fixed launcher, watcher, and attestation verifier are fixed locally. Each release carries compatible Compose and controller files. Controllers are installed at immutable versioned paths. The fixed launcher selects a controller from durable state, health-checks a candidate before activation, and atomically reverts the active pointer if activation, state parsing, or reconciliation fails. It can always invoke the recorded stable controller even when the candidate controller is broken. A bundle requiring a newer bootstrap is rejected.

The fixed launcher owns a versioned recovery-state envelope and validates controller state updates before committing them. State-schema evolution is additive and backward-readable by the recorded stable launcher/controller. A release cannot write a state version its rollback target cannot parse. A non-additive state change requires a separately installed and rehearsed bootstrap infrastructure release, a preserved prior state snapshot, and explicit recovery compatibility evidence.

Durable states are:

- `stable`: current and previous digests are verified;
- `deploying`: candidate, prior release, backup, schema, controller version, and completed step are recorded before mutation;
- `failed`: attempted digest, failure class, retries, and rollback outcome are recorded; and
- `recovery-required`: rollback is unsafe or incomplete and public ingress remains disabled.

State writes are atomic and fsynced. Deploy, reconcile, restore, scheduled backup, pruning, and infrastructure upgrade share one global operation lock. The controller writes `deploying` before service replacement and records each completed step. On startup the fixed launcher and selected controller reconcile non-stable state before `cloudflared` starts: resume an idempotent step, roll the whole application back when safe, or enter `recovery-required`. Entering `recovery-required` first detaches or stops `cloudflared` and proves every public hostname unreachable, then stops API, MCP, every scheduler, and all background/side-effect workers. It never serves a mixed release after restart or leaves a failed candidate writing.

Transient failures get at most three bounded retries. A terminally failed or rolled-back digest is quarantined by immutable bundle digest until Cooper explicitly authorizes a retry after recording a reason. Pointer movement does not clear quarantine. Direct upgrades and chain planning reject every quarantined intermediate digest, and an unchanged failed pointer cannot repeatedly create backups or outages.

### 5. Cloudflare Tunnel as the only ingress

A remotely managed Tunnel routes the three existing hostnames to pinned internal containers. Each origin has a separate internal network shared only with `cloudflared`; MCP reaches API through another explicit service network. Database access is limited to API and administrative backup/restore jobs. No database, API, MCP, web, Docker, SSH, or deployment port is published to the router or LAN.

Cloudflare enforces HTTPS redirects, the exact current two-year HSTS header, the available managed WAF ruleset, and a coarse rate-limit rule covering authentication and MCP abuse. Redirects, response-header rules, WAF exceptions, and rate limits are explicitly scoped to the three ilo hostnames; zone-wide settings are rejected unless every sibling hostname is inventoried and proven compatible. Actual plan capabilities and recurring certificate/add-on cost are recorded and approved. Phase 0 inventories the authoritative zone and proves active edge-certificate coverage for all three multi-level hostnames. For a full `coopersully.me` zone, advanced or custom certificates covering the exact Tunnel hostnames are provisioned before cutover because Universal SSL and Tunnel-excluded Total TLS are insufficient. Application authentication and per-token controls remain authoritative.

The current first-value `X-Forwarded-For` behavior is not trusted. Declared Cloudflare mode uses `CF-Connecting-IP` only from the exact authenticated `cloudflared` hop on a per-origin network and ignores caller forwarding headers. A peer application container is never a trusted proxy. Tests forge both `X-Forwarded-For` and `CF-Connecting-IP` from every non-edge network and prove neither can affect API authentication or MCP rate-limit identity.

The production VM or host firewall explicitly permits only the named Compose flows (`cloudflared` to each origin, MCP to API, API and administrative jobs to PostgreSQL, and Docker DNS), then denies destinations reachable through host or LAN interfaces. Denials cover RFC1918, IPv4/IPv6 loopback, link-local, IPv4-mapped IPv6, `fc00::/7`, multicast, host-gateway, router/NAS addresses, and any globally addressed IPv6 LAN prefixes. Required external DNS and HTTPS remain available. `cloudflared` alone may reach Cloudflare's documented Tunnel endpoints on TCP and UDP 7844; QUIC is preferred and HTTP/2 fallback is explicitly tested. An isolated VLAN or verified host/VM rules are acceptable; probes for every allowed flow, Tunnel reconnect/fallback, and denied address class are mandatory.

### 6. Pin PostgreSQL and migrate through SSM only

Local PostgreSQL uses the same major and an equal or newer tested minor than RDS, pinned by digest. PostgreSQL and `cloudflared` upgrades require backup and clean restore rehearsal.

RDS is never made public. A temporary EC2 transfer host in an existing public application subnet uses an SSM role and current agent, accepts no inbound traffic, has minimal outbound access, and uses a dedicated security group allowed into RDS. The Mac reaches RDS only with Session Manager remote-host port forwarding.

Connections validate the RDS CA and hostname. Dump tools are the same or newer PostgreSQL major. Before choosing the local image, capture RDS server encoding, `LC_COLLATE`, `LC_CTYPE`, collation provider/version, ICU/libc dependencies, extensions, and relevant compatibility settings. The local cluster reproduces them where supported; otherwise the migration plan names the difference, affected indexes/constraints, required `REINDEX`, and tested Unicode ordering, case-folding, `ILIKE`, and uniqueness invariants. Create local application/migration roles first, restore with `--no-owner --no-acl` into an empty database owned by the intended role, apply explicit grants, run required reindexing, and run `ANALYZE`. Rehearsal verifies extensions, sequences, grants, counts, collations, Unicode invariants, and encrypted data. Remove the host and temporary rules after the final dump.

### 7. Independent immutable recovery

PostgreSQL is internal-only. `PGDATA` uses a Linux named volume on Colima's separate persistent container-data disk, never a macOS file-sharing bind mount. The data disk is treated as recoverable but not authoritative disaster recovery. Encrypted logical backup staging is copied to protected FileVault host storage and then offsite, so loss of either the VM/data disk or host staging does not remove all recovery copies.

The offsite control plane is a dedicated Backblaze account, independent of AWS, GitHub, Cloudflare, and the production Mac. Checked-in OpenTofu under `infra/backup/` owns a private B2 bucket with 35-day Compliance-mode Object Lock/default retention, lifecycle, server-side encryption, monitoring, and a bucket-and-prefix-scoped Mac application key limited to the minimum create/complete-upload capabilities proven necessary by integration tests. It has no delete, retention-change, bypass-governance, bucket-policy, application-key-admin, or account-admin capability. Administrative credentials and an encrypted state snapshot are escrowed independently; the root includes import/recovery instructions and a no-Mac clean plan. AWS retirement is blocked until this control plane and its state recover from escrow.

Create compressed logical dumps hourly, at a frozen writer boundary before each eligible deployment, and after cutover or infrastructure upgrades. Verify each dump, encrypt it with a unique data key wrapped by the escrowed backup key, and use a unique immutable object name. The bucket's default Compliance retention applies without trusting uploader-provided retention. The Mac credential cannot delete, overwrite, shorten retention, change policy, or disable Object Lock. The age of the latest independently accepted checkpoint must remain below one hour; backup duration, lock contention, or witness delay that threatens the RPO alerts and blocks deployment.

Retention is 24 hourly and seven pre-deploy backups locally, 48 hourly and 30 daily offsite, plus the final RDS snapshot through retirement.

At least weekly, a separately scheduled independent machine restores the most recent independently accepted checkpoint and its offsite backup/recovery manifest, validates schema fingerprint, roles/grants, representative data, and credential decryption, and records duration against the four-hour RTO. The independent scheduler, owner, read credential, and alert destination are recorded in the runbook and are unavailable to the Mac uploader. Missed or failed rehearsals alert remotely. Infrastructure upgrades require an additional successful restore immediately before approval.

Escrow `APP_ENCRYPTION_KEY`, the backup key, and the recovery-secret inventory independently. Every uploaded database object has an authenticated immutable recovery manifest beside it containing the stable bundle and service digests, PostgreSQL and `cloudflared` digests, schema fingerprint, release sequence, bootstrap/controller/host-runtime versions, required configuration inventory, backup checksum, the exact offline attestation bundles, and the pinned trusted-root material required for offline verification. The Mac also exports both supported platform images and the referenced release/controller bundle into an immutable OCI archive. Artifact retention is at least as long as every database backup that references it. Clean-room recovery must work with GitHub and GHCR unavailable and verifies attestations offline before executing the archived release.

The independent monitor accepts a recovery checkpoint only after it observes the same public stable revision, verifies the release attestation and manifest hash independently, and records the immutable database, manifest, and OCI-object identifiers in its own append-only account. Recovery selects the last explicitly accepted checkpoint before the incident; it never treats the lexicographically or chronologically newest uploader object as trusted. Cooper may deliberately select an earlier accepted checkpoint. A clean-room restore first deploys that checkpoint's proven-compatible release and then restores the database. The gate uses another machine, the offsite objects, the witness record, and escrow; it cannot read from the production Mac. Backup, artifact export, witness, or upload failure blocks deployment and is remotely reported.

Runtime secrets live outside the repository in a file readable only by the dedicated production account. GitHub receives build-time public values only. Preserve `APP_ENCRYPTION_KEY` unchanged; preserve OAuth and email credentials initially; generate a new local database password and Tunnel token; and rotate `MCP_INTERNAL_SECRET` only when API and MCP change together. File permissions, absence from Compose output, and absence from process arguments are verification gates.

### 8. Revision health, graceful shutdown, rehearsal safety, and monitoring

API and MCP health expose a non-secret build revision, and the web image exposes the same revision through a release-specific static version path and response header. Cloudflare bypasses cache for revision paths and every response sends `Cache-Control: no-store`; the verifier uses a nonce-bearing request and requires an origin-fresh response. Verification must observe the expected candidate, not any healthy response.

Release publication and production observation are separate statuses. The publication workflow succeeds when the protected-main bundle, pointer, and attestations are durable. A deployment-observation job then waits with a bounded timeout for the expected public revision. During the explicit 72-hour hold, matching hold state and deadline are recorded in both GitHub deployment metadata and the Mac; observation reports `deferred`, not failed. A mismatch or an expired hold fails closed and alerts. Removing the hold triggers immediate watcher reconciliation plus a new observation job for the selected candidate.

On SIGTERM API and MCP stop accepting requests and scheduling work, await tracked in-flight requests/background jobs with bounded timeouts, then close dependencies. Compose provides matching `stop_grace_period` values. Candidate API/MCP processes start with schedulers, synchronization, callbacks, email, provider HTTP, and every background/side-effect worker disabled. Promotion enables those capabilities only after the coherent local candidate and public revision pass; failure before durable `stable` returns to writer-stopped reconciliation.

MCP mutations generate or forward an `Idempotency-Key` to the public API. Authentication resolves a stable idempotency subject: the human user ID for interactive sessions, or a persisted credential/token-family ID for agents. An OAuth refresh carries forward the same family across replacement access and refresh-token rows; the current access-token row ID is never the idempotency subject. A database idempotency record is transactionally committed with the mutation and audit event under a unique `(idempotency subject, method, route, key)` scope. It stores a canonical request hash, completion state, and replayable result reference. The same key and payload returns the committed result; the same key with a different payload returns `409`; an uncommitted transaction leaves no success record and may be retried. Records outlive the maximum client/controller retry window and are pruned only under the global operation lock. This narrow database migration is explicitly in scope; an audit `request_id` alone is not an idempotency boundary.

Cutover verifies zero active application database connections, open transactions, queued jobs, and background writers before declaring a write freeze. Persisted human sessions remain intact during the final frozen migration; they are not counted as active connections and are not deleted.

Production-derived rehearsal is private: it has no public Tunnel route unless protected by independent Cloudflare Access or mTLS. Before any application starts, an offline scrub removes sessions, PATs, OAuth state/codes, password/reset/action tokens, provider access/refresh tokens, API keys, email credentials, webhook secrets, and other externally usable credentials, then inserts separate rehearsal-only credentials. A network policy independently denies all external egress except pinned mock/capture endpoints and the minimum monitoring destination; application configuration is not the sole guard. Rehearsal mode also disables scheduled jobs, callbacks, email, and external side effects. Connector behavior uses separate test credentials or captured responses; a production credential is never exercised, even for a nominal read. A restored rehearsal database cannot run synchronization, automations, finance backfills, callbacks, or email.

A mandatory independent remote sink receives deployment, backup, tunnel, disk, watcher-heartbeat, and redacted structured API/MCP/controller/backup/Tunnel errors with correlation IDs. Independent continuous synthetic probes check all three public hostnames, the recorded stable revision, and safe authenticated API/MCP behavior; a connected Tunnel alone is not healthy. Synthetic authentication uses a dedicated read-only canary principal/token with no mutation or provider scope, stored outside the Mac uploader context and rotated on a recorded schedule.

Before deliberately disabling ingress, the controller creates a remotely visible maintenance lease naming the stable and candidate digests, reason, start time, and hard deadline. Probes accept only that exact bounded state, continue checking heartbeat/backup/revision invariants, and alert on an unexpected revision or deadline overrun; broad alert suppression is prohibited. The lease is cleared only after public verification or failure reporting. Alerts cover explicit errors, failed probes, missing heartbeats, pending restart-required host updates, and missing scheduled clean-room restores.

## Repository boundaries

### Release and Compose

`.github/workflows/deploy.yml` becomes one protected-main `push` workflow whose least-privilege CI jobs gate a SHA-bound release job. That job replaces AWS publication with GHCR images, the bundle, attestations, and monotonic successful-main publication; a separate unprivileged job records hold-aware production observation. Pull-request workflows never receive release permissions, and no privileged follow-on event consumes artifacts from another run.

`compose.production.yaml`, versioned in the bundle, defines pinned PostgreSQL, one-shot migration, API, MCP, web, and `cloudflared`; least-privilege database/service/per-origin networks; health/revision checks; Linux named storage; and delayed Tunnel startup until reconciliation. Before execution, the fixed verifier evaluates the fully resolved Compose model—including interpolation, extensions, profiles, includes, and providers—against a service-specific allowlist. It rejects `build`, mutable tags, `privileged`, added capabilities, host PID/IPC/network namespaces, devices, Docker socket/API access, unapproved bind mounts, published ports, external networks, arbitrary secret/config paths, and unknown keys. Services use non-root users, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, read-only filesystems, explicit writable tmpfs/volumes, and per-service secrets wherever compatible.

### Narrow application hardening

Only composition and transport edges change: health revision, exact-hop trusted-edge identity, scheduler/provider-side-effect switches, graceful API/MCP draining, and mutation idempotency at the public API boundary. Business rules remain in existing packages and MCP stays a stateless API adapter. The only hosting-motivated persistence change is the API idempotency table and migration described above; no deployment state enters product/domain tables.

### Mac deployment files

Files under `deploy/mac-mini/` have one responsibility:

- `bootstrap.sh`: verify the production login identity, FileVault, AC sleep policy, architecture, profile/resources, disk, commands, directories, isolation, and startup;
- `watch.sh`: serialize checks and enforce monotonic sequence, live ancestry revalidation, holds, and quarantine;
- `verify-release.sh`: verify provenance, checksums, branch, commit, bootstrap compatibility, and digests;
- `deploy.sh`: execute the state machine;
- `reconcile.sh`: recover interrupted state before ingress;
- `backup.sh`: create, verify, encrypt, upload, and report backups;
- `restore.sh`: restore only an independently accepted named checkpoint into a verified empty target, require an explicit final-cutover or disaster-recovery class, and refuse ingress until that class's credential policy passes;
- `verify.sh`: test exact revisions, database, Tunnel, HTTPS/HSTS, isolation, and monitoring; and
- launchd definitions: start the explicit `ilo-production` Colima profile after production-account login, reconcile, start the stable stack/Tunnel, watch, and schedule hourly backup.

State, logs, secrets, controller versions, and metadata live outside the checkout in permission-restricted directories.

### DNS ownership and runbook

Cloudflare hostname records, Tunnel and ingress configuration, exact edge certificates, HTTPS/HSTS settings, WAF, and rate-limit rules move into one authoritative reviewed Cloudflare IaC root before cutover. Remove existing record addresses from AWS state without deleting live records, import all pre-existing Cloudflare resources, and prove neither the old plan nor AWS destruction can modify production edge behavior. Its locked, versioned state backend and state-recovery credentials are independent of the AWS account being retired. All production edge changes use reviewed IaC; dashboard drift is alerted and corrected through the same root.

`docs/deployment/mac-mini.md` documents bootstrap, escrow, state/quarantine, monitoring, restore, attended reboot, rollback, time-limited AWS return, post-retirement alternate-host recovery, SSM, Cloudflare, state ownership, and AWS removal. Commands are labeled development Mac, AWS, or Mac Mini.

## Steady-state deployment flow

1. A commit lands on protected `main`; CI succeeds.
2. Release builds exact images without untrusted artifacts.
3. It resolves digests, creates the bundle, tests migration rollback compatibility, and attests artifacts.
4. It serializes publication, verifies monotonic successful-main ancestry/sequence, then moves the bundle pointer last.
5. Within 30 seconds the watcher sees a new digest; hold/quarantine causes an auditable skip.
6. Under the global operation lock, the Mac independently revalidates successful-main ancestry/sequence, provenance, actual-predecessor compatibility, infrastructure-release evidence, and before-schema fingerprint; then the fixed launcher health-checks the candidate controller.
7. Controller records `deploying`, checks capacity, creates the bounded remote maintenance lease, disables Tunnel ingress, drains API/MCP/background work, and proves zero connections, transactions, queued jobs, and writers.
8. From that frozen point it creates, verifies, encrypts, and uploads the immutable backup/recovery manifest; failure restarts the unchanged stable release without mutation.
9. It pulls exact digests, runs the credential-free one-shot migration, and verifies the after-schema fingerprint before starting application services.
10. It starts API/MCP/web as one candidate set with schedulers, providers, email, callbacks, and side effects disabled, then proves every local revision and safe behavior.
11. It enables Tunnel ingress only after the coherent local release passes, proves HTTPS, certificates, HSTS, authentication, and origin-fresh public revisions, then activates and verifies background capabilities.
12. It records `stable`, current/previous digests, schema, backup, artifact archive, and witnessed checkpoint; clears maintenance; reports remotely; and prunes only unreferenced images outside recovery.
13. GitHub's separate observation status records the expected deployed revision, or an explicit hold-aware deferred state.

## Failure and migration policy

- Build, attestation, publication, or monotonic ancestry/sequence failure leaves the pointer unchanged.
- Provenance, digest, stale-release, bootstrap, backup, isolation, disk, or lock failure prevents replacement.
- Pre-migration failure leaves stable production serving.
- Post-replacement failure rolls all services back only when attested compatibility names the actual stable predecessor digest and proves it supports the resulting live schema fingerprint.
- If rollback is unsafe, keep ingress disabled; stop API, MCP, schedulers, and all background writers; record `recovery-required`; and require a forward fix or explicit database restore.
- Never restore database contents silently or automatically.
- Quarantine terminal failures; retry classified transient failures at most three times.
- Report all outcomes remotely; a missing heartbeat is an alert.

## Cutover

### Phase 0: Release and DNS ownership

1. Add hardened publication while retaining AWS deployment.
2. Publish and attest the exact AWS SHA/content for both architectures.
3. Require protected `main`, CI, privileged-workflow review, and no force pushes.
4. Create the independent Cloudflare IaC backend and root; non-destructively transfer/import DNS, Tunnel configuration, certificates, hostname-scoped HTTPS/HSTS, WAF, and rate limits; prove state recovery and clean ownership plans.
5. Provision the dedicated Backblaze/OpenTofu backup control plane, 35-day Compliance retention, uploader key, independent read/rehearsal identity, escrow, state recovery, monitoring, and negative permission tests.
6. Inventory the authoritative zone, approve recurring edge-certificate cost, and provision active certificates explicitly covering all three multi-level production hostnames.
7. Create private or independently access-controlled validation routes without changing public production DNS.

### Phase 1: Prove the Mac

1. Verify FileVault/no auto-login, enable the non-admin production account for FileVault login, and disable system sleep on AC.
2. Bootstrap the dedicated profile, host-runtime compatibility manifest, explicit LaunchAgent/profile/environment, resources, socket, Linux named storage, isolation, monitoring, and launchd jobs.
3. Install secrets, preserve `APP_ENCRYPTION_KEY`, and complete independent escrow.
4. Deploy the AWS release with disposable data and rehearsal mode.
5. Verify local/private-validation revisions, forged forwarding-header rejection from every non-edge network, IPv4/IPv6 isolation, `cloudflared` TCP/UDP 7844 reconnect/fallback, remote logs, synthetic monitoring, disk, edge certificates, and hostname-scoped HTTPS/HSTS without using production provider credentials.
6. Back up and restore on another machine using only offsite storage and escrow.
7. Rehearse release failure, controller interruption at every boundary, and quarantine.
8. Reboot, unlock and log into the production account once, and prove the explicit production Colima profile and full stack recover without a shell; then rehearse sleep/wake and verify no service-level drift.

### Phase 2: Rehearse RDS migration

1. Create the no-inbound SSM transfer instance and least-privilege groups.
2. Snapshot RDS; use SSM forwarding for a CA/hostname-verified non-final dump.
3. Acquire the global operation lock, pause scheduled production backups, create roles/empty rehearsal database, restore ownership/grants, and run `ANALYZE`.
4. Offline-scrub all copied sessions, PATs, OAuth state/codes, action/reset tokens, provider access/refresh tokens, API keys, email/webhook secrets, and other externally usable credentials; create a rehearsal-only principal and mock credentials.
5. Apply the independent rehearsal egress deny, then start the exact AWS SHA privately with schedulers, provider HTTP/token refresh, callbacks, email, and all side effects disabled.
6. Verify extensions, sequences, grants, rehearsal login, counts, encrypted-data decryptability without provider use, captured-response connector behavior, and MCP authorization.
7. Delete and segregate rehearsal data/artifacts, record duration against the four-hour RTO, and release the operation lock without publishing a rehearsal backup as production.

### Phase 3: Freeze and cut over

1. Record AWS, GitHub, Cloudflare, SSM, monitoring, and Mac health; put watcher in `hold`; acquire the global operation lock and pause hourly backup.
2. Disable AWS jobs, scale MCP then API to zero, and wait for ECS running and pending counts to reach zero.
3. Verify zero active application database connections, open transactions, queued jobs, and background writers. Persisted login sessions remain stored. Only then declare the freeze.
4. Take final RDS snapshot and verified SSM logical dump from that frozen state.
5. Restore into an empty local database with roles, grants, sequences, extensions, and `ANALYZE`.
6. Start the exact AWS release; do not combine cutover with a new application release.
7. Verify counts, credentials, login, revisions, assets, callbacks, email, and a local mutation.
8. Apply the reviewed authoritative Cloudflare IaC root from AWS targets to Tunnel targets.
9. Verify HTTPS/HSTS, WAF/rate limits, sign-in, public revisions, mutation, MCP, email, and callbacks.
10. Upload the first post-cutover immutable backup, recovery manifest, offline attestations, and OCI archive; obtain an independent accepted checkpoint, confirm heartbeat, resume hourly backup, and release the operation lock.

### Phase 4: Frozen 72-hour window

Keep ECS at zero; retain RDS, snapshot, exact images, transfer procedure, and state; keep matching deadline-bound hold metadata on the Mac and GitHub deployment environment; monitor public synthetic checks, remote logs, and heartbeats; run an offsite restore with its recovery manifest; and make no destructive AWS/Cloudflare-state/escrow change. Bundles may publish to `production-candidate`; observation records them as deferred and they cannot deploy.

An urgent release requires an explicit choice to end simple AWS rollback after proving the post-write return path, or a schema-neutral forward fix. It is never unattended. After 72 healthy hours, remove the hold and deploy only the newest eligible monotonic successful protected-`main` bundle.

### Phase 5: Retire AWS

1. Reconcile live/Terraform drift and prove AWS state owns no production Cloudflare resource.
2. Preserve final snapshot and one downloaded logical backup through agreed retention.
3. Remove traffic resources through reviewed Terraform.
4. Remove GitHub AWS variables and disable OIDC deployment.
5. Remove root keys; retain only intentional least-privilege recovery access.
6. Remove SSM transfer resources.
7. Mark the AWS-return procedure expired and switch the authoritative disaster-recovery runbook to a replacement Mac, Linux VM, or VPS.
8. Clean-room restore the newest offsite database/recovery-manifest pair to that alternate target within the four-hour RTO.
9. Close AWS only after Cloudflare state recovery and alternate-host recovery succeed independently.

## Rollback

### Before a local write

Stop local writers, apply Cloudflare state back to AWS, scale API then MCP to one, re-enable and verify AWS schedulers/background jobs, and verify the frozen AWS revision. RDS remains authoritative.

### After local writes

1. Gracefully stop local writers, disable ingress, and prove the database frozen.
2. Upload a verified immutable backup.
3. Provision a genuinely empty compatible RDS instance/database for the logical import. A snapshot-restored instance is populated and cannot be used unless the target application database is explicitly dropped and recreated empty first. Never import over populated frozen RDS.
4. Through SSM, prove the target database has no application objects or rows, restore local data, apply roles/grants, run `ANALYZE`, and validate.
5. Point AWS secrets to the new endpoint; start compatible API then MCP; re-enable and verify schedulers/background jobs; verify revisions.
6. Apply the authoritative Cloudflare IaC root back to AWS.
7. Preserve original and returned RDS targets until resolution.

Alternatively, Cooper may explicitly discard identified local writes and return to frozen RDS. Record that decision and discarded interval before DNS changes.

The AWS procedures above are valid only while Phase 4/retained AWS prerequisites exist. After Phase 5 marks them expired, disaster recovery restores the authenticated offsite database/recovery-manifest pair to the tested alternate Mac/Linux/VPS target and repoints the authoritative Cloudflare IaC root.

Any disaster recovery from a non-final-frozen backup restores authentication data into a private recovery state. Before production ingress, invalidate every restored session, PAT, OAuth access/refresh token and authorization code, password/action/reset token, and other bearer or one-time credential, then require a fresh human login and provider reconnect as applicable. The final frozen cutover dump may preserve sessions because AWS writers were proven stopped before capture. Revocation safety takes precedence over session preservation for all older checkpoints.

## Verification gates

- `pnpm verify` passes.
- Compose has no secrets, builds, published DB ports, mutable tags, macOS-bound `PGDATA`, shared development resources, or excess service-network membership.
- The fully resolved Compose model passes the privilege, namespace, mount, socket, capability, secret-path, and service-specific allowlist.
- Provenance verifies for repository, workflow, branch, commit, release sequence, bundle, and image digests.
- Out-of-order workflows, failed newer HEAD, pointer races, forged tag/label, digest substitution, and failed candidates preserve the newest successful monotonic release.
- A delayed A release after newer failing B is attested from A's own successful protected-main run and reviewed workflow definition; no default-branch follow-on can substitute B's provenance.
- Direct and chained upgrades are accepted only when rollback evidence names the actual stable predecessor digest.
- Live before/after schema fingerprints match the manifest; mismatch enters writer-stopped `recovery-required`.
- PostgreSQL or `cloudflared` digest changes fail without an approved attested infrastructure rehearsal.
- Candidate-controller failure before and during every transition reactivates the recorded stable controller and coherent release before ingress.
- Stable and candidate controllers can parse every recovery-state version they may encounter; incompatible state writes are rejected before mutation.
- Normal deployments expose maintenance, never mixed API/MCP/web revisions.
- A valid bounded maintenance lease prevents expected probe paging without suppressing heartbeat, backup, revision-mismatch, or overrun alerts.
- Native images, the explicit `ilo-production` Colima profile, production-account LaunchAgent, AC sleep policy, and named Linux data volume pass.
- Local/public health reports expected revisions.
- Revision probes bypass caches, reject stale responses, and distinguish published, held/deferred, deploying, and stable status.
- Forged `X-Forwarded-For` or `CF-Connecting-IP` from every non-edge network cannot alter identity or limits.
- Required named Compose flows work; containers cannot reach prohibited IPv4 or IPv6 LAN address classes.
- `cloudflared` reaches only documented Tunnel endpoints on TCP/UDP 7844 and reconnects through tested QUIC/HTTP2 fallback.
- API/MCP shutdown drains requests/jobs and a forced MCP retry cannot duplicate a mutation.
- Idempotency replay, payload conflict, transaction rollback, concurrent duplicate, OAuth refresh/token replacement, and retention tests pass at the API boundary.
- Production-derived rehearsal is private, copied authentication records are purged, and provider HTTP/token refresh and all side effects are impossible.
- Non-final disaster recovery invalidates restored bearer and one-time credentials before ingress; final frozen cutover preserves sessions.
- Login, CRUD, MCP, credential decryption, callback, and email pass.
- Exact multi-level edge certificates, HTTPS redirect, HSTS, WAF, and edge rate limiting pass.
- Restore/deploy/backup lock exclusion proves no partial or rehearsal database can become the newest production backup.
- Hourly immutable backup/recovery-manifest pairing and missing-heartbeat alerts pass.
- GitHub/GHCR-offline recovery verifies archived OCI artifacts and attestation bundles from an independently witnessed accepted checkpoint.
- Continuous public synthetic probes and remotely retained correlated error logs pass.
- Weekly another-machine restore uses only offsite backup, recovery manifest, and escrow and meets the four-hour RTO.
- Accepted-checkpoint age stays within the one-hour RPO under long backup, lock contention, and witness-delay tests.
- Rollback passes for safe and unsafe migrations.
- Attended production-account reboot and sleep/wake need no post-login shell.
- Host-runtime drift and unattended restart-required upgrades are rejected; attended upgrade and alternate-host rollback rehearsals pass.
- Final snapshot/dump follow verified freeze.
- Both AWS return paths re-enable and verify scheduled/background jobs.
- Post-write AWS return proves a genuinely empty target before import.
- The complete Cloudflare IaC root and independent backend recover without AWS; old AWS Terraform cannot revert any edge resource.
- The Backblaze control plane, OpenTofu state, Compliance retention, least-privilege uploader, and clean-room credentials recover without the Mac, AWS, GitHub, or Cloudflare.
- After AWS retirement, a replacement Mac/Linux/VPS restores the latest compatible release and database within the RTO.

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
