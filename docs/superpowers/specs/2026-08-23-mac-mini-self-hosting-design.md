# Mac Mini Self-Hosting and AWS Cutover Design

**Status:** Proposed for implementation  
**Date:** 2026-08-23  
**Owner:** Cooper  
**Repository:** `coopersully/personal-os`

## Summary

Move ilo production from AWS ECS, RDS, ALB, WAF, S3, and CloudFront to the
always-on Mac Mini. Preserve the existing public hostnames and automatic
deployment after CI succeeds on `main`. Optimize for a single-user service,
fast cutover, simple recovery, and low recurring cost rather than high
availability or zero-downtime deployment.

The Mac Mini will run the existing Linux containers in a Docker-compatible
Linux VM. Cloudflare Tunnel will provide public ingress without exposing the
home network. GitHub-hosted Actions will publish immutable multi-architecture
images to GHCR. A fixed pull-based watcher on the Mac will notice a new
production image and run a local deployment script. PostgreSQL will run beside
the application and will be protected by local and encrypted offsite backups.

AWS will remain stopped but recoverable for 72 hours after cutover. It will be
decommissioned only after the local deployment, reboot recovery, backup, and
restore paths have all passed.

## Goals

- Serve `app.ilo.coopersully.me`, `api.ilo.coopersully.me`, and
  `mcp.ilo.coopersully.me` from the Mac Mini.
- Deploy every successful `main` commit without interactive access to the Mac.
- Add no inbound router port forwarding and require no static residential IP.
- Preserve production data, sessions, connected-account credentials, OAuth
  callbacks, and public URLs.
- Provide deterministic health checks, image rollback, database backup, and a
  documented return-to-AWS procedure.
- Make the complete setup executable by Codex on the Mac Mini from repository
  documentation and checked-in scripts.
- Remove the steady-state AWS application cost after the recovery window.

## Non-goals

- Zero downtime, blue/green deployment, clustering, or automatic failover.
- More than one API replica or one MCP replica.
- Kubernetes or a self-hosted platform control plane.
- Running pull-request jobs on the production Mac.
- Removing every AWS resource during initial cutover.
- Changing application behavior, public APIs, domain packages, or database
  schema as part of the hosting migration.

## Constraints and assumptions

- Cooper is the only production user and accepts a maintenance window.
- The Mac Mini normally remains powered on and has adequate memory and storage.
- The repository remains public.
- The Mac has outbound HTTPS access to GitHub, GHCR, Cloudflare, provider APIs,
  Resend, and the selected offsite backup store.
- The existing production hostnames remain unchanged, so registered OAuth
  callback URLs and desktop builds do not need to change.
- Production migrations continue to follow the append-only,
  expand-migrate-contract policy in `docs/engineering/database-migrations.md`.

## Decisions

### 1. Use the existing containers through a Docker-compatible Linux VM

The production deployment will continue using the root `Dockerfile`. On Apple
Silicon, the release workflow will publish `linux/arm64` images; it will also
publish `linux/amd64` images so the deployment remains portable and works on an
Intel Mac Mini.

The bootstrap process may reuse an existing healthy Docker-compatible runtime.
If none exists, it will install Colima with Docker and Docker Compose. The
chosen runtime is acceptable only after an unattended reboot test proves that
the VM and all ilo services recover without manual shell commands. This keeps
the repository independent of a specific macOS container UI while selecting
Colima as the default implementation.

### 2. Keep GitHub execution off the production Mac

The public repository will not register the Mac Mini as a GitHub Actions
self-hosted runner. GitHub-hosted Actions will run CI and build images. The Mac
will run only fixed, locally installed deployment code and the released
containers selected by the production tag.

This preserves immediate deployment without allowing forked pull-request jobs
to execute on a production machine containing application secrets and data.

### 3. Publish immutable images and use one image tag as the release pointer

GitHub Actions will publish these packages to GHCR for each successful `main`
commit:

- `ghcr.io/coopersully/personal-os-api:sha-<commit>`
- `ghcr.io/coopersully/personal-os-mcp:sha-<commit>`
- `ghcr.io/coopersully/personal-os-web:sha-<commit>`

