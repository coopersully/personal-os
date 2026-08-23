# Mac Mini Self-Hosting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ilo production from AWS to the Mac Mini with automatic, provenance-verified deployment after a successful `main` merge, an hourly immutable-backup RPO, deterministic crash recovery, and a tested AWS return window.

**Architecture:** GitHub-hosted Actions build and attest digest-pinned multi-architecture images and a release bundle. A fixed launcher on the Mac verifies that bundle and invokes its versioned controller. The controller serializes backup, migration, deployment, validation, rollback, and recovery through durable state before Cloudflare Tunnel exposes the release. PostgreSQL lives in a dedicated Colima named volume; encrypted logical backups are copied to FileVault storage and immutable Backblaze B2 storage.

**Tech Stack:** TypeScript 5.8, Node.js 22, Hono, Drizzle/PostgreSQL, Vitest/Testcontainers, Docker Buildx/Compose, GitHub Actions/GHCR artifact attestations, Colima/Lima, launchd, Cloudflare Tunnel, OpenTofu, Backblaze B2, AWS SSM Session Manager.

**Spec:** [`docs/superpowers/specs/2026-08-23-mac-mini-self-hosting-design.md`](../specs/2026-08-23-mac-mini-self-hosting-design.md)

## Global Constraints

- Execute in a fresh `cooper/mac-mini-self-hosting` worktree based on current `main`. Preserve and reconcile the existing uncommitted local-runtime/config work; do not overwrite it.
- Keep `compose.yaml` for development. Production uses `compose.production.yaml`, project name `ilo-production`, and an explicit `DOCKER_HOST` for the `ilo-production` Colima profile.
- Do not edit an already published migration. Current `main` ends at `0065_finance_period_reviews.sql`. At execution time, rebase before generating `0066_mac_deployment_idempotency.sql`; if `main` has advanced, allocate the next journal number and update this plan's expected filename in the implementing commit.
- Never store production secrets, Tunnel credentials, Backblaze credentials, database dumps, recovery keys, Terraform/OpenTofu state, or deployment state in Git.
- Do not place a GitHub Actions runner or any write-capable GitHub credential on the Mac.
- Preserve the existing `quiesce-v1` API lifecycle and deployment-drain contract. Extend `apps/api/src/runtime-lifecycle.ts` rather than replacing it.
- Treat `.codex/scripts/production-runtime.mjs` and `infra/local-production-runtime.tf` as reusable RDS-access/rehearsal foundations, not as the final self-hosted production supervisor or Compose stack.
- Each task is independently reviewable. Run its focused tests before committing. Run `pnpm verify` at the integration gates in Tasks 5, 9, 13, and 17.
- Pin image references by manifest digest and GitHub Actions by full commit SHA before merging. Version tags in snippets are explanatory locators, not the final trust boundary.
- Any production-changing command in Tasks 14–17 requires Cooper to be present, a current accepted offsite checkpoint, and the global operation lock.

## File Map

| Area | Existing files changed | New files |
| --- | --- | --- |
| Runtime identity and drain | `apps/api/src/{app,config,main,runtime-lifecycle,types}.ts`, `apps/api/src/runtime-lifecycle.test.ts`, `apps/api/tsup.config.ts`, `apps/mcp/src/http.ts`, `apps/mcp/tsup.config.ts`, `Dockerfile`, `infra/compute.tf`, CI/deploy workflows | `apps/api/src/{deployment-mode,migrate,scheduler}.ts`, mode/scheduler tests, `apps/mcp/src/runtime.ts` |
| Retry safety | `packages/database/src/schema.ts`, migration journal, `apps/api/src/{auth-service,oauth-service,types}.ts`, all agent-facing API routes/services, `packages/api-client/src/**`, `apps/mcp/src/**` | migration `0066_mac_deployment_idempotency.sql`, `apps/api/src/idempotency.ts` and tests |
| Production packaging | `Dockerfile`, `.dockerignore`, `.env.example`, root scripts | `compose.production.yaml`, `deploy/mac-mini/compose-policy.json`, validation scripts/tests, `deploy/mac-mini/nginx.conf` |
| Release pipeline | `.github/workflows/{ci,deploy}.yml` | `.github/workflows/required-ci.yml`, `scripts/release/**`, release schemas/fixtures/tests |
| Mac controller | none | `deploy/mac-mini/{bootstrap,launcher,watch,deploy,reconcile,rollback}.sh`, `deploy/mac-mini/controller/**`, LaunchAgents, runtime manifest |
| Backup and recovery | none | `deploy/mac-mini/{backup,restore,credential-reset}.sh`, `infra/backup/**`, `infra/witness/**`, backup/OCI schemas, tests, and runbooks |
| Edge ownership | `infra/dns.tf`, `infra/waf.tf`, root outputs/state docs | `infra/cloudflare/**` with independent backend/import/recovery docs |
| AWS transfer/cutover | `infra/local-production-runtime.tf`, `.codex/scripts/production-runtime.mjs`, existing AWS deploy workflow | `deploy/mac-mini/{rds-inspect,rds-transfer}.sh`, cutover/rollback/retirement runbooks |
| Monitoring and rehearsal | API/MCP health tests | `deploy/mac-mini/{probe,witness,rehearse}.sh`, synthetic/restore workflows, fault fixtures |

