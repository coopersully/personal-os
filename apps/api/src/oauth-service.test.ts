import { createHash } from "node:crypto";
import type { Database } from "@personal-os/database";
import type { AccessScope } from "@personal-os/domain";
import { createOAuthService } from "./oauth-service.js";

const serviceOptions = {
  now: () => new Date("2026-07-21T12:00:00.000Z"),
  resource: "https://mcp.ilo.coopersully.me/mcp",
};

describe("OAuth authorized clients", () => {
  it("lists each active client once with its latest token details", async () => {
    const client = {
      id: "mcp-client",
      name: "Codex",
      redirectUris: ["http://127.0.0.1/callback"],
    };
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: async () => [
              {
                client,
                token: {
                  lastUsedAt: null,
                  scopes: ["calendar:read"],
                },
              },
              {
                client,
                token: {
                  lastUsedAt: new Date("2026-07-21T12:00:00.000Z"),
                  scopes: ["calendar:read", "tasks:read"],
                },
              },
            ],
          }),
        }),
      }),
    } as unknown as Database;
    const service = createOAuthService({
      db,
      ...serviceOptions,
    });

    await expect(service.listAuthorizedClients("user-1")).resolves.toEqual([
      {
        id: "mcp-client",
        lastUsedAt: "2026-07-21T12:00:00.000Z",
        name: "Codex",
        redirectUris: ["http://127.0.0.1/callback"],
        scopes: ["calendar:read", "tasks:read"],
      },
    ]);
  });

  it("revokes access and refresh tokens together", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const transaction = vi.fn(async (run: (value: { update: typeof update }) => Promise<void>) =>
      run({ update }),
    );
    const db = { transaction } as unknown as Database;
    const now = new Date("2026-07-21T12:00:00.000Z");
    const service = createOAuthService({
      db,
      now: () => now,
      resource: serviceOptions.resource,
    });

    await service.revokeAuthorizedClient("user-1", "mcp-client");

    expect(transaction).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenNthCalledWith(1, { revokedAt: now });
    expect(set).toHaveBeenNthCalledWith(2, { replacedAt: now });
  });

  it("parses defaults, removes duplicates, and rejects empty or unsupported scopes", () => {
    const service = createOAuthService({ db: {} as Database, ...serviceOptions });

    expect(service.parseScopes(undefined)).toContain("tasks:read");
    expect(service.parseScopes("tasks:read  tasks:read calendar:read")).toEqual([
      "tasks:read",
      "calendar:read",
    ]);
    expect(() => service.parseScopes("")).toThrow("requested scopes are not supported");
    expect(() => service.parseScopes("tasks:read unknown:read")).toThrow(
      "requested scopes are not supported",
    );
  });

  it("accepts secure and loopback redirects while rejecting fragments and insecure hosts", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const db = { insert: vi.fn(() => ({ values })) } as unknown as Database;
    const service = createOAuthService({ db, ...serviceOptions });

    await service.registerClient("Codex", [
      "https://client.example/callback",
      "http://localhost/callback",
      "http://127.0.0.1/callback",
    ]);
    expect(values).toHaveBeenCalledOnce();

    await expect(
      service.registerClient("Fragment", ["https://client.example/callback#fragment"]),
    ).rejects.toThrow("cannot contain a fragment");
    await expect(
      service.registerClient("Remote HTTP", ["http://client.example/callback"]),
    ).rejects.toThrow("must use HTTPS");
    await expect(
      service.registerClient("Other protocol", ["ftp://localhost/callback"]),
    ).rejects.toThrow("must use HTTPS");
  });

  it("rejects unregistered authorization redirects and stores valid authorization codes", async () => {
    const clients = [
      [],
      [{ id: "client-1", redirectUris: ["https://client.example/callback"] }],
      [{ id: "client-1", redirectUris: ["https://client.example/callback"] }],
    ];
    const values = vi.fn().mockResolvedValue(undefined);
    const db = {
      insert: vi.fn(() => ({ values })),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => clients.shift() ?? [],
          }),
        }),
      }),
    } as unknown as Database;
    const service = createOAuthService({ db, ...serviceOptions });
    const authorization = {
      clientId: "client-1",
      codeChallenge: "challenge",
      redirectUri: "https://client.example/callback",
      scopes: ["tasks:read"] as AccessScope[],
      userId: "user-1",
    };

    await expect(service.authorize(authorization)).rejects.toThrow("not registered");
    await expect(
      service.authorize({ ...authorization, redirectUri: "https://other.example/callback" }),
    ).rejects.toThrow("not registered");
    await expect(service.authorize(authorization)).resolves.toMatch(/^oauth_code_/);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-1",
        redirectUri: "https://client.example/callback",
        userId: "user-1",
      }),
    );
  });

  it("rejects code exchange and refresh requests for another resource before querying storage", async () => {
    const service = createOAuthService({ db: {} as Database, ...serviceOptions });

    await expect(
      service.exchangeCode({
        clientId: "client-1",
        code: "code",
        codeVerifier: "verifier",
        redirectUri: "https://client.example/callback",
        resource: "https://other.example/mcp",
      }),
    ).rejects.toThrow("not this MCP server");
    await expect(
      service.refresh({
        clientId: "client-1",
        refreshToken: "refresh",
        resource: "https://other.example/mcp",
      }),
    ).rejects.toThrow("not this MCP server");
  });

  it("rejects missing, mismatched, and already-consumed authorization codes", async () => {
    const verifier = "verifier";
    const validCode = {
      clientId: "client-1",
      codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
      id: "code-1",
      scopes: ["tasks:read"] as AccessScope[],
      userId: "user-1",
    };
    const exchange = {
      clientId: "client-1",
      code: "code",
      codeVerifier: verifier,
      redirectUri: "https://client.example/callback",
      resource: serviceOptions.resource,
    };
    const createDb = (codes: unknown[], used: unknown[]) =>
      ({
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => codes,
            }),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => ({
              returning: async () => used,
            }),
          }),
        }),
      }) as unknown as Database;

    await expect(
      createOAuthService({ db: createDb([], []), ...serviceOptions }).exchangeCode(exchange),
    ).rejects.toThrow("invalid or expired");
    await expect(
      createOAuthService({
        db: createDb([{ ...validCode, codeChallenge: "different" }], []),
        ...serviceOptions,
      }).exchangeCode(exchange),
    ).rejects.toThrow("invalid or expired");
    await expect(
      createOAuthService({ db: createDb([validCode], []), ...serviceOptions }).exchangeCode(
        exchange,
      ),
    ).rejects.toThrow("invalid or expired");
  });

  it("rejects missing, reused, and disconnected refresh tokens", async () => {
    const record = {
      accessTokenId: "access-1",
      clientId: "client-1",
      id: "refresh-1",
      userId: "user-1",
    };
    const input = {
      clientId: "client-1",
      refreshToken: "refresh",
      resource: serviceOptions.resource,
    };
    const createDb = (selectResults: unknown[][], replaced: unknown[]) =>
      ({
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => selectResults.shift() ?? [],
            }),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => ({
              returning: async () => replaced,
            }),
          }),
        }),
      }) as unknown as Database;

    await expect(
      createOAuthService({ db: createDb([[]], []), ...serviceOptions }).refresh(input),
    ).rejects.toThrow("invalid or expired");
    await expect(
      createOAuthService({ db: createDb([[record]], []), ...serviceOptions }).refresh(input),
    ).rejects.toThrow("already been used");
    await expect(
      createOAuthService({
        db: createDb([[record], []], [{ id: "refresh-1" }]),
        ...serviceOptions,
      }).refresh(input),
    ).rejects.toThrow("no longer valid");
  });

  it("reports a storage failure when an exchanged access token cannot be returned", async () => {
    const verifier = "verifier";
    const db = {
      insert: () => ({
        values: () => ({
          returning: async () => [],
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [
              {
                clientId: "client-1",
                codeChallenge: createHash("sha256").update(verifier).digest("base64url"),
                id: "code-1",
                scopes: ["tasks:read"] as AccessScope[],
                userId: "user-1",
              },
            ],
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [{ id: "code-1" }],
          }),
        }),
      }),
    } as unknown as Database;

    await expect(
      createOAuthService({ db, ...serviceOptions }).exchangeCode({
        clientId: "client-1",
        code: "code",
        codeVerifier: verifier,
        redirectUri: "https://client.example/callback",
        resource: serviceOptions.resource,
      }),
    ).rejects.toThrow("Could not issue OAuth access token");
  });
});
