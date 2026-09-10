# CI Hardening and Acceleration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pull-request CI proportional to affected ilo surfaces while adding Terraform plans and closing validation gaps without reducing coverage or release confidence.

**Architecture:** Keep one always-triggered CI workflow with a tested fail-closed change classifier, conditional validation lanes, and a stable aggregate required check. Preserve a full run on `main`, add a separate trusted Terraform speculative-plan boundary, and stage each optimization behind shadow-mode evidence.

**Tech Stack:** GitHub Actions, Node.js 22, pnpm 11, Biome, TypeScript, Vitest, Playwright, Terraform 1.14, TFLint, Trivy, Drizzle Kit/PostgreSQL, Docker BuildKit, Rust/Tauri.

**Spec:** `docs/engineering/ci-audit-2026-08-26.md`

## Global Constraints

- Preserve `pnpm verify` as the complete local verification contract.
- Preserve 95% statements/functions/lines and 94% branches globally on `main`.
- A classifier error, unknown path, missing comparison base, root toolchain change, or CI routing change must select full CI.
- Never expose Terraform state, saved binary plans, JSON plans, secrets, or sensitive variable values in artifacts, comments, summaries, or logs.
- Never use the production deploy role for pull-request Terraform plans.
- Keep production deployments serialized with `cancel-in-progress: false`.
- Pin third-party actions to full commit SHAs and annotate the corresponding release tag in comments.
- Implement each task as an independently reviewable pull request in the listed order.

---

### Task 1: Add a fail-closed CI scope classifier in shadow mode

**Files:**
- Create: `.github/scripts/ci-scope.mjs`
- Create: `.github/scripts/ci-scope.test.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: newline-delimited repository-relative changed paths and event name.
- Produces: JSON and GitHub outputs with booleans `full`, `repo`, `terraform`, `node`, `database`, `browser`, `desktop`, `containers`, and `dependencies`, plus a sorted `changed_packages` JSON array.

- [ ] **Step 1: Write classifier tests before implementation**

  Add table-driven Node tests that assert the complete scope object for at
  least: docs-only; Terraform root; bootstrap Terraform; domain; database
  migration; connectors; API client; UI; web; API; MCP; desktop Rust;
  Dockerfile; lockfile; workflow; classifier self-change; unknown top-level
  path; empty input; and diff-error mode. Explicitly assert that lockfile,
  workflow, classifier, unknown, empty, and diff-error cases set `full: true`.

  ```js
  assert.deepEqual(classifyChanges(["apps/mcp/src/server.ts"]), {
    full: false,
    repo: false,
    terraform: false,
    node: true,
    database: false,
    browser: false,
    desktop: false,
    containers: true,
    dependencies: false,
    changed_packages: ["@personal-os/mcp"],
  });
  assert.equal(classifyChanges(["unowned/new.txt"]).full, true);
  assert.equal(classifyChanges([]).full, true);
  ```

- [ ] **Step 2: Run the tests and confirm the missing-module failure**

  Run: `node --test .github/scripts/ci-scope.test.mjs`

  Expected: FAIL because `.github/scripts/ci-scope.mjs` does not exist.

- [ ] **Step 3: Implement the classifier as a pure function plus CLI**

  Export `classifyChanges(paths, options = {})`. Define the package dependency
  graph from workspace `package.json` files at runtime, then expand every
  changed package through transitive dependents. Map expanded packages to
  lanes using the matrix in the audit. The CLI must accept `--files <path>`,
  `--json`, and `--github-output <path>`. Reject absolute paths and `..`
  traversal. Catch all CLI errors, emit a full scope, and exit successfully in
  shadow mode so the old CI remains authoritative.

- [ ] **Step 4: Run classifier unit tests**

  Run: `node --test .github/scripts/ci-scope.test.mjs`

  Expected: PASS for every owned path and fail-closed case.

- [ ] **Step 5: Add a shadow-mode `changes` job**

  In `.github/workflows/ci.yml`, add workflow concurrency:

  ```yaml
  concurrency:
    group: ci-${{ github.event.pull_request.number || github.ref }}
    cancel-in-progress: ${{ github.event_name == 'pull_request' }}
  ```

  Add a `changes` job with `fetch-depth: 0`. For pull requests, diff
  `${{ github.event.pull_request.base.sha }}...${{ github.event.pull_request.head.sha }}`.
  For pushes, set `full=true`. Write the changed file list to
  `$RUNNER_TEMP/changed-files.txt`, run the classifier, expose all outputs, and
  append its JSON to `$GITHUB_STEP_SUMMARY`. Do not condition any existing job
  yet.

- [ ] **Step 6: Add repository scripts and run local verification**

  Add `test:ci-scope` to `package.json`, include it in the repository check
  path, and run:

  ```bash
  pnpm test:ci-scope
  actionlint .github/workflows/ci.yml
  pnpm verify
  ```

  Expected: all pass; CI still runs every pre-existing job.

- [ ] **Step 7: Commit the shadow classifier**

  ```bash
  git add .github/scripts/ci-scope.mjs .github/scripts/ci-scope.test.mjs .github/workflows/ci.yml package.json
  git commit -m "ci: classify affected validation scopes"
  ```

### Task 2: Introduce a stable required gate and enable coarse-grained skips

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/scripts/ci-scope.mjs`
- Modify: `.github/scripts/ci-scope.test.mjs`
- Modify: `package.json`
- Modify: `.codex/scripts/environment.sh`
- Modify: `docs/engineering/ci-audit-2026-08-26.md`

