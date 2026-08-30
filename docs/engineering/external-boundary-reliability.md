# External Boundary Reliability

An external dependency is any system whose availability, authority, timing, or state ilo does not
fully control. This includes provider APIs, databases, queues, object stores, mail protocols,
webhooks, model hosts, operating-system bridges, deployment services, and browser redirects.

The engineering mistake to avoid is proving only that the application code is plausible.
Production behavior crosses several independent contracts, and every one must be reasoned about
and evidenced.

## Readiness is a sequence, not a boolean

Use these terms precisely:

| State | What has been established |
| --- | --- |
| Declared | The dependency, capability, owner, and required configuration are documented. |
| Configured | A value is present in the intended runtime. This does not prove that a secret is valid. |
| Authorized | The credential, consent, scopes, role, callback, and resource policy permit the operation. |
| Reachable | DNS, routing, proxy, TLS, protocol, port, firewall, and security-group rules permit the path. |
| Bounded | Deadlines, per-attempt timeouts, payload limits, pagination, concurrency, and rate behavior fit the caller's budget. |
| Recoverable | Partial success, duplicate delivery, process loss, retry, cancellation, and repair have explicit semantics. |
| Observable | Progress, freshness, failure, correlation, and operator or user recovery are visible without exposing secrets. |
| Verified | Production-equivalent evidence has exercised the real path at the appropriate risk level. |

Do not describe an integration as “working,” “healthy,” or “fully configured” when only an
environment variable or API key is present. Secret values must never be printed merely to inspect
them; validate them through the least-privileged, non-destructive operation that proves the required
capability.

## Required boundary record

Before implementing or reviewing a changed external boundary, answer this matrix. Put stable
answers in the nearest architecture, engineering, or deployment document and change-specific
evidence in the pull request.

| Concern | Required question |
| --- | --- |
| Capability and owner | What exact operation crosses the boundary, and which component owns it? |
| Configuration and authority | Which runtime value, identity, scope, consent, role, callback, or resource policy authorizes it? |
| Transport | Which host class, protocol, port, TLS mode, proxy, ingress, and egress path does it require? |
| Time and capacity | What is the caller deadline, per-attempt timeout, retry allowance, page or payload bound, concurrency limit, and rate-limit behavior? |
| Commit point | What durable state means the request was accepted, and what work may continue afterward? |
| Delivery semantics | Can work be duplicated, reordered, partially applied, cancelled, or replayed; what makes it idempotent or reversible? |
| Degraded behavior | What does the user or caller see when the dependency is slow, denied, unavailable, or only partly successful? |
| Recovery and observation | Who retries or repairs it, where are progress and redacted errors stored, and which signal identifies a production failure? |
| Evidence | Which checks prove code behavior, runtime policy, production-equivalent reachability, and post-deploy operation? |

If an answer is unknown, record it as an evidence gap or blocker. Do not silently replace it with
an assumption from a local mock, SDK default, remembered cloud policy, or the presence of a secret.

## Required reasoning method

Review the complete path, not only the function changed in the diff:

1. Trace the request from caller and public edge through the handler, persistence, asynchronous
   work, external dependency, projection, and user/operator feedback.
2. Inventory every network hop, SDK-created socket, callback or webhook, credential boundary,
   timeout, queue or scheduler handoff, and durable write on that path.
3. Compare application assumptions with deployed configuration and infrastructure as code. A
   port in a client, callback in a dashboard, or permission in code is not automatically present in
   the runtime environment.
4. Identify the commit point. Work that can outlive the caller's deadline must cross a durable
   handoff before the response and must not depend on an in-memory promise for eventual recovery.
5. Challenge the happy path with at least: invalid authority, unreachable or hanging transport,
   rate limiting, malformed response, partial persistence, duplicate or replayed delivery, and
   process loss after the commit point.
6. State the disconfirming case explicitly: **What could make all current tests green while this
   still fails in production?** Add evidence or expose the remaining risk.

