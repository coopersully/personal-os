# Public Repository Guardrails Design

## Goal

Make Personal OS easier and safer for people and coding agents to contribute to by combining one
context-aware reviewer with deterministic dependency, workflow-security, and contribution-intake
controls that are free for a public repository.

## Options considered

1. Add another AI reviewer beside CodeRabbit. This may find a few unique issues, but duplicates
   feedback and makes review state harder to interpret.
2. Keep CodeRabbit on defaults and add only standalone scanners. This improves deterministic
   coverage but leaves the reviewer unaware of Personal OS's engineering contracts.
3. Configure CodeRabbit and add narrow deterministic guardrails. This keeps one review voice while
   making dependency and workflow-security evidence independently inspectable. This is the selected
   design.

## Design

### Context-aware review

Commit `.coderabbit.yaml` so review behavior is versioned with the repository. Keep the `chill`
profile, skip automatic reviews for drafts and Dependabot PRs, and apply path-specific guidance to
API, MCP, database, workflow, infrastructure, web, and end-to-end changes. CodeRabbit reads the
current PR rubric, external-boundary reliability standard, connector reliability standard, and
design governance documents as code guidelines.

Custom public-safety and external-boundary checks begin in warning mode. The repository's
deterministic checks remain authoritative until those prompts have demonstrated low false-positive
rates. The GitHub Checks timeout is 15 minutes because the complete CI workflow can exceed the
default 90-second integration timeout.

### Deterministic security evidence

- Dependency Review runs on pull requests with read-only contents access and fails when a change
  introduces a high- or critical-severity runtime dependency vulnerability. It reports OpenSSF
  dependency scores but does not create repetitive PR comments.
- OpenSSF Scorecard runs on `main` and weekly. It publishes authenticated results and uploads SARIF
  to GitHub code scanning with the upstream-recommended minimal permissions.
- zizmor scans GitHub Actions on pushes to `main`, pull requests, and weekly. It uploads SARIF to
  code scanning so existing workflow findings can be triaged incrementally. It does not become a
  blocking check until the existing workflow backlog is resolved and merge protection is
  deliberately enabled.

All newly introduced third-party actions are pinned to full commit SHAs and retain their release
versions in comments. Dependabot keeps those pins current.

### Contribution intake and dependency maintenance

Add issue forms for reproducible bugs and bounded product proposals, plus a config file that routes
security reports to private vulnerability reporting. Add a pull-request template matching the
repository PR rubric. The forms request only public-safe engineering context and explicitly reject
secrets, personal information, and provider payloads.

Group compatible Dependabot version and security updates by production/development scope and group
GitHub Actions updates into one PR. Major updates remain separate so they receive focused review.

## Reliability and failure behavior

The committed configuration proves declared policy and static syntax only. These records make each
external boundary and its remaining failure modes auditable.

### GitHub Actions and security services

- **Capability and owner:** GitHub owns hosted workflow execution, the dependency graph, tokens,
  Checks, and code-scanning ingestion; repository maintainers own workflow policy.
- **Authority and transport:** Event-scoped `GITHUB_TOKEN` permissions authorize HTTPS GitHub API
  and SARIF uploads. No long-lived repository secret is introduced.
- **Time and capacity:** Individual jobs use GitHub-hosted runner limits; CodeRabbit check polling is
  bounded to 15 minutes. Queuing, rate limits, or service incidents can delay evidence.
- **Commit point and delivery semantics:** A completed check run or accepted SARIF upload is the
  durable observation. Event delivery is at-least-once, so workflows and uploads must be safe to
  rerun for the same commit.
- **Degraded behavior, recovery, and observation:** A missing dependency graph, denied token, runner
  outage, or rejected upload fails or omits only its security evidence; it does not alter application
  runtime. Maintainers inspect Actions and Security, then rerun the failed job after correcting
  authority or service availability.
