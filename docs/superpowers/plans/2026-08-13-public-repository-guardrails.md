# Public Repository Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved priority-one public repository guardrails to Personal OS.

**Architecture:** CodeRabbit supplies repository-aware review while GitHub Actions supply narrow,
independently observable dependency and workflow-security evidence. GitHub templates normalize
public contribution intake, and Dependabot groups compatible maintenance work.

**Tech Stack:** CodeRabbit configuration v2, GitHub Actions, Dependency Review, OpenSSF Scorecard,
zizmor, Dependabot, GitHub issue forms.

## Global Constraints

- Keep CodeRabbit as the only AI reviewer.
- Use least-privilege workflow permissions and pin every newly added action to a full commit SHA.
- Keep all committed prompts, forms, examples, and documentation public-safe.
- Treat GitHub-side execution as production-only evidence; local parsing proves configuration only.
- Run `pnpm verify` before publishing.

---

### Task 1: Version-controlled review policy

**Files:**
- Create: `.coderabbit.yaml`

**Interfaces:**
- Consumes: `AGENTS.md` and current engineering/design standards.
- Produces: CodeRabbit review, analyzer, knowledge-base, and warning-mode pre-merge policy.

- [ ] Create the configuration with path-specific guidance and public-safety checks.
- [ ] Validate it against `https://coderabbit.ai/integrations/schema.v2.json` using PyYAML and
  JSON Schema.
- [ ] Confirm no local paths, personal information, or maintainer-only workflows are present.

### Task 2: Deterministic security workflows

**Files:**
- Create: `.github/workflows/dependency-review.yml`
- Create: `.github/workflows/scorecard.yml`
- Create: `.github/workflows/zizmor.yml`

**Interfaces:**
- Consumes: GitHub dependency graph, repository workflows, and GitHub code scanning.
- Produces: PR dependency gate plus Scorecard and zizmor SARIF findings.

- [ ] Add Dependency Review at high severity for runtime dependencies.
- [ ] Add the upstream-recommended Scorecard workflow with authenticated result publication.
- [ ] Add zizmor in stateful Advanced Security mode for incremental triage.
- [ ] Pin every action to its verified release commit.
- [ ] Run `actionlint .github/workflows/*.yml` and local zizmor analysis.

### Task 3: Public contribution intake and dependency grouping

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/pull_request_template.md`
- Modify: `.github/dependabot.yml`

**Interfaces:**
- Consumes: the repository PR rubric, public security policy, and current package ecosystems.
- Produces: structured public issue/PR submissions and bounded Dependabot PR volume.

- [ ] Add public-safe bug and product-proposal forms.
- [ ] Route vulnerability reports to private vulnerability reporting.
- [ ] Add a PR template matching every required rubric section.
- [ ] Group compatible npm production/development updates and GitHub Actions updates while keeping
  major updates independent.
- [ ] Parse all changed YAML and inspect the generated diff.

### Task 4: Verify and publish

**Files:**
- Modify: current draft pull-request description.

**Interfaces:**
- Consumes: the complete branch diff and fresh local/GitHub evidence.
- Produces: a pushed commit and accurate draft PR #109 reviewer snapshot.

- [ ] Run focused schema, actionlint, and zizmor checks.
- [ ] Run `pnpm lint` and `pnpm verify`.
- [ ] Stage only the intended files and inspect the staged diff.
- [ ] Commit, push, and update PR #109 with the new scope, verification, and boundary analysis.
- [ ] Re-read the live PR head, draft state, and check rollup.
