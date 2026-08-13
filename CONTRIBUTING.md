# Contributing to Personal OS

Thanks for helping improve Personal OS. Please use a focused branch and pull
request for each change, explain the user impact, and include focused tests.

## Before opening a pull request

1. Do not include credentials, production exports, personal journals, account
   identifiers, or generated build output.
2. Update the nearest current documentation when behavior, API contracts,
   authorization, deployment, or operations change.
3. Run `pnpm verify` before requesting review.
4. Keep changes compatible with self-hosted deployments where practical.

## Automated review

- CI validates formatting, types, tests, coverage, builds, infrastructure, and browser acceptance.
- Dependency Review rejects newly introduced high- or critical-severity runtime vulnerabilities.
- CodeRabbit applies the repository's engineering and design standards without replacing required
  deterministic checks or human review.
- OpenSSF Scorecard and zizmor publish supply-chain and GitHub Actions findings to the repository's
  Security tab for maintainer triage.

Automated output is evidence, not authority. A passing check does not establish that an external
service, credential, callback, or production path works; describe remaining production-only proof
in the pull request.

By submitting a contribution, you confirm that you have the right to submit it
under the repository's AGPL-3.0 license. Contributions are accepted under that
same license.

For a security issue, follow [SECURITY.md](SECURITY.md) instead of opening a
public issue.
