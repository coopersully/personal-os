import { createHash, randomBytes } from "node:crypto";
import {
  accessTokens,
  type Database,
  oauthAccessTokenRotations,
  oauthAuthorizationCodes,
  oauthClients,
  oauthRefreshTokens,
} from "@personal-os/database";
import type { AccessScope } from "@personal-os/domain";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { AppError } from "./errors.js";
import {
  type OAuthActorIdentity,
  oauthActorIdentitySelection,
  oauthScopeSubset,
} from "./oauth-actor-lineage.js";
import { lockOAuthGrant } from "./oauth-grant-lock.js";
import { generateToken, hashToken } from "./security.js";

const allScopes = new Set<AccessScope>([
  "knowledge:read",
  "knowledge:write",
  "audit:read",
  "automations:read",
  "bookmarks:read",
  "calendar:read",
  "calendar:write",
  "calendar:execute",
  "mail:read",
  "mail:write",
  "mail:execute",
  "goals:read",
  "goals:write",
  "finances:read",
  "finances:write",
  "finances:execute",
  "finances:maintain",
  "reminders:read",
  "reminders:write",
  "texting:read",
  "texting:write",
  "texting:execute",
  "tasks:read",
  "tasks:write",
  "tasks:execute",
]);
const defaultScopes = new Set<AccessScope>(
  [...allScopes].filter(
    (scope) =>
      scope !== "finances:maintain" &&
      scope !== "knowledge:read" &&
      scope !== "knowledge:write" &&
      !scope.endsWith(":execute"),
  ),
);