**Interfaces:**
- Consumes: Task 1 job outputs.
- Produces: stable `CI required` job conclusion and composed `check:repo`, `check:node`, and `check:all` commands.

- [ ] **Step 1: Add aggregate-gate truth-table tests**

  Extend the classifier test module with `requiredGate(results)` cases. It must
  pass only when every dependency is `success` or `skipped`, fail on `failure`,
  and fail on `cancelled`. It must not use `always()` in a way that survives
  cancellation; the workflow job condition is `${{ !cancelled() }}`.

- [ ] **Step 2: Split the duplicate check command**

  Keep `pnpm verify` unchanged from the developer's perspective. Define:

  ```json
  {
    "check:repo": "bash ./.codex/scripts/check.sh",
    "check:node": "pnpm typecheck && pnpm test:coverage && pnpm build",
    "check:all": "pnpm check:repo && pnpm lint && pnpm check:node",
    "check": "pnpm check:all"
  }
  ```

  Update CI so the lint job runs `pnpm lint` and the quality job runs
  `pnpm check:repo && pnpm check:node`; it must no longer invoke lint a second
  time. Keep `.codex/scripts/environment.sh verify` calling `pnpm check` and
  `pnpm test:e2e`.

- [ ] **Step 3: Condition the existing jobs conservatively**

  Split repository checks from Biome lint, then add `needs: changes` and job
  conditions:

  - Terraform: `full || terraform`
  - repository environment/contract checks: `full || repo`
  - Biome lint and TypeScript source contracts: `full || node`
  - quality: `full || node || database`
  - browser acceptance: split from quality and use `full || browser`
  - desktop matrix: `full || desktop`

  On `push` to `main`, the classifier already returns `full=true`. Do not add
  workflow-level `paths` or `paths-ignore`.

- [ ] **Step 4: Add the stable aggregate job**

  Create a final job named `CI required` with `needs` listing every conditional
  job and `if: ${{ !cancelled() }}`. Its shell step must inspect
  `toJSON(needs)`, fail unless every result is `success` or `skipped`, and print
  the scope and job results to `$GITHUB_STEP_SUMMARY`.