Each image will include the OCI revision label containing the full commit SHA.
After all three immutable images are available, the workflow will move the API
image's `production` tag last. That tag is the atomic release pointer. The Mac
watcher pulls it, reads the revision label, confirms that all three matching
immutable images exist, and deploys only that complete set.

The packages should be public because the source repository is public. If they
remain private, the Mac will use a read-only package credential stored locally;
no write-capable GitHub credential will be placed on the server.

### 4. Use Cloudflare Tunnel as the only public ingress

A remotely managed Cloudflare Tunnel will route the existing three hostnames to
the internal web, API, and MCP container ports. `cloudflared` will run as part
of the production Compose project and share only its internal network.

No PostgreSQL, API, MCP, web, Docker, SSH, or deployment port will be published
to the router or public internet. Production Compose will not expose PostgreSQL
to the LAN. Administrative access to the Mac remains outside this design.

Cloudflare will terminate TLS and provide edge filtering and rate limiting.
`TRUST_PROXY` and `MCP_TRUST_PROXY` will be enabled only because Cloudflare
Tunnel is the declared trusted edge. The application-level authentication and
MCP rate limits remain enabled.

### 5. Run PostgreSQL locally and make offsite restoration a release gate

PostgreSQL 17 will run in the Compose project with a dedicated persistent
volume and a generated production password. The database will not be reachable
outside the internal container network.

Before each deployment, the deployment script will create a compressed logical
backup with `pg_dump`. A separate scheduled job will create at least one daily
backup. Backups will be encrypted and copied to an S3-compatible offsite store.
The first cutover cannot proceed until a backup created on the Mac has been
restored successfully into a disposable database and verified.

Retention defaults:

- seven successful pre-deploy or daily backups on the Mac;
- thirty daily backups in the offsite store; and
- the final RDS snapshot retained through AWS decommissioning.

Backup failure blocks application deployment. A failed upload may be retried,
but the deploy cannot continue merely because a local dump exists.

### 6. Store secrets only on the Mac

Production secrets will live in a root- or service-user-owned environment file
outside the repository. The file will be readable only by the account that
runs the deployment. GitHub Actions will receive build-time public values only,
such as `VITE_API_BASE_URL`; it will not receive database, OAuth, encryption,
email, or MCP shared secrets.

The existing production `APP_ENCRYPTION_KEY` must be copied unchanged so ilo
can continue decrypting stored connected-account credentials. OAuth client
secrets and the email credential will also be preserved initially. The local
database password and Cloudflare Tunnel token will be new. The
`MCP_INTERNAL_SECRET` may be rotated during cutover as long as API and MCP
receive the same value.

## Components and repository changes

Implementation is expected to add or change the following boundaries. Exact
task ordering and tests will be defined in the implementation plan.

### Release workflow

`.github/workflows/deploy.yml` will retain its current `workflow_run` trigger
after successful CI on `main`, immutable commit selection, concurrency guard,
and public health verification. AWS OIDC, ECR, ECS, S3, and CloudFront steps
will be replaced by multi-architecture GHCR build and publish steps.

Before enabling unattended production deployments, `main` will receive a
GitHub ruleset that requires the existing CI checks and prevents force pushes.
This is an external repository setting and must be recorded in the runbook.

### Production Compose definition

`compose.production.yaml` will define:

- PostgreSQL with a health check and persistent volume;
- API with readiness checks and production-only configuration;
- MCP, starting only after the API is ready;
- the immutable web image; and
- `cloudflared`, with access only to the internal application network.

It will reference image names and one `RELEASE_SHA` supplied by the deploy
script. It will not contain `build:` entries, development passwords, published
database ports, or secret values.

### Mac deployment scripts

Files under `deploy/mac-mini/` will have narrow responsibilities:

- `bootstrap.sh`: validate architecture, container runtime, disk capacity,
  required commands, runtime directories, and auto-start support;
- `watch.sh`: serialize checks for a changed production image and invoke the
  deployer;
