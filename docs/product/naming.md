# nohmi naming contract

- Status: Accepted target contract; repository-wide migration pending
- Last reconciled: 2026-10-26

## Names

The internal application name is **Personal OS**. The repository, package, and infrastructure
identifier is `personal-os`. Use `PersonalOs` / `personalOs` for implementation types, functions,
and components, and `PERSONAL_OS` for constants and environment variables. The user-facing product
name is `nohmi`, always lowercase, including at the start of a sentence. This includes the signed-in
application as well as public pages; Personal OS is not an alternative name shown inside the app.

Former product names are not compatibility identifiers in the target. They must not remain in
current prose, paths, package or skill names, protocol and resource identifiers, metadata, headers,
metrics, logs, infrastructure, domains, fixtures, examples, tests, or generated artifacts.

Use `personal-os` for implementation-owned identifiers such as the repository, package scope,
environment variables, database and runtime names, deployment resources, internal labels, and
service diagnostics. Use `nohmi` for anything a person or agent host sees as the product, including
application copy, public endpoints, MCP server identity and resource namespaces, published skills,
product documentation, and support language. Engineering prose may use Personal OS to describe the
implementation. Product descriptions in engineering documents still call the product nohmi.

## Current application audit

The October 26 source cleanup aligns implementation types, the API client, MCP composition and
catalog, web brand components, native Swift package/widget targets and Rust bridge symbols with
Personal OS. Developer diagnostics, transient workspace-search events, setup query-cache keys and
desktop build environment variables use the internal identity. Finance CSV exports and remaining
product copy use nohmi. The optional setup reference advances to v0.2.1 so changed public copy
does not reuse its prior immutable artifact identity. Desktop display names, PWA metadata, public
pages, notifications, and published installer filenames retain the user-facing brand.

Existing state and external contracts still require a coordinated migration. This source cleanup
does not claim the repository-wide migration below is complete. In particular:

- MCP orientation/setup tool names, resource URIs and metadata keys still use their existing
  protocol identities; callers and published setup references must move together.
- Existing browser storage keys, native preferences, widget cache files and notification category
  identifiers retain their stored names to preserve device identity, preferences and pending work.
- Finance playbook IDs and Texting provenance values are serialized domain values, distinct from
  implementation constant/type names.
- The installed desktop deep-link scheme, deployment drain header, production account, Compose and
  launch-agent identities, monitoring labels, DNS names and cloud resources need runtime migration
  and production evidence before their identifiers change.
- GitHub release jobs map existing account-level signing secrets and updater variables to
  `PERSONAL_OS_*` process variables. Those external bindings retain their configured names.
- Historical migrations, plans, release metadata and legacy recovery values remain evidence of
  existing state. They must not be rewritten to imply that a runtime cutover has already happened.

New implementation identifiers follow the internal name; new product copy follows nohmi. Do not
copy an existing compatibility identifier into a new surface.

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

Before the cutover, change review rejects newly invented former-name identifiers and treats an
unchanged deployed compatibility value moved during a documentation or skill rename as current
implementation evidence, not target vocabulary. This transitional rule is not an allowlist for the
completed migration: the final gate below still requires literal zero occurrences.

## Completion gate

The migration is complete only when:

- a case-insensitive repository scan finds no former-name occurrence in tracked or generated files;
- current application, API, MCP, connector, deployment, monitoring, and local-runtime checks pass;
- public endpoints, callbacks, certificates, registered clients, and published agent artifacts use
  the correct current name;
- production evidence shows the new identifiers are healthy and old endpoints are retired; and
- the implementation log records the cutover and recovery evidence without retaining a former name
  as a tracked compatibility value.
