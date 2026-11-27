# Contributing to nohmi

Start with the [local development guide](docs/local-development.md) to run the app. The [code of conduct](CODE_OF_CONDUCT.md) applies to issues, discussions, and pull requests. Report suspected vulnerabilities through the [security policy](SECURITY.md).

## Prepare a change

- Keep each branch focused on one outcome. For tracked work, link the direct issue in the Nohmi Linear project. The [work context guide](docs/engineering/work-context.md) explains issue routing.
- Follow the existing domain and platform conventions. Update the nearest current documentation when behavior, APIs, permissions, or operations change.
- Use synthetic examples. Keep credentials, personal records, account identifiers, production exports, and generated build output out of contributions.

## Open a pull request

Use the [pull request template](.github/pull_request_template.md) to describe the user impact, link the work and relevant docs, and record the checks you ran. Run focused checks while developing and addressing review feedback. Once review converges, verify the final commit with `pnpm verify` or the equivalent hosted checks. The [delivery verification policy](docs/engineering/delivery-verification.md) defines the required evidence and the narrow exception for eligible Markdown changes.

## Contribution license

By submitting a contribution, you confirm that you have the right to submit it under the repository’s [GNU Affero General Public License v3.0](LICENSE). Contributions are accepted under that same license.