- `deploy.sh`: validate the release set, back up the database, update Compose,
  sequence services, run health checks, record success, and roll back images on
  failure;
- `backup.sh`: create, verify, encrypt, upload, and expire database backups;
- `restore.sh`: restore an explicitly named backup into an empty target and
  refuse accidental overwrite;
- `verify.sh`: test local and public web, API, MCP, database, and tunnel health;
  and
- launchd definitions: start the container runtime, stack, watcher, and daily
  backup after reboot.

State will live outside the checkout in a dedicated deployment directory and
will include the current SHA, previous successful SHA, Compose environment,
deployment logs, and backup metadata. Scripts will use an exclusive lock so a
scheduled check cannot overlap an active deployment.

### Operations runbook

`docs/deployment/mac-mini.md` will document bootstrap, secrets, deployment,
logs, health checks, backup/restore, reboot recovery, manual rollback, AWS
return, Cloudflare routing, and eventual AWS removal.

The runbook will explicitly state which steps run on the development Mac, which
run through AWS, and which run on the Mac Mini so Codex does not operate on the
wrong host.

## Deployment flow

1. A commit lands on `main`.
2. The existing CI workflow completes successfully.
3. The release workflow builds all three architectures/images from the exact
   successful SHA and pushes immutable tags.
4. The workflow moves the API `production` tag only after all images exist.
5. The Mac watcher notices the new production image within 30 seconds.
6. The deployer obtains a lock, validates the image revision, pulls the full
   release, and confirms adequate free disk space.
7. The deployer completes and uploads a PostgreSQL backup.
8. Compose replaces the API first. API startup applies pending migrations and
   readiness proves database connectivity.
9. Compose replaces MCP and web, then checks local health.
10. The deployer checks all three existing public hostnames through Cloudflare.
11. On success it records the new current and previous SHAs and prunes only
    unreferenced images older than the rollback window.

The target is for local deployment to begin within 30 seconds of image
publication. Completion time depends on image pulls, backup upload, and
migrations. Total merge-to-production time remains bounded primarily by CI and
image builds, not by the Mac watcher.

## Deployment failure handling

- A build or publish failure leaves the `production` tag unchanged.
- A missing image, revision mismatch, backup failure, low disk condition, or
  active deployment lock prevents any service replacement.
- If API readiness fails, the deployer restores the previous API image and
  leaves MCP and web unchanged.
- If MCP, web, or public verification fails after API succeeds, all application
  images revert to the previous SHA.
- Database contents are not automatically restored during image rollback.
  Automatic application rollback is allowed only under the repository's
  backward-compatible migration policy.
- Every failure exits nonzero, writes a durable local log, and leaves the prior
  successful SHA recorded. Initial implementation may use GitHub deployment
  status or email for notification; lack of notification does not change
  rollback behavior.

## Cutover approach

Downtime is acceptable, so cutover will favor an explicit write freeze over
dual-write, replication, or blue/green database infrastructure.

### Phase 1: Prepare and prove the Mac

1. Bootstrap the container runtime and production deployment directory.
2. Install production secrets, preserving `APP_ENCRYPTION_KEY`.
3. Create the Cloudflare Tunnel and temporary validation hostnames.
4. Deploy the currently running production SHA to the Mac with an empty or
   disposable database.
5. Verify local and tunneled web/API/MCP health, outbound provider access,
   restart behavior, log rotation, and disk monitoring.
6. Produce an encrypted offsite backup and restore it successfully into a
   disposable database.
7. Reboot the Mac and prove that the runtime, database, application, tunnel,
   watcher, and scheduled backup recover without an interactive command.

### Phase 2: Prove production data migration

1. Create an RDS snapshot.
2. Copy a non-final production dump to the Mac without stopping AWS.
3. Restore it into the local PostgreSQL volume.
4. Start the currently deployed application SHA and verify owner login, core
   record counts, encrypted connected-account data, connector reads, and MCP
   authorization.
5. Delete the rehearsal database and document measured dump/restore duration.

