# nohmi naming contract

- Status: Accepted target contract; repository-wide migration pending
- Last reconciled: 2026-09-10

## Names

The internal repository, package, and infrastructure name is `personal-os`. The user-facing product
name is `nohmi`, always lowercase, including at the start of a sentence.

Former product names are not compatibility identifiers in the target. They must not remain in
current prose, paths, package or skill names, protocol and resource identifiers, metadata, headers,
metrics, logs, infrastructure, domains, fixtures, examples, tests, or generated artifacts.

Use `personal-os` for implementation-owned identifiers such as the repository, package scope,
environment variables, database and runtime names, deployment resources, internal labels, and
service diagnostics. Use `nohmi` for anything a person or agent host sees as the product, including
application copy, public endpoints, MCP server identity and resource namespaces, published skills,
documentation, and support language.

## Migration rule

The existing repository still contains former names in deployed URLs, infrastructure resources,
protocol identifiers, fixtures, tests, skills, and historical documentation. Removing them is a
coordinated hard cutover, not a reason to preserve or add aliases.

The implementation migration must inventory and replace every occurrence while preserving data and
external reachability through a bounded deployment transition. DNS, certificates, OAuth and webhook
callbacks, MCP clients, monitoring, secrets and parameters, runtime labels, published skills, and
production rollback must move together where their contracts depend on one another.

This documentation branch records the target and migration scope but does not perform that runtime
cutover.

## Completion gate

The migration is complete only when:

- a case-insensitive repository scan finds no former-name occurrence in tracked or generated files;
- current application, API, MCP, connector, deployment, monitoring, and local-runtime checks pass;
- public endpoints, callbacks, certificates, registered clients, and published agent artifacts use
  the correct current name;
- production evidence shows the new identifiers are healthy and old endpoints are retired; and
- the implementation log records the cutover, recovery evidence, and any intentionally retained
  third-party value that cannot be changed by nohmi.