- [ ] **Step 5: Verify representative classifier/workflow cases**

  Run the classifier against committed fixture lists for docs, Terraform, MCP,
  web, database, root lockfile, and unknown paths. Run:

  ```bash
  pnpm test:ci-scope
  actionlint .github/workflows/ci.yml
  shellcheck .codex/scripts/*.sh
  pnpm verify
  ```

  Expected: all pass. Open one docs-only test PR and one Terraform-only test PR
  before making `CI required` the sole branch-protection check.

- [ ] **Step 6: Update branch protection and document observed results**

  Require only `CI required`; remove direct requirements for conditional jobs.
  Record actual selected jobs and elapsed time for the two test PRs in the audit.
  Roll back job conditions if any required job is unexpectedly absent.

- [ ] **Step 7: Commit coarse-grained routing**

  ```bash
  git add .github/workflows/ci.yml .github/scripts/ci-scope.mjs .github/scripts/ci-scope.test.mjs package.json .codex/scripts/environment.sh docs/engineering/ci-audit-2026-08-26.md
  git commit -m "ci: run validation only for affected surfaces"
  ```

### Task 3: Add Terraform static analysis and native invariant tests

**Files:**
- Create: `.tflint.hcl`
- Create: `.trivyignore.yaml`
- Create: `infra/tests/security.tftest.hcl`
- Create: `infra/tests/variables.tftest.hcl`
- Create: `infra/bootstrap/tests/state.tftest.hcl`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/dependabot.yml`
- Modify: `infra/README.md`

**Interfaces:**
- Consumes: Task 2 `terraform` scope.
- Produces: deterministic Terraform format/init/validate/TFLint/Trivy/test gate for both roots without cloud credentials.

- [ ] **Step 1: Write failing native Terraform tests with mocked providers**

  Use `mock_provider "aws" {}` and `mock_provider "cloudflare" {}`. Add plan
  runs with example variables and assertions for:

  - `aws_db_instance.postgres.publicly_accessible == false`
  - storage encryption and deletion protection are true
  - both ECR repositories are immutable and scan on push
  - all web/state public-access-block flags are true
  - the GitHub deploy trust is constrained to the configured environment subject
  - invalid GitHub repository, Plaid environment, push configuration, and
    service capacity inputs fail their named validations/checks

  Override computed mock values needed by locals so the tests reach assertions.

- [ ] **Step 2: Run Terraform tests and capture the initial failures**

  ```bash
  terraform -chdir=infra init -backend=false -input=false -lockfile=readonly -no-color
  terraform -chdir=infra test -no-color
  terraform -chdir=infra/bootstrap init -backend=false -input=false -lockfile=readonly -no-color
  terraform -chdir=infra/bootstrap test -no-color
  ```

  Expected: tests initially fail only where mock data or assertions expose a
  real configuration issue. Fix configuration defects in the same PR; do not
  weaken assertions.

- [ ] **Step 3: Configure TFLint**

  Enable the recommended Terraform preset and a pinned AWS ruleset. Run
  `tflint --init`, `tflint --chdir=infra --recursive`, and
  `tflint --chdir=infra/bootstrap`. Add only rule-specific exclusions with an
  explanation. Pass `GITHUB_TOKEN` to plugin initialization and cache the TFLint
  plugin directory by `.tflint.hcl` hash.

- [ ] **Step 4: Baseline Trivy without hiding high-risk findings**

  Run `trivy config --severity HIGH,CRITICAL --exit-code 1 infra Dockerfile
  compose.yaml`. Fix findings where possible. Add an ignore only with the exact
  check ID, affected path, owner, rationale, and expiration date. An empty ignore
  file is valid and preferred.

- [ ] **Step 5: Harden the Terraform CI commands**

  Set `TF_IN_AUTOMATION=1` and `TF_INPUT=0`. For both roots run format,
  `init -backend=false -lockfile=readonly -no-color`, `validate -no-color`,
  TFLint, Terraform tests, then Trivy. Pin setup actions and scanners by full
  commit SHA. Add Dependabot coverage for any new GitHub actions.

- [ ] **Step 6: Document and verify the complete static gate**

  Update `infra/README.md` with identical local commands. Run all commands from
  a clean checkout and then `pnpm verify`.

- [ ] **Step 7: Commit Terraform static validation**

  ```bash
  git add .tflint.hcl .trivyignore.yaml infra/tests infra/bootstrap/tests .github/workflows/ci.yml .github/dependabot.yml infra/README.md
  git commit -m "ci: add Terraform lint and invariant tests"
  ```

### Task 4: Add trusted real-state Terraform speculative plans

**Files:**
- Create: `.github/workflows/terraform-plan.yml` (reusable via `workflow_call`)
- Create: `.github/scripts/terraform-plan-summary.mjs`
- Create: `.github/scripts/terraform-plan-summary.test.mjs`
- Modify: `infra/iam.tf`
- Modify: `infra/variables.tf`
- Modify: `infra/outputs.tf`
- Modify: `infra/README.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: a conditional caller job in the always-triggered CI workflow for trusted same-repository pull requests classified as Terraform, plus the production S3 backend/variable secrets.
- Produces: redacted speculative plan text and action counts; no reusable plan artifact.

