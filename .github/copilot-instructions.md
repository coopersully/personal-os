# Personal OS contributor instructions

Read [AGENTS.md](../AGENTS.md) before changing this repository. It is the source of truth for the local environment, lifecycle actions, and required verification.

## Working conventions

- Keep one coherent outcome per pull request. Do not stage or discard unrelated working-tree changes.
- Use the checked-in `pnpm env:*` lifecycle actions; do not start ad hoc background services.
- Read the nearest product, architecture, design, and engineering documentation before changing a domain contract.
- Run focused checks during development and `pnpm verify` before requesting review or marking a pull request ready.
- Keep current documentation, tests, GitHub issue relationships, and PR descriptions aligned with the delivered behavior.
- Never add credentials, provider payloads, personally identifiable data, private reasoning, or local-machine details to source, docs, issues, or PRs.

## Workflow skills

The public routing guide is [docs/engineering/contributor-agent-workflows.md](../docs/engineering/contributor-agent-workflows.md). Use the narrowest matching skill under `.agents/skills`:

- knowledge and product planning before creating delivery work;
- architecture, database, frontend, MCP, and testing skills for implementation;
- QA for browser-facing acceptance;
- GitHub work and PR skills for delivery tracking, review, and maintenance.

Skills define their own authority boundaries. A request to plan, inspect, or draft does not authorize implementation or GitHub writes unless the selected skill says that it does.