export function createOAuthService(options: { db: Database; now: () => Date; resource: string }) {
  const { db, now, resource } = options;
  const getAuthorizationClient = async (clientId: string, redirectUri: string) => {
    const [client] = await db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.id, clientId))
      .limit(1);
    if (!client?.redirectUris.includes(redirectUri))
      throw new AppError("invalid_request", "The redirect URI is not registered for this client.");
    return { id: client.id, name: client.name };
  };
  const issue = async (
    userId: string,
    clientId: string,
    scopes: AccessScope[],
    authorizationConnectionId: string | undefined,
    executor: Pick<Database, "insert">,
    predecessor?: OAuthActorIdentity,
  ) => {
    // Only this private issuer can append an edge. Its successor identity is
    // the ID returned by its own fresh INSERT, never a caller-supplied target.
    if (
      predecessor &&
      (predecessor.userId !== userId ||
        predecessor.clientId !== clientId ||
        predecessor.audience !== resource ||
        predecessor.authorizationConnectionId !== authorizationConnectionId ||
        !oauthScopeSubset(scopes, predecessor.scopes))
    )
      throw new AppError("internal_error", "OAuth predecessor does not match canonical issuance.");
    const token = generateToken("mcp");
    const refreshToken = generateToken("mcp_refresh");
    const expiresAt = new Date(now().getTime() + 60 * 60_000);
    const refreshExpiresAt = new Date(now().getTime() + 30 * 86_400_000);
    const [access] = await executor
      .insert(accessTokens)
      .values({
        audience: resource,
        ...(authorizationConnectionId ? { authorizationConnectionId } : {}),
        clientId,
        expiresAt,
        name: `MCP OAuth (${clientId})`,
        scopes,
        tokenHash: hashToken(token),
        userId,
      })
      .returning({ id: accessTokens.id });
    if (!access) throw new AppError("internal_error", "Could not issue OAuth access token.");
    await executor.insert(oauthRefreshTokens).values({
      accessTokenId: access.id,
      clientId,
      expiresAt: refreshExpiresAt,
      tokenHash: hashToken(refreshToken),
      userId,
    });
    if (predecessor) {
      if (access.id === predecessor.id)
        throw new AppError("internal_error", "OAuth successor must be newly issued.");
      await executor.insert(oauthAccessTokenRotations).values({
        userId,
        fromAccessTokenId: predecessor.id,
        toAccessTokenId: access.id,
        clientId,
        audience: resource,
        authorizationConnectionId: predecessor.authorizationConnectionId,
        predecessorScopes: predecessor.scopes,
        successorScopes: scopes,
        rotatedAt: now(),
      });
    }
    return {
      accessTokenId: access.id,
      response: {
        access_token: token,
        expires_in: 3600,
        refresh_token: refreshToken,
        scope: scopes.join(" "),
        token_type: "Bearer",
      },
    };
  };
  return {
    getAuthorizationClient,
    async listAuthorizedClients(userId: string) {
      const records = await db
        .select({ client: oauthClients, refresh: oauthRefreshTokens, token: accessTokens })
        .from(oauthRefreshTokens)
        .innerJoin(accessTokens, eq(oauthRefreshTokens.accessTokenId, accessTokens.id))
        .innerJoin(oauthClients, eq(accessTokens.clientId, oauthClients.id))
        .where(
          and(
            eq(oauthRefreshTokens.userId, userId),
            eq(accessTokens.audience, resource),
            isNull(accessTokens.revokedAt),
            isNull(oauthRefreshTokens.replacedAt),
            gt(oauthRefreshTokens.expiresAt, now()),
          ),
        );
      const activeRecords = records.filter(
        (record) => record.refresh.replacedAt === null && record.refresh.expiresAt > now(),
      );
      activeRecords.sort(
        (left, right) =>
          (right.token.lastUsedAt?.getTime() ?? 0) - (left.token.lastUsedAt?.getTime() ?? 0) ||
          right.refresh.expiresAt.getTime() - left.refresh.expiresAt.getTime(),
      );
      const clients = new Map<
        string,
        {
          id: string;
          lastUsedAt: string | null;
          name: string;
          redirectUris: string[];
          scopes: AccessScope[];
        }
      >();
      for (const { client, token } of activeRecords) {
        const existing = clients.get(client.id);
        if (existing) {
          existing.scopes = [...new Set([...existing.scopes, ...token.scopes])];
          continue;
        }
        clients.set(client.id, {
          id: client.id,
          lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
          name: client.name,
          redirectUris: client.redirectUris,
          scopes: token.scopes,
        });
      }
      return [...clients.values()];
    },
    async revokeAuthorizedClient(userId: string, clientId: string) {
      await db.transaction(async (transaction) => {
        await lockOAuthGrant(transaction, userId, clientId, resource);
        // Full audience set is stable behind the same gate as both issue callers.
        await transaction
          .select({ id: accessTokens.id })
          .from(accessTokens)
          .where(
            and(
              eq(accessTokens.userId, userId),
              eq(accessTokens.clientId, clientId),
              eq(accessTokens.audience, resource),
            ),
          )
          .orderBy(asc(accessTokens.id))
          .for("update");
        const current = now();
        await transaction
          .update(accessTokens)
          .set({ revokedAt: current })
          .where(
            and(
              eq(accessTokens.userId, userId),
              eq(accessTokens.clientId, clientId),
              eq(accessTokens.audience, resource),
              isNull(accessTokens.revokedAt),
            ),
          );
        // Audience-specific grant key must never retire another resource's refresh.
        await transaction
          .update(oauthRefreshTokens)
          .set({ replacedAt: current })
          .where(
            and(
              eq(oauthRefreshTokens.userId, userId),
              eq(oauthRefreshTokens.clientId, clientId),
              isNull(oauthRefreshTokens.replacedAt),
              sql`EXISTS (SELECT 1 FROM ${accessTokens} WHERE ${accessTokens.id}=${oauthRefreshTokens.accessTokenId} AND ${accessTokens.userId}=${oauthRefreshTokens.userId} AND ${accessTokens.clientId}=${oauthRefreshTokens.clientId} AND ${accessTokens.audience}=${resource})`,
            ),
          );
      });
    },
    async registerClient(name: string, redirectUris: string[]) {
      for (const uri of redirectUris) validateRedirectUri(uri);
      const id = `mcp_client_${randomBytes(18).toString("base64url")}`;
      await db.insert(oauthClients).values({ id, name, redirectUris });
      return { client_id: id, client_name: name, redirect_uris: redirectUris };
    },
    async authorize(input: {
      clientId: string;
      codeChallenge: string;
      redirectUri: string;
      scopes: AccessScope[];
      userId: string;
    }) {
      await getAuthorizationClient(input.clientId, input.redirectUri);
      const code = generateToken("oauth_code");
      await db.insert(oauthAuthorizationCodes).values({
        clientId: input.clientId,
        codeChallenge: input.codeChallenge,
        codeHash: hashToken(code),
        expiresAt: new Date(now().getTime() + 5 * 60_000),
        redirectUri: input.redirectUri,
        resource,
        scopes: input.scopes,
        userId: input.userId,
      });
      return code;
    },
    async exchangeCode(input: {
      clientId: string;
      code: string;
      codeVerifier: string;
      redirectUri: string;
      resource: string;
    }) {
      if (input.resource !== resource)
        throw new AppError("unauthorized", "The requested resource is not this MCP server.");
      const current = now();
      const [code] = await db
        .select()
        .from(oauthAuthorizationCodes)
        .where(
          and(
            eq(oauthAuthorizationCodes.codeHash, hashToken(input.code)),
            eq(oauthAuthorizationCodes.clientId, input.clientId),
            eq(oauthAuthorizationCodes.redirectUri, input.redirectUri),
            eq(oauthAuthorizationCodes.resource, resource),
            isNull(oauthAuthorizationCodes.usedAt),
            gt(oauthAuthorizationCodes.expiresAt, current),
          ),
        )
        .limit(1);
      if (!code || pkceChallenge(input.codeVerifier) !== code.codeChallenge)
        throw new AppError("unauthorized", "The authorization code is invalid or expired.");
      return db.transaction(async (transaction) => {
        await lockOAuthGrant(transaction, code.userId, code.clientId, resource);
        const [used] = await transaction
          .update(oauthAuthorizationCodes)
          .set({ usedAt: now() })
          .where(
            and(
              eq(oauthAuthorizationCodes.id, code.id),
              isNull(oauthAuthorizationCodes.usedAt),
              gt(oauthAuthorizationCodes.expiresAt, now()),
            ),
          )
          .returning({ id: oauthAuthorizationCodes.id });
        if (!used)
          throw new AppError("unauthorized", "The authorization code is invalid or expired.");
        // Code-row UPDATE may itself wait. Recheck at the actual issuance decision.
        if (code.expiresAt <= now())
          throw new AppError("unauthorized", "The authorization code is invalid or expired.");
        return (await issue(code.userId, code.clientId, code.scopes, undefined, transaction))
          .response;
      });
    },
    async refresh(input: { clientId: string; refreshToken: string; resource: string }) {
      if (input.resource !== resource)
        throw new AppError("unauthorized", "The requested resource is not this MCP server.");
      const [record] = await db
        .select()
        .from(oauthRefreshTokens)
        .where(
          and(
            eq(oauthRefreshTokens.tokenHash, hashToken(input.refreshToken)),
            eq(oauthRefreshTokens.clientId, input.clientId),
            sql`EXISTS (SELECT 1 FROM ${accessTokens} WHERE ${accessTokens.id}=${oauthRefreshTokens.accessTokenId} AND ${accessTokens.userId}=${oauthRefreshTokens.userId} AND ${accessTokens.clientId}=${oauthRefreshTokens.clientId} AND ${accessTokens.audience}=${resource})`,
            isNull(oauthRefreshTokens.replacedAt),
            gt(oauthRefreshTokens.expiresAt, now()),
          ),
        )
        .limit(1);
      if (!record) throw new AppError("unauthorized", "The refresh token is invalid or expired.");
      return db.transaction(async (transaction) => {
        await lockOAuthGrant(transaction, record.userId, record.clientId, resource);
        const [replaced] = await transaction
          .update(oauthRefreshTokens)
          .set({ replacedAt: now() })
          .where(
            and(
              eq(oauthRefreshTokens.id, record.id),
              isNull(oauthRefreshTokens.replacedAt),
              gt(oauthRefreshTokens.expiresAt, now()),
            ),
          )
          .returning({ id: oauthRefreshTokens.id });
        if (!replaced)
          throw new AppError("unauthorized", "The refresh token has already been used.");
        const [access] = await transaction
          .select({ ...oauthActorIdentitySelection, revokedAt: accessTokens.revokedAt })
          .from(accessTokens)
          .where(eq(accessTokens.id, record.accessTokenId))
          .for("share")
          .limit(1);
        if (
          record.expiresAt <= now() ||
          !access ||
          access.audience !== resource ||
          access.revokedAt ||
          access.userId !== record.userId ||
          access.clientId !== record.clientId
        )
          throw new AppError("unauthorized", "The refresh token is no longer valid.");
        const issued = await issue(
          record.userId,
          record.clientId,
          access.scopes,
          access.authorizationConnectionId,
          transaction,
          access,
        );
        return issued.response;
      });
    },
    parseScopes(value: string | undefined): AccessScope[] {
      const scopes = value?.split(" ").filter(Boolean) ?? [...defaultScopes];
      if (!scopes.length || scopes.some((scope) => !allScopes.has(scope as AccessScope)))
        throw new AppError("invalid_request", "One or more requested scopes are not supported.");
      return [...new Set(scopes)] as AccessScope[];
    },
  };
}

function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}
function validateRedirectUri(value: string) {
  const url = new URL(value);
  if (
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost")))
  )
    throw new AppError(
      "invalid_request",
      "Redirect URIs must use HTTPS or localhost HTTP and cannot contain a fragment.",
    );
}