- [ ] **Step 1: Test plan exit-code and redaction handling**

  Unit-test `terraform-plan-summary.mjs` with fixtures for exit codes 0, 1, and
  2; ANSI removal; GitHub output escaping; 1 MiB summary truncation; and lines
  containing values marked sensitive. Exit 0 and 2 must succeed, while exit 1
  fails. The module must never read or serialize `terraform show -json`.

- [ ] **Step 2: Add a dedicated AWS plan role**

  Add a role trusted only by the repository's pull-request OIDC subject. Grant
  S3 list/get for the exact state path, get/put/delete only for the exact
  `.tflock` path, and the `Get`/`List`/`Describe` actions empirically required to
  refresh resources in this configuration. Do not grant mutation actions for
  managed resources, `iam:PassRole`, ECR push, ECS update, S3 state-object put,
  or CloudFront invalidation. Output the plan-role ARN.

- [ ] **Step 3: Apply the role through the existing manual Terraform process**

  Run a local production plan, review it, apply only the plan-role resources,
  and configure repository/environment values `AWS_TERRAFORM_PLAN_ROLE_ARN`,
  backend coordinates, production non-secret variables, sensitive variable
  secrets, and a Cloudflare read token. This is an explicit operator step; do
  not reuse `AWS_ROLE_ARN` from deployment.

- [ ] **Step 4: Implement the speculative-plan workflow**

  Define `terraform-plan.yml` with `on: workflow_call` and explicit inputs for
  the immutable head SHA and repository identity. In the always-triggered
  `ci.yml`, add a `terraform-plan` caller job that needs `changes`, runs only
  when the Terraform scope is selected, and calls the reusable workflow. The
  credentialed called job must additionally verify
  `github.event.pull_request.head.repo.full_name == github.repository`; fork PRs
  receive only Task 3 static validation. Initialize the real backend, select the
  production workspace if one is used, and run:

  ```bash
  set +e
  terraform -chdir=infra plan -input=false -no-color -detailed-exitcode 2>&1 | tee "$RUNNER_TEMP/terraform-plan.txt"
  plan_exit=${PIPESTATUS[0]}
  set -e
  node .github/scripts/terraform-plan-summary.mjs --exit-code "$plan_exit" --input "$RUNNER_TEMP/terraform-plan.txt" --summary "$GITHUB_STEP_SUMMARY"
  ```

  Delete the text file in an `if: always()` step. Never invoke `-out`, never
  upload a plan artifact, and never expose the plan through an untrusted PR
  comment action.

