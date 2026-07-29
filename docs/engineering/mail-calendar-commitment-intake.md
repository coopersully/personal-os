# Mail-to-Calendar Commitment Intake

This prerequisite boundary specializes
[`external-boundary-reliability.md`](external-boundary-reliability.md) and
[`connector-reliability.md`](connector-reliability.md). It does not create Calendar events.

## Current durable handoff

- Mail connector sync recognizes only calendar MIME attachment metadata (`text/calendar`,
  `text/x-vcalendar`, or `application/ics`). Cached prose and every other attachment remain outside
  this intake path.
- One append-only intake identity binds the owning user/account, provider thread/message, provider
  MIME part ID, local thread/message, local thread revision, attachment metadata fingerprint, and a
  fingerprint of the complete cached message projection. The snapshot also preserves per-message
  provider labels/revision and a hash of the authenticated account address. Account/message/part
  uniqueness and a stable idempotency key suppress replay.
- The durable database insert is the handoff. It survives the sync request and does not depend on
  an MCP caller or in-memory task.
- Every current row is `provider_projected_unverified` and `preview_only`. Attachment type, name,
  sender, body text, or caller classification is not evidence that the person committed.
- Re-observing the exact source preserves a later lifecycle state. A changed source fingerprint
  demotes the same identity to unverified preview so stale verification cannot authorize work.
- Audit records contain safe IDs, state, fingerprints, and hashes of remote identities. They omit
  message bodies, addresses, subjects, filenames, provider payloads, and credentials.
- Mail setup reports preview-only intake count, zero server-verified items, and
  `automaticCreationEnabled: false`. Preferences remain separate from authorization.

The evidence-kind column is an open server-owned vocabulary. A later authenticated MIME verifier
can promote the existing message/part identity to a deterministic kind without changing the
storage shape merely to add that kind. Lifecycle states also reserve pending, claimed,
reconciliation, succeeded, and failed work, but this prerequisite does not enter them.

## External boundary record

| Concern | Current answer |
| --- | --- |
| Capability and owner | Mail owns provider source capture. Integration will own verification and the cross-domain handoff. Calendar owns destination validation and provider effects. |
| Configuration and authority | Existing Mail read authority permits projection only. No profile preference, MCP annotation, attachment, or caller payload authorizes Calendar creation. |
| Transport | Existing Google HTTPS or iCloud IMAP sync transports supply metadata. No attachment download, verifier, queue, port, or credential is added. |
| Time and capacity | Intake is bounded by the provider sync page and projected messages. Stable identity makes repeat sync idempotent. |
| Commit point | Intake plus its redacted audit is committed atomically after the exact Mail message projection exists. |
| Delivery semantics | Duplicate observation converges on one account/message/part row. Changed cached source material demotes verification state. |
| Degraded behavior | Failure fails the owning sync visibly; a later sync retries the same deterministic insert. Calendar remains unchanged. |
| Recovery and observation | Setup exposes preview-only count. Database state and redacted activity identify the source handoff without exposing content. |
| Evidence | Unit tests cover MIME boundaries and revision fingerprints; database tests cover identity and lifecycle constraints; connector integration covers persistence and audit redaction. |

All tests can be green while production provider metadata is incomplete, MIME part IDs change, or
the deployed connector lacks access to attachment bytes and authentication results. Those remain
explicit evidence gaps, not provider success.

## Follow-up acceptance: verifier

- The first auto-eligible class is Google-only paired iTIP. An inbound `METHOD:REQUEST` is
  insufficient by itself; require a later per-message Gmail `SENT`-labeled `METHOD:REPLY` with the
  same UID, ORGANIZER, and highest non-cancelled SEQUENCE.
- The reply must contain exactly one nondelegated attendee matching the authenticated Gmail profile
  address with `PARTSTAT=ACCEPTED`. Inbound `PARTSTAT=ACCEPTED` is not acceptance evidence.
- Initially accept only one non-recurring timed UTC VEVENT with explicit DTSTART and DTEND.
  Recurrence, floating/local times, all-day values, multiple events, cancellation, delegation, or
  ambiguity remain preview-only.
- Fetch the exact provider message and MIME part with a bounded timeout, explicit size limit, and
  stable provider revision; verify the downloaded digest against the claimed part.
- Validate provider authentication and sender/organizer identity using provider-supplied,
  server-checked results. Cached prose, filenames, and caller assertions never satisfy this gate.
- Parse only the bounded iCalendar contract above and bind every decision to exact message label,
  provider revision, MIME part identity, and downloaded digest.
- Persist a redacted verification result and deterministic evidence kind against the unchanged
  intake fingerprint. Source disappearance or revision drift demotes the intake and any dependent
  rule/profile authorization.
- Add separately specified authenticated ticket/reservation formats only when their issuer,
  commitment status, time, and stable provider identity can be verified without prose inference.

## Follow-up acceptance: durable Calendar execution

- Require one fresh signed-in acceptance that promotes a disabled preview rule to
  `approved_rule`; the versioned cross-domain rule binds the source Google Mail account to one local
  Calendar destination. Setup preferences alone never authorize execution.
- Snapshot exact Mail intake, Mail rule/profile, Calendar profile, writable destination, and all
  revisions into durable work before acknowledging acceptance.
- Revalidate ownership, source presence, evidence digest, rule/profile versions, destination
  capability/freshness, time zone/all-day boundaries, and exact-source deduplication before write.
- Use a deterministic event identity and the Calendar provider-effect ledger. Persist pending,
  claimed, indeterminate/reconciliation, succeeded, and terminal failure states with bounded lease,
  retry, and repair behavior.
- Reconcile an indeterminate provider create by exact provider identity before replay. Never report
  success from a mock, an MCP caller staying alive, or a provider response that was not projected
  and audited.
- Leave ambiguous prose and unsupported ticket/reservation evidence preview-only.
