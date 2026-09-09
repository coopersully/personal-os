# Attended nohmi Mac production cutover

Status: implementation and rehearsal in progress; this is **not a record of a live
cutover**. Follow the September 8 execution plan in `docs/superpowers/plans/`.
Do not use the August unattended-controller plan as the initial release gate.

## What runs where

The Mac also hosts Halara and other programs. Leave their services, ports, storage,
and Docker Desktop context alone. Production uses the `nohmi-production` macOS
account, its `nohmi-production` Colima profile, and an explicit socket. No production
container publishes a host port. Only Cloudflare Tunnel reaches the gateway; the
gateway routes the new nohmi app/API/MCP hostnames. PostgreSQL is on an internal
network and a named Linux volume. Application containers retain their existing
migrations and schedulers; starting API permits writes immediately.

The operator credential is the `personal-os-migration` AWS CLI profile, backed by
the non-root `personal-os-mac-migration` IAM user. Its managed policy is checked in
as `migration-operator-policy.json`. It has no IAM management or resource deletion
permission. Its access key does not automatically expire; revoke it after AWS
retirement. Keep it out of application environment files and production containers.
The Mac's default profile delegates to it; the separate `personal-os-bootstrap`
profile retains the expiring administrative login for provisioning only.

Cloudflare operator access uses the official `cloudflared tunnel login` flow and
the operator account's owner-only `~/.cloudflared/cert.pem`. This long-lived
credential can manage account tunnels and DNS routes for the authorized
`coopersully.me` zone; it is not an application credential. Revoke it through
Cloudflare's profile API-token settings when no longer needed. The dedicated
remotely managed tunnel is `nohmi-mac-mini-production`. Its separate `tunnel-token`
may run only that tunnel and must be the only Cloudflare credential mounted in
production. Never reuse or modify `halara-mac-mini`.

Preparing the tunnel's ingress configuration does not change DNS or publish the
application. The approved public origins are `https://nohmi.coopersully.me`,
`https://nohmi-api.coopersully.me`, and `https://nohmi-mcp.coopersully.me`.
These single-level names fit the zone's free Universal SSL wildcard; no Advanced
Certificate Manager subscription is needed. Verify actual TLS after provisioning
the new proxied tunnel CNAMEs. Preserve the old AWS DNS records for recovery; do
not claim old HTTPS URLs redirect to nohmi, because their multi-level names are
not covered by the free Cloudflare certificate.

`prepare` rewrites only the known old public origins in URL configuration and
origin allowlists, preserving callback paths, credentials, and the original AWS
export. It changes the email display name to nohmi but retains the existing verified
sender address/domain. Before activation, add the new Google and X callback URLs
to the existing provider applications without removing the old registrations.
Check any configured Plaid return URL, webhooks, and push audiences separately;
rewriting a local value does not change provider registrations. Existing provider
credentials and data remain intact; browser sessions and MCP connections must be
re-established at the new origins. Finish any in-flight OAuth attempt before the
writer freeze, or restart it after cutover.

All newly provisioned Mac runtime identities use `nohmi-production`: the macOS
account and home, Colima profile, runtime directory, and Compose project. The
operator must verify the actual account home before provisioning; do not create
an `ilo-production` account or reuse an old runtime configuration.

Existing database names, AWS resource names, package identifiers, MCP tool/resource
names, and the versioned `ilo-setup` artifact remain compatibility identifiers.
Renaming existing data or protocol identifiers is not part of the public rebrand.

## 1. Preserve and rehearse the database

Use a private directory outside Git for every export, dump, receipt, and key.
`aws.mjs` reads deployed ECS configuration and resolves referenced SSM parameters
without printing values. It also handles an intentionally or accidentally stopped
service; a stopped service is not evidence that all database writers are stopped.

```sh
node deploy/mac-mini/aws.mjs personal-os-migration /PRIVATE/aws-source.json
```

Install PostgreSQL 17 client tools, `age`, Colima, and the AWS Session Manager
plugin. Do not start Homebrew PostgreSQL or replace Docker Desktop. Open an attended
SSM remote-host port forward to the exact tagged tunnel instance and real RDS host.
Download the RDS CA bundle from AWS; the Dockerfile records its expected SHA-256.
Native libpq uses the RDS name with `PGHOSTADDR=127.0.0.1`, preserving hostname and
CA verification through the tunnel.

```sh
node deploy/mac-mini/rds-dump.mjs /PRIVATE/aws-source.json 17747 /PRIVATE/rds-ca.pem /PRIVATE/rehearsal.dump rehearsal
node deploy/mac-mini/rehearse.mjs /PRIVATE/rehearsal.dump /PRIVATE/new-rehearsal-result sha256:POSTGRES_IMAGE_ID FULL_TARGET_COMMIT /PRIVATE/aws-source.json
```

