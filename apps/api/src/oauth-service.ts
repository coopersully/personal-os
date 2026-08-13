import { createHash, randomBytes } from "node:crypto";
import {
  accessTokens,
  type Database,
  oauthAuthorizationCodes,
  oauthClients,
  oauthRefreshTokens,
} from "@personal-os/database";
import type { AccessScope } from "@personal-os/domain";
import { and, eq, gt, isNull } from "drizzle-orm";
import { AppError } from "./errors.js";
import { generateToken, hashToken } from "./security.js";

const allScopes = new Set<AccessScope>([
  "audit:read",
  "automations:read",
  "bookmarks:read",
  "calendar:read",
  "calendar:write",
  "mail:read",
  "mail:write",
  "goals:read",
  "goals:write",
  "finances:read",
  "finances:write",
  "reminders:read",
  "reminders:write",
  "tasks:read",
  "tasks:write",
]);

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
  const issue = async (userId: string, clientId: string, scopes: AccessScope[]) => {
    const token = generateToken("mcp");
    const refreshToken = generateToken("mcp_refresh");
    const expiresAt = new Date(now().getTime() + 60 * 60_000);
    const refreshExpiresAt = new Date(now().getTime() + 30 * 86_400_000);
    const [access] = await db
      .insert(accessTokens)
      .values({
        audience: resource,
        clientId,
        expiresAt,
        name: `MCP OAuth (${clientId})`,
        scopes,
        tokenHash: hashToken(token),
        userId,
      })
      .returning();
    if (!access) throw new AppError("internal_error", "Could not issue OAuth access token.");
    await db.insert(oauthRefreshTokens).values({
      accessTokenId: access.id,
      clientId,
      expiresAt: refreshExpiresAt,
      tokenHash: hashToken(refreshToken),
      userId,
    });
    return {
      access_token: token,
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: scopes.join(" "),
      token_type: "Bearer",
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
      const current = now();
      await db.transaction(async (transaction) => {
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
        await transaction
          .update(oauthRefreshTokens)
          .set({ replacedAt: current })
          .where(
            and(
              eq(oauthRefreshTokens.userId, userId),
              eq(oauthRefreshTokens.clientId, clientId),
              isNull(oauthRefreshTokens.replacedAt),
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
      const [used] = await db
        .update(oauthAuthorizationCodes)
        .set({ usedAt: current })
        .where(and(eq(oauthAuthorizationCodes.id, code.id), isNull(oauthAuthorizationCodes.usedAt)))
        .returning({ id: oauthAuthorizationCodes.id });
      if (!used)
        throw new AppError("unauthorized", "The authorization code is invalid or expired.");
      return issue(code.userId, code.clientId, code.scopes);
    },
    async refresh(input: { clientId: string; refreshToken: string; resource: string }) {
      if (input.resource !== resource)
        throw new AppError("unauthorized", "The requested resource is not this MCP server.");
      const current = now();
      const [record] = await db
        .select()
        .from(oauthRefreshTokens)
        .where(
          and(
            eq(oauthRefreshTokens.tokenHash, hashToken(input.refreshToken)),
            eq(oauthRefreshTokens.clientId, input.clientId),
            isNull(oauthRefreshTokens.replacedAt),
            gt(oauthRefreshTokens.expiresAt, current),
          ),
        )
        .limit(1);
      if (!record) throw new AppError("unauthorized", "The refresh token is invalid or expired.");
      const [replaced] = await db
        .update(oauthRefreshTokens)
        .set({ replacedAt: current })
        .where(and(eq(oauthRefreshTokens.id, record.id), isNull(oauthRefreshTokens.replacedAt)))
        .returning({ id: oauthRefreshTokens.id });
      if (!replaced) throw new AppError("unauthorized", "The refresh token has already been used.");
      const [access] = await db
        .select()
        .from(accessTokens)
        .where(eq(accessTokens.id, record.accessTokenId))
        .limit(1);
      if (!access || access.audience !== resource || access.revokedAt)
        throw new AppError("unauthorized", "The refresh token is no longer valid.");
      return issue(record.userId, record.clientId, access.scopes);
    },
    parseScopes(value: string | undefined): AccessScope[] {
      const scopes = value?.split(" ").filter(Boolean) ?? [...allScopes];
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
