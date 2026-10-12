import { createHash } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createApiClient } from "@personal-os/api-client";
import {
  accessTokens,
  createDatabaseClient,
  executionPolicySettings,
  migrateDatabase,
} from "@personal-os/database";
import type { AccessScope } from "@personal-os/domain";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createApp } from "../../apps/api/src/app.js";
import { createAuthService } from "../../apps/api/src/auth-service.js";
import { loadConfig } from "../../apps/api/src/config.js";
import { createOAuthService } from "../../apps/api/src/oauth-service.js";
import { hashToken } from "../../apps/api/src/security.js";
import type { AppDependencies } from "../../apps/api/src/types.js";
import { createPersonalOsMcpServer } from "../../apps/mcp/src/server.js";

/** Real protocol, typed client, API authentication and migrated PostgreSQL. No API stubs. */
export async function createMcpWorkspaceFixture(
  overrides: Pick<AppDependencies, "google" | "plaid" | "icloud" | "twilio" | "log"> = {},
) {
  const container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
  const database = createDatabaseClient(container.getConnectionUri());
  const clients: Array<{ close(): Promise<void> }> = [];
  async function close() {
    await Promise.allSettled(clients.map((client) => client.close()));
    await database.close();
    await container.stop();
  }
  try {
    await migrateDatabase(database.db, resolve("packages/database/migrations"));
    const config = loadConfig({
      NODE_ENV: "test",
      MCP_INTERNAL_SECRET: "fixture-internal-key-only-1234567890",
      APP_BASE_URL: "http://localhost:8081",
      API_BASE_URL: "http://localhost:8787",
      DATABASE_URL: container.getConnectionUri(),
      APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      GOOGLE_REDIRECT_URI: "http://localhost:8787/v1/connectors/google/callback",
      X_REDIRECT_URI: "http://localhost:8787/v1/x-bookmarks/callback",
      REGISTRATION_MODE: "open",
      ...(overrides.twilio
        ? {
            TEXTING_ENABLED: "true",
            TWILIO_ACCOUNT_SID: "fixture-account",
            TWILIO_AUTH_TOKEN: "fixture-token",
            TWILIO_MESSAGING_SERVICE_SID: "fixture-messaging",
            TWILIO_VERIFY_SERVICE_SID: "fixture-verify",
            TWILIO_PHONE_NUMBER: "+12025550100",
          }
        : {}),
    });
    let currentTime = new Date("2026-10-11T15:00:00Z");
    const now = () => currentTime;
    const oauth = createOAuthService({
      db: database.db,
      now,
      resource: `${config.apiBaseUrl}/mcp`,
    });
    const app = createApp({
      ...overrides,
      config,
      db: database.db,
      now,
      log: overrides.log ?? (() => {}),
    });
    const auth = createAuthService({
      db: database.db,
      now,
      sessionTtlDays: 30,
      registrationMode: "open",
    });
    const register = async (email: string) =>
      (
        await auth.register(
          {
            email,
            displayName: "MCP fixture",
            password: "FixtureOnly123!",
            planningTimezone: "America/New_York",
          },
          { ipAddress: null, userAgent: "test" },
        )
      ).user;
    const owner = await register("mcp-owner@example.com");
    const otherOwner = await register("mcp-other@example.com");
    const fetch: typeof globalThis.fetch = async (input, init) =>
      app.request(new Request(input, init));
    async function connectAgent(
      scopes: AccessScope[],
      options: {
        ownerId?: string;
        readOnly?: boolean;
        credentialKind?: "personal" | "oauth";
        oauthToken?: string;
        clientId?: string;
        refreshToken?: string;
      } = {},
    ) {
      const ownerId = options.ownerId ?? owner.id;
      let clientId = options.clientId;
      let refreshToken = options.refreshToken;
      let credential: { id: string; token: string };
      if (options.credentialKind === "oauth") {
        let token = options.oauthToken;
        if (!token) {
          const redirectUri = "http://127.0.0.1:4312/callback";
          const registered = await oauth.registerClient("Parity OAuth", [redirectUri]);
          clientId = registered.client_id;
          const codeVerifier = "v".repeat(64);
          const code = await oauth.authorize({
            clientId,
            redirectUri,
            userId: ownerId,
            scopes,
            codeChallenge: createHash("sha256").update(codeVerifier).digest("base64url"),
          });
          const issued = await oauth.exchangeCode({
            clientId,
            redirectUri,
            code,
            codeVerifier,
            resource: `${config.apiBaseUrl}/mcp`,
          });
          token = issued.access_token;
          refreshToken = issued.refresh_token;
        }
        const row = await database.db.query.accessTokens.findFirst({
          where: eq(accessTokens.tokenHash, hashToken(token)),
        });
        if (!row) throw new Error("OAuth grant was not persisted");
        credential = { id: row.id, token };
      } else credential = await auth.createAccessToken(ownerId, { name: "Parity fixture", scopes });
      const api = createApiClient({
        baseUrl: config.apiBaseUrl,
        token: credential.token,
        fetch,
        ...(options.credentialKind === "oauth"
          ? {
              headers: {
                "x-personal-os-mcp-resource": `${config.apiBaseUrl}/mcp`,
                "x-personal-os-mcp-key": config.mcpInternalSecret ?? "",
              },
            }
          : {}),
      });
      const context = await api.getIloContext();
      const server = createPersonalOsMcpServer({
        api,
        scopes: new Set(context.access.grantedScopes),
        readOnly: options.readOnly ?? false,
        timeZone: "America/New_York",
      });
      const client = new Client({ name: "workspace-parity-test", version: "1" });
      if (process.env.WORKSPACE_MCP_TRACE) {
        const call = client.callTool.bind(client);
        client.callTool = async (...args: Parameters<typeof call>) => {
          try {
            const result = await call(...args);
            await appendFile(
              process.env.WORKSPACE_MCP_TRACE!,
              JSON.stringify({
                file: expect.getState().testPath,
                test: expect.getState().currentTestName,
                tool: args[0].name,
                isError: result.isError === true,
              }) + "\n",
            );
            return result;
          } catch (error) {
            await appendFile(
              process.env.WORKSPACE_MCP_TRACE!,
              JSON.stringify({
                file: expect.getState().testPath,
                test: expect.getState().currentTestName,
                tool: args[0].name,
                isError: true,
              }) + "\n",
            );
            throw error;
          }
        };
      }
      clients.push(client, server);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
      return {
        client,
        api,
        credential,
        refresh: async (): Promise<ReturnType<typeof createApiClient>> => {
          if (!clientId || !refreshToken) throw new Error("This is not an OAuth credential");
          const issued = await oauth.refresh({
            clientId,
            refreshToken,
            resource: `${config.apiBaseUrl}/mcp`,
          });
          refreshToken = issued.refresh_token;
          return createApiClient({
            baseUrl: config.apiBaseUrl,
            token: issued.access_token,
            fetch,
            headers: {
              "x-personal-os-mcp-resource": `${config.apiBaseUrl}/mcp`,
              "x-personal-os-mcp-key": config.mcpInternalSecret ?? "",
            },
          });
        },
        revoke: () =>
          database.db
            .update(accessTokens)
            .set({ revokedAt: new Date() })
            .where(eq(accessTokens.id, credential.id)),
      };
    }
    return {
      db: database.db,
      config,
      advanceTime: (milliseconds: number) => {
        currentTime = new Date(currentTime.getTime() + milliseconds);
      },
      app,
      owner,
      otherOwner,
      connectAgent,
      close,
      async setBypass(enabled: boolean) {
        await database.db
          .insert(executionPolicySettings)
          .values({ userId: owner.id, reviewBypassEnabled: enabled })
          .onConflictDoUpdate({
            target: executionPolicySettings.userId,
            set: { reviewBypassEnabled: enabled },
          });
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
export type WorkspaceFixture = Awaited<ReturnType<typeof createMcpWorkspaceFixture>>;
