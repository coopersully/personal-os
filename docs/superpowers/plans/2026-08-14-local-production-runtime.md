# Local Production Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run any registered ilo worktree's local API, MCP server, and web app directly against live production PostgreSQL with full product behavior through a private SSM tunnel.

**Architecture:** Terraform provisions one stopped-when-idle, no-ingress EC2 Session Manager tunnel host and a scoped operator role. A focused Node lifecycle helper assumes the role, mirrors the deployed API task's public and secret configuration into memory, forwards the worktree database port to private RDS, and is composed into the existing worktree lifecycle script.

**Tech Stack:** Terraform/AWS (EC2, IAM, SSM, RDS, ECS), Node.js child processes, Bash lifecycle composition, pnpm, Vitest.

## Global Constraints

- The local runtime is a full production writer and may run migrations and provider side effects.
- RDS stays private; neither PostgreSQL nor the tunnel host receives public ingress.
- Production secrets remain only in process memory and never appear in logs, files, command arguments, or Git.
- Every worktree retains its stable tier ports and owns only its own processes and SSM session.
- Normal `pnpm env:start` remains local-Docker-only.
- Starting production mode requires `ILO_PRODUCTION_RUNTIME=I_UNDERSTAND_THIS_IS_PRODUCTION`.

---

### Task 1: Production tunnel infrastructure

**Files:**
- Create: `infra/local-production-runtime.tf`
- Modify: `infra/outputs.tf`
- Modify: `infra/README.md`

**Interfaces:**
- Consumes: `aws_vpc.main`, `aws_subnet.public[0]`, `aws_security_group.database`, `aws_db_instance.postgres`, `local.runtime_parameter_arns`, and production ECS resources.
- Produces: tagged instance `personal-os-prod-local-db-tunnel` and IAM role `personal-os-prod-local-production-runtime` discoverable by the local lifecycle.

- [ ] **Step 1: Add a failing infrastructure contract test**

Create `scripts/check-local-production-runtime-contract.mjs` and invoke it from the root `lint` script. It must parse the Terraform files and fail unless the tunnel has zero ingress, database ingress is SG-to-SG, IMDSv2 is required, the instance has no key, the scoped role has exact SSM/RDS/ECS/EC2 permissions, and runtime parameter access uses `values(local.runtime_parameter_arns)`.

- [ ] **Step 2: Run the contract test and observe the missing-infrastructure failure**

Run: `node scripts/check-local-production-runtime-contract.mjs`

Expected: non-zero exit identifying the missing `infra/local-production-runtime.tf` contract.

- [ ] **Step 3: Implement the Terraform resources**

Add an AL2023 ARM64 AMI lookup, SSM-managed EC2 role/profile, no-ingress tunnel security group, exact RDS ingress rule, hardened `t4g.nano` instance, scoped assumable operator role, and outputs for role ARN and instance ID. The operator policy must restrict mutating EC2 and Session Manager actions to this tunnel and restrict parameter reads to `values(local.runtime_parameter_arns)`.

- [ ] **Step 4: Verify the infrastructure contract**

Run:

```bash
node scripts/check-local-production-runtime-contract.mjs
terraform -chdir=infra fmt -check
terraform -chdir=infra init -backend=false
terraform -chdir=infra validate
```

Expected: all commands exit 0.

### Task 2: Testable production runtime resolver

**Files:**
- Create: `.codex/scripts/production-runtime.mjs`
- Create: `.codex/scripts/production-runtime.test.ts`

**Interfaces:**
- Consumes: AWS CLI JSON for STS, EC2, SSM, RDS, ECS, and the deployed API task definition.
- Produces: `start`, `stop`, and `status` commands plus exported pure validation/config functions used by tests.

- [ ] **Step 1: Write failing unit tests**

Cover exact acknowledgement, fixed RDS identifier, rejection of public/unavailable RDS, tagged tunnel selection, deployed-task configuration projection, local URL overrides, database URL loopback rewriting with TLS query preservation, parameter completeness, and redacted errors.

- [ ] **Step 2: Run the focused tests and observe missing-module failure**

Run: `pnpm vitest run .codex/scripts/production-runtime.test.ts`

Expected: non-zero exit because `.codex/scripts/production-runtime.mjs` does not exist.

- [ ] **Step 3: Implement pure validation and projection helpers**

Export functions with these signatures:

```ts
assertProductionAcknowledgement(environment: NodeJS.ProcessEnv): void
validateProductionDatabase(instance: AwsDbInstance): { endpoint: string }
selectTunnelInstance(instances: AwsEc2Instance[]): AwsEc2Instance
projectProductionEnvironment(input: ProjectionInput): Record<string, string>
rewriteDatabaseUrl(databaseUrl: string, localPort: number): string
redactProductionError(error: unknown, secretValues: string[]): string
```

- [ ] **Step 4: Run focused tests to green**

Run: `pnpm vitest run .codex/scripts/production-runtime.test.ts`

Expected: all focused tests pass.

### Task 3: Attached tunnel and source-service lifecycle

**Files:**
- Modify: `.codex/scripts/production-runtime.mjs`
- Modify: `.codex/scripts/production-runtime.test.ts`

