# Shared agent accounts

## Product contract

One user-owned agent account identity represents one external platform account across its client
surfaces. It may have many authenticated connections and many automations across workspaces.
Finance adopts the shared identity first. An account, an authorization connection, a schedule,
and an execution run remain separate records.

The identity has an immutable nohmi UUID, editable generated display name, optional account label,
platform label, and deterministic local avatar seed/version. Names and avatars are presentation,
never credentials or matching keys. Claude Code and other Claude surfaces can share one identity;
two distinct Claude accounts must remain separate. Models and conversations do not create identities.

MCP implementation metadata and OAuth client IDs identify software, not verified provider users.
This release supports connection-bound and explicitly user-confirmed grouping. It does not claim
provider-verified identity discovery. A future verified provider adapter must validate issuer,
subject, audience, and organization context before introducing provider identity matching. Email,
agent-reported account IDs, names, client IDs, and avatar hashes cannot silently merge accounts.

## Registration and ownership

The first authenticated use of an agent connection materializes its identity transactionally.
Existing connections are adopted on use; no unbounded migration backfill or credential replacement
is required. Finance schedule creation also ensures an identity on its already authorized connection.
`register_agent_account` idempotently returns that connection's identity and may supply an unverified
platform label when the identity is still unknown. `get_agent_account` and the orientation context
return only the caller's current identity.

Shared Connected agents settings lets the authenticated owner rename a profile, label its account,
correct its platform, link a connection to an existing account, or separate it into a new account.
Agents cannot link, rename, enumerate other accounts, or choose an arbitrary identity for attribution.
A mismatched known platform cannot be linked without first correcting its owner-managed metadata.
Dormant profiles remain available after relinking so an identity is not silently destroyed.

Every account and binding is structurally tenant-owned. Connection binding changes are serialized
against automatic registration, and concurrent registration produces one profile. A composite foreign
key prevents a connection from referring to another owner's profile. Owner management is audited.

## Authority and attribution

Grouping changes display identity only. It does not union grants, rebind schedules or pending
continuations, change original actor IDs, move execution, or restore revoked tokens. Token rotation
on the same authorization connection preserves identity; reconnecting without verified provider
identity requires explicit owner linking. Revocation remains per connection and schedule.

Finance automation status and activity resolve profiles through owner-scoped connection records.
Activity retains the original actor token and canonical evidence. Its profile display reflects current
owner-confirmed grouping and names; historical permission and execution records remain authoritative.
Unknown historical actors retain a generic attribution rather than a guessed account identity.

## Presentation

Use the same generated name and avatar throughout settings, Finance registration, automation rows,
and attributed activity. Optional personal/work labels and platform help distinguish accounts.
Generate a symmetrical identicon locally from the opaque seed using a versioned renderer. No email,
credential, image upload, avatar hosting service, or external image request is needed. Avatar colors
are decorative, and accessible text always supplies the identity.

## Boundary and recovery

This change uses the existing authenticated API and PostgreSQL transport. It introduces no provider
API, account-token extraction, new callback, recurring scheduler, or network avatar dependency.
Database commit is the identity-registration and linking acceptance point. A failed transaction
preserves the previous binding; retried registration reuses the existing profile. Profile identity
must never be presented as evidence that an external schedule, wake-up, or provider account is live.
Provider-verified discovery remains future work and requires real provider evidence.
