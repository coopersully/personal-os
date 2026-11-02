# Security policy

ilo can hold calendar, mail, task, goal, and financial data. Please do
not report vulnerabilities in public issues or discussions.

Report suspected vulnerabilities through this repository's private
vulnerability reporting form under **Security → Advisories → Report a
vulnerability**. If that form is unavailable, contact a project maintainer
privately before sharing details.

Please include a clear impact description, affected version or commit, and
reproduction steps. We will acknowledge valid reports promptly, work on a fix
privately, and publish a coordinated advisory and release when appropriate.

## Runtime dependency patch boundaries

The production audit remains required with no advisory ignores. The pinned Zod 4.6.6,
body-parser 2.4.0 and Nodemailer 10.1.4 updates address the October 23, 2026 advisory set:

- [Zod collection-validation resource exhaustion](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5):
  direct validation consumers and MCP transitive Zod 4 dependencies use the patched release.
  Existing HTTP body and MCP collection limits remain defense in depth. Compatibility refinements
  preserve existing UTF-16 bounds shared by password forms, Finance service guards and immutable
  budget-policy storage contracts. Public ISO 8601 inputs retain qualified minute precision using
  the patched validators; UTC-only inputs remain UTC-only, while persisted budget-policy JSON
  timestamps retain their seconds requirement. Generated MCP schema documentation reflects these
  contracts and the patched serializer. Migrations and their validation assertions remain unchanged.
- [body-parser compressed-body trailing-byte failure](https://github.com/advisories/GHSA-27r3-jxmh-p828):
  the bounded 2.x override covers Express JSON parsing before MCP routing. The regression uses an
  isolated loopback server and checks delayed trailing bytes after successful decoding, late decoder
  errors, and a subsequent healthy request.
- Nodemailer address parsing fixes for [nested comments](https://github.com/advisories/GHSA-8c8m-p3m8-cjg8),
  [quoted group separators](https://github.com/advisories/GHSA-m943-m63m-w62w) and
  [quoted angle-address text](https://github.com/advisories/GHSA-85x2-q946-cp5h) apply to both direct
  SMTP construction and mailparser's inbound sender/recipient parsing. A connector regression checks
  that nested comment text cannot replace the actual synced sender or recipient.

Overrides cover affected transitive ranges and must be reassessed when parent dependencies advance;
remove them only when the resolved production graph stays patched without them. Exact direct pins
keep this remediation bounded. No transport ports, credentials, message authority or retry semantics
change. An audit pass and local tests do not prove live provider delivery or deployed image contents:
release acceptance must verify the deployed dependency graph and existing authorized health checks.
Do not send real mail merely to validate a package update.