- [ ] **Step 5: Verify least privilege**

  Test a no-change PR, an additive tagged-resource change, and a change that
  would replace a protected resource. Use CloudTrail to enumerate the read calls.
  Remove any unused permissions, confirm that write attempts fail, and confirm
  that the plan cannot read arbitrary state keys.

- [ ] **Step 6: Add the plan result to the aggregate gate**

  Add the reusable-workflow caller job to `CI required`'s `needs` list. Require
  its result only for trusted Terraform PRs. Treat an intentional fork skip as
  success and a plan exit code 1 as failure. Because the caller is part of
  `ci.yml`, no cross-workflow dependency or status-name coupling is required.

- [ ] **Step 7: Commit the Terraform plan workflow**

  ```bash
  git add .github/workflows/terraform-plan.yml .github/scripts/terraform-plan-summary.mjs .github/scripts/terraform-plan-summary.test.mjs infra/iam.tf infra/variables.tf infra/outputs.tf infra/README.md .github/workflows/ci.yml
  git commit -m "ci: preview production Terraform changes"
  ```

### Task 5: Close workflow, database, container, and Rust validation gaps

**Files:**
- Create: `rust-toolchain.toml`
- Create: `.github/workflows/security.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/production-health.yml`
- Modify: `.github/dependabot.yml`
- Modify: `package.json`
- Modify: `packages/database/package.json`
- Modify: `apps/desktop/package.json`
- Modify: `SECURITY.md`

**Interfaces:**
- Consumes: Task 2 scopes `database`, `containers`, `desktop`, and `dependencies`.
- Produces: focused platform-specific checks that complete before production deployment.

- [ ] **Step 1: Add named package scripts**

  Add exact scripts:

  ```json
  {
    "db:check": "pnpm --filter @personal-os/database exec drizzle-kit check",
    "compose:check": "docker compose config --quiet",
    "desktop:fmt": "cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check",
    "desktop:clippy": "cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings",
    "desktop:test": "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml"
  }
  ```

  Pin the stable Rust release currently proven by both release runners in
  `rust-toolchain.toml`, including `rustfmt` and `clippy` components.

- [ ] **Step 2: Add the workflow/script validation lane**

  When `.github/**`, `.codex/scripts/**`, or shell/Python helper paths change,
  run pinned actionlint with ShellCheck, ShellCheck directly over repository
  shell scripts, `python -m py_compile` for Python helpers, and `node --check`
  for plain JavaScript helpers. Keep existing behavioral contract tests.

- [ ] **Step 3: Add database validation**

  On the database scope run `pnpm db:check`, the database Vitest tests, and one
  clean PostgreSQL migration replay. Reuse the locked PostgreSQL 17 image and
  keep migration preservation tests in the API integration suite.

- [ ] **Step 4: Build containers before deployment**

  On the container scope run `pnpm compose:check`, create a Buildx builder, and
  build the affected `api`, `mcp`, and/or `web` targets without pushing. Use a
  separate `type=gha` cache scope for each target. Run Trivy against built API
  and MCP runtime images for high/critical vulnerabilities. Keep ECR scan-on-push
  as defense in depth during deployment.

- [ ] **Step 5: Add fast Rust checks before the cross-platform matrix**

  Run fmt, Clippy, and tests on Ubuntu. Make the conditional macOS/Windows Tauri
  compile matrix depend on this job. Add a Cargo cache keyed by OS,
  `Cargo.lock`, and `rust-toolchain.toml`. Keep both OS builds whenever the
  desktop or embedded web surface changes.

- [ ] **Step 6: Replace per-PR full audit with dependency-diff and scheduled gates**

  On dependency scope PRs, run the SHA-pinned GitHub dependency review action
  and fail on high/critical production vulnerabilities. Create a weekly
  `security.yml` that runs `pnpm audit --prod --audit-level high`; also run the
  full audit on `main`. Enable CodeQL default setup in repository settings for
  JavaScript/TypeScript and GitHub Actions and record that setting in
  `SECURITY.md`. Remove `pnpm audit --prod` from unrelated quality jobs.

