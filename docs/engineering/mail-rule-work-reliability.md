# Durable Mail Rule Reliability

This record specializes
[`external-boundary-reliability.md`](external-boundary-reliability.md) and
[`connector-reliability.md`](connector-reliability.md) for approved Google Mail rule execution.

## Capability and authority

- The Mail domain owns rule/profile validation and the durable work ledger.
- A signed-in person activates a 15-minute reviewed rule. MCP may draft, preview, and review but
  cannot activate it.
- An executable item snapshots the user, Google account, provider thread ID, local thread ID,
  rule/profile versions, source projection revision, action, action fingerprint, and due time.
- Execution revalidates the active `approved_rule`, exact rule version and action, active compatible
  profile/version and retention preference, explicit Google source, current matching thread, and
  owned custom-label destination. Any drift fails closed.
- Mail bodies are untrusted data and never grant execution authority.

## Configuration and transport

- Google OAuth credentials remain encrypted on the connected account. Archive, mark-read, star,
  and label use Gmail `users.threads.modify`; recoverable Trash uses `users.threads.trash`.
- The connector's shared HTTPS timeout is 15 seconds, below the 60-second production edge timeout.
  The scheduler is background work and does not rely on an interactive request remaining open.
- Gmail HTTPS requires production egress on TCP 443. No new port or provider credential is added.
- Permanent thread deletion, provider filter creation, spam classification, and unsubscribe
  automation are not connector capabilities.

## Time, paging, and capacity

- `due_at` is the projected conversation `received_at` plus the accepted action's `afterDays`.
  Every immediate or delayed action crosses the same durable handoff.
- Sync enqueues positive matching evidence. A thread missing from Gmail's capped newest-thread page
  is retained and is never treated as deletion evidence.
- One scheduler pass claims at most six conversations and executes with two workers. Work beyond
  that bound remains pending for a later pass.
- Run-summary maintenance independently selects at most six oldest accounts missing a summary and
  six oldest open summaries per pass. Creating or refreshing a summary advances it out of the
  oldest set, so later passes repair the remaining accounts without historical failures causing
  unbounded scheduler fan-out.
- Claims lease for ten minutes. A stale claim becomes reconciliation work because the prior
  provider effect is unknown.
- Each work item receives at most five claimed attempts with 1, 5, 15, 60, and 360 minute backoff.
  Exhausted work becomes terminally failed instead of silently disappearing or becoming
  permanently non-claimable.

## Commit point and delivery semantics

- The durable insert is the handoff; enqueue and the redacted `mail.synced` handoff audit commit in
  one transaction, and no in-memory timer or detached promise carries delivery.
- Claiming locks candidate local thread and account rows with `FOR UPDATE SKIP LOCKED`, groups all
  due actions for one provider thread and accepted rule revision under one claim, and excludes a
  thread with another active claim. Connection disable/disconnect refuses while an effect is
  claimed or while `applied`/`indeterminate` evidence remains in reconciliation or failed review,
  so lifecycle change cannot erase accepted-effect reconciliation authority.
- Delivery is at-least-once with exact-state reconciliation. Stable account/thread/rule/profile
  revision/action identity and a unique database index suppress duplicate enqueue while allowing a
  newly accepted profile revision to create independently authorized work. Compatible modify
  actions coalesce into one provider call per conversation.
- Provider success precedes refreshed-credential persistence and the atomic local projection,
  work-state, and redacted audit commit. If either local step fails, the recorded provider effect
  is `applied` or `indeterminate` and the item enters reconciliation.
- Reconciliation resolves the immutable action snapshot and provider label locator before checking
  current rule authorization, then reads that exact Gmail thread with `format=minimal`. It marks an
  already-applied action complete without another write even if the rule was revoked. A revoked
  rule may be observed but is never replayed; only a still-authorized, still-missing idempotent
  state change may execute.

## Degraded behavior and recovery

- HTTP 429 is a confirmed rejection and backs off without claiming a provider effect.
- HTTP 404 is a confirmed missing provider source and fails terminally.
- HTTP 401/403 after connector refresh is a confirmed authorization rejection and fails closed so
  the signed-in person sees review attention, reconnects, and accepts a new rule revision.
- HTTP 408, 5xx, transport ambiguity, process loss, credential-persistence failure after a write,
  and provider-success/local-commit failure reconcile exact provider state before replay.
- A changed or paused rule, changed profile or retention preference, disconnected source, changed
  match, or removed label fails before a provider write.
- Setup context and Agent access expose pending, in-progress, reconciliation, failed, oldest-due,
  and last-completed state. Reconciliation or terminal failure also creates redacted Mail
  attention. Connector-managed run-summary create, refresh, and resolution advance the shared
  attention version and write a redacted audit atomically with connector actor,
  `approved_rule` policy, and background-dispatch metadata. No body, snippet, credential, provider
  error body, or token enters those summaries or audits. Every scheduler pass rediscovers bounded,
  oldest-first sets of accounts missing summaries and accounts with open summaries. Accounts that
  already have an open summary are excluded from missing-summary discovery, so repair rotates
  without starvation and a transactional audit failure is retried on a later dispatch even after
  the work itself became terminal.
- A person repairs authorization in **Settings → Connections**, refreshes source projection through
  **Mail → Sync**, and reviews changed rules in **Settings → Agent access → Review Mail rules**.
- Reauthorizing the same Google Mail account with Mail scope atomically moves failed
  `applied`/`indeterminate` evidence back to reconciliation, resets its bounded attempt budget, and
  preserves the evidence. The scheduler then performs an exact no-replay read. Until that review
  settles, account disconnect and Mail disable remain blocked. Legacy iCloud rows cannot use the
  Google-only durable executor and require support/operator resolution rather than a synthetic
  retry.
- A terminal item with no unresolved external-effect evidence remains historical; a newly reviewed
  rule revision produces a distinct work identity.

## Evidence and remaining production proof

Automated evidence covers unique enqueue, overlapping workers, the six-conversation bound, stale
claim recovery, one-day Trash, 404, 429, timeout ambiguity, credential rotation persistence
failure, provider-success/local-commit failure, profile drift, exact no-replay reconciliation,
revocation during reconciliation, reauthorization repair, lifecycle fencing, redacted setup
status, and schema claim invariants. Connector unit tests assert the dedicated Gmail minimal-read
and Trash requests. Integration coverage also proves bounded run-summary rediscovery and eventual
repair and resolution when the account set exceeds one pass.

These tests and local PostgreSQL integration are not proof of production Gmail authority or
delivery. Before declaring production operation verified, use a non-destructive dedicated Google
test account to activate a narrow test-label rule, observe durable pending → succeeded state and
the matching provider label, then exercise recoverable Trash on a disposable test conversation and
restore it from Gmail Trash. Confirm the deployed scheduler is invoking runs and that production
logs/attention expose a deliberately rejected test action without sensitive content.