## Execution Order

1. Tasks 1–5 establish deploy-safe application behavior and must land first.
2. Tasks 6–9 build the production artifact chain and crash-safe controller.
3. Tasks 10–13 establish recovery, independent edge ownership, host isolation, and external observation. Tasks 10–12 may proceed independently after Task 7, but all must finish before Task 13's integrated rehearsals.
4. Tasks 14–15 produce the database-transfer path and executable operating procedures.
5. Task 16 is the no-traffic-moving dress rehearsal. Task 17 is the only production cutover/retirement task.

---

### Task 1: Establish deployment identity and runtime-mode contracts

**Files:**
- Create: `packages/domain/src/deployment.ts`
- Create: `packages/domain/src/deployment.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `Dockerfile`
- Modify: `infra/compute.tf`
- Modify: `.github/workflows/{ci,deploy}.yml`
- Create: `scripts/run-with-build-revision.mjs`
- Create: `scripts/run-with-build-revision.test.mjs`
- Modify: `package.json`

- [ ] Write failing tests for three modes (`candidate`, `active`, `rehearsal`), full 40-character lowercase commit revisions, Mac production rejection when `DEPLOYMENT_MODE_FILE` is absent, and transition-AWS rejection when immutable `BUILD_REVISION` or explicit `DEPLOYMENT_MODE=active` is absent.

```ts
expect(deploymentModeSchema.parse("candidate")).toBe("candidate");
expect(buildRevisionSchema.safeParse("abc").success).toBe(false);
expect(() => loadConfig(awsTransitionEnv({ BUILD_REVISION: undefined }))).toThrow();
```

- [ ] Run `pnpm vitest run packages/domain/src/deployment.test.ts apps/api/src/config.test.ts` and confirm the new assertions fail.
- [ ] Implement exported schemas/types and add `buildRevision`, `deploymentMode`, `runtimeTopology`, and `deploymentModeFile` to `AppConfig`. Mac production requires the mode file. During the dual-deploy window only, ECS uses explicit `DEPLOYMENT_MODE=active` and `RUNTIME_TOPOLOGY=combined`; no implicit active default is allowed.
- [ ] Thread the exact event SHA through API/MCP/web Docker build arguments, Vite, CI builds, `.github/workflows/deploy.yml`, and the ECS task definition in `infra/compute.tf` before enforcing the new requirements. Add contract tests proving the live AWS transition task and web artifact report that SHA.
- [ ] Add the cross-platform `run-with-build-revision.mjs` wrapper used by `pnpm check`, `pnpm verify`, and documented local build commands. It supplies the exact `git rev-parse HEAD` SHA only for local verification, records whether the tree is dirty, refuses dirty production/release builds, and never overrides a CI-provided SHA. Test clean, dirty, detached, missing-Git, and caller-provided cases.
- [ ] Re-run the focused tests and `pnpm --filter @personal-os/api typecheck`.
- [ ] Commit: `feat: define production deployment runtime contracts`.

### Task 2: Split migration, scheduler, and HTTP lifecycles

**Files:**
- Create: `apps/api/src/deployment-mode.ts`
- Create: `apps/api/src/deployment-mode.test.ts`
- Create: `apps/api/src/migrate.ts`
- Create: `apps/api/src/scheduler.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/runtime-lifecycle.ts`
- Modify: `apps/api/src/runtime-lifecycle.test.ts`
- Modify: `apps/api/tsup.config.ts`
- Modify: `apps/api/package.json`
- Modify: `Dockerfile`
- Modify: `infra/compute.tf`
- Modify: `.github/workflows/deploy.yml`

- [ ] Write failing tests proving: migrations are not run by the HTTP entrypoint; candidate/rehearsal mode blocks provider callbacks, email, manual sync, and background jobs with `503 deployment_inactive`; active mode permits them; a mode-file flip takes effect without restart; readiness returns revision/mode/schema; and SIGTERM waits for tracked requests/jobs before closing the pool.

```ts
expect(await json(request("/health/ready"))).toMatchObject({
  mode: "candidate",
  revision: REVISION,
  status: "ready",
});
expect(await request("/v1/connectors/google/callback?code=x&state=y")).toHaveStatus(503);
```

- [ ] Run `pnpm vitest run apps/api/src/deployment-mode.test.ts apps/api/src/runtime-lifecycle.test.ts apps/api/src/app.integration.test.ts` and capture the expected failures.
- [ ] Implement `readDeploymentMode(path)` with strict parsing and fail-closed I/O handling. The container receives a read-only runtime-control **directory**, not a bind-mounted individual file, so an atomic host rename changes the directory entry visible inside the container. Add middleware/helpers that gate every external side effect, including callback GETs and auth email delivery—not only ordinary POST mutations.
- [ ] Move startup migrations into the one-shot `migrate.ts` entry and interval/startup jobs into `scheduler.ts`. Preserve a tested `RUNTIME_TOPOLOGY=combined` compatibility composition in `main.ts` for AWS during `DEPLOY_TARGET=aws|dual`; it runs the same migration and scheduler modules without duplicating their logic. The Mac split topology runs the one-shot migration and separate scheduler containers, and the scheduler performs no work unless the mode file is `active`.
- [ ] Extend the AWS task/deploy contract so migration and scheduling remain live throughout the dual window. Add a deployment test proving `combined` is required while AWS is enabled and rejected after `DEPLOY_TARGET=mac`; remove combined topology only in the AWS-retirement change.
- [ ] Keep `runtime-lifecycle.ts` authoritative for the existing `quiesce-v1` request/background-task tracking, abort signal, drain timeout, signal handling, and database shutdown. Refactor `main.ts` into a thin entrypoint without weakening the headers or AWS deployment-drain checks that already consume that contract.
- [ ] Add `main`, `migrate`, and `scheduler` tsup entries and package scripts. Re-run focused tests and build the API.
- [ ] Commit: `refactor: separate api migration scheduler and drain lifecycles`.

### Task 3: Add coherent revision health to MCP and web

**Files:**
- Create: `apps/mcp/src/runtime.ts`
- Create: `apps/mcp/src/runtime.test.ts`
- Modify: `apps/mcp/src/http.ts`
- Modify: `apps/mcp/tsup.config.ts`
- Modify: `apps/web/vite.config.ts`
- Create: `apps/web/src/revision-build.test.ts`
- Modify: `deploy/nginx.conf`

- [ ] Write failing MCP tests for revision health and graceful request drain. Add a web build test that rejects a missing/malformed revision and asserts `/revision.json` is cache-disabled.
- [ ] Run the focused MCP/web tests and confirm failure.
- [ ] Extract an MCP runtime with tracked requests and bounded SIGTERM drain. Return `{status, revision}` from `/health/live`; API ready, MCP live, and web revision must report the same full SHA.
- [ ] Have the Vite build emit `dist/revision.json` from `BUILD_REVISION` without tracking a source-tree placeholder; configure nginx with `Cache-Control: no-store, max-age=0` for revision/health responses.
- [ ] Re-run focused tests and build API, MCP, and web through `node scripts/run-with-build-revision.mjs pnpm build`; also prove a direct production/release build without a revision fails.
- [ ] Commit: `feat: expose coherent release revision health`.

### Task 4: Add credential-family identity and idempotency persistence

**Files:**
- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/migrations/0066_mac_deployment_idempotency.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/auth-service.ts`
- Modify: `apps/api/src/oauth-service.ts`
- Modify: auth/OAuth integration tests