- **Evidence and production-disconfirming case:** Green PR-side Dependency Review, zizmor, and SARIF
  checks prove this branch's event path. Local syntax can still pass while repository permissions,
  dependency-graph data, or code-scanning ingestion fail on a later event.

### CodeRabbit

- **Capability and owner:** CodeRabbit owns PR ingestion and review generation; maintainers own the
  versioned `.coderabbit.yaml` policy and GitHub App installation.
- **Authority and transport:** The installed GitHub App reads public PR content and publishes review
  and Check results over provider-managed HTTPS. Repository secrets are not supplied.
- **Time and capacity:** GitHub Check polling is bounded to 15 minutes; provider queues and rate
  limits can delay or omit a review.
- **Commit point and delivery semantics:** A GitHub review or completed Check is the durable result.
  Delivery may be retried or superseded by incremental reviews, so the PR head SHA remains the
  correlation key.
- **Degraded behavior, recovery, and observation:** Provider failure leaves the review absent or
  failed without blocking application runtime. Maintainers inspect the PR Check and CodeRabbit
  review, then request a new review after configuration or provider recovery.
- **Evidence and production-disconfirming case:** A review that reports `.coderabbit.yaml` as its
  configuration proves policy loading for that head. Schema validity can still coexist with a
  revoked installation, provider outage, or behavior change in a later service release.

### OpenSSF Scorecard publication

- **Capability and owner:** OpenSSF owns Scorecard result publication; GitHub owns workflow execution
  and code-scanning ingestion; maintainers own scheduling and permissions.
- **Authority and transport:** GitHub OIDC and scoped workflow permissions authenticate HTTPS result
  publication and SARIF upload without a stored credential.
- **Time and capacity:** The workflow runs on `main` and weekly within GitHub-hosted job limits;
  OpenSSF or GitHub availability can delay publication.
- **Commit point and delivery semantics:** An authenticated published result and accepted SARIF upload
  are the durable commits. Repeated scheduled runs replace or supplement results for later commits.
- **Degraded behavior, recovery, and observation:** Publication or upload failure fails the workflow
  but does not affect application deployment. Maintainers inspect the workflow and Security tab,
  correct permissions or wait for recovery, and rerun.
- **Evidence and production-disconfirming case:** The pinned workflow and PR static checks prove
  configuration only. Default-branch publication can still fail after merge because PR events do
  not exercise the same OIDC, branch, or publication path.

### Action release artifacts

- **Capability and owner:** Each third-party action maintainer owns its release artifact; Personal OS
  maintainers own selection, review, and immutable pin updates.
- **Authority and transport:** GitHub downloads action source over its managed transport by full
  commit SHA. Dependabot may propose later pin updates through ordinary public PRs.
- **Time and capacity:** Checkout is bounded by the containing job; release deletion, repository
  outage, or runner cache behavior can prevent retrieval.
- **Commit point and delivery semantics:** The committed full SHA is the repository's durable
  selection. Runner retrieval is repeatable for that immutable object but not guaranteed available.
- **Degraded behavior, recovery, and observation:** Retrieval or execution failure fails the job.
  Maintainers inspect the action log, verify the upstream release provenance, and deliberately update
  or replace the pin through review.
- **Evidence and production-disconfirming case:** Full-SHA references, Dependabot validation, and a
  successful hosted run prove the selected artifacts resolved for this head. A compromised upstream
  release predating the pin, later repository unavailability, or incompatible runner change can
  still invalidate that evidence.

## Verification

- Parse every committed YAML file locally. Separately fetch CodeRabbit's published JSON Schema with
  fail-on-HTTP, a 20-second timeout, and retries; record its SHA-256 digest and validation result as
  external evidence rather than a deterministic repository gate.
- Run `actionlint` across both `.yml` and `.yaml` workflow files.
- Run zizmor locally to establish the current findings and verify the new workflow uses immutable
  action references.
- Run the repository's deterministic `pnpm verify` gate.
- Push to the existing draft pull request and inspect the live checks; local validation is not
  evidence that GitHub-side integrations are authorized or reachable.
