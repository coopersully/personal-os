# Workspace agent capabilities

This document describes the implementation in the workspace-agent-parity change. It is not a
production deployment claim. The [generated tool dictionary](workspace-agent-tools.md) contains
all discovered names, complete input schemas, required grants, annotations, descriptions, and
adapter/client links. Regenerate it with `pnpm exec tsx scripts/workspace-agent-dictionary.ts`.
The test compares it to actual MCP discovery, including explicit compatibility tools.

## Authority

| Operation class | Bypass disabled | Bypass enabled |
| --- | --- | --- |
| Workspace reads | Existing read scopes | Same |
| Existing direct scoped writes, including Tasks, Reminders, editable Mail drafts and Calendar events | Existing API policy | Same |
| Mail send/reconciliation, rule activation and explicit stewardship decisions | Owner action required | `mail:write` and opt-in `mail:execute` |
| Finance bank sync, budget/guidance activation, explicit review execution and policy management | Existing proposal/review boundary | Relevant read/write grants and opt-in `finances:execute` |
| Workspace preferences | Owner action required | Workspace write plus execute |
| Notification preferences and Texting disconnection | Owner action required | `texting:write` plus `texting:execute`; privacy ceiling still applies |
| Shared source sync/disconnect | Owner action required | Mail, Calendar and Tasks write/execute plus Reminders write |
| Host schedule metadata/recovery | Existing observation allowed for original connection | Explicit Finance execution grants; original connection ownership remains mandatory |
| Grant administration, changing bypass, security/account identity | Owner only | Owner only |
| New provider/phone consent | Owner consent | Owner consent |

Execution grants are opt-in and excluded from default OAuth scopes. Old grants are not widened.
The API checks the persisted token and bypass setting, with additional service checks at acceptance
boundaries. Bypass is standing owner authorization for registered operations, not a way to gain a
scope or assume a human identity. Agent approvals persist the agent identity and approval source.
The original reversible-action evaluator continues to reject unregistered irreversible actions.

## Workspace coverage

| Workspace | Exposed operations | Principal runtime suites |
| --- | --- | --- |
| Mail | Messages, threads, filters, attachments, editable drafts, exact-revision send, uncertain-send reconciliation, rule preview/lifecycle/activation, obligations, disposition, questions, feedback, status/maintenance/reviews | `mail`, `mail-send`, `mail-stewardship` |
| Tasks and Reminders | List/Project/Task creation, updates, moves, lifecycles, mixed workspace reads, Reminder creation/update/completion/trash/restore, filters and attention items | `tasks`; existing Task/Reminder API suites |
| Calendar | Calendar creation/update/deletion/selection, status/reviews, full-field event create/update, preview, blocks, trash/restore, timezone-aware reads | `calendar`; existing Calendar API/provider suites |
| Finances | Reporting, profiles, setup, accounts, categories, imports/classification, merchants, budgets/policies, proposals, questions/reviews, goals/buckets, maintenance/recovery, bank sync and authorization handoff | `finances`, `finance-review`, `ledger`, `planning`, `maintenance`, `budget-policy`, `finance-sync`, `bank-handoff`; existing Finance service suites |
| Shared | Workspace preferences/search, notification override/reset, Texting connection/disconnect, guidance, connected sources, connection-bound host controls | `controls`, `guidance`, `sources`, `recovery`, `authorization`, `texting` |

Suite paths are under `integration/workspace-agent/`. These use the actual MCP client/server,
typed API client, authentication and migrated PostgreSQL. Providers are simulated only at their
connector boundary. The typed API audit rejects missing workspace adapters unless a named semantic
equivalence or owner/provider consent boundary appears in `operation-cases.ts`.

## Cohesive calling conventions

Use `get_` for exact/current records, `list_` for collections, `search_` for text retrieval,
`preview_` before an evidence-bound change, and operation-specific verbs for mutations. Calendar
and Reminder tools retain their established unprefixed entity names. Finance has two intentionally
different profiles: `get_finance_profile` is income/employment configuration; `get_financial_profile`
is the versioned budget-planning profile. Existing deprecated aliases remain compatibility-only.

Transaction readback `version` and split `expectedVersion` use the database-owned material-change
generation, including classification, relationship status and provider edits; audit-history revision
numbers are a separate sequence.

Read before writing. Copy returned IDs, revision/version values, preview tokens, fingerprints and
work references unchanged into the next call. A conflict means reload/re-preview, not incrementing
a guessed revision. Preserve filters while following returned cursors. Omitted patch fields stay
unchanged; use null only where the discovered schema permits it. Do not infer success from the MCP
envelope alone: inspect outcome, pending work, per-item dispositions and canonical readback.

Examples (copy the observed revision/IDs into mutation arguments):

```json
{"name":"get_mail_settings","arguments":{}}
{"name":"update_mail_settings","arguments":{"expectedRevision":1,"preferences":{"includeArchivedInSearch":false}}}
{"name":"create_calendar","arguments":{"name":"Planning","timezone":"America/New_York"}}
{"name":"list_task_lists","arguments":{"limit":25}}
{"name":"get_finance_overview","arguments":{}}
```

For Mail, list owned sending accounts/messages, create a draft, inspect/edit it, then send its exact
`confirmedUpdatedAt`. Uncertain delivery uses `reconcile_mail_draft` with provider evidence; never
blindly resend. Attachment results contain authenticated base64 bytes with media type, filename and
size; the API bounds transfer to 10 MB. Provider attachment IDs are opaque strings, not UUIDs.

For bank connection, call `start_finance_account_connection` with a new idempotency key. Give its
hosted HTTPS URL to the owner for provider login/MFA. Call `complete_finance_account_connection`
with the returned connection ID after consent. Pending means consent is not yet confirmed;
expired/uncertain exchange requires a fresh authorization. Ordinary connection-status reads redact the bearer URL; recover it by replaying the start
operation with its original key and current execution authority. Credentials never enter agent arguments
or results. Completion persists exchange state so a retry cannot repeat the single-use exchange.

Finance transaction-review decisions retain server-owned proposal, confidence and ambiguity checks.
Copy the current proposal; a caller-supplied confidence or rationale alone is not evidence. Unresolved
ambiguous transfers remain pending for owner evidence even with execution authority and bypass.

## Explicit boundaries

- Agents cannot grant themselves access, change bypass, replace host fire-token secrets, verify a
  phone possession challenge, or complete provider login/MFA on the owner's behalf.
- Shared source deletion removes synchronized local projections, not the provider account. It is
  destructive and requires grants across affected workspaces.
- Budget policy evaluation is exposed, but a preview that reports execution unavailable is not a
  promise of automatic budget reallocation. No new money movement or unsupported provider
  recurrence/RSVP capability is introduced.
- Hosted bank authorization needs Plaid Hosted Link support and configured credentials. Local
  connector simulation does not prove production provisioning or real provider consent.

See [verification evidence](workspace-agent-verification.md) for what actually ran and remaining
verification limits. Discovery parity is not exhaustive behavioral or production-provider parity.

Pure budget-policy evaluation requires only `finances:read` and is available in read-only mode with
bypass off. Persisting a preview or changing policy state remains an execution operation. Review
approval/dismissal and host schedule/answer binding changes write credential-attributed audit events
in the same transaction, with safe state/version metadata instead of host secrets or private labels.
