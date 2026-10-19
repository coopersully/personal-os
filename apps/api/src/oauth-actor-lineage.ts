import { accessTokens, type Database, oauthAccessTokenRotations } from "@personal-os/database";
import type { AccessScope } from "@personal-os/domain";
import { and, asc, eq, inArray } from "drizzle-orm";

export const oauthActorIdentitySelection = {
  id: accessTokens.id,
  userId: accessTokens.userId,
  clientId: accessTokens.clientId,
  audience: accessTokens.audience,
  authorizationConnectionId: accessTokens.authorizationConnectionId,
  scopes: accessTokens.scopes,
};
export type OAuthActorIdentity = {
  id: string;
  userId: string;
  clientId: string | null;
  audience: string | null;
  authorizationConnectionId: string;
  scopes: AccessScope[];
};
export function oauthScopeSubset(successor: readonly string[], predecessor: readonly string[]) {
  return successor.every((scope) => predecessor.includes(scope));
}
/** Historical evidence only. Does not authorize execution, check current expiry, or return secrets. */
export async function readOAuthActorLineage(
  executor: Pick<Database, "select">,
  input: { ownerId: string; ancestorActorId: string; currentActorId: string; audience: string },
): Promise<{ actorIds: string[] } | null> {
  const endpoints = await executor
    .select(oauthActorIdentitySelection)
    .from(accessTokens)
    .where(
      and(
        eq(accessTokens.userId, input.ownerId),
        eq(accessTokens.audience, input.audience),
        inArray(accessTokens.id, [input.ancestorActorId, input.currentActorId]),
      ),
    )
    .orderBy(asc(accessTokens.id));
  const ancestor = endpoints.find((row) => row.id === input.ancestorActorId),
    current = endpoints.find((row) => row.id === input.currentActorId);
  if (
    !ancestor ||
    !current ||
    !ancestor.clientId ||
    ancestor.clientId !== current.clientId ||
    ancestor.authorizationConnectionId !== current.authorizationConnectionId
  )
    return null;
  const ids = [current.id];
  const seen = new Set(ids);
  for (let depth = 0; depth <= 64; depth++) {
    const id = ids.at(-1);
    if (id === ancestor.id) return { actorIds: ids.reverse() };
    if (depth === 64 || !id) return null;
    const [edge] = await executor
      .select({
        from: oauthAccessTokenRotations.fromAccessTokenId,
        clientId: oauthAccessTokenRotations.clientId,
        connectionId: oauthAccessTokenRotations.authorizationConnectionId,
        predecessorScopes: oauthAccessTokenRotations.predecessorScopes,
        successorScopes: oauthAccessTokenRotations.successorScopes,
      })
      .from(oauthAccessTokenRotations)
      .where(
        and(
          eq(oauthAccessTokenRotations.userId, input.ownerId),
          eq(oauthAccessTokenRotations.audience, input.audience),
          eq(oauthAccessTokenRotations.toAccessTokenId, id),
        ),
      )
      .limit(1);
    if (
      !edge ||
      edge.clientId !== ancestor.clientId ||
      edge.connectionId !== ancestor.authorizationConnectionId ||
      !oauthScopeSubset(edge.successorScopes, edge.predecessorScopes) ||
      seen.has(edge.from)
    )
      return null;
    seen.add(edge.from);
    ids.push(edge.from);
  }
  return null;
}