Replace all placeholders with inspected values. The rehearsal creates a uniquely
named, network-disabled database container and volume, records private counts and
timing, then deletes only that disposable container and volume. It never starts
API/MCP or calls providers. The restored schema, Drizzle ledger, locale/collation,
large objects, extensions, and representative encrypted records must be checked;
successful archive parsing alone is not sufficient. Compare source and target
row counts while the final source is frozen. Rehearse pending latest-code migrations
with the migration tool only, not API startup with real provider credentials.

The user approved using latest code for deployment; AWS application recovery is
not a prerequisite. RDS data and the existing encryption/provider keys are.

## 2. Prepare the permanent runtime

Provision the dedicated macOS account and Colima profile without touching other
services. Start with 4 GiB VM RAM / 2 CPUs; measure actual memory headroom with the
other services running. Use the console's normal privileged setup when required;
do not weaken account permissions to automate it. Record disk headroom and test
restart after logout/reboot with the intended login arrangement before cutover.

### Host startup and operator access

The attended host uses the existing `anchor` login to supervise Colima, which runs
as the non-admin `nohmi-production` account. The owner-approved sudoers rule grants
`anchor` password-free commands **only as `nohmi-production`**, not root or other
accounts. Verify with `sudo -n -H -u nohmi-production id`; `-H` selects the actual
production account home. Never place a macOS password in scripts or environment files.

`me.coopersully.nohmi.colima.plist` is the checked-in LaunchAgent configuration.
Install it in `/Users/anchor/Library/LaunchAgents/` and create its private log
directory `/Users/anchor/Library/Logs/nohmi-production` first. It starts the named
profile in the foreground with 2 CPUs, 4 GiB RAM, and a 24 GiB container-data disk.
Only `/Users/nohmi-production/nohmi-production` is mounted into the VM; SSH-agent
forwarding, host port forwarding, and automatic context switching stay disabled.
Release code and migration inputs live outside that mount, in the production
account's private `releases/` and `migration/` directories.

The Docker **client and Compose plugin** come from the already installed Docker
application; nohmi connects only to its Colima socket, never the Docker Desktop
engine. `docker-client.json` configures the plugin path in the new production
account's `.docker/config.json`. Do not overwrite an existing client configuration
or change the operator's shared Docker context. Keep `/usr/local/bin` in the
operator command PATH along with `/opt/homebrew/bin`.

Operate the supervisor as `anchor`:

```sh
launchctl bootstrap gui/501 /Users/anchor/Library/LaunchAgents/me.coopersully.nohmi.colima.plist
launchctl print gui/501/me.coopersully.nohmi.colima
launchctl bootout gui/501/me.coopersully.nohmi.colima
```

Verify the operator UID rather than assuming `501` on another host. Before
maintenance, unload the LaunchAgent and wait for Colima to stop; do not fight the
loaded supervisor by repeatedly stopping its VM. Unloading retains PostgreSQL's
Linux volume. Re-bootstrap to start it again. Already activated application
containers then follow their Docker restart policies.

This is **startup after operator login**, not a pre-login system daemon. A power
cycle still requires normal FileVault unlock and operator login. A tested
LaunchAgent stop/start is evidence of service recovery, not proof of a full host
reboot; record the full reboot/login rehearsal separately without interrupting
the Mac's unrelated services unannounced.

Build API/MCP/web from one recorded, clean full Git commit using the checked-in
Dockerfile and production `VITE_API_BASE_URL=https://nohmi-api.coopersully.me`. Label
images `org.opencontainers.image.revision` with that commit. `build.mjs FULL_COMMIT
/PRIVATE/new-images.json` automates clean committed-source extraction and all three
build targets (preserving source file read permissions). Inspect the built image
IDs; do not put mutable tags in runtime configuration. Pull and inspect immutable
PostgreSQL 17, nginx-unprivileged gateway, and cloudflared image digests. Match RDS
encoding/collation; select a compatible PostgreSQL image, not merely a matching
major version. Inspect application image labels against the recorded revision.

Create owner-only `config.json` (0600) in a private runtime directory (0700) ending
in `/nohmi-production`, outside every checkout. Its fields are:

```json
{
  "version": 1,
  "root": "/Users/nohmi-production/nohmi-production",
  "dockerHost": "unix:///Users/nohmi-production/.colima/nohmi-production/docker.sock",
  "revision": "FULL_40_CHARACTER_COMMIT",
  "postgresMajor": 17,
  "backupRecipient": "age1PUBLIC_RECIPIENT",
  "images": {
    "api": "sha256:IMAGE_ID",
    "mcp": "sha256:IMAGE_ID",
    "web": "sha256:IMAGE_ID",
    "postgres": "postgres@sha256:DIGEST",
    "gateway": "nginxinc/nginx-unprivileged@sha256:DIGEST",
    "tunnel": "cloudflare/cloudflared@sha256:DIGEST"
  }
}
```

```sh
node deploy/mac-mini/cli.mjs prepare /PRIVATE/config.json /PRIVATE/aws-source.json
node deploy/mac-mini/cli.mjs check /PRIVATE/config.json
node deploy/mac-mini/cli.mjs database /PRIVATE/config.json
```

