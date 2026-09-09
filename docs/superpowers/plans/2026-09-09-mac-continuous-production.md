# Mac continuous production implementation plan

Owner request: verify host recovery, retire nohmi AWS infrastructure, and deploy
automatically after merges to main. The owner has explicitly authorized autonomous
execution and deferred offsite backups. Preserve unrelated Mac/AWS services.

## Design

Use the existing dedicated `nohmi-production` Colima engine, persistent PostgreSQL
volume and Cloudflare Tunnel. No static public IP or router ingress is required.
The observed Mac setup has sleep disabled, power-failure restart enabled, FileVault
off and automatic `anchor` login, which starts the existing LaunchAgent supervisor.
Do not change disk encryption or other programs to achieve this.

The public repository should not attach an unrestricted self-hosted Actions runner
to production. An outbound-only local controller polls public `main` and its exact
successful push CI run. No GitHub credential is required. Builds use committed source
and the dedicated Docker socket while the previous release remains live. Recheck
main before switching, then use the existing writer stop/start and operation lock.
Keep secrets, database identity, gateway/tunnel configuration and ancillary images
unchanged. An update may change only API/MCP/web image IDs and their release revision.
Never restore the database or automatically roll back schema after failed startup.

Health recovery shares the maintenance lock. Recover running unhealthy API/MCP
containers with bounded retries and cooldown; process exits already use Docker
restart policies. A persistent maintenance flag prevents recovery from undoing an
intentional stop. Save private status and bounded logs; a killed controller must
not race an orphan build/deploy, nor silently repeat a failed write-boundary action.

## Execution

- [ ] Add behavior tests for exact-main/successful-push-CI eligibility, no downgrade,
  stale candidate rejection, build failure leaving the old release running,
  serialized writes, preserved secrets/DB, interrupted switch recovery, maintenance,
  and bounded unhealthy-container recovery.
- [ ] Implement and test the controller in `deploy/mac-mini`, using existing
  `commands.mjs`, `compose.mjs`, `safety.mjs` and `build.mjs` rather than a second
  production runtime. Install stable controller code outside the user's checkout.
- [ ] Add a supervised LaunchAgent using the existing scoped `sudo -u nohmi-production`
  access. Poll at most once per minute; GitHub CI checks must avoid anonymous rate
  limits, back off on failures, and never execute pull-request code.
- [ ] Run focused tests, `pnpm verify`, and an independent code review. Publish via
  a PR; never push directly to main. Exercise a real successful main-CI deployment.
- [ ] Verify live public endpoints, process recovery, and PostgreSQL identity/data
  retention. Record the distinction between tested service recovery and an untested
  full physical reboot. Verify static LAN reservation separately, without guessing
  an unused address or disturbing unrelated services.
- [ ] Inventory exact AWS resources, privately preserve configuration/state and the
  final data copies, and retire only confirmed nohmi resources in dependency order.
  Preserve Cloudflare email/DKIM/SPF/DMARC records, provider applications, the live
  nohmi tunnel/DNS, and shared/account-wide resources absent separate authority.
- [ ] Verify remaining AWS resources and ongoing charges honestly; update current
  deployment docs and the operating runbook with evidence and any residual actions.