- [ ] Rebase and reserve the next migration number. Write failing integration tests proving a PAT keeps one `credentialFamilyId`, OAuth refresh rotation preserves the family, session identity uses the `user:` prefix plus the stable user UUID, and token replacement cannot change the idempotency subject.
- [ ] Add `credential_family_id` using a short expand/backfill/contract migration: nullable UUID column, batched unique-value backfill for existing rows, `NOT NULL`, then `DEFAULT gen_random_uuid()` for new rows. Index it, and add `idempotency_records` with columns `subject`, `method`, `route`, `key`, `request_hash`, `response_status`, `response_body`, `created_at`, `expires_at`; enforce uniqueness on `(subject, method, route, key)` and index expiry.
- [ ] Extend `Principal` with `idempotencySubject`. Backfill existing access-token rows with distinct families; pass the family through OAuth `issue()` during refresh.
- [ ] Generate and review SQL for locks/default behavior, then test fresh migration and upgrade migration against Testcontainers.
- [ ] Run database, auth, OAuth, and migration tests.
- [ ] Commit: `feat: persist stable mutation idempotency identity`.

### Task 5: Enforce API idempotency and forward keys from MCP

**Files:**
- Create: `apps/api/src/idempotency.ts`
- Create: `apps/api/src/idempotency.integration.test.ts`
- Modify: `apps/api/src/routes/{assistant,calendar,finances,goals,mail,reminders,tasks}.ts` and agent-authenticated mutation handlers still registered in `apps/api/src/app.ts`
- Modify: mutation-owning services used by those routes to accept a `Database` transaction executor
- Modify: `apps/api/src/app.ts`
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/features/**`
- Modify: `apps/mcp/src/server.ts`
- Modify: `apps/mcp/src/tools/**` and `apps/mcp/src/tool-surface.ts`

- [ ] Define `Idempotency-Key` semantics in tests: required for agent-authenticated mutations, optional for human browser mutations, 128-character maximum, same key/body replays the stored response, same key/different body returns `409 idempotency_conflict`, concurrent duplicates produce one mutation, and failed transactions store no replay.
- [ ] Run the integration test and confirm each behavior fails.
- [ ] Implement canonical request hashing over method, normalized route template, and parsed JSON body. Execute the domain mutation and idempotency-record insert in one database transaction; use a transaction-scoped PostgreSQL advisory lock derived from the unique tuple to serialize first use.
- [ ] Refactor every MCP-exposed mutation—including assistant, planning, reminders, calendar, finance, Mail, and X-bookmark surfaces—to accept the transaction executor. Do not wrap email/provider operations in replayable transactions; gate or redesign those endpoints explicitly and cover the selected behavior in tests.
- [ ] Extend API client request options with `idempotencyKey`. Generate one UUID per MCP tool invocation and reuse it for transport retries. Do not generate a new key inside a retry loop.
- [ ] Add cleanup for expired records and tests for OAuth rotation, replay retention, concurrent duplicates, rollback, and forced MCP disconnect/retry.
- [ ] Run focused tests, then `pnpm verify`.
- [ ] Commit: `feat: make mcp mutation retries idempotent`.

### Task 6: Build hardened production images and Compose model

**Files:**
- Modify: `Dockerfile`
- Modify: `.dockerignore`
- Modify: `.env.example`
- Create: `compose.production.yaml`
- Create: `deploy/mac-mini/nginx.conf`
- Create: `deploy/mac-mini/compose-policy.json`
- Create: `scripts/validate-production-compose.mjs`
- Create: `scripts/validate-production-compose.test.mjs`
- Modify: `package.json`

- [ ] Write policy fixtures that fail for mutable tags, `build:`, published ports, Docker socket, privileged mode, host namespaces, unapproved bind mounts, writable root filesystems, added capabilities, cross-service networks, or secrets outside `/run/secrets`.
- [ ] Implement a validator over `docker compose -p ilo-production -f compose.production.yaml config --format json` and a service-specific allowlist.
- [ ] Define digest-only services: `postgres`, one-shot `migrate`, `api`, `scheduler`, `mcp`, `web`, and `cloudflared`. Use a Linux named volume for PGDATA. Approve only the read-only runtime-control directory mount and secret files. Publish no ports.
- [ ] Give each origin a distinct ingress network; give MCP/API a distinct internal network; give only API, scheduler, migrate, backup/restore jobs database access. Set read-only roots, tmpfs, dropped capabilities, resource limits, health checks, and `restart: "no"` for every application/ingress writer controlled by the launcher.
- [ ] Add a multi-stage web image and distinct API `main`, `migrate`, and `scheduler` targets/commands. Build for `linux/arm64` locally and run the policy validator.
- [ ] Commit: `feat: add hardened mac production compose stack`.

### Task 7: Define and validate the attested release bundle

**Files:**
- Create: `scripts/release/release-manifest.schema.json`
- Create: `scripts/release/release-envelope.schema.json`
- Create: `scripts/release/create-manifest.mjs`
- Create: `scripts/release/verify-manifest.mjs`
- Create: `scripts/release/release-manifest.test.mjs`
- Create: `scripts/release/test-predecessor-compatibility.mjs`
- Create: `scripts/release/test-predecessor-compatibility.test.mjs`
- Create: `scripts/release/create-infrastructure-approval.mjs`
- Create: `scripts/release/verify-infrastructure-approval.mjs`
- Create: `scripts/release/infrastructure-approval.test.mjs`
- Create: `deploy/mac-mini/infrastructure-approval.pub`
- Create: `scripts/release/fixtures/**`
- Create: `deploy/mac-mini/runtime-compatibility.json`

- [ ] Write failing fixture tests for checksum substitution, wrong repository/workflow/branch/SHA, non-monotonic sequence, invalid ancestry, unlisted stable predecessor, schema fingerprint mismatch, changed Postgres/cloudflared digest in an application release, incompatible state schema, and too-new bootstrap.
- [ ] Implement a canonical immutable inner release payload containing all fields required by Decision 3 of the spec, including exact platform digests, controller checksums, before/after migration fingerprints, compatible predecessor bundle digests, infrastructure class, and rehearsal-evidence digests. Its digest excludes approval and outer-envelope metadata. The generator accepts predecessor evidence only from the compatibility harness, never a caller-authored digest list.
- [ ] In CI, restore the actual recorded stable predecessor schema/data fixture, apply the candidate migration, start the predecessor API/MCP images against the migrated schema, run their read/write smoke and rollback checks, then run the candidate. Emit signed evidence naming both exact bundle digests and schema fingerprints. For skipped releases, test every planned chain edge or the direct stable-to-candidate edge.
- [ ] Define an attended infrastructure-approval statement binding the immutable inner payload digest, old/new PostgreSQL or cloudflared digests, restore/upgrade rehearsal evidence digests, approving Cooper identity, issue time, and expiry. Sign its canonical bytes with a dedicated offline Ed25519/minisign key whose public key is pinned in the fixed bootstrap; keep the private key outside the production Mac, GitHub, AWS, Cloudflare, and Backblaze.
- [ ] Build an attested outer release envelope containing the unchanged inner payload plus its approval artifact; the outer envelope/bundle digest is the published candidate identity. Require envelope generation to reject infrastructure changes without a valid non-expired approval over the inner payload. Require the Mac controller to verify the outer attestation, recompute the inner digest, and then verify signature, pinned public-key fingerprint, payload/evidence bindings, and expiry before mutation. Test content-cycle resistance, arbitrary digest, wrong signer, replayed payload, changed evidence, expiry, and application-release misuse.
- [ ] Implement offline structural/checksum verification separately from online GitHub attestation and ancestry verification. Make verification output machine-readable and fail closed.
- [ ] Pin the tested host compatibility matrix in `runtime-compatibility.json` rather than using floating Homebrew latest versions.
- [ ] Run the release test suite and commit: `feat: define verifiable production release bundles`.

### Task 8: Replace `workflow_run` with a same-SHA protected-main release graph

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy.yml`
- Create: `.github/workflows/required-ci.yml`
- Modify: `infra/README.md`

- [ ] Move the required infrastructure, lint/format, quality/browser, and desktop jobs into `required-ci.yml` behind `workflow_call`. Make `ci.yml` invoke it for pull requests and feature-branch pushes. Make `deploy.yml` invoke it for `push` to `main`, then make release `needs: required-ci`. Add a workflow-shape test/inspection proving release checks out `github.sha` and cannot run unless that same event SHA passed the called workflow. Remove `workflow_run` release eligibility.
- [ ] Build API/MCP/web for `linux/arm64` and `linux/amd64`, push to GHCR, resolve platform-manifest digests, rebuild the release bundle from the event SHA without untrusted artifacts/caches, and create GitHub artifact attestations for every image and the bundle.
- [ ] Grant `packages: write`, `attestations: write`, and `id-token: write` only to the release job. Pin all third-party actions to full SHAs.
- [ ] Serialize `production-candidate` updates. Reread the pointer, verify signed sequence and Git ancestry, then move it last. Add test fixtures for delayed A/newer failing B and pointer races.
- [ ] Preserve a conditional AWS deployment job for `DEPLOY_TARGET=dual|aws`; publish the identical live AWS SHA as the first complete GHCR bundle. Require the transition identity/topology contract and predecessor compatibility evidence before either target deploys. `DEPLOY_TARGET=mac` disables AWS deployment only after cutover.
- [ ] Run local workflow validation and release-script tests. Commit: `ci: publish attested monotonic production bundles`.

### Task 9: Implement the fixed launcher and durable controller state machine

**Files:**
- Create: `deploy/mac-mini/bootstrap.sh`
- Create: `deploy/mac-mini/launcher.sh`
- Create: `deploy/mac-mini/watch.sh`
- Create: `deploy/mac-mini/{deploy,reconcile,rollback}.sh`
- Create: `deploy/mac-mini/controller/{state,lock,release,compose,reconcile}.mjs`
- Create: `deploy/mac-mini/controller/*.test.mjs`
- Create: `deploy/mac-mini/state.schema.json`
- Create: `deploy/mac-mini/install-layout.md`

- [ ] Write Node test fixtures for `stable`, every interrupted `deploying` step, `failed`, and `recovery-required`; corrupt/truncated state; candidate-controller failure; stable-controller fallback; quarantine; chained upgrades; and lock exclusion.
- [ ] Implement atomic state writes using same-directory temporary files, file and directory fsync, rename, schema validation, and preserved prior snapshots. State records current/previous/candidate bundle digests, release sequence, ancestry, schema fingerprints, controller version, backup identity, completed step, retry count, and quarantine reason.
- [ ] Implement one global `flock`-backed operation lock shared by deploy, reconcile, restore, backup, prune, and infrastructure upgrade. Unit-test contention and owner diagnostics.
- [ ] Make `launcher.sh` fixed and minimal: verify its own install/version, parse only the backward-compatible envelope, select the recorded stable controller, test a candidate controller in isolation, atomically activate it, and revert on failure.
- [ ] Implement `watch.sh` polling at 10 seconds with ETag/backoff, deployment start under 30 seconds, exact attestation verification, local ancestry revalidation under lock, bounded three-attempt retries, digest quarantine, and hold/deferred status.
- [ ] Implement controller transitions in this exact order: lock → resolve/verify → write `deploying` → freeze mode → drain/stop ingress and writers → immutable predeploy backup → verify live before fingerprint → one-shot migration → verify after fingerprint → start coherent candidate → local revision tests → start ingress → public revision/auth-safe tests → atomically flip mode active → start scheduler → observe → write `stable` → unlock.
- [ ] On unsafe rollback or corrupt state, stop/detach Tunnel first, prove all hostnames unreachable, stop every writer, write `recovery-required`, and alert. Never infer success from container uptime alone.
- [ ] Run controller tests, ShellCheck, production Compose validation, and `pnpm verify`.
- [ ] Commit: `feat: add crash-safe mac deployment controller`.

### Task 10: Implement encrypted immutable backups and credential-safe restore

**Files:**
- Create: `deploy/mac-mini/backup.sh`
- Create: `deploy/mac-mini/restore.sh`
- Create: `deploy/mac-mini/credential-reset.sh`
- Create: `deploy/mac-mini/backup-manifest.schema.json`
- Create: `deploy/mac-mini/controller/backup.mjs`
- Create: `deploy/mac-mini/controller/backup.test.mjs`
- Create: `deploy/mac-mini/controller/oci-archive.mjs`
- Create: `deploy/mac-mini/controller/oci-archive.test.mjs`
- Create: `infra/backup/{versions,variables,main,outputs}.tf`
- Create: `infra/backup/terraform.tfvars.example`
- Create: `infra/backup/{README,RECOVERY}.md`

- [ ] Write tests proving unique object names, per-backup data keys, wrapped-key manifests, full-restore verification before acceptance, database/manifest/OCI digest pairing, lock exclusion, retention selection, stale-checkpoint blocking, and failure when B2 does not report Compliance retention.
- [ ] Implement a compressed custom-format `pg_dump`, authenticated encryption, FileVault staging copy, and B2 upload. `pg_restore --list` is only an early format check: before acceptance, restore every archive into a disposable empty PostgreSQL instance and verify schema fingerprint, representative row counts/data, roles/grants, sequences, and encrypted-field decryption. Destroy the disposable target afterward. An independently witnessed accepted checkpoint—not merely a successful upload—sets the RPO clock.
- [ ] Implement OpenTofu for a private B2 bucket with 35-day Compliance Object Lock/default retention, lifecycle, server-side encryption, alerting, and a prefix-scoped uploader key without delete or administration capabilities. Prove permissions with integration tests.
- [ ] Implement restore into a demonstrably empty cluster using `--no-owner --no-acl`, explicit roles/grants, `ANALYZE`, schema/row/sequence/encrypted-field checks, and recovery-manifest validation.
- [ ] Export the exact both-platform OCI image manifests/blobs, release bundle, controller, GitHub attestation bundles, and trusted verification roots beside every accepted database checkpoint. Encrypt, upload, retain, and witness them as one immutable recovery set. Rehearse a network-isolated restore with GHCR and GitHub unavailable.
- [ ] For any non-final-frozen backup, run `credential-reset.sh` before ingress to invalidate sessions, PATs, OAuth access/refresh tokens and codes, password/reset/action tokens, and other bearer material. Test that prior credentials no longer authenticate.
- [ ] Document escrow of the wrapping private key, B2 admin credentials, and encrypted OpenTofu state outside Mac/AWS/GitHub/Cloudflare.
- [ ] Commit: `feat: add immutable offsite backup and safe restore`.

### Task 11: Extract authoritative Cloudflare ownership from AWS state

**Files:**
- Create: `infra/cloudflare/{versions,variables,locals,dns,tunnel,rules,outputs}.tf`
- Create: `infra/cloudflare/backend.hcl.example`
- Create: `infra/cloudflare/terraform.tfvars.example`
- Create: `infra/cloudflare/{README,IMPORTS,RECOVERY}.md`
- Modify: `infra/dns.tf`
- Modify: `infra/waf.tf`
- Modify: `infra/README.md`

- [ ] Inventory the live zone, sibling hostnames, current HSTS, certificates, DNS records, WAF/rate rules, and plan entitlements with read-only Cloudflare/AWS queries. Save sanitized command output references in the migration runbook, not secrets/state in Git.
- [ ] Define the complete independent Cloudflare root: Tunnel/routes, three host records, exact-host HTTPS redirect/HSTS, managed WAF, coarse auth/MCP rate limits, certificate coverage, and existing Resend records. Scope every rule to the ilo hostnames unless the inventory proves zone-wide safety. Store state in an encrypted, versioned Backblaze S3-compatible backend separate from the AWS state backend, and escrow a recoverable encrypted snapshot.
- [ ] Write and rehearse exact `terraform state mv`/`tofu import` commands. Apply `removed` blocks without destroying live records, import into the new backend, and require both roots to plan with zero unintended changes before any target switch.
- [ ] Prove the new backend and credentials recover without AWS, and prove the AWS root can no longer manage or revert any Cloudflare resource.
- [ ] Validate all roots and commit: `infra: separate cloudflare production ownership from aws`.

### Task 12: Provision the dedicated Mac runtime and network boundary

**Files:**
- Create: `deploy/mac-mini/colima.yaml`
- Create: `deploy/mac-mini/host-firewall.sh`
- Create: `deploy/mac-mini/vm-firewall.sh`
- Create: `deploy/mac-mini/verify-host.sh`
- Create: `deploy/mac-mini/launchagents/me.coopersully.ilo.{colima,launcher,watch,backup}.plist`
- Create: `deploy/mac-mini/README.md`

- [ ] Make `verify-host.sh` fail unless running as the dedicated non-admin production account with FileVault enabled, automatic login disabled, sleep disabled on AC, at least 25% host memory free, at least 20% disk free, and exact compatibility-manifest versions.
- [ ] Configure the named `ilo-production` Colima profile with explicit CPU, memory, root disk, data disk, architecture, runtime, `COLIMA_HOME`, and socket. Verify effective VM resources from inside the VM.
- [ ] Install LaunchAgents that use absolute paths and explicit environment, run Colima foreground, and invoke only the fixed launcher, watch, and backup entrypoints. No application container gets autonomous restart ownership.
- [ ] Inventory every current provider protocol from code and AWS egress rules. Implement macOS PF rules in `host-firewall.sh` and Colima-VM/container-forwarding rules in `vm-firewall.sh` for LAN, loopback, link-local, multicast, host-gateway, private IPv4, ULA and globally addressed LAN IPv6. Allow destination-scoped DNS/HTTPS, iCloud IMAP TCP 993, iCloud SMTP TCP 587, and documented Tunnel endpoint flows; verify provider sync/IDLE/move/send, TCP/UDP 7844, QUIC preference, and HTTP/2 fallback. Reapply VM rules through the checked-in Colima provisioning lifecycle after every VM start.
- [ ] Run positive probes for named Compose flows and negative probes for every prohibited address class from every service container.
- [ ] Commit: `infra: provision isolated mac production runtime`.

### Task 13: Add monitoring, independent witness, and fault rehearsals

**Files:**
- Create: `deploy/mac-mini/probe.sh`
- Create: `deploy/mac-mini/witness.sh`
- Create: `deploy/mac-mini/rehearse.sh`
- Create: `deploy/mac-mini/rehearsals/**`
- Create: `deploy/witness/ilo-restore-witness.service`
- Create: `deploy/witness/ilo-restore-witness.timer`
- Create: `deploy/witness/ilo-checkpoint-witness.service`
- Create: `deploy/witness/ilo-checkpoint-witness.timer`
- Create: `deploy/witness/README.md`
- Create: `infra/witness/{versions,variables,main,outputs}.tf`
- Create: `infra/witness/terraform.tfvars.example`
- Create: `infra/witness/{README,RECOVERY}.md`
- Create: `docs/runbooks/mac-mini-monitoring.md`

- [ ] Implement public cache-bypassing probes for all three revisions, login-safe API behavior, MCP initialize, TLS/HSTS, maintenance lease, heartbeat, backup age, and revision mismatch. Store correlated logs remotely with request/release IDs.
- [ ] Make maintenance leases signed, bounded, and release-specific. They may suppress expected availability alerts but never heartbeat, backup, mismatch, or overrun alerts.
- [ ] Provision the witness control plane explicitly: a minimal Debian Hetzner Cloud VPS outside AWS/GitHub/Cloudflare/Backblaze/Mac, no standing inbound access, encrypted disk where supported, provider firewall, a separately escrowed OpenTofu state snapshot, a B2 read-only recovery-set credential, a write-only non-overwriting witness-evidence prefix, and a Healthchecks.io dead-man alert owned outside the Mac uploader context. Use an exact-IP one-time bootstrap rule/key, then remove both and prove console/rescue recovery. Record the selected SKU, region, owner, alert destination, and quoted recurring cost; require Cooper's approval before apply.
- [ ] Implement an independent witness that validates the full offsite database/manifest/OCI/attestation set and writes accepted-checkpoint evidence unavailable to the Mac uploader. Give the Mac only read access to witness evidence. Configure the weekly clean-room restore with the checked-in systemd timer and prove missed runs alert; do not schedule it through GitHub, AWS, Cloudflare, Backblaze jobs, or the production Mac.
- [ ] Run checkpoint discovery/validation every 10 minutes with `ilo-checkpoint-witness.timer`, independently of the weekly full-restore timer. Alert when acceptance latency exceeds 30 minutes, a timer run is missed, or accepted-checkpoint age approaches one hour; make stale acceptance block deployments before the RPO is exceeded.
- [ ] Add deterministic rehearsals for killed migration, killed controller at every state transition, corrupt state, stale pointer, pointer race, bad attestation, digest substitution, incompatible schema, broken candidate controller, Colima `Broken`, sleep/wake, reboot-after-login, Tunnel QUIC failure, and forced MCP retry.
- [ ] Run the full rehearsal suite plus `pnpm verify`; retain sanitized evidence paths in the runbook.
- [ ] Commit: `test: add mac deployment failure and recovery rehearsals`.

### Task 14: Extend and rehearse the existing private RDS transfer path

**Files:**
- Modify: `infra/local-production-runtime.tf`
- Modify: `.codex/scripts/production-runtime.mjs`
- Modify: `.codex/scripts/production-runtime.test.ts`
- Create: `deploy/mac-mini/rds-inspect.sh`
- Create: `deploy/mac-mini/rds-transfer.sh`
- Create: `docs/runbooks/mac-mini-rds-transfer.md`

- [ ] Audit and extend the existing `aws_instance.local_production_tunnel`, its no-ingress security group, scoped runtime role, and Session Manager remote-host forwarding. Do not create a second transfer host/root. Add explicit cutover lifecycle and teardown evidence while retaining current IMDSv2, no-keypair, least-privilege, and database-only network constraints.
- [ ] Capture RDS PostgreSQL major/minor, encoding, locale/collation provider/version, ICU/libc dependencies, extensions, roles/grants, and relevant settings. Select the pinned local Postgres digest only after comparing this report.
- [ ] Rehearse TLS hostname/CA-validated forwarding, dump with equal/newer major tools, restore to an empty local database, explicit grants, reindex where required, `ANALYZE`, and validation of extensions, sequences, counts, Unicode ordering/case-folding/`ILIKE`/uniqueness, and encrypted fields.
- [ ] Prove teardown removes the instance and temporary rules. Commit: `infra: add private rds transfer rehearsal path`.

### Task 15: Write executable cutover, AWS-return, and retirement runbooks

**Files:**
- Create: `docs/runbooks/mac-mini-cutover.md`
- Create: `docs/runbooks/mac-mini-aws-return.md`
- Create: `docs/runbooks/mac-mini-aws-retirement.md`
- Create: `docs/runbooks/mac-mini.md`
- Create: `deploy/mac-mini/cutover-check.sh`
- Create: `deploy/mac-mini/aws-return-check.sh`

- [ ] Encode every Phase 0–5 gate from the spec as a checkbox plus an executable evidence command and expected result. `cutover-check.sh` must fail closed if any attestation, backup, witness, schema, certificate, restore, reboot, network, monitoring, or rollback rehearsal is stale/missing.
- [ ] Define the final freeze order exactly: acquire lock and maintenance lease; stop AWS ingress/schedulers/API/MCP; prove zero writers; final snapshot and TLS dump; restore locally; verify schema/data/grants/credentials; start candidate with side effects disabled; local revision/auth/MCP checks; switch authoritative Cloudflare root; public checks; flip active mode/start scheduler; create and witness first local backup; release lock.
- [ ] Define both return paths. Before a local write, return to frozen RDS. After local writes, restore into a genuinely empty compatible RDS database, prove it empty, repoint secrets, start API then MCP, verify scheduler/background jobs, then switch Cloudflare. Never import over populated frozen RDS.
- [ ] Encode the 72-hour hold in Mac state and the GitHub production environment. Releases publish but are marked deferred; an urgent release requires an attended explicit decision. Record the exact expiry timestamp.
- [ ] Define AWS retirement only after the offsite restore, independent Cloudflare-state recovery, and alternate-host restore meet RTO. Preserve final snapshot/dump retention and remove OIDC/variables/transfer resources only afterward.
- [ ] Peer-review the runbooks against the design verification list and commit: `docs: add executable mac cutover and recovery runbooks`.

### Task 16: Perform the dual-publish and full dress rehearsal

**Operational; no production traffic moves in this task.**

- [ ] Set `DEPLOY_TARGET=dual` and merge a transition release. Prove the exact SHA and content running on AWS are represented by the complete attested GHCR bundle for both architectures.
- [ ] Bootstrap the production Mac account from checked-in scripts. Recover secrets through the documented escrow path and verify no secret entered shell history, Git, logs, or process arguments.
- [ ] Run `cutover-check.sh`, the full fault suite, an attended reboot/login rehearsal, a clean RDS-to-local rehearsal, an offsite immutable upload, an independent accepted checkpoint, and a separate-machine clean restore within four hours.
- [ ] Rehearse both AWS return paths without changing production DNS. Record bundle/database/schema identities and elapsed times.
- [ ] Stop if any gate fails. Fix through Tasks 1–15 and repeat this task from a fresh immutable backup; do not waive gates.

### Task 17: Cut over, observe, and retire AWS

**Operational; execute only during an attended maintenance window.**

- [ ] Run the Phase 3 sequence from `mac-mini-cutover.md` without reordering steps. Record the final RDS snapshot, final frozen dump, first accepted local checkpoint, stable bundle digest, release sequence, schema fingerprint, and Cloudflare plan/apply IDs.
- [ ] Verify all public hostnames, revisions, TLS/HSTS/WAF/rate limiting, login, CRUD, MCP forced retry, email, provider callbacks, schedulers, heartbeat, correlated logs, and backup age before ending maintenance.
- [ ] Scale ECS to zero but retain RDS, snapshot, exact AWS images, transfer path, and state. Set `DEPLOY_TARGET=mac` and enforce the 72-hour deployment hold.
- [ ] During the hold, monitor continuously and complete the offsite/alternate restore. If rollback is required, choose the correct before-write or after-write procedure based on recorded local write evidence.
- [ ] After 72 healthy hours, remove the hold and allow only the newest eligible monotonic bundle to reconcile. Confirm an ordinary merge to `main` begins deployment within 30 seconds and reaches stable without Mac interaction.
- [ ] Execute the retirement runbook only after every retirement gate passes. Remove traffic resources and deployment credentials, expire AWS-return, and make alternate-host restore the authoritative disaster-recovery procedure.

## Final Integration Review

- [ ] Trace every design decision and every verification gate to at least one task/test/runbook command above.
- [ ] Run a placeholder-marker and angle-bracket-token scan over this plan and resolve every result before handoff.
- [ ] Run `pnpm verify`, production Compose validation, all OpenTofu/Terraform formatting and validation, ShellCheck, release/controller tests, and the non-production rehearsal suite.
- [ ] Confirm `git diff --check` is clean and no secret/state/dump/recovery artifact is tracked.
- [ ] Review the resulting branch with correctness, security, recovery, and maintainability passes before merging Task 15. Treat Tasks 16–17 as controlled operations, not ordinary CI steps.
