import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  textInboundClaims,
  textingConnections,
  textMessages,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Hono } from "hono";
import { errorResponse } from "../errors.js";
import { encryptJson } from "../security.js";
import { createTextingRecoveryService } from "../texting-recovery-service.js";
import type { AppEnv, Principal } from "../types.js";
import { registerTextingRecoveryRoutes } from "./texting-recovery.js";

describe.sequential("owner-scoped Finance SMS status in PostgreSQL", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  it("gives missing and foreign claims the same response without Finance execution", async () => {
    const ownerId = randomUUID();
    const foreignId = randomUUID();
    for (const userId of [ownerId, foreignId]) {
      await database.db.insert(users).values({
        id: userId,
        email: `${userId}@example.com`,
        displayName: "Status test",
        passwordHash: "unused",
      });
    }
    const [connection] = await database.db
      .insert(textingConnections)
      .values({
        userId: ownerId,
        encryptedPhoneNumber: encryptJson(
          { e164: "+12025550123" },
          Buffer.alloc(32, 7).toString("base64"),
        ),
        phoneFingerprint: randomUUID(),
        phoneLastFour: "0123",
        country: "US",
        state: "active",
        consentVersion: "test",
        verifiedAt: new Date(),
      })
      .returning();
    if (!connection) throw new Error("Missing connection fixture");
    const [inbound] = await database.db
      .insert(textMessages)
      .values({
        userId: ownerId,
        connectionId: connection.id,
        direction: "inbound",
        status: "delivered",
        body: "Private answer text",
        occurredAt: new Date(),
        occurredAtSource: "provider",
      })
      .returning();
    if (!inbound) throw new Error("Missing inbound fixture");
    await database.db.insert(textInboundClaims).values({
      userId: ownerId,
      connectionId: connection.id,
      messageId: inbound.id,
      consentEpoch: connection.consentEpoch,
    });
    const principal: Principal = {
      userId: ownerId,
      actorId: ownerId,
      actorType: "user",
      scopes: new Set(["texting:read", "finances:read"]),
    };
    const finance = {
      inspectSmsReceipt: vi.fn(async () => ({ state: "absent" as const })),
      executeAnswer: vi.fn(async () => {
        throw new Error("No Finance execution on GET");
      }),
    };
    const recovery = createTextingRecoveryService({
      db: database.db,
      enabled: () => true,
      finance,
    });
    const app = new Hono<AppEnv>();
    app.onError(errorResponse);
    app.use("*", async (context, next) => {
      context.set("principal", principal);
      context.set("requestId", "request");
      await next();
    });
    registerTextingRecoveryRoutes({ app, recovery });
    const path = (id: string) => `/v1/texting/finance-replies/${id}/status`;
    const ownerStatus = await app.request(path(inbound.id));
    expect(ownerStatus.status).toBe(200);
    expect(await ownerStatus.json()).toEqual({
      inboundMessageId: inbound.id,
      state: "waiting",
      reasonCode: "processing_uncertain",
      children: [],
      reviewHref: "/settings?section=reviews",
    });
    principal.userId = foreignId;
    const foreign = await app.request(path(inbound.id));
    const missing = await app.request(path(randomUUID()));
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
    expect(finance.inspectSmsReceipt).not.toHaveBeenCalled();
    expect(finance.executeAnswer).not.toHaveBeenCalled();
  });
});