`prepare` refuses to overwrite credentials. Raw Compose environment files preserve
literal `$` and `#` values. Keep the existing `APP_ENCRYPTION_KEY` unchanged.
Do not use `pnpm env:prod:start`: that mode is a live RDS writer, not this migration.

Configure a dedicated Cloudflare Tunnel and its 0600 `tunnel-token` file. All three
new hostnames route to `http://172.30.253.2:8080`, preserving Host. Confirm edge
certificate coverage for the single-level names, HTTPS redirects, and request limits
before changing DNS. Do not repurpose Halara's tunnel. Validate SMTP/IMAP, OAuth,
webhooks, MCP discovery/streaming, and background synchronization through the real
home-network path; a health endpoint cannot prove those capabilities.

## 3. Attended cutover

1. Freeze deployment automation and all AWS/external database writers. Record ECS
   desired counts and autoscaling settings; stop API/MCP and any local RDS runtime.
   Wait for tasks and SQL clients to drain. Preserve AWS resources and configuration.
2. Take the final dump with `rds-dump.mjs ... final-frozen`. This refuses other
   client connections, but the operator must also prevent writers restarting.
3. Restore into a **fresh empty** production database using `cli.mjs restore`.
   Compare counts, migration ledger, locale and encrypted-record recovery. The
   manifest hash and successful restore receipt must match. A rehearsal receipt
   cannot authorize production activation.
   The September 8 rehearsal found a skipped task-organization migration (the
   timestamp cursor had advanced through parallel Finance releases). Run
   `cli.mjs repair-tasks /PRIVATE/config.json --reconcile-skipped-task-migration`
   on the restored Mac copy before activation. This executes the unchanged,
   bounded `0073_task_organization_reconciliation` only for the known gap, records
   its actual execution in the ledger, and refuses contradictory history. It
   never edits a published migration, touches RDS, or starts application writers.
   A failed repair blocks activation until a successful retry/check.
4. `cli.mjs activate /PRIVATE/config.json --aws-writers-stopped`. This persists the
   local-write boundary before starting API and its migrations/schedulers. From this
   point, restoring the old AWS copy would lose new data.
5. `cli.mjs publish /PRIVATE/config.json`; provision the three new Cloudflare routes/DNS
   records as prepared. Verify actual TLS and routing, login/session, an attended
   create/edit/read operation, connectors, and public MCP. Record results privately.
6. Schedule encrypted offsite backups and missed-backup alerts, verify upload bytes,
   decrypt/restore an offsite copy, and test service restart. Keep AWS for at least
   72 healthy hours. No AWS deletion is implemented by these commands.

If a check fails before API activation, keep the Mac app stopped and restore the
recorded AWS writer/routing configuration. After activation, stop ingress/API/MCP,
dump the Mac database and preserve **all new writes**. Restore that dump into a new
compatible AWS recovery database before routing back; do not just restart stale RDS.
The return path must support the latest schema and app revision.

To recover a local encrypted backup, download its `.dump.age` and matching
`.dump.age.json` manifest into a private directory, then run:

```sh
node deploy/mac-mini/unseal.mjs /PRIVATE/backup.dump.age /PRIVATE/escrowed-age-key.txt /PRIVATE/new-recovery.dump
node deploy/mac-mini/cli.mjs restore /PRIVATE/recovery-config.json /PRIVATE/new-recovery.dump
```

Use a genuinely separate empty Docker engine/database (for example a fresh recovery
host, or a new isolated Colima home containing its own `nohmi-production` profile).
Never reuse the old production volume. Recovery manifests retain `mode: recovery`;
do not rename them to `final-frozen`. After verifying data and stopping every old
writer, recovery activation requires `--previous-writers-stopped`, not the AWS
cutover acknowledgement. Do not activate an old backup while a newer live database
still contains unpreserved writes. `rehearse.mjs` also accepts recovery backups;
its optional final argument is an age identity path for exercising local
backup/encryption/decryption before a second empty-target restore.

## Operations and remaining gates

`status` is read-only. `start` requires previous activation; `stop` selects exact
project/root/service Docker labels and does not require working release files or
images. It retains the database. `backup` accepts an activated or successfully
restored database and creates an age-encrypted custom-format dump and hash manifest,
removing its temporary plaintext dump. It currently creates a **local** backup only.
Offsite upload, retention, key escrow, hourly scheduling, missed-backup alerting,
and an offsite restore are still operational gates, not completed capabilities.
Escrow the age private key and an encrypted provider-configuration export outside
this Mac; the database alone cannot recover encrypted OAuth credentials.

Operations share an exclusive lock. After a crash, inspect `operation.lock` and
confirm its process is gone before removing that exact lock. Never purge a populated
production volume to retry restore. Use a separate recovery runtime. Deployment
updates and schema changes remain attended, with a fresh backup and rollback plan.

Run `pnpm test:mac-production` and `pnpm verify`. Tests are implementation evidence,
not proof of Cloudflare authority, public certificates, real callbacks, startup
recovery, or offsite restore. Record each live gate separately.