RDS is private. For the fastest controlled transfer, temporarily make the RDS
instance publicly reachable only from the Mac Mini's current public `/32`
address, require TLS, take the dump, and immediately return RDS to private
access. The security-group and RDS changes must be recorded and reversed in the
same procedure. If that constrained route cannot be established safely, use a
temporary SSM-managed EC2 transfer host; do not broadly expose PostgreSQL.

### Phase 3: Final write freeze and DNS cutover

1. Record AWS, GitHub, Cloudflare, and Mac health before making changes.
2. Create a final manual RDS snapshot.
3. Scale AWS MCP to zero, then AWS API to zero, establishing the write freeze.
4. Create and verify the final compressed PostgreSQL dump.
5. Restore the final dump into an empty local production database.
6. Start the exact SHA that was running on AWS; do not combine infrastructure
   cutover with a new application release.
7. Verify database counts, owner login, API readiness, MCP authorization,
   application assets, and connector credential decryption locally.
8. Replace the three Cloudflare DNS routes with Tunnel routes while preserving
   the existing hostnames.
9. Verify all public surfaces, sign-in, one representative mutation, MCP read,
   transactional email, and provider callback reachability.
10. Create and upload the first post-cutover local backup.
11. Mark the local deploy watcher active and keep AWS writers at zero.

### Phase 4: Recovery window and AWS retirement

For 72 hours:

- keep ECS services at zero;
- retain RDS, its final snapshot, ECR images, and Terraform state;
- monitor public uptime, tunnel health, disk use, logs, backup uploads, and one
  daily restore check; and
- avoid destructive AWS or Terraform changes.

After 72 healthy hours:

1. Reconcile the known difference between checked-in Terraform and live ECS
   networking before applying or destroying anything.
2. Preserve the final RDS snapshot and one independently downloaded logical
   backup.
3. Remove application traffic resources in dependency order through reviewed
   Terraform changes.
4. Remove obsolete GitHub AWS deployment variables and disable the AWS OIDC
   deployment role.
5. Remove or deactivate any root AWS access keys and make a named least-
   privilege identity the only routine local profile.
6. Retain only intentionally selected backup/storage resources, or close AWS
   entirely after verifying the offsite provider.

## Cutover rollback

### Before the first local write

Route the three hostnames back to the existing AWS targets and scale API and MCP
back to one. No database synchronization is required because RDS remains the
source of truth.

### After local writes begin

1. Stop the local MCP and API to freeze writes.
2. Back up the local PostgreSQL database.
3. Restore that backup to RDS through the same tightly restricted transfer
   route, verifying schema compatibility first.
4. Start AWS API, then MCP, and verify health.
5. Route Cloudflare DNS back to CloudFront and the ALB.

Because Cooper is the only user, rollback may instead discard explicitly
identified test-only local writes and return to the frozen RDS state. The
operator must choose and record whether local writes are preserved before
changing DNS back.

## Verification gates

Implementation and cutover are incomplete until all of these pass:

- repository lint, type checking, tests, builds, and E2E through `pnpm verify`;
- production Compose configuration validation with no secret values committed;
- native image execution on the Mac Mini architecture;
- local API readiness, MCP liveness, and web health;
- public health through all three Cloudflare hostnames;
- owner sign-in and one representative create/read/update flow;
- MCP OAuth/token use and one representative tool call;
- production credential decryption for an existing connected account;
- transactional email delivery;
- successful offsite backup and clean-room restore;
- failed-release image rollback rehearsal;
- full Mac reboot recovery without manual commands; and
- documented AWS return procedure tested before AWS destruction.

## Risks accepted for the single-user phase

- The Mac, local disk, home power, and internet connection form one availability
  zone.
- In-place API replacement can cause a short outage.
- Database restoration is manual and slower than RDS point-in-time recovery.
- Cloudflare is both DNS and production ingress.
- A malicious commit merged to `main` can still publish a malicious production
  container. Required CI and branch protection reduce accidental deployment but
  do not replace review of privileged workflow changes.

These risks are proportionate for one owner and can be revisited if ilo gains
additional users or availability requirements.
