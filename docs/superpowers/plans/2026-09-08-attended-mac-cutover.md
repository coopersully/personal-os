# Attended Mac production migration

Approved execution scope: September 8, 2026. This supersedes the August 23 plan's
requirement to finish unattended deployment infrastructure before cutover.

September 9 scope update: the sole user explicitly deferred offsite backups and
requested immediate attended cutover with preserved data. Offsite storage, key
escrow, and backup alerting no longer gate initial activation. Retain the local
final migration dump and provider configuration, and leave AWS recovery resources
intact during the switch. This accepts that local copies cannot recover from loss
of the Mac; no offsite recovery guarantee is made.

The Mac is shared with other always-running services. Use a separate production
account and Colima socket, bounded resources, and a nohmi-only Compose project.
The created account is `nohmi-production`, with home `/Users/nohmi-production`.
Use `nohmi-production` for its Colima profile, runtime directory, and Compose
project as well; verify the actual host account before provisioning.
Keep application behavior unchanged. The user subsequently approved deploying the
latest code rather than repairing the old AWS application; preserve the database
and provider/encryption configuration. Rehearse any latest-code migrations on an
isolated copy before activation.

The user approved free Cloudflare hosting with new nohmi public origins:
`nohmi.coopersully.me`, `nohmi-api.coopersully.me`, and
`nohmi-mcp.coopersully.me`. This supersedes preserving the old public hostnames.
Rebrand user-facing metadata and the tunnel label, but retain compatibility tool,
resource, database, and package identifiers. Add provider callback
registrations before activation and require browser/MCP reconnection at the new URLs.
Do not purchase Advanced Certificate Manager.

## Delivery sequence

- [x] Fetch current main and create an isolated migration branch.
- [x] Implement production Compose generation and explicit start/stop/inspect commands.
- [x] Implement local encrypted backup and empty-target restore, with behavioral tests.
- [x] Implement safe deployed-configuration export and release identity inspection.
- [ ] Document and rehearse provisioning, startup, restore, and cutover.
- [x] Verify the branch, build the release, and exercise the isolated synthetic stack.
- [x] Obtain live AWS access and verify the deployed task-definition release.
- [x] Obtain persistent Cloudflare access and verify tunnel/DNS authority.
- [x] Prepare certificates, production account, and dedicated runtime (offsite storage deferred).
- [x] Rehearse database export/restore and decrypt restored provider credentials.
- [x] Rehearse the known skipped-task reconciliation and latest pending SQL on a copy.
- [x] Record final transfer timing and compare frozen-source data: all 89 relations match.
- [x] Freeze AWS writers and deployment automation, transfer the final database,
      activate the Mac, publish the new nohmi hostnames, and verify public HTTPS health.
- [ ] Complete authenticated browser acceptance at the new public origin.
- [ ] Retire retained AWS resources after an explicit recovery/data-retention decision;
      offsite recovery is deferred, not silently satisfied.

## Initial operating contract

Deployments are attended. The existing API performs migrations and scheduled work
on startup. Starting it against the restored database immediately crosses the local
write boundary, even before a human mutation or DNS switch. Rehearsal uses database
tools only on production-derived data; application testing uses disposable data.
Never start a second application against live RDS through `env:prod:start`.

Backup, restore, and activation share a local operation lock. Interrupted restore
cannot authorize application startup. Restore refuses a populated target; no
command silently drops production data. Keep the encryption key and complete
provider configuration unchanged, including optional Google signals, Plaid, X,
and Twilio values from the actual deployed ECS task.

Ordinary Docker restart policies are acceptable for an activated release. Before
restore or maintenance, explicitly stop services (which suppresses their restart)
and verify no other writer exists. Keep database storage in a Linux named volume.

Deferred: a custom unattended deployment controller, signed infrastructure approval
machinery, the independent Hetzner witness, the automatic release watcher, generic
idempotency changes, and migration/scheduler process separation. These are follow-up
improvements, not evidence that this first cutover is ready. Hourly encrypted offsite
backups, an offsite restore, and external alerts were originally required but are
deferred by the September 9 owner instruction. The post-write return procedure
remains required. No one-hour recovery guarantee is claimed without measured backup
and upload timing and an alert for missed backups.

Local files and automated tests prove implementation, not live credentials,
certificates, callback delivery, offsite upload, startup after login, or data migration.
Record those outcomes in the runbook when exercised; do not check off operational
steps merely because their scripts exist.