- [ ] **Step 7: Pin actions and narrow permissions**

  Resolve every `uses:` reference to a verified full commit SHA and retain a
  tag comment. Move `id-token: write`, `issues: write`, `statuses: write`, and
  `contents: write` to the smallest job scope that uses each permission. Run
  actionlint after every workflow edit.

- [ ] **Step 8: Verify all focused and full gates**

  ```bash
  pnpm db:check
  pnpm compose:check
  pnpm desktop:fmt
  pnpm desktop:clippy
  pnpm desktop:test
  actionlint
  shellcheck .codex/scripts/*.sh .github/scripts/*.sh
  pnpm verify
  ```

  Expected: all pass; an intentionally invalid Dockerfile, workflow expression,
  Drizzle journal, and Rust lint each fail only its intended focused job in test
  branches.

- [ ] **Step 9: Commit platform validation**

  ```bash
  git add rust-toolchain.toml .github package.json packages/database/package.json apps/desktop/package.json SECURITY.md
  git commit -m "ci: validate deployable platform surfaces"
  ```

### Task 6: Partition Vitest coverage by ownership boundary

**Files:**
- Create: `vitest.projects.ts`
- Create: `.github/scripts/affected-vitest-projects.mjs`
- Create: `.github/scripts/affected-vitest-projects.test.mjs`
- Modify: `vitest.config.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: package manifests under `apps/*/package.json` and `packages/*/package.json`

**Interfaces:**
- Consumes: Task 1 `changed_packages` expanded through transitive dependents.
- Produces: named Vitest projects and project-local coverage reports that can be selected safely on PRs.

- [ ] **Step 1: Measure, do not guess, each ownership boundary's baseline**

  Generate JSON coverage from the full suite and calculate statement, function,
  line, and branch coverage separately for domain, database, connectors,
  api-client, UI, API, MCP, web, and repository scripts. Commit the calculation
  test, not transient coverage output. If any boundary is below 95/95/95/94,
  keep the global PR suite active until focused tests raise that boundary to the
  existing policy.

- [ ] **Step 2: Define named Vitest projects**

  Give each project an exact test include and source coverage include rooted in
  its owned directory. Preserve shared aliases, setup, two workers, CI timeout,
  exclusions, and the existing thresholds. Do not let one project's coverage
  count toward another project's threshold.

- [ ] **Step 3: Test affected-project expansion**

  Assert that domain selects every transitive consumer; database and connectors
  select API; api-client selects web and MCP; UI selects web; MCP selects only
  MCP; and root/unknown changes select all projects. Test package renames and a
  cyclic dependency error as fail-closed full selection.

- [ ] **Step 4: Run all projects and close coverage deficits**

  Run `pnpm test:coverage -- --project <name>` for every project. Add public-
  behavior tests until every project independently satisfies 95% statements,
  functions, and lines and 94% branches. Do not add coverage exclusions or lower
  thresholds to make the partition pass.

- [ ] **Step 5: Enable affected-project coverage on pull requests**

  Have the classifier emit a JSON matrix of affected projects and run them in
  parallel Linux jobs. Merge coverage reports only for display. The aggregate
  gate requires every selected project. Keep the full all-project global report
  on every `main` push.

- [ ] **Step 6: Verify selective/full equivalence**

  For one PR in each package boundary, run the selective suite and a non-required
  full suite. Any failure found only by the full suite is a classifier bug: add a
  regression test and broaden the dependency rule before enabling that boundary.

- [ ] **Step 7: Commit coverage partitioning**

  ```bash
  git add vitest.config.ts vitest.projects.ts .github/scripts/affected-vitest-projects.mjs .github/scripts/affected-vitest-projects.test.mjs .github/workflows/ci.yml package.json apps/*/package.json packages/*/package.json
  git commit -m "ci: scope coverage to affected ownership boundaries"
  ```

### Task 7: Make deployment selection proportional and complete the rollout

**Files:**
- Create: `.github/scripts/deployment-scope.mjs`
- Create: `.github/scripts/deployment-scope.test.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `docs/deployment.md`
- Modify: `docs/engineering/ci-audit-2026-08-26.md`

