# Canonical OAuth token lifecycle and rotation evidence

OAuth belongs to shared Settings/Auth, not Finance. The private issuer has exactly two production
callers: authorization-code exchange and refresh. Both use one transaction and the advisory key
`JSON.stringify([userId, clientId, resource])`, followed by the owner row `FOR KEY SHARE` before
refresh/access rows or credential FK inserts. Code exchange retires the code and inserts both
tokens atomically; it creates no rotation edge. Refresh retires the old refresh, retains the old
access row `FOR SHARE`, revalidates its owner/client/audience/revocation, and inserts successor
access, successor refresh and immutable rotation evidence in one commit.

Expiry checks use the injected decision-time clock after lock waits, including after the retained
old-access lock. An expired access bearer can still have a valid refresh grant. Rejecting expired
old access would break ordinary OAuth refresh; its historical expiry is not a refresh gate.
Successor lifetimes remain one hour access and thirty days refresh, measured at actual issuance.
PKCE, resource checks, scope propagation and the public token response remain unchanged.

Client revoke uses the same audience gate and owner lock, prelocks the complete matching access
set in UUID order, revokes those access rows and retires refresh rows only through matching
owner/client/access-audience joins. It never retires another resource's refresh rows. Individual
`auth.revokeAccessToken` remains one standalone token UPDATE: if it wins before refresh's SHARE,
rotation fails; if rotation wins, revoke waits and then can revoke the ancestor alone. This does
not become family or descendant revocation. `authenticateAccessToken` updates last-used metadata;
`createAccessToken` creates manual tokens with no OAuth client, refresh token or lineage edge.
These are the complete production access/refresh writers; fixture insertion is separate test code.

Client revoke affects issued grants, not an unused already-consented five-minute authorization
code. A valid PKCE code may exchange afterward as new authorization. No revocation epoch is
claimed. A committed refresh with a lost response consumes the old refresh once: reconnect/new
authorization is required, never secret persistence, replay, or a fabricated successor.

`oauth_access_token_rotations` contains safe owner/client/audience/connection/actor IDs, scope
snapshots and issuance time only. No hashes or credentials are copied. There is no historical
backfill. Composite owner FKs reject foreign endpoints; deferred NO ACTION endpoint FKs preserve
active-owner history on token deletion while allowing owner-erasure cascade. Database guards reject
updates and active-owner deletion, and validate dimensions and scope subset. Only private issue() inserts edges, using the ID
returned by its own successful fresh access INSERT in that same transaction. No exported edge
writer or caller-provided successor exists. One predecessor/successor uniqueness plus that trusted
canonical fresh issuance prevents canonical cycles; tuple xmin is not birth evidence. The API's trusted canonical writer is
still part of this integrity boundary; this is not a separate database-role authorization system.

`readOAuthActorLineage` returns only a proven ordered list of actor IDs or null, bounded to sixty-four
edges. Same connection is insufficient; missing historical edges fail closed. Scope narrowing is
allowed, expired ancestors remain evidence, and revoking an ancestor after completed rotation does
not silently revoke descendants. This reader grants no current execution authority, locks no
Finance material, and adds no Finance recovery operation. A later Finance consumer must separately
recheck its current grant, policy, proof, lease and binding under its own reviewed protocol.

Before release, run the authored real PostgreSQL two-session tests for both revoke/rotation orders,
client revoke versus issuance and audience isolation, owner erasure, rollback, immutable evidence,
one-use replay and expiry after waits. Unit success cannot prove row-lock ordering or deployment
migration behavior. No database/runtime evidence is implied by this document's existence.

Refresh preflight joins refresh→access on access ID, owner, client and configured audience before
acquiring its grant gate or retiring a refresh row. A wrong-resource refresh cannot lock a different
audience's refresh row under the wrong advisory key; final retained-access validation still repeats
the checks. Database constraints/guards protect immutable dimensions and erasure, not issuance
provenance against a compromised trusted runtime or arbitrary privileged SQL INSERT.
