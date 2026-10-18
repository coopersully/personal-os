# Finance automation prompt issuance and health

The existing external-host registry owns Finance registration identity, authorization connection,
scopes, lifecycle and observed host slots. A registration does not create or edit an external job.
This increment adds server-issued prompt history and grace-aware observational health. It does not
implement generic-host enrollment, passive recognition, durable overdue notifications or Chat.

## Issued instructions

`automation_host_prompt_issues` stores the owner, existing internal schedule ID, positive template
version, schedule version at issuance, exact issued text and server issuance time. The composite
owner/schedule/template key is the replay identity. The composite schedule foreign key prevents
cross-owner issues. Cancellation/revocation retains history; privacy deletion cascades with the
schedule. There is no backfill: an older registration may have no recorded issued prompt.

New registration commits its initial prompt and both audit events in the same transaction. Failure
rolls back the whole registration. The existing registration POST has no new idempotency guarantee.
Issuing or copying a prompt never creates a host job or proves the host adopted the instructions.

The server template takes the stable internal schedule ID and immutable host surface. Labels and
cadence are not embedded mutable inputs. Current instructions use the existing continuation and
`maintain_finances` protocol and prohibit budget self-approval. The ID is not a credential. Every
instruction change requires a new monotonically increasing template version. Never rewrite issued
text to match a new release or a changed schedule label.

## API and authority

- `PUT /v1/automation-hosts/:id/prompts/:version`, body `{expectedScheduleVersion}`: issues the
  current available template after checking schedule ownership, original connection, live Finance
  grant, workspace execution authority, nonterminal state and optimistic schedule version. The
  schedule row lock serializes concurrent requests. An existing issue returns byte-identical text,
  original issuance time and original schedule version without a new audit or schedule version bump.
  This replay is a history read and works after a later edit or local cancellation/revocation.
- `GET /v1/automation-hosts/:id/prompts/:version`: returns exactly the stored issue; missing history
  is a not-found response rather than newly rendered text.
- `GET /v1/automation-hosts/:id/prompts?beforeVersion=2&limit=20`: reads descending template versions.
  The default page size is 20, maximum 100. `nextCursor` is an exclusive template-version cursor.
  Reads never create issues. Owner and original-connection isolation also apply to history.

Human routes retain Finance read/write scope checks. Maintenance agents use the existing
`finances:maintain` host scope; the service enforces original-connection and execution authority.
A stored ID or copied text cannot grant authority. Issuance audits record version identities rather
than prompt payloads or credentials.

Schedule status responses add `prompt` with `latestIssued` (nullable), `currentTemplateVersion` and
`upgradeAvailable`, plus `externalAdoption: "unknown"`. They also explicitly return unverified Chat capability with reason
`message_protocol_unavailable`. Active registration, host observation, a prompt issue and successful
maintenance cannot verify Chat. A future conversation protocol must prove its own challenge-bound
fetch, acknowledgment and persisted response before enabling that capability.

The existing host-settings screen still renders its original client prompt in this backend slice.
A subsequent UI increment will consume stored text for recopy and explicit upgrades. Existing
consumers retain schedule, health and continuation fields; shared domain exports already flow through
the existing host-module wildcard export.

## Health semantics

For an active interval registration, the approved grace is
`min(60 minutes, max(5 minutes, 10% of recurrence interval))`. Daily and weekly intervals use 60
minutes. Fractional minutes are retained. `overdueAt` is the persisted host `nextExpectedAt` plus
`graceMilliseconds`; health becomes overdue strictly after that deadline. At the exact deadline it
remains expected. Reading status never advances the slot or fabricates recovery evidence.

Event-only hosts have no next-run countdown, grace or deadline. Setup-pending, paused, cancelled and
revoked registrations also have null grace/deadline. `lastObservedAt` means host observation, not
maintenance start or success. Run creation/update timestamps do not prove execution start/completion.
Durable overdue-episode notification and accurate execution-history timestamps remain separate work.

## Migration and external boundary

Migration `0113_finance_host_prompt_issues` only creates the new table and constraints. Existing
schedule JSON and rows remain unchanged. Deploy the additive migration before application code
queries the new table; an older application can continue operating against the expanded database.
Rollback application code can leave the table and issued evidence intact. Published migration history
is immutable; corrections require another migration.

The durable acceptance point is the committed schedule/issue/audit transaction (or committed issue
and audit for upgrades). Prompt/history reads are bounded; there is no new network hop, credential,
provider action or scheduler. The external host remains responsible for installing instructions and
running them with the original authorized connection. Green local tests cannot prove host adoption,
reachability or actual execution. The release owner must separately observe a supported host under
existing authorized scope before making operational claims. This increment grants no new production
action authority.

## Verification

Domain tests cover the grace floor, fractional interval, cap, exact boundary and event semantics.
Renderer tests isolate two schedule IDs. Route/client tests cover scoped adapters and exact request
identity. PostgreSQL integration tests exercise migrations, owner foreign keys, privacy deletion,
concurrent replay, immutable upgrades/history, stale versions, terminal registrations, authority
failures and atomic registration rollback on prompt-audit failure. Required complete candidate
verification and independent review remain release gates; written tests are not execution evidence.