**Interfaces:**
- Consumes: successful `main` CI head SHA and an unambiguous comparison base.
- Produces: `deployable`, `api`, `mcp`, `web`, and `skills` deployment scopes; ambiguity selects every deployment scope.

- [ ] **Step 1: Write deployment-scope tests**

  Cover docs-only; infra-only; API; MCP; web; domain; database; API client; UI;
  public skills; Dockerfile; deployment workflow; multiple commits; merge
  commits; deleted files; empty comparison; missing base; and GitHub API
  truncation. Missing/ambiguous data must deploy everything.

- [ ] **Step 2: Implement independently verifiable deployment classification**

  Reuse the pure path mapping from `ci-scope.mjs` but independently calculate
  the changed paths from the exact successful `main` run range. Do not trust an
  editable artifact from a pull-request run. If the triggering range cannot be
  proven, select all deployable surfaces.

- [ ] **Step 3: Skip non-deployable production runs safely**

  Add an initial deploy `changes` job. A docs-only result records a successful
  neutral deployment status and summary without requesting OIDC credentials,
  building images, or entering the production environment. Deployable results
  retain the existing serial concurrency, protected environment, fail-closed
  API rollout, image scanning, and public health checks.

- [ ] **Step 4: Split build and publication by immutable surface**

  Allow API-, MCP-, web-, and skills-only releases to skip unaffected builds.
  Preserve a single release SHA. Before skipping an API or MCP build, verify
  that the service keeps its current immutable task-definition image; before
  updating one, verify that the new `sha-<commit>` image exists. When both
  services are selected, a partial image pair remains an error. Publish web or
  skills assets only when their scope is selected, and run public health checks
  for every surface after any deployable release.

- [ ] **Step 5: Run a two-week shadow comparison**

  Before enabling deployment skips, report what would have deployed while still
  performing the current full deployment. Compare classifier decisions with
  merged paths and production outcomes. Target zero misses across at least ten
  main-branch runs.

- [ ] **Step 6: Record final performance and correctness metrics**

  Update the audit with p50/p95 PR duration, total runner-minutes by OS,
  cancellation savings, scope distribution, cache hit rate, selective/full
  mismatches, Terraform plan reliability, and deployment build failures. Keep a
  weekly full safety-net workflow if main-branch frequency does not provide one.

- [ ] **Step 7: Run final verification and commit**

  ```bash
  node --test .github/scripts/deployment-scope.test.mjs
  actionlint
  pnpm verify
  git add .github/scripts/deployment-scope.mjs .github/scripts/deployment-scope.test.mjs .github/workflows/ci.yml .github/workflows/deploy.yml docs/deployment.md docs/engineering/ci-audit-2026-08-26.md
  git commit -m "ci: deploy only affected production surfaces"
  ```

## Final self-review checklist

- [ ] Every top-level repository path is owned by a classifier test.
- [ ] Unknown paths and comparison failures run full CI and full deployment.
- [ ] `main` still runs all Vitest projects, global thresholds, both Playwright
  projects, and all release-relevant builds.
- [ ] Terraform static checks require no cloud credentials.
- [ ] Terraform plan uses a non-deploy role and stores no plan artifact.
- [ ] Conditional jobs are not direct branch-protection requirements.
- [ ] `CI required` fails on every selected job failure and on cancellation.
- [ ] No third-party action remains on a movable tag.
- [ ] Deployment permissions are job-scoped and production concurrency remains
  non-cancelling.
- [ ] The audit contains measured before/after results rather than estimated
  savings.
