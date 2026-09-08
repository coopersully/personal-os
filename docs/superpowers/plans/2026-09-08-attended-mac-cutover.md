# Attended Mac production migration

Approved execution scope: September 8, 2026. This supersedes the August 23 plan's
requirement to finish unattended deployment infrastructure before cutover.

The Mac is shared with other always-running services. Use a separate production
account and Colima socket, bounded resources, and an ilo-only Compose project.
Keep application behavior unchanged. The user subsequently approved deploying the
latest code rather than repairing the old AWS application; preserve the database
and provider/encryption configuration. Rehearse any latest-code migrations on an
isolated copy before activation.

The user approved free Cloudflare hosting with new nohmi public origins:
`nohmi.coopersully.me`, `nohmi-api.coopersully.me`, and
`nohmi-mcp.coopersully.me`. This supersedes preserving the old public hostnames.
Rebrand user-facing metadata and the tunnel label, but retain compatibility tool,
resource, database, package, and runtime ownership identifiers. Add provider callback
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
- [ ] Prepare certificates, offsite storage, production account, and dedicated runtime.
- [x] Rehearse database export/restore and decrypt restored provider credentials.
- [x] Rehearse the known skipped-task reconciliation and latest pending SQL on a copy.
- [ ] Measure final attended freeze/transfer downtime and compare frozen-source data.
- [ ] Freeze AWS writers and deployment automation, transfer the final database,
      activate the Mac, publish the new nohmi hostnames, and verify public behavior.
- [ ] Retain AWS recovery resources for at least 72 healthy hours, then retire them
      only after offsite recovery has been demonstrated.

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
backups, a tested restore, external health alerts, and the post-write return procedure
remain required. No one-hour recovery guarantee is claimed without measured backup
and upload timing and an alert for missed backups.

Local files and automated tests prove implementation, not live credentials,
certificates, callback delivery, offsite upload, startup after login, or data migration.
Record those outcomes in the runbook when exercised; do not check off operational
steps merely because their scripts exist.