This reasoning is required even when the code change is small. External failures usually live in
the negative space between application, infrastructure, provider configuration, and operations.

## Time and lifecycle rules

- Each downstream timeout must leave budget for the caller to persist state and return a controlled
  result before its own deadline.
- Retries consume the same end-to-end budget; multiplying a per-attempt timeout by retries must not
  exceed it.
- Paginated, bulk, backfill, discovery, and reconciliation work is background work unless it has a
  proven small bound.
- Acceptance and completion are distinct states. Return success only for the state durably achieved
  so far, and name pending work honestly.
- Background work needs a durable identity, idempotency or reconciliation rule, progress state,
  bounded retry, stale-work recovery, and a terminal error or repair path.
- Increasing an edge timeout is a capacity decision, not a substitute for a missing lifecycle
  boundary.

## Evidence ladder

Use evidence proportional to the failure cost. No single layer proves the whole boundary.

1. **Static contract:** schema/config validation, lint rules, and consistency checks catch declared
   drift.
2. **Behavior tests:** unit tests cover parsing, timeout, cancellation, idempotency, and degraded
   states.
3. **Integration tests:** the real persistence and lifecycle path covers partial success, retry,
   replay, and process-boundary behavior using a simulator or controlled dependency.
4. **Runtime-policy evidence:** infrastructure validation or plan proves required secrets,
   routes, protocols, ports, roles, callbacks, and resource policies are wired.
5. **Production-equivalent smoke:** a least-privileged non-destructive operation proves authority
   and reachability from the deployed runtime.
6. **Post-deploy evidence:** health, structured logs, metrics, alerts, and a repair action prove the
   boundary remains operable.

A mocked success response proves application behavior only. A successful infrastructure plan proves
declared policy only. A healthy process proves neither that credentials work nor that the required
external capability is reachable.

## Change and review gate

A change to an external dependency is incomplete until:

- code, runtime configuration, infrastructure, deployment order, and current docs agree;
- the boundary record has no hidden unknowns;
- failure and recovery behavior is tested at the layer that owns it;
- the pull request separates what is implemented from what is actually evidenced;
- any production-only verification is listed with its owner and safe post-deploy action; and
- rollback does not strand accepted work or destroy the evidence needed to reconcile it.

Specialized standards may add stricter rules. Connector work additionally follows
[`connector-reliability.md`](connector-reliability.md), and database changes follow
[`database-migrations.md`](database-migrations.md).

## Finance provider authorization handoff

The Finance account-connection boundary creates a Plaid Link authorization handoff; the API owns
the attempt record and the Plaid connector owns the provider request. The configured Plaid client
identity, allowed products, country, redirect/callback settings, and the user's consent authorize
the operation. Connector transport must use the shared HTTPS timeout policy and the request must
fit within the API deadline without retrying an unbounded provider workflow.

The durable commit point is a `finance_account_connections` row in `pending` state, created before
the provider request. A successful provider response stores the short-lived handoff artifact and
its expiry before returning it. Provider rejection or transport failure changes the attempt to
`failed` with a redacted, retryable error. Completed exchange changes it to `connected`; expired
artifacts remain observable as pending-but-expired and require a new connection attempt. Process
loss after the pending commit is therefore visible and recoverable rather than indistinguishable
from a request that never started.

API and MCP structured content may expose only the short-lived authorization artifact, provider,
and expiry. It must never contain Plaid access tokens, refresh tokens, encrypted credentials, or
raw provider errors. Idempotency is scoped to the user and requested attempt; a failed attempt is
retried with a new key, while replay of a completed key returns the original result.

Behavior coverage must prove pending persistence, success metadata, expiry, redacted failure, and
idempotent replay. Production-equivalent evidence must separately prove runtime authority,
outbound HTTPS reachability, Link configuration, callback correctness, and successful transition
from a handoff to connected accounts. Green mock tests do not prove any of those runtime facts.
