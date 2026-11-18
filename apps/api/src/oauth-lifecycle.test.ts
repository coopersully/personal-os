import { createHash } from "node:crypto";
import {
  accessTokens,
  type Database,
  oauthAccessTokenRotations,
  oauthAuthorizationCodes,
  oauthRefreshTokens,
  users,
} from "@personal-os/database";
import { createOAuthService } from "./oauth-service.js";

const resource = "https://mcp.example.com/mcp";
function fixture() {
  let time = new Date("2026-10-18T23:00:00Z");
  const old = {
    id: "old",
    userId: "owner",
    clientId: "client",
    audience: resource,
    authorizationConnectionId: "connection",
    scopes: ["finances:read"],
    revokedAt: null,
    expiresAt: new Date("2026-10-18T22:00:00Z"),
  };
  const next = { ...old, id: "new" };
  const refresh = {
    id: "refresh",
    userId: "owner",
    clientId: "client",
    accessTokenId: "old",
    expiresAt: new Date("2026-11-17T23:00:00Z"),
  };
  const code = {
    id: "code",
    userId: "owner",
    clientId: "client",
    scopes: old.scopes,
    expiresAt: new Date("2026-10-18T23:05:00Z"),
    codeChallenge: createHash("sha256").update("verifier").digest("base64url"),
  };
  const writes: Array<{ table: unknown; value: Record<string, unknown> }> = [];
  let afterWait = () => {};
  const select = () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () =>
          table === users
            ? [{ id: "owner" }]
            : table === oauthAuthorizationCodes
              ? [code]
              : table === oauthRefreshTokens
                ? [refresh]
                : [old],
        for: () => ({
          limit: async () => {
            if (table === accessTokens) afterWait();
            return table === users ? [{ id: "owner" }] : [old];
          },
        }),
      }),
    }),
  });
  const tx = {
    execute: vi.fn(),
    select,
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ id: "used" }] }) }) }),
    insert: (table: unknown) => ({
      values: (value: Record<string, unknown>) => {
        writes.push({ table, value });
        return Object.assign(Promise.resolve(), { returning: async () => [next] });
      },
    }),
  };
  const db = {
    ...tx,
    transaction: async (run: (executor: unknown) => unknown) => run(tx),
  } as unknown as Database;
  const service = createOAuthService({ db, resource, now: () => time });
  return {
    service,
    writes,
    old,
    next,
    refresh,
    tx,
    rotate: () => service.refresh({ clientId: "client", refreshToken: "refresh-secret", resource }),
    waitUntil: (value: string) => {
      afterWait = () => {
        time = new Date(value);
      };
    },
    advanceGate: (value: string) => {
      tx.execute.mockImplementation(async () => {
        time = new Date(value);
      });
    },
  };
}
it("keeps an expired old bearer refreshable and writes only safe lineage metadata", async () => {
  const f = fixture();
  const result = await f.rotate();
  expect(result.expires_in).toBe(3600);
  expect(Object.keys(result).sort()).toEqual([
    "access_token",
    "expires_in",
    "refresh_token",
    "scope",
    "token_type",
  ]);
  const edge = f.writes.find((write) => write.table === oauthAccessTokenRotations)?.value;
  expect(edge).toEqual({
    userId: "owner",
    fromAccessTokenId: "old",
    toAccessTokenId: "new",
    clientId: "client",
    audience: resource,
    authorizationConnectionId: "connection",
    predecessorScopes: ["finances:read"],
    successorScopes: ["finances:read"],
    rotatedAt: new Date("2026-10-18T23:00:00Z"),
  });
  expect(JSON.stringify(edge)).not.toMatch(/tokenHash|refresh-secret|access_token|refresh_token/);
});
it("rejects a refresh that expires while waiting for retained old-access SHARE", async () => {
  const f = fixture();
  f.waitUntil("2026-11-18T00:00:00Z");
  await expect(f.rotate()).rejects.toMatchObject({ code: "unauthorized" });
  expect(f.writes).toEqual([]);
});
it("rejects a code that expires during grant/owner lock waits", async () => {
  const f = fixture();
  f.advanceGate("2026-10-18T23:06:00Z");
  await expect(
    f.service.exchangeCode({
      clientId: "client",
      code: "code-secret",
      codeVerifier: "verifier",
      redirectUri: "https://client.example/callback",
      resource,
    }),
  ).rejects.toMatchObject({ code: "unauthorized" });
  expect(f.writes).toEqual([]);
});

it("never accepts an existing caller target as the fresh issuer identity", async () => {
  const f = fixture();
  f.next.id = f.old.id;
  await expect(f.rotate()).rejects.toMatchObject({ code: "internal_error" });
  expect(f.writes.filter((write) => write.table === oauthAccessTokenRotations)).toEqual([]);
});