**Interfaces:**
- Consumes: worktree runtime JSON passed by `environment.sh`, AWS source profile, and local process ownership directory.
- Produces: attached runtime supervision and per-worktree production session metadata.

- [ ] **Step 1: Write failing process-level tests using fake AWS and service executables**

The tests must run the real helper with a temporary runtime directory and assert that start assumes the scoped role, starts/waits for the exact tunnel, opens `AWS-StartPortForwardingSessionToRemoteHost`, never prints secret fixtures, starts API/MCP/web with the projected environment, and tears all children down when the tunnel exits. Add stop/status ownership cases.

- [ ] **Step 2: Run the tests and observe lifecycle failures**

Run: `pnpm vitest run .codex/scripts/production-runtime.test.ts`

Expected: pure tests pass and lifecycle cases fail because commands are not implemented.

- [ ] **Step 3: Implement start, stop, status, ownership, and supervision**

Use `spawn` with environment variables, never secret-bearing command arguments. Store only PIDs, process start identities, instance ID, and SSM session ID under `.codex/run/production`; never store AWS credentials, SSM parameter output, or database URLs. Bound all readiness loops and redact child errors.

- [ ] **Step 4: Run focused tests to green**

Run: `pnpm vitest run .codex/scripts/production-runtime.test.ts`

Expected: all focused tests pass without secret fixture text in output.

### Task 4: Worktree lifecycle composition

**Files:**
- Modify: `.codex/scripts/environment.sh`
- Modify: `.codex/scripts/environment.test.sh`
- Modify: `.codex/scripts/check.sh`
- Modify: `.codex/environments/environment.toml`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/deployment.md`

**Interfaces:**
- Consumes: existing stable tier and process-ownership functions plus the production runtime helper.
- Produces: `env:prod:start`, `env:prod:stop`, and `env:prod:status` without altering normal local lifecycle semantics.

- [ ] **Step 1: Write failing environment lifecycle tests**

Extend the shell lifecycle test to assert production commands pass the tier's exact API/MCP/web/database ports and run directory to the helper, normal `start` still uses `LOCAL_DATABASE_URL`, and the acknowledgement is not synthesized by the script.

- [ ] **Step 2: Run the lifecycle test and observe missing-command failures**

Run: `bash ./.codex/scripts/environment.test.sh`

Expected: non-zero exit because production lifecycle commands are absent.

- [ ] **Step 3: Add the production command composition and documentation**

Wire the three commands into package scripts and lifecycle usage. Add optional Codex environment actions without replacing normal Start. Document the exact warning, prerequisites, attached behavior, worktree ports, and stop/status commands.

- [ ] **Step 4: Run focused lifecycle and repository checks**

Run:

```bash
bash -n ./.codex/scripts/environment.sh
bash ./.codex/scripts/environment.test.sh
bash ./.codex/scripts/check.sh
```

Expected: all commands exit 0.

### Task 5: Verification and production activation

**Files:**
- Modify only if verification exposes a defect in the files above.

**Interfaces:**
- Consumes: complete implementation and a named non-root production administrator AWS profile.
- Produces: reviewed infrastructure plan, applied tunnel boundary, and live product smoke evidence.

- [ ] **Step 1: Run deterministic repository verification**

Run: `pnpm verify`

Expected: lint, types, coverage, builds, desktop E2E, and mobile E2E pass.

- [ ] **Step 2: Produce and review the production Terraform plan**

Run with the named administrator profile and the existing private backend/tfvars:

```bash
AWS_PROFILE=<named-ilo-admin-profile> terraform -chdir=infra plan -out=.codex-local-production-runtime.tfplan
terraform -chdir=infra show .codex-local-production-runtime.tfplan
```

Expected: only the tunnel instance/roles/profile/security-group rules and documented outputs are added; RDS is not replaced or made public.

- [ ] **Step 3: Apply and stop the idle tunnel**

Run:

```bash
AWS_PROFILE=<named-ilo-admin-profile> terraform -chdir=infra apply .codex-local-production-runtime.tfplan
AWS_PROFILE=<named-ilo-admin-profile> aws ec2 stop-instances --region us-east-1 --instance-ids <tunnel-instance-id>
```

Expected: apply succeeds and the idle tunnel reaches `stopped`.

- [ ] **Step 4: Run the live production smoke test**

Run:

```bash
ILO_PRODUCTION_SOURCE_PROFILE=<named-ilo-admin-profile> \
ILO_PRODUCTION_RUNTIME=I_UNDERSTAND_THIS_IS_PRODUCTION \
pnpm env:prod:start
```

Verify the printed local health URLs, log in locally, run one MCP read, perform and reverse one low-impact product mutation, inspect connector state, and confirm an audit event. Then run `pnpm env:prod:stop` and confirm `pnpm env:prod:status` reports all local production components down.

- [ ] **Step 5: Final diff and secret scan**

Run:

```bash
git diff --check
git status --short
git diff -- . ':!pnpm-lock.yaml'
rg -n "postgresql://[^[:space:]]+@|AKIA[0-9A-Z]{16}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY" . --hidden --glob '!node_modules/**' --glob '!.git/**'
```

Expected: no whitespace errors, only intended files changed, and no production credentials or private keys found.
