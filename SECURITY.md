# Security policy

nohmi handles private mail, calendars, tasks, and financial records. Report suspected vulnerabilities privately so maintainers can investigate while protecting the people affected.

## Report a vulnerability

Use GitHub’s [private vulnerability reporting form](https://github.com/coopersully/personal-os/security/advisories/new). If the form is unavailable, contact a project maintainer privately before sharing details.

Include the affected version or commit, the impact, and the steps needed to reproduce the issue using synthetic data. Redact tokens, credentials, account identifiers, and personal records from logs and screenshots.

Maintainers will acknowledge valid reports, work on a fix privately, and coordinate an advisory and release when appropriate.

## Dependency security

The Node build in CI runs `pnpm audit --prod`. Approved exceptions, their owners, and the conditions for removing them are recorded in the [dependency audit policy](docs/engineering/code-standards.md#dependency-audit-exceptions). The active package-manager configuration lives in [pnpm-workspace.yaml](pnpm-workspace.yaml).
