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

GitHub, CodeRabbit, the OpenSSF service, and action release artifacts are external boundaries. The
committed configuration proves declared policy and static syntax only. GitHub-hosted execution will
prove token authority, dependency-graph availability, SARIF upload, and OpenSSF publication after
the branch is pushed. Scanner outages fail their own jobs without changing application runtime or
deployment state.

## Verification

- Parse every YAML file and validate `.coderabbit.yaml` against CodeRabbit's published JSON Schema.
- Run `actionlint` across all workflow files.
- Run zizmor locally to establish the current findings and verify the new workflow uses immutable
  action references.
- Run the repository's deterministic `pnpm verify` gate.
- Push to the existing draft pull request and inspect the live checks; local validation is not
  evidence that GitHub-side integrations are authorized or reachable.
