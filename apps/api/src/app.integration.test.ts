import { createHash, createHmac, hkdfSync } from "node:crypto";
import { resolve } from "node:path";
import type {
  GoogleConnector,
  GoogleCredentials,
  ICloudConnector,
  XConnector,
} from "@personal-os/connectors";
import {
  auditEvents,
  calendarAccounts,
  calendarEvents,
  connectorSubscriptions,
  connectorSyncTriggers,
  createDatabaseClient,
  type DatabaseClient,
  domainProfiles,
  financeTransactions,
  mailThreads,
  migrateDatabase,
  reminders,
  taskLists,
  taskProjects,
  users,
} from "@personal-os/database";
import type { Task, TaskListQuery } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, inArray } from "drizzle-orm";
import { createApp, type PersonalOsApp } from "./app.js";
import { createAuthService } from "./auth-service.js";
import { createDailyBriefService } from "./daily-brief-service.js";
import type { EmailMessage } from "./email-delivery.js";
import { GooglePubSubAuthError } from "./google-pubsub-auth.js";
import { DEMO_QA_PASSWORD, loadQaFixtures, qaFixtureAccounts } from "./qa-fixtures.js";
import { createRuntimeLifecycle } from "./runtime-lifecycle.js";
import { verifyPassword } from "./security.js";

const invalidLowercasePassword = ["alllowercase", "123", "!"].join("");

type RequestOptions = {
  auth?: "agent" | "none" | "session";
  body?: unknown;
  headers?: Record<string, string>;
  method?: string;
  rawBody?: string;
};

describe.sequential("ilo API", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let app: PersonalOsApp;
  let appConfig: Parameters<typeof createApp>[0]["config"];
  let sessionToken = "";
  let agentToken = "";
  const logs = vi.fn();
  const weatherFetch = vi.fn();
  const verifyGooglePubSubToken = vi.fn(async () => ({ subject: "pubsub-push" }));
  const deliveredEmails: EmailMessage[] = [];
  const icloudConnector: ICloudConnector = {
    createEvent: vi.fn(),
    deleteEvent: vi.fn(),
    listCalendars: vi.fn(async () => []),
    syncCalendar: vi.fn(),
    syncMail: vi.fn(async () => ({
      deletedThreadIds: [],
      mailboxes: [
        { id: "INBOX", name: "Inbox", role: "inbox" as const, totalCount: 1, unreadCount: 1 },
      ],
      nextSyncToken: null,
      reset: true,
      threads: [
        {
          bodyText: "Integration mail body",
          from: { address: "sender@icloud.com", name: "Sender" },
          mailboxIds: ["INBOX"],
          messageCount: 1,
          receivedAt: new Date("2026-07-13T12:00:00.000Z"),
          remoteThreadId: "integration-thread",
          snippet: "Integration mail",
          starred: false,
          subject: "Integration mail",
          to: [],
          unread: true,
        },
      ],
    })),
    updateEvent: vi.fn(),
  };
  const xConnector: XConnector = {
    authorizationUrl: vi.fn((state) => `https://x.example.com/auth?state=${state}`),
    exchangeCode: vi.fn(async () => ({
      accessToken: "x-access",
      expiresAt: "2026-07-13T13:00:00.000Z",
      refreshToken: "x-refresh",
      scope: "bookmark.read",
      tokenType: "Bearer",
    })),
    getProfile: vi.fn(async (credentials) => ({
      credentials,
      value: { id: "x-user", name: "X User", username: "xuser" },
    })),
    listBookmarkFolders: vi.fn(async (credentials) => ({
      credentials,
      value: [{ id: "x-folder", name: "Calendar" }],
    })),
    listFolderBookmarks: vi.fn(async (credentials) => ({
      credentials,
      value: [
        {
          authorId: "x-author",
          authorName: "X Author",
          authorUsername: "xauthor",
          postedAt: new Date("2026-07-13T11:00:00.000Z"),
          raw: { id: "x-post" },
          remotePostId: "x-post",
          text: "Save the date",
          url: "https://x.com/xauthor/status/x-post",
        },
      ],
    })),
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    appConfig = {
      allowedOrigins: ["https://app.example.com"],
      apiBaseUrl: "https://api.example.com",
      apiShutdownTimeoutMs: 105_000,
      appBaseUrl: "https://app.example.com",
      databaseUrl: container.getConnectionUri(),
      emailFrom: "",
      encryptionKey: Buffer.alloc(32, 1).toString("base64"),
      googleClientId: "",
      googleClientSecret: "",
      googleCalendarPushEnabled: true,
      googleCalendarWebhookUrl:
        "https://api.example.com/v1/connectors/google/calendar/notifications",
      googleGmailPubsubSubscription: "projects/ilo/subscriptions/gmail-push",
      googleGmailPubsubTopic: "projects/ilo/topics/gmail-push",
      googleGmailPushAudience: "https://api.example.com/v1/connectors/google/gmail/notifications",
      googleGmailPushEnabled: true,
      googleGmailPushServiceAccount: "pubsub@example.iam.gserviceaccount.com",
      googleRedirectUri: "https://api.example.com/v1/connectors/google/callback",
      logLevel: "info",
      port: 8787,
      plaidClientId: "",
      plaidEnvironment: "sandbox",
      plaidSecret: "",
      production: false,
      resendApiKey: "",
      sessionCookieName: "personal_os_session",
      sessionTtlDays: 30,
      trustProxy: true,
      xClientId: "",
      xClientSecret: "",
      xRedirectUri: "https://api.example.com/v1/x-bookmarks/callback",
    };
    app = createApp({
      config: appConfig,
      db: database.db,
      fetch: weatherFetch,
      email: { send: async (message) => void deliveredEmails.push(message) },
      icloud: icloudConnector,
      log: logs,
      now: () => new Date("2026-07-13T12:00:00.000Z"),
      runtimeLifecycle: createRuntimeLifecycle(),
      verifyGooglePubSubToken,
      x: xConnector,
    });
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  async function request(path: string, options: RequestOptions = {}) {
    const headers = new Headers(options.headers);
    if (options.auth === "session" || (options.auth === undefined && sessionToken)) {
      headers.set("authorization", `Session ${sessionToken}`);
    }
    if (options.auth === "agent") headers.set("authorization", `Bearer ${agentToken}`);
    const hasBody = options.body !== undefined || options.rawBody !== undefined;
    if (hasBody) headers.set("content-type", "application/json");
    return app.request(path, {
      ...(hasBody ? { body: options.rawBody ?? JSON.stringify(options.body) } : {}),
      headers,
      method: options.method ?? (hasBody ? "POST" : "GET"),
    });
  }

  async function payload(response: Response) {
    return response.status === 204 ? null : response.json();
  }

  describe("task lists", () => {
    let listAgentToken = "";
    let listReadToken = "";
    let listSessionToken = "";
    let listUserId = "";
    let listWriteToken = "";

    async function listRequest(path: string, options: Omit<RequestOptions, "auth"> = {}) {
      const headers = new Headers(options.headers);
      headers.set("authorization", `Session ${listSessionToken}`);
      const hasBody = options.body !== undefined || options.rawBody !== undefined;
      if (hasBody) headers.set("content-type", "application/json");
      return app.request(path, {
        ...(hasBody ? { body: options.rawBody ?? JSON.stringify(options.body) } : {}),
        headers,
        method: options.method ?? (hasBody ? "POST" : "GET"),
      });
    }

    async function createList(name: string) {
      const response = await listRequest("/v1/task-lists", { body: { name } });
      expect(response.status).toBe(201);
      return (await payload(response)).taskList as {
        availability: "active" | "archived";
        id: string;
        name: string;
        revision: number;
        source: {
          accountId: null;
          provider: "local";
          remoteId: string;
          revision: string;
          sourceType: "task_list";
        };
      };
    }

    async function agentListRequest(
      token: string,
      path: string,
      options: Omit<RequestOptions, "auth"> = {},
    ) {
      const headers = new Headers(options.headers);
      headers.set("authorization", `Bearer ${token}`);
      const hasBody = options.body !== undefined || options.rawBody !== undefined;
      if (hasBody) headers.set("content-type", "application/json");
      return app.request(path, {
        ...(hasBody ? { body: options.rawBody ?? JSON.stringify(options.body) } : {}),
        headers,
        method: options.method ?? (hasBody ? "POST" : "GET"),
      });
    }

    async function createListAgentToken(name: string, scopes: string[]) {
      const response = await listRequest("/v1/access-tokens", { body: { name, scopes } });
      expect(response.status).toBe(201);
      return (await payload(response)).token.token as string;
    }

    beforeAll(async () => {
      const registration = await request("/v1/auth/register", {
        auth: "none",
        body: {
          displayName: "Task Lists User",
          email: "task-lists@example.com",
          password: "LocalTestOnly123!",
          planningTimezone: "America/New_York",
        },
      });
      expect(registration.status).toBe(201);
      const body = await payload(registration);
      listSessionToken = body.sessionToken;
      listUserId = body.user.id;
      listAgentToken = await createListAgentToken("Task Lists agent", [
        "tasks:read",
        "tasks:write",
      ]);
      listReadToken = await createListAgentToken("Task Lists reader", ["tasks:read"]);
      listWriteToken = await createListAgentToken("Task Lists writer", ["tasks:write"]);
    });

    it("task lists retrieve the protected Inbox only for its authenticated owner", async () => {
      expect((await request("/v1/task-lists", { auth: "none" })).status).toBe(401);

      const response = await listRequest("/v1/task-lists");
      expect(response.status).toBe(200);
      const result = await payload(response);
      expect(result).toEqual({
        items: [
          expect.objectContaining({
            archivedAt: null,
            availability: "active",
            deletedAt: null,
            kind: "inbox",
            name: "Inbox",
            revision: 1,
            source: {
              accountId: null,
              provider: "local",
              remoteId: expect.any(String),
              revision: "1",
              sourceType: "task_list",
            },
          }),
        ],
        nextCursor: null,
      });
      expect(
        (await payload(await listRequest(`/v1/task-lists/${result.items[0].id}`))).taskList,
      ).toEqual(result.items[0]);
    });

    it("task lists reject reserved and colliding names while preserving user and idempotency boundaries", async () => {
      const reserved = await listRequest("/v1/task-lists", {
        body: { name: "  Ｔｏｄａｙ  " },
      });
      expect(reserved.status).toBe(409);
      expect((await payload(reserved)).error).toMatchObject({ code: "conflict" });

      const canonical = await createList("Ｆｏｃｕｓ　 Plan");
      expect(canonical.source).toEqual({
        accountId: null,
        provider: "local",
        remoteId: canonical.id,
        revision: "1",
        sourceType: "task_list",
      });
      expect(
        (
          await listRequest("/v1/task-lists", {
            body: {
              name: "Forged provenance",
              source: {
                accountId: null,
                provider: "local",
                remoteId: canonical.id,
                revision: "1",
                sourceType: "task_list",
              },
            },
          })
        ).status,
      ).toBe(400);
      const collision = await listRequest("/v1/task-lists", {
        body: { name: "  focus   plan " },
      });
      expect(collision.status).toBe(409);
      expect((await payload(collision)).error).toMatchObject({
        code: "conflict",
        details: { code: "task_list_name_conflict" },
      });

      const idempotencyKey = "11111111-1111-4111-8111-111111111111";
      const createInput = {
        color: "blue",
        description: "Stable replay",
        idempotencyKey,
        name: "Replay List",
      };
      const created = await listRequest("/v1/task-lists", { body: createInput });
      const replayed = await listRequest("/v1/task-lists", { body: createInput });
      expect(created.status).toBe(201);
      expect(replayed.status).toBe(201);
      const createdList = (await payload(created)).taskList;
      expect((await payload(replayed)).taskList).toEqual(createdList);
      const renameCollision = await listRequest(`/v1/task-lists/${createdList.id}`, {
        body: { expectedRevision: createdList.revision, name: " focus plan " },
        method: "PATCH",
      });
      expect(renameCollision.status).toBe(409);
      expect((await payload(renameCollision)).error).toMatchObject({
        code: "conflict",
        details: { code: "task_list_name_conflict" },
      });
      const mismatch = await listRequest("/v1/task-lists", {
        body: { ...createInput, description: "Different material" },
      });
      expect(mismatch.status).toBe(409);
      expect((await payload(mismatch)).error).toMatchObject({
        code: "conflict",
        details: { code: "task_list_idempotency_mismatch" },
      });

      await database.db
        .update(taskLists)
        .set({ deletedAt: new Date("2026-07-13T12:00:00.000Z") })
        .where(eq(taskLists.id, createdList.id));
      const deletedReplay = await listRequest("/v1/task-lists", { body: createInput });
      expect(deletedReplay.status).toBe(201);
      expect((await payload(deletedReplay)).taskList).toMatchObject({
        deletedAt: "2026-07-13T12:00:00.000Z",
        id: createdList.id,
      });

      const otherRegistration = await request("/v1/auth/register", {
        auth: "none",
        body: {
          displayName: "Other Task Lists User",
          email: "task-lists-other@example.com",
          password: "LocalTestOnly123!",
          planningTimezone: "America/New_York",
        },
      });
      expect(otherRegistration.status).toBe(201);
      const otherSessionToken = (await payload(otherRegistration)).sessionToken as string;
      expect(
        (
          await app.request(`/v1/task-lists/${canonical.id}`, {
            headers: { authorization: `Session ${otherSessionToken}` },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await app.request("/v1/task-lists", {
            body: JSON.stringify({ name: "focus plan" }),
            headers: {
              authorization: `Session ${otherSessionToken}`,
              "content-type": "application/json",
            },
            method: "POST",
          })
        ).status,
      ).toBe(201);

      const firstPage = await payload(await listRequest("/v1/task-lists?limit=1"));
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.nextCursor).toEqual(expect.any(String));
      expect(
        (
          await payload(
            await listRequest(
              `/v1/task-lists?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
            ),
          )
        ).items,
      ).toHaveLength(1);
    });

    it("task lists guard revisions and Inbox mutation choices and audit successful mutations", async () => {
      const inbox = (await payload(await listRequest("/v1/task-lists"))).items.find(
        (item: { kind: string }) => item.kind === "inbox",
      );
      const inboxRename = await listRequest(`/v1/task-lists/${inbox.id}`, {
        body: { expectedRevision: inbox.revision, name: "Renamed Inbox" },
        method: "PATCH",
      });
      expect(inboxRename.status).toBe(409);
      expect((await payload(inboxRename)).error).toMatchObject({
        code: "conflict",
        details: {
          code: "task_list_inbox_protected",
          resolutions: ["keep_inbox", "choose_another_list"],
        },
      });
      const inboxArchive = await listRequest(`/v1/task-lists/${inbox.id}/archive`, {
        body: { expectedRevision: inbox.revision },
      });
      expect(inboxArchive.status).toBe(409);
      expect((await payload(inboxArchive)).error.details).toEqual({
        code: "task_list_inbox_protected",
        currentRevision: 1,
        resolutions: ["keep_inbox", "choose_another_list"],
      });

      const mutable = await createList("Revision Guard");
      const updatedResponse = await listRequest(`/v1/task-lists/${mutable.id}`, {
        body: {
          color: "violet",
          description: "Revised once",
          expectedRevision: mutable.revision,
        },
        method: "PATCH",
      });
      expect(updatedResponse.status).toBe(200);
      const updated = (await payload(updatedResponse)).taskList;
      expect(updated).toMatchObject({
        color: "violet",
        description: "Revised once",
        revision: 2,
        source: {
          provider: "local",
          remoteId: mutable.id,
          revision: "2",
          sourceType: "task_list",
        },
      });
      expect(
        (await payload(await listRequest(`/v1/task-lists/${mutable.id}`))).taskList.source,
      ).toEqual({
        accountId: null,
        provider: "local",
        remoteId: mutable.id,
        revision: "2",
        sourceType: "task_list",
      });
      const stale = await listRequest(`/v1/task-lists/${mutable.id}`, {
        body: { expectedRevision: mutable.revision, name: "Stale write" },
        method: "PATCH",
      });
      expect(stale.status).toBe(409);
      expect((await payload(stale)).error).toMatchObject({
        code: "conflict",
        details: { currentRevision: 2 },
      });

      const archivedResponse = await listRequest(`/v1/task-lists/${mutable.id}/archive`, {
        body: { expectedRevision: updated.revision },
      });
      expect(archivedResponse.status).toBe(200);
      const archived = (await payload(archivedResponse)).taskList;
      expect(archived).toMatchObject({
        archivedAt: "2026-07-13T12:00:00.000Z",
        availability: "archived",
        revision: 3,
      });
      expect(
        (
          await payload(
            await listRequest(`/v1/task-lists/${mutable.id}/archive`, {
              body: { expectedRevision: updated.revision },
            }),
          )
        ).error,
      ).toMatchObject({ code: "conflict", details: { currentRevision: 3 } });

      const audit = await database.db
        .select({
          action: auditEvents.action,
          after: auditEvents.after,
          before: auditEvents.before,
        })
        .from(auditEvents)
        .where(and(eq(auditEvents.userId, listUserId), eq(auditEvents.entityId, mutable.id)));
      expect(audit.map(({ action }) => action)).toEqual([
        "task_list.created",
        "task_list.updated",
        "task_list.archived",
      ]);
      expect(audit.find(({ action }) => action === "task_list.created")?.after).toMatchObject({
        source: { provider: "local", remoteId: mutable.id, revision: "1" },
      });
      expect(audit.find(({ action }) => action === "task_list.updated")).toMatchObject({
        after: { source: { provider: "local", remoteId: mutable.id, revision: "2" } },
        before: { source: { provider: "local", remoteId: mutable.id, revision: "1" } },
      });
      expect(audit.find(({ action }) => action === "task_list.archived")).toMatchObject({
        after: { source: { provider: "local", remoteId: mutable.id, revision: "3" } },
        before: { source: { provider: "local", remoteId: mutable.id, revision: "2" } },
      });
    });

    it("task lists enforce scoped-token permissions and agent mutation guards", async () => {
      expect(
        (
          await agentListRequest(listReadToken, "/v1/task-lists", {
            body: { name: "Read cannot create" },
          })
        ).status,
      ).toBe(403);
      expect((await agentListRequest(listWriteToken, "/v1/task-lists")).status).toBe(403);

      const missingKey = await agentListRequest(listAgentToken, "/v1/task-lists", {
        body: { name: "Agent missing key" },
      });
      expect(missingKey.status).toBe(400);
      expect((await payload(missingKey)).error).toMatchObject({ code: "invalid_request" });

      const agentInput = {
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
        name: "Agent List",
      };
      const createdResponse = await agentListRequest(listAgentToken, "/v1/task-lists", {
        body: agentInput,
      });
      expect(createdResponse.status).toBe(201);
      const created = (await payload(createdResponse)).taskList;
      const replayResponse = await agentListRequest(listAgentToken, "/v1/task-lists", {
        body: agentInput,
      });
      expect(replayResponse.status).toBe(201);
      expect((await payload(replayResponse)).taskList).toEqual(created);

      const missingUpdateRevision = await agentListRequest(
        listAgentToken,
        `/v1/task-lists/${created.id}`,
        { body: { name: "Agent update without revision" }, method: "PATCH" },
      );
      expect(missingUpdateRevision.status).toBe(400);
      expect((await payload(missingUpdateRevision)).error).toMatchObject({
        code: "invalid_request",
      });
      const missingArchiveRevision = await agentListRequest(
        listAgentToken,
        `/v1/task-lists/${created.id}/archive`,
        { body: {} },
      );
      expect(missingArchiveRevision.status).toBe(400);
      expect((await payload(missingArchiveRevision)).error).toMatchObject({
        code: "invalid_request",
      });
    });

    it("task lists resolve active-content archive conflicts without implicit mutation", async () => {
      const source = await createList("Move Source");
      const destination = await createList("Move Destination");
      const [project] = await database.db
        .insert(taskProjects)
        .values({
          listId: source.id,
          name: "Move Project",
          normalizedName: "move project",
          userId: listUserId,
        })
        .returning();
      if (!project) throw new Error("Project fixture was not created.");
      const [task] = await database.db
        .insert(reminders)
        .values({
          kind: "task",
          status: "inbox",
          taskLifecycle: "open",
          taskListId: source.id,
          taskProjectId: project.id,
          taskRevision: 1,
          title: "Move Task",
          userId: listUserId,
        })
        .returning();
      if (!task) throw new Error("Task fixture was not created.");
      const terminalAt = new Date("2026-07-13T11:00:00.000Z");
      const [archivedProject, completedProject] = await database.db
        .insert(taskProjects)
        .values([
          {
            archivedAt: terminalAt,
            availability: "archived",
            listId: source.id,
            name: "Archived Project Stays",
            normalizedName: "archived project stays",
            userId: listUserId,
          },
          {
            completedAt: terminalAt,
            lifecycle: "completed",
            listId: source.id,
            name: "Completed Project Stays",
            normalizedName: "completed project stays",
            userId: listUserId,
          },
        ])
        .returning();
      const [cancelledTask, deletedTask] = await database.db
        .insert(reminders)
        .values([
          {
            kind: "task",
            status: "cancelled",
            taskCancelledAt: terminalAt,
            taskLifecycle: "cancelled",
            taskListId: source.id,
            taskRevision: 1,
            title: "Cancelled Task Stays",
            userId: listUserId,
          },
          {
            deletedAt: terminalAt,
            kind: "task",
            status: "inbox",
            taskLifecycle: "open",
            taskListId: source.id,
            taskRevision: 1,
            title: "Trashed Task Stays",
            userId: listUserId,
          },
        ])
        .returning();
      if (!archivedProject || !completedProject || !cancelledTask || !deletedTask) {
        throw new Error("Inactive Task List contents were not created.");
      }

      const preview = await listRequest(`/v1/task-lists/${source.id}/archive`, {
        body: { expectedRevision: source.revision },
      });
      expect(preview.status).toBe(409);
      expect((await payload(preview)).error).toMatchObject({
        code: "conflict",
        details: {
          code: "task_list_has_active_contents",
          currentRevisions: {
            destinationList: null,
            project: null,
            sourceList: 1,
            task: null,
          },
          openContentCounts: { projects: 1, tasks: 1 },
          resolutions: ["move_active_contents", "archive_contents_together", "cancel"],
        },
      });
      const destinationPreview = await listRequest(`/v1/task-lists/${source.id}/archive`, {
        body: { destinationListId: destination.id, expectedRevision: source.revision },
      });
      expect(destinationPreview.status).toBe(409);
      expect((await payload(destinationPreview)).error.details.currentRevisions).toMatchObject({
        destinationList: destination.revision,
        sourceList: source.revision,
      });

      const cancelled = await listRequest(`/v1/task-lists/${source.id}/archive`, {
        body: { expectedRevision: source.revision, resolution: "cancel" },
      });
      expect(cancelled.status).toBe(200);
      expect((await payload(cancelled)).taskList).toMatchObject({
        availability: "active",
        revision: 1,
      });
      expect(
        await database.db.select().from(auditEvents).where(eq(auditEvents.entityId, source.id)),
      ).toHaveLength(1);

      const moved = await listRequest(`/v1/task-lists/${source.id}/archive`, {
        body: {
          destinationListId: destination.id,
          expectedRevision: source.revision,
          resolution: "move_active_contents",
        },
      });
      expect(moved.status).toBe(200);
      expect((await payload(moved)).taskList).toMatchObject({
        availability: "archived",
        revision: 2,
      });
      expect(
        await database.db.select().from(taskProjects).where(eq(taskProjects.id, project.id)),
      ).toEqual([expect.objectContaining({ listId: destination.id, revision: 2 })]);
      expect(await database.db.select().from(reminders).where(eq(reminders.id, task.id))).toEqual([
        expect.objectContaining({ taskListId: destination.id, taskRevision: 2 }),
      ]);
      expect(
        await database.db
          .select({ listId: taskProjects.listId, revision: taskProjects.revision })
          .from(taskProjects)
          .where(inArray(taskProjects.id, [archivedProject.id, completedProject.id])),
      ).toEqual([
        { listId: source.id, revision: 1 },
        { listId: source.id, revision: 1 },
      ]);
      expect(
        await database.db
          .select({ listId: reminders.taskListId, revision: reminders.taskRevision })
          .from(reminders)
          .where(inArray(reminders.id, [cancelledTask.id, deletedTask.id])),
      ).toEqual([
        { listId: source.id, revision: 1 },
        { listId: source.id, revision: 1 },
      ]);
      const moveAudits = await database.db
        .select({
          action: auditEvents.action,
          actorId: auditEvents.actorId,
          actorType: auditEvents.actorType,
          after: auditEvents.after,
          before: auditEvents.before,
          entityId: auditEvents.entityId,
          requestId: auditEvents.requestId,
        })
        .from(auditEvents)
        .where(inArray(auditEvents.entityId, [source.id, project.id, task.id]));
      expect(moveAudits.map(({ action }) => action).sort()).toEqual([
        "task.moved_with_list",
        "task_list.archived",
        "task_list.created",
        "task_project.moved_with_list",
      ]);
      expect(new Set(moveAudits.map(({ requestId }) => requestId)).size).toBe(2);
      for (const childAudit of moveAudits.filter(({ entityId }) => entityId !== source.id)) {
        expect(childAudit).toMatchObject({
          actorId: listUserId,
          actorType: "user",
          after: {
            authorization: { actorId: listUserId, kind: "interactive_user" },
            listId: destination.id,
            policy: "approve_each",
            revision: 2,
            source: { provider: "local", revision: "2" },
          },
          before: {
            authorization: { actorId: listUserId, kind: "interactive_user" },
            listId: source.id,
            policy: "approve_each",
            revision: 1,
            source: { provider: "local", revision: "1" },
          },
        });
      }
      expect(
        new Set(
          moveAudits
            .filter(({ action }) => action !== "task_list.created")
            .map(({ requestId }) => requestId),
        ).size,
      ).toBe(1);

      const together = await createList("Archive Together");
      const [togetherProject] = await database.db
        .insert(taskProjects)
        .values({
          listId: together.id,
          name: "Stay Project",
          normalizedName: "stay project",
          userId: listUserId,
        })
        .returning();
      if (!togetherProject) throw new Error("Together Project fixture was not created.");
      const [togetherTask] = await database.db
        .insert(reminders)
        .values({
          kind: "task",
          status: "inbox",
          taskLifecycle: "open",
          taskListId: together.id,
          taskProjectId: togetherProject.id,
          taskRevision: 1,
          title: "Stay Task",
          userId: listUserId,
        })
        .returning();
      if (!togetherTask) throw new Error("Together Task fixture was not created.");
      const archivedTogether = await listRequest(`/v1/task-lists/${together.id}/archive`, {
        body: {
          expectedRevision: together.revision,
          resolution: "archive_contents_together",
        },
      });
      expect(archivedTogether.status).toBe(200);
      expect((await payload(archivedTogether)).taskList).toMatchObject({
        availability: "archived",
        revision: 2,
      });
      expect(
        await database.db
          .select({ listId: taskProjects.listId, revision: taskProjects.revision })
          .from(taskProjects)
          .where(eq(taskProjects.id, togetherProject.id)),
      ).toEqual([{ listId: together.id, revision: 1 }]);
      expect(
        await database.db
          .select({ listId: reminders.taskListId, revision: reminders.taskRevision })
          .from(reminders)
          .where(eq(reminders.id, togetherTask.id)),
      ).toEqual([{ listId: together.id, revision: 1 }]);

      const projectOnlySource = await createList("Move Project-Only Source");
      const projectOnlyDestination = await createList("Move Project-Only Destination");
      const [projectOnly] = await database.db
        .insert(taskProjects)
        .values({
          listId: projectOnlySource.id,
          name: "Move Project Without Tasks",
          normalizedName: "move project without tasks",
          userId: listUserId,
        })
        .returning();
      if (!projectOnly) throw new Error("Project-only move fixture was not created.");
      const projectOnlyMove = await listRequest(`/v1/task-lists/${projectOnlySource.id}/archive`, {
        body: {
          destinationListId: projectOnlyDestination.id,
          expectedRevision: projectOnlySource.revision,
          resolution: "move_active_contents",
        },
      });
      expect(projectOnlyMove.status).toBe(200);
      expect(
        await database.db
          .select({ listId: taskProjects.listId, revision: taskProjects.revision })
          .from(taskProjects)
          .where(eq(taskProjects.id, projectOnly.id)),
      ).toEqual([{ listId: projectOnlyDestination.id, revision: 2 }]);
      expect(
        await database.db
          .select({ action: auditEvents.action })
          .from(auditEvents)
          .where(eq(auditEvents.entityId, projectOnly.id)),
      ).toEqual([{ action: "task_project.moved_with_list" }]);

      const taskOnlySource = await createList("Move Task-Only Source");
      const taskOnlyDestination = await createList("Move Task-Only Destination");
      const [taskOnly] = await database.db
        .insert(reminders)
        .values({
          kind: "task",
          status: "inbox",
          taskLifecycle: "open",
          taskListId: taskOnlySource.id,
          taskRevision: 1,
          title: "Move Task Without Project",
          userId: listUserId,
        })
        .returning();
      if (!taskOnly) throw new Error("Task-only move fixture was not created.");
      const taskOnlyMove = await agentListRequest(
        listAgentToken,
        `/v1/task-lists/${taskOnlySource.id}/archive`,
        {
          body: {
            destinationListId: taskOnlyDestination.id,
            expectedRevision: taskOnlySource.revision,
            resolution: "move_active_contents",
          },
        },
      );
      expect(taskOnlyMove.status).toBe(200);
      expect(
        await database.db
          .select({ listId: reminders.taskListId, revision: reminders.taskRevision })
          .from(reminders)
          .where(eq(reminders.id, taskOnly.id)),
      ).toEqual([{ listId: taskOnlyDestination.id, revision: 2 }]);
      const [taskOnlyAudit] = await database.db
        .select({
          actorId: auditEvents.actorId,
          actorType: auditEvents.actorType,
          after: auditEvents.after,
          before: auditEvents.before,
        })
        .from(auditEvents)
        .where(eq(auditEvents.entityId, taskOnly.id));
      expect(taskOnlyAudit).toMatchObject({
        actorType: "agent",
        after: {
          authorization: {
            actorId: taskOnlyAudit?.actorId,
            kind: "scoped_agent_permission",
          },
          listId: taskOnlyDestination.id,
          policy: "approved_rule",
          projectId: null,
          revision: 2,
        },
        before: {
          authorization: {
            actorId: taskOnlyAudit?.actorId,
            kind: "scoped_agent_permission",
          },
          listId: taskOnlySource.id,
          policy: "approved_rule",
          projectId: null,
          revision: 1,
        },
      });
    });

    it("task lists reject missing, archived, and same-list archive destinations", async () => {
      const missingId = "99999999-9999-4999-8999-999999999999";
      expect(
        (
          await listRequest(`/v1/task-lists/${missingId}/archive`, {
            body: { resolution: "archive_contents_together" },
          })
        ).status,
      ).toBe(404);

      const empty = await createList("Human Revision Default");
      const humanUpdate = await listRequest(`/v1/task-lists/${empty.id}`, {
        body: { description: "Updated without an explicit human revision" },
        method: "PATCH",
      });
      expect(humanUpdate.status).toBe(200);
      expect((await payload(humanUpdate)).taskList.revision).toBe(2);
      const humanArchive = await listRequest(`/v1/task-lists/${empty.id}/archive`, { body: {} });
      expect(humanArchive.status).toBe(200);
      const archived = (await payload(humanArchive)).taskList;
      expect(archived.revision).toBe(3);
      expect(
        (
          await listRequest(`/v1/task-lists/${empty.id}/archive`, {
            body: { expectedRevision: archived.revision },
          })
        ).status,
      ).toBe(409);

      const source = await createList("Unavailable Destination Source");
      for (const destinationListId of [source.id, missingId, empty.id]) {
        const response = await listRequest(`/v1/task-lists/${source.id}/archive`, {
          body: {
            destinationListId,
            expectedRevision: source.revision,
            resolution: "move_active_contents",
          },
        });
        expect(response.status).toBe(destinationListId === missingId ? 404 : 409);
      }
    });
  });

  describe("task projects", () => {
    let projectAgentToken = "";
    let projectSessionToken = "";
    let projectUserId = "";

    type ProjectResponse = {
      availability: "active" | "archived";
      id: string;
      lifecycle: "open" | "completed" | "cancelled";
      listId: string;
      name: string;
      revision: number;
      source: {
        accountId: null;
        provider: "local";
        remoteId: string;
        revision: string;
        sourceType: "task_project";
      };
    };

    async function projectRequest(path: string, options: Omit<RequestOptions, "auth"> = {}) {
      const headers = new Headers(options.headers);
      headers.set("authorization", `Session ${projectSessionToken}`);
      const hasBody = options.body !== undefined || options.rawBody !== undefined;
      if (hasBody) headers.set("content-type", "application/json");
      return app.request(path, {
        ...(hasBody ? { body: options.rawBody ?? JSON.stringify(options.body) } : {}),
        headers,
        method: options.method ?? (hasBody ? "POST" : "GET"),
      });
    }

    async function agentProjectRequest(path: string, options: Omit<RequestOptions, "auth"> = {}) {
      const headers = new Headers(options.headers);
      headers.set("authorization", `Bearer ${projectAgentToken}`);
      const hasBody = options.body !== undefined || options.rawBody !== undefined;
      if (hasBody) headers.set("content-type", "application/json");
      return app.request(path, {
        ...(hasBody ? { body: options.rawBody ?? JSON.stringify(options.body) } : {}),
        headers,
        method: options.method ?? (hasBody ? "POST" : "GET"),
      });
    }

    async function createProjectList(name: string) {
      const response = await projectRequest("/v1/task-lists", { body: { name } });
      expect(response.status).toBe(201);
      return (await payload(response)).taskList as { id: string; revision: number };
    }

    async function createProject(
      listId: string,
      name: string,
      extra: Record<string, unknown> = {},
    ) {
      const response = await projectRequest("/v1/task-projects", {
        body: { listId, name, ...extra },
      });
      expect(response.status).toBe(201);
      return (await payload(response)).taskProject as ProjectResponse;
    }

    async function insertProjectTask(project: ProjectResponse, title: string) {
      const [task] = await database.db
        .insert(reminders)
        .values({
          kind: "task",
          status: "inbox",
          taskLifecycle: "open",
          taskListId: project.listId,
          taskProjectId: project.id,
          taskRevision: 1,
          title,
          userId: projectUserId,
        })
        .returning();
      if (!task) throw new Error("Task Project Task fixture was not created.");
      return task;
    }

    async function waitForTaskOrganizationLockWaiters(expected: number) {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const result = await database.pool.query<{ count: string }>(`
          SELECT count(*)::text AS count
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query LIKE '%task_lists%'
            AND query NOT LIKE '%pg_stat_activity%'
        `);
        if (Number(result.rows[0]?.count ?? 0) >= expected) return;
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, 20));
      }
      throw new Error(`Expected at least ${expected} Task organization lock waiter(s).`);
    }

    beforeAll(async () => {
      const registration = await request("/v1/auth/register", {
        auth: "none",
        body: {
          displayName: "Task Projects User",
          email: "task-projects@example.com",
          password: "LocalTestOnly123!",
          planningTimezone: "America/New_York",
        },
      });
      expect(registration.status).toBe(201);
      const body = await payload(registration);
      projectSessionToken = body.sessionToken;
      projectUserId = body.user.id;
      const tokenResponse = await projectRequest("/v1/access-tokens", {
        body: { name: "Task Projects agent", scopes: ["tasks:read", "tasks:write"] },
      });
      expect(tokenResponse.status).toBe(201);
      projectAgentToken = (await payload(tokenResponse)).token.token;
    });

    it("task projects enforce List ownership, local provenance, scoped uniqueness, and idempotent empty creation", async () => {
      expect((await request("/v1/task-projects", { auth: "none" })).status).toBe(401);
      const firstList = await createProjectList("Project Alpha List");
      const secondList = await createProjectList("Project Beta List");
      const first = await createProject(firstList.id, "Ｆｏｃｕｓ　Project");
      expect(first).toMatchObject({
        availability: "active",
        lifecycle: "open",
        listId: firstList.id,
        notes: null,
        revision: 1,
        source: {
          accountId: null,
          provider: "local",
          remoteId: first.id,
          revision: "1",
          sourceType: "task_project",
        },
        targetDate: null,
        why: null,
      });
      expect(
        await database.db
          .select()
          .from(reminders)
          .where(and(eq(reminders.taskProjectId, first.id), eq(reminders.kind, "task"))),
      ).toHaveLength(0);
      expect(
        (
          await projectRequest("/v1/task-projects", {
            body: {
              listId: firstList.id,
              name: "Forged source",
              source: first.source,
            },
          })
        ).status,
      ).toBe(400);

      const collision = await projectRequest("/v1/task-projects", {
        body: { listId: firstList.id, name: " focus project " },
      });
      expect(collision.status).toBe(409);
      expect((await payload(collision)).error.details).toMatchObject({
        code: "task_project_name_conflict",
      });
      expect((await createProject(secondList.id, "focus project")).listId).toBe(secondList.id);

      const idempotencyKey = "66666666-6666-4666-8666-666666666666";
      const input = { idempotencyKey, listId: firstList.id, name: "Replay Project" };
      const created = await projectRequest("/v1/task-projects", { body: input });
      const replayed = await projectRequest("/v1/task-projects", { body: input });
      expect(created.status).toBe(201);
      expect(replayed.status).toBe(201);
      const createdProject = (await payload(created)).taskProject;
      expect((await payload(replayed)).taskProject).toEqual(createdProject);
      const mismatch = await projectRequest("/v1/task-projects", {
        body: { ...input, notes: "Different material" },
      });
      expect(mismatch.status).toBe(409);
      expect((await payload(mismatch)).error.details).toMatchObject({
        code: "task_project_idempotency_mismatch",
      });
      await database.db
        .update(taskProjects)
        .set({ deletedAt: new Date("2026-07-13T12:00:00.000Z") })
        .where(eq(taskProjects.id, createdProject.id));
      const deletedReplay = await projectRequest("/v1/task-projects", { body: input });
      expect(deletedReplay.status).toBe(201);
      expect((await payload(deletedReplay)).taskProject).toMatchObject({
        deletedAt: "2026-07-13T12:00:00.000Z",
        id: createdProject.id,
      });

      const otherRegistration = await request("/v1/auth/register", {
        auth: "none",
        body: {
          displayName: "Other Task Projects User",
          email: "task-projects-other@example.com",
          password: "LocalTestOnly123!",
          planningTimezone: "America/New_York",
        },
      });
      expect(otherRegistration.status).toBe(201);
      const other = await payload(otherRegistration);
      const [otherInbox] = await database.db
        .select({ id: taskLists.id })
        .from(taskLists)
        .where(and(eq(taskLists.userId, other.user.id), eq(taskLists.kind, "inbox")));
      if (!otherInbox) throw new Error("Other Project Inbox fixture was not created.");
      expect(
        (
          await projectRequest("/v1/task-projects", {
            body: { listId: otherInbox.id, name: "Cross-owner Project" },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await app.request(`/v1/task-projects/${first.id}`, {
            headers: { authorization: `Session ${other.sessionToken}` },
          })
        ).status,
      ).toBe(404);

      const listed = await payload(await projectRequest("/v1/task-projects?limit=1"));
      expect(listed.items).toHaveLength(1);
      expect(listed.nextCursor).toEqual(expect.any(String));
      expect(
        (
          await payload(
            await projectRequest(
              `/v1/task-projects?limit=1&cursor=${encodeURIComponent(listed.nextCursor)}`,
            ),
          )
        ).items,
      ).toHaveLength(1);
    });

    it("task projects enforce agent idempotency and revision guards", async () => {
      const list = await createProjectList("Agent Project List");
      const missingKey = await agentProjectRequest("/v1/task-projects", {
        body: { listId: list.id, name: "Agent missing key" },
      });
      expect(missingKey.status).toBe(400);
      const createInput = {
        idempotencyKey: "77777777-7777-4777-8777-777777777777",
        listId: list.id,
        name: "Agent Project",
      };
      const createdResponse = await agentProjectRequest("/v1/task-projects", {
        body: createInput,
      });
      expect(createdResponse.status).toBe(201);
      const created = (await payload(createdResponse)).taskProject as ProjectResponse;
      for (const [path, body, method] of [
        [`/v1/task-projects/${created.id}`, { name: "No revision" }, "PATCH"],
        [`/v1/task-projects/${created.id}/cancel`, {}, "POST"],
        [`/v1/task-projects/${created.id}/archive`, {}, "POST"],
        [`/v1/task-projects/${created.id}/complete`, {}, "POST"],
      ] as const) {
        expect((await agentProjectRequest(path, { body, method })).status).toBe(400);
      }
    });

    it("task projects use dedicated revision-safe update, cancel, and archive transitions", async () => {
      const list = await createProjectList("Project Lifecycle List");
      const mutable = await createProject(list.id, "Mutable Project");
      const updatedResponse = await projectRequest(`/v1/task-projects/${mutable.id}`, {
        body: {
          expectedRevision: mutable.revision,
          name: "Renamed Project",
          notes: "Reviewed",
          targetDate: "2026-07-31",
          why: "Ship it",
        },
        method: "PATCH",
      });
      expect(updatedResponse.status).toBe(200);
      const updated = (await payload(updatedResponse)).taskProject as ProjectResponse;
      expect(updated).toMatchObject({
        listId: list.id,
        name: "Renamed Project",
        revision: 2,
        source: { remoteId: mutable.id, revision: "2", sourceType: "task_project" },
      });
      expect(
        (
          await projectRequest(`/v1/task-projects/${mutable.id}`, {
            body: { expectedRevision: 2, listId: list.id },
            method: "PATCH",
          })
        ).status,
      ).toBe(400);
      const stale = await projectRequest(`/v1/task-projects/${mutable.id}`, {
        body: { expectedRevision: mutable.revision, name: "Stale Project" },
        method: "PATCH",
      });
      expect(stale.status).toBe(409);
      expect((await payload(stale)).error.details).toMatchObject({ currentRevision: 2 });

      const cancellable = await createProject(list.id, "Cancellable Project");
      const cancelledResponse = await projectRequest(`/v1/task-projects/${cancellable.id}/cancel`, {
        body: { expectedRevision: cancellable.revision },
      });
      expect(cancelledResponse.status).toBe(200);
      expect((await payload(cancelledResponse)).taskProject).toMatchObject({
        cancelledAt: "2026-07-13T12:00:00.000Z",
        lifecycle: "cancelled",
        revision: 2,
      });
      expect(
        (
          await projectRequest(`/v1/task-projects/${cancellable.id}/cancel`, {
            body: { expectedRevision: cancellable.revision },
          })
        ).status,
      ).toBe(409);

      const archivable = await createProject(list.id, "Archivable Project");
      const archivedResponse = await projectRequest(`/v1/task-projects/${archivable.id}/archive`, {
        body: { expectedRevision: archivable.revision },
      });
      expect(archivedResponse.status).toBe(200);
      expect((await payload(archivedResponse)).taskProject).toMatchObject({
        archivedAt: "2026-07-13T12:00:00.000Z",
        availability: "archived",
        revision: 2,
      });
      expect(
        (
          await projectRequest(`/v1/task-projects/${archivable.id}/archive`, {
            body: { expectedRevision: archivable.revision },
          })
        ).status,
      ).toBe(409);
    });

    it("task projects fail closed for terminal Projects and unavailable move destinations", async () => {
      const missingId = "99999999-9999-4999-8999-999999999999";
      const sourceList = await createProjectList("Project Safety Source");
      const project = await createProject(sourceList.id, "Project Safety Subject");
      expect((await projectRequest(`/v1/task-projects/${missingId}`)).status).toBe(404);
      const notesOnly = await projectRequest(`/v1/task-projects/${project.id}`, {
        body: { notes: "Human review without a supplied revision" },
        method: "PATCH",
      });
      expect(notesOnly.status).toBe(200);
      const revised = (await payload(notesOnly)).taskProject as ProjectResponse;
      expect(revised).toMatchObject({
        notes: "Human review without a supplied revision",
        revision: 2,
      });

      const sameDestination = await projectRequest(`/v1/task-projects/${project.id}/move/preview`, {
        body: { destinationListId: sourceList.id, expectedRevision: revised.revision },
      });
      expect(sameDestination.status).toBe(409);
      expect(
        (
          await projectRequest(`/v1/task-projects/${project.id}/move`, {
            body: {
              destinationListId: sourceList.id,
              expectedRevision: revised.revision,
              previewToken: "same-destination-does-not-commit",
            },
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await projectRequest(`/v1/task-projects/${project.id}/move/preview`, {
            body: { destinationListId: missingId, expectedRevision: revised.revision },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await projectRequest(`/v1/task-projects/${project.id}/move`, {
            body: {
              destinationListId: missingId,
              expectedRevision: revised.revision,
              previewToken: "missing-destination-does-not-commit",
            },
          })
        ).status,
      ).toBe(404);

      const archivedDestination = await createProjectList("Project Safety Archived Destination");
      expect(
        (
          await projectRequest(`/v1/task-lists/${archivedDestination.id}/archive`, {
            body: { expectedRevision: archivedDestination.revision },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await projectRequest(`/v1/task-projects/${project.id}/move/preview`, {
            body: {
              destinationListId: archivedDestination.id,
              expectedRevision: revised.revision,
            },
          })
        ).status,
      ).toBe(404);

      const completed = await createProject(sourceList.id, "Project Safety Completed");
      expect(
        (
          await projectRequest(`/v1/task-projects/${completed.id}/complete`, {
            body: { expectedRevision: completed.revision },
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await projectRequest(`/v1/task-projects/${completed.id}/cancel`, {
            body: { expectedRevision: 2 },
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await projectRequest(`/v1/task-projects/${completed.id}/complete`, {
            body: { expectedRevision: 2 },
          })
        ).status,
      ).toBe(409);

      const archivedProject = await createProject(sourceList.id, "Project Safety Archived");
      const archiveResponse = await projectRequest(
        `/v1/task-projects/${archivedProject.id}/archive`,
        { body: { expectedRevision: archivedProject.revision } },
      );
      expect(archiveResponse.status).toBe(200);
      for (const [path, body, method] of [
        [
          `/v1/task-projects/${archivedProject.id}`,
          { expectedRevision: 2, notes: "Cannot edit an archived Project" },
          "PATCH",
        ],
        [
          `/v1/task-projects/${archivedProject.id}/move/preview`,
          { destinationListId: sourceList.id, expectedRevision: 2 },
          "POST",
        ],
      ] as const) {
        expect((await projectRequest(path, { body, method })).status).toBe(409);
      }

      const destinationList = await createProjectList("Project Completion Safety Destination");
      const movable = await createProject(sourceList.id, "Project Completion Safety Subject");
      await insertProjectTask(movable, "Project Completion Safety Task");
      expect(
        (
          await projectRequest(`/v1/task-projects/${movable.id}/complete`, {
            body: {
              destinationListId: missingId,
              expectedRevision: movable.revision,
              resolution: "move_open_tasks",
            },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await projectRequest(`/v1/task-projects/${movable.id}/complete`, {
            body: {
              destinationListId: destinationList.id,
              destinationProjectId: missingId,
              expectedRevision: movable.revision,
              resolution: "move_open_tasks",
            },
          })
        ).status,
      ).toBe(404);
      const movedWithoutProject = await projectRequest(`/v1/task-projects/${movable.id}/complete`, {
        body: {
          destinationListId: destinationList.id,
          expectedRevision: movable.revision,
          resolution: "move_open_tasks",
        },
      });
      expect(movedWithoutProject.status).toBe(200);
      expect(
        (
          await projectRequest(`/v1/task-projects/${missingId}/archive`, {
            body: { expectedRevision: 1 },
          })
        ).status,
      ).toBe(404);
    });

    it("task organization moves and renames preserve destination name uniqueness", async () => {
      const sourceList = await createProjectList("Project Collision Source");
      const destinationList = await createProjectList("Project Collision Destination");
      const sourceProject = await createProject(sourceList.id, "Collision Project");
      await createProject(destinationList.id, "collision project");

      const preview = await payload(
        await projectRequest(`/v1/task-projects/${sourceProject.id}/move/preview`, {
          body: {
            destinationListId: destinationList.id,
            expectedRevision: sourceProject.revision,
          },
        }),
      );
      const collidingMove = await projectRequest(`/v1/task-projects/${sourceProject.id}/move`, {
        body: {
          destinationListId: destinationList.id,
          expectedRevision: sourceProject.revision,
          previewToken: preview.preview.previewToken,
        },
      });
      expect(collidingMove.status).toBe(409);
      expect((await payload(collidingMove)).error.details).toMatchObject({
        code: "task_project_move_name_conflict",
      });

      const renameSource = await createProject(sourceList.id, "Rename Source Project");
      const collidingRename = await projectRequest(`/v1/task-projects/${renameSource.id}`, {
        body: { expectedRevision: renameSource.revision, name: "Collision Project" },
        method: "PATCH",
      });
      expect(collidingRename.status).toBe(409);
      expect((await payload(collidingRename)).error.details).toMatchObject({
        code: "task_project_name_conflict",
      });

      const listMove = await projectRequest(`/v1/task-lists/${sourceList.id}/archive`, {
        body: {
          destinationListId: destinationList.id,
          expectedRevision: sourceList.revision,
          resolution: "move_active_contents",
        },
      });
      expect(listMove.status).toBe(409);
      expect((await payload(listMove)).error.details).toMatchObject({
        code: "task_list_move_name_conflict",
      });
    });

    it("task projects require an explicit open-Task completion resolution and apply every choice atomically", async () => {
      const sourceList = await createProjectList("Project Completion Source");
      const destinationList = await createProjectList("Project Completion Destination");
      const destinationProject = await createProject(destinationList.id, "Destination Project");

      const kept = await createProject(sourceList.id, "Keep Project Open");
      const keptTask = await insertProjectTask(kept, "Keep Task Open");
      const conflict = await projectRequest(`/v1/task-projects/${kept.id}/complete`, {
        body: { expectedRevision: kept.revision },
      });
      expect(conflict.status).toBe(409);
      expect((await payload(conflict)).error.details).toEqual({
        code: "task_project_has_open_tasks",
        currentRevisions: {
          destinationList: null,
          project: 1,
          sourceList: 1,
          task: null,
        },
        openContentCounts: { projects: 0, tasks: 1 },
        resolutions: [
          "complete_open_tasks",
          "cancel_open_tasks",
          "move_open_tasks",
          "keep_project_open",
        ],
      });
      const destinationConflict = await projectRequest(`/v1/task-projects/${kept.id}/complete`, {
        body: { destinationListId: destinationList.id, expectedRevision: kept.revision },
      });
      expect(destinationConflict.status).toBe(409);
      expect((await payload(destinationConflict)).error.details.currentRevisions).toMatchObject({
        destinationList: destinationList.revision,
        project: kept.revision,
      });
      const keepResponse = await projectRequest(`/v1/task-projects/${kept.id}/complete`, {
        body: { expectedRevision: kept.revision, resolution: "keep_project_open" },
      });
      expect(keepResponse.status).toBe(200);
      expect((await payload(keepResponse)).taskProject).toMatchObject({
        lifecycle: "open",
        revision: 1,
      });
      expect(
        await database.db.select().from(reminders).where(eq(reminders.id, keptTask.id)),
      ).toEqual([expect.objectContaining({ taskLifecycle: "open", taskRevision: 1 })]);

      const completed = await createProject(sourceList.id, "Complete Tasks Project");
      const completeTasks = await Promise.all([
        insertProjectTask(completed, "Complete First Task"),
        insertProjectTask(completed, "Complete Second Task"),
      ]);
      const completedResponse = await projectRequest(`/v1/task-projects/${completed.id}/complete`, {
        body: { expectedRevision: completed.revision, resolution: "complete_open_tasks" },
      });
      expect(completedResponse.status).toBe(200);
      expect((await payload(completedResponse)).taskProject).toMatchObject({
        completedAt: "2026-07-13T12:00:00.000Z",
        lifecycle: "completed",
        revision: 2,
      });
      expect(
        await database.db
          .select({ lifecycle: reminders.taskLifecycle, revision: reminders.taskRevision })
          .from(reminders)
          .where(
            inArray(
              reminders.id,
              completeTasks.map(({ id }) => id),
            ),
          ),
      ).toEqual([
        { lifecycle: "completed", revision: 2 },
        { lifecycle: "completed", revision: 2 },
      ]);
      const completionAudit = await database.db
        .select({ entityId: auditEvents.entityId, requestId: auditEvents.requestId })
        .from(auditEvents)
        .where(
          and(
            inArray(auditEvents.entityId, [completed.id, ...completeTasks.map(({ id }) => id)]),
            inArray(auditEvents.action, ["task_project.completed", "task.completed_with_project"]),
          ),
        );
      expect(completionAudit).toHaveLength(3);
      expect(new Set(completionAudit.map(({ requestId }) => requestId)).size).toBe(1);

      const cancelled = await createProject(sourceList.id, "Cancel Tasks Project");
      const cancelledTask = await insertProjectTask(cancelled, "Cancel This Task");
      const cancelResponse = await projectRequest(`/v1/task-projects/${cancelled.id}/complete`, {
        body: { expectedRevision: cancelled.revision, resolution: "cancel_open_tasks" },
      });
      expect(cancelResponse.status).toBe(200);
      expect((await payload(cancelResponse)).taskProject.lifecycle).toBe("completed");
      expect(
        await database.db.select().from(reminders).where(eq(reminders.id, cancelledTask.id)),
      ).toEqual([
        expect.objectContaining({
          completedAt: null,
          taskCancelledAt: new Date("2026-07-13T12:00:00.000Z"),
          taskLifecycle: "cancelled",
          taskRevision: 2,
        }),
      ]);

      const moved = await createProject(sourceList.id, "Move Tasks Project");
      const movedTask = await insertProjectTask(moved, "Move This Task");
      const selfMove = await projectRequest(`/v1/task-projects/${moved.id}/complete`, {
        body: {
          destinationListId: sourceList.id,
          destinationProjectId: moved.id,
          expectedRevision: moved.revision,
          resolution: "move_open_tasks",
        },
      });
      expect(selfMove.status).toBe(409);
      expect((await payload(selfMove)).error.details).toMatchObject({
        code: "task_project_destination_unavailable",
      });
      const moveResponse = await projectRequest(`/v1/task-projects/${moved.id}/complete`, {
        body: {
          destinationListId: destinationList.id,
          destinationProjectId: destinationProject.id,
          expectedRevision: moved.revision,
          resolution: "move_open_tasks",
        },
      });
      expect(moveResponse.status).toBe(200);
      expect((await payload(moveResponse)).taskProject.lifecycle).toBe("completed");
      expect(
        await database.db.select().from(reminders).where(eq(reminders.id, movedTask.id)),
      ).toEqual([
        expect.objectContaining({
          status: "inbox",
          taskLifecycle: "open",
          taskListId: destinationList.id,
          taskProjectId: destinationProject.id,
          taskRevision: 2,
        }),
      ]);
    });

    it("task projects preview and atomically commit Project-plus-Task moves while rejecting drift and cross-user destinations", async () => {
      const sourceList = await createProjectList("Project Move Source");
      const destinationList = await createProjectList("Project Move Destination");
      const project = await createProject(sourceList.id, "Atomic Move Project");
      const firstTask = await insertProjectTask(project, "Atomic Move First");

      const otherRegistration = await request("/v1/auth/register", {
        auth: "none",
        body: {
          displayName: "Project Move Other",
          email: "task-project-move-other@example.com",
          password: "LocalTestOnly123!",
          planningTimezone: "America/New_York",
        },
      });
      const other = await payload(otherRegistration);
      const [otherInbox] = await database.db
        .select({ id: taskLists.id })
        .from(taskLists)
        .where(and(eq(taskLists.userId, other.user.id), eq(taskLists.kind, "inbox")));
      if (!otherInbox) throw new Error("Other Project Move Inbox fixture was not created.");
      expect(
        (
          await projectRequest(`/v1/task-projects/${project.id}/move/preview`, {
            body: { destinationListId: otherInbox.id, expectedRevision: project.revision },
          })
        ).status,
      ).toBe(404);

      const previewResponse = await projectRequest(`/v1/task-projects/${project.id}/move/preview`, {
        body: { destinationListId: destinationList.id, expectedRevision: project.revision },
      });
      expect(previewResponse.status).toBe(200);
      const preview = (await payload(previewResponse)).preview;
      expect(preview).toEqual({
        affectedTaskCount: 1,
        destinationListId: destinationList.id,
        destinationListRevision: destinationList.revision,
        previewToken: expect.any(String),
        sourceListId: sourceList.id,
        sourceListRevision: sourceList.revision,
        taskProjectId: project.id,
        taskProjectRevision: project.revision,
      });

      const forgedToken = createHash("sha256")
        .update(
          JSON.stringify({
            affectedTaskCount: 1,
            affectedTasks: [
              {
                deletedAt: null,
                id: firstTask.id,
                lifecycle: "open",
                listId: sourceList.id,
                projectId: project.id,
                revision: 1,
              },
            ],
            destinationListId: destinationList.id,
            destinationListRevision: destinationList.revision,
            sourceListId: sourceList.id,
            sourceListRevision: sourceList.revision,
            taskProjectId: project.id,
            taskProjectRevision: project.revision,
          }),
        )
        .digest("hex");
      const forgedMove = await projectRequest(`/v1/task-projects/${project.id}/move`, {
        body: {
          destinationListId: destinationList.id,
          expectedRevision: project.revision,
          previewToken: forgedToken,
        },
      });
      expect(forgedMove.status).toBe(409);
      expect((await payload(forgedMove)).error.details).toMatchObject({
        code: "task_project_move_preview_stale",
      });

      const secondTask = await insertProjectTask(project, "Atomic Move Drift");
      const stale = await projectRequest(`/v1/task-projects/${project.id}/move`, {
        body: {
          destinationListId: destinationList.id,
          expectedRevision: project.revision,
          previewToken: preview.previewToken,
        },
      });
      expect(stale.status).toBe(409);
      expect((await payload(stale)).error.details).toMatchObject({
        code: "task_project_move_preview_stale",
        currentRevision: project.revision,
      });
      expect(
        await database.db
          .select({ listId: taskProjects.listId })
          .from(taskProjects)
          .where(eq(taskProjects.id, project.id)),
      ).toEqual([{ listId: sourceList.id }]);
      expect(
        await database.db
          .select({ listId: reminders.taskListId })
          .from(reminders)
          .where(inArray(reminders.id, [firstTask.id, secondTask.id])),
      ).toEqual([{ listId: sourceList.id }, { listId: sourceList.id }]);

      const freshPreview = (
        await payload(
          await projectRequest(`/v1/task-projects/${project.id}/move/preview`, {
            body: { destinationListId: destinationList.id, expectedRevision: project.revision },
          }),
        )
      ).preview;
      const movedResponse = await projectRequest(`/v1/task-projects/${project.id}/move`, {
        body: {
          destinationListId: destinationList.id,
          expectedRevision: project.revision,
          previewToken: freshPreview.previewToken,
        },
      });
      expect(movedResponse.status).toBe(200);
      expect((await payload(movedResponse)).taskProject).toMatchObject({
        listId: destinationList.id,
        revision: 2,
        source: { remoteId: project.id, revision: "2", sourceType: "task_project" },
      });
      expect(
        await database.db
          .select({
            legacyStatus: reminders.status,
            listId: reminders.taskListId,
            projectId: reminders.taskProjectId,
            revision: reminders.taskRevision,
          })
          .from(reminders)
          .where(inArray(reminders.id, [firstTask.id, secondTask.id])),
      ).toEqual([
        {
          legacyStatus: "inbox",
          listId: destinationList.id,
          projectId: project.id,
          revision: 2,
        },
        {
          legacyStatus: "inbox",
          listId: destinationList.id,
          projectId: project.id,
          revision: 2,
        },
      ]);
      const moveAudit = await database.db
        .select({
          action: auditEvents.action,
          entityId: auditEvents.entityId,
          requestId: auditEvents.requestId,
        })
        .from(auditEvents)
        .where(
          and(
            inArray(auditEvents.entityId, [project.id, firstTask.id, secondTask.id]),
            inArray(auditEvents.action, ["task_project.moved", "task.moved_with_project"]),
          ),
        );
      expect(moveAudit).toHaveLength(3);
      expect(moveAudit.map(({ action }) => action).sort()).toEqual([
        "task.moved_with_project",
        "task.moved_with_project",
        "task_project.moved",
      ]);
      expect(new Set(moveAudit.map(({ requestId }) => requestId)).size).toBe(1);

      const staleRevision = await projectRequest(`/v1/task-projects/${project.id}/move`, {
        body: {
          destinationListId: sourceList.id,
          expectedRevision: project.revision,
          previewToken: freshPreview.previewToken,
        },
      });
      expect(staleRevision.status).toBe(409);
      expect((await payload(staleRevision)).error.details).toMatchObject({ currentRevision: 2 });
    });

    it("task project move previews reject same-count Task replacement", async () => {
      const sourceList = await createProjectList("Exact Preview Source");
      const destinationList = await createProjectList("Exact Preview Destination");
      const replacementProject = await createProject(sourceList.id, "Exact Set Project");
      const originalTask = await insertProjectTask(replacementProject, "Original Exact Set Task");
      const replacementPreview = (
        await payload(
          await projectRequest(`/v1/task-projects/${replacementProject.id}/move/preview`, {
            body: {
              destinationListId: destinationList.id,
              expectedRevision: replacementProject.revision,
            },
          }),
        )
      ).preview;
      await database.db.delete(reminders).where(eq(reminders.id, originalTask.id));
      const replacementTask = await insertProjectTask(
        replacementProject,
        "Replacement Exact Set Task",
      );
      const replaced = await projectRequest(`/v1/task-projects/${replacementProject.id}/move`, {
        body: {
          destinationListId: destinationList.id,
          expectedRevision: replacementProject.revision,
          previewToken: replacementPreview.previewToken,
        },
      });
      expect(replaced.status).toBe(409);
      expect((await payload(replaced)).error.details).toMatchObject({
        code: "task_project_move_preview_stale",
      });
      expect(
        await database.db
          .select({ listId: reminders.taskListId })
          .from(reminders)
          .where(eq(reminders.id, replacementTask.id)),
      ).toEqual([{ listId: sourceList.id }]);
    });

    it("task project move previews reject Task revision drift without a count change", async () => {
      const sourceList = await createProjectList("Revision Preview Source");
      const destinationList = await createProjectList("Revision Preview Destination");
      const revisionProject = await createProject(sourceList.id, "Revision Drift Project");
      const revisionTask = await insertProjectTask(revisionProject, "Revision Drift Task");
      const revisionPreview = (
        await payload(
          await projectRequest(`/v1/task-projects/${revisionProject.id}/move/preview`, {
            body: {
              destinationListId: destinationList.id,
              expectedRevision: revisionProject.revision,
            },
          }),
        )
      ).preview;
      await database.db
        .update(reminders)
        .set({ taskRevision: 2 })
        .where(eq(reminders.id, revisionTask.id));
      const revised = await projectRequest(`/v1/task-projects/${revisionProject.id}/move`, {
        body: {
          destinationListId: destinationList.id,
          expectedRevision: revisionProject.revision,
          previewToken: revisionPreview.previewToken,
        },
      });
      expect(revised.status).toBe(409);
      expect((await payload(revised)).error.details).toMatchObject({
        code: "task_project_move_preview_stale",
      });
    });

    it("task project moves include soft-deleted Tasks and preserve their deletion state", async () => {
      const sourceList = await createProjectList("Trashed Task Move Source");
      const destinationList = await createProjectList("Trashed Task Move Destination");
      const project = await createProject(sourceList.id, "Trashed Task Project");
      const task = await insertProjectTask(project, "Trashed Project Task");
      const deletedAt = new Date("2026-07-12T12:00:00.000Z");
      await database.db.update(reminders).set({ deletedAt }).where(eq(reminders.id, task.id));

      const previewResponse = await projectRequest(`/v1/task-projects/${project.id}/move/preview`, {
        body: { destinationListId: destinationList.id, expectedRevision: project.revision },
      });
      expect(previewResponse.status).toBe(200);
      const preview = (await payload(previewResponse)).preview;
      expect(preview.affectedTaskCount).toBe(1);
      const moved = await projectRequest(`/v1/task-projects/${project.id}/move`, {
        body: {
          destinationListId: destinationList.id,
          expectedRevision: project.revision,
          previewToken: preview.previewToken,
        },
      });
      expect(moved.status).toBe(200);
      expect(
        await database.db
          .select({
            deletedAt: reminders.deletedAt,
            listId: reminders.taskListId,
            projectId: reminders.taskProjectId,
            revision: reminders.taskRevision,
          })
          .from(reminders)
          .where(eq(reminders.id, task.id)),
      ).toEqual([
        {
          deletedAt,
          listId: destinationList.id,
          projectId: project.id,
          revision: 2,
        },
      ]);
    });

    it("task project move rollback restores every Task and audit after a post-detach failure", async () => {
      const sourceList = await createProjectList("Rollback Move Source");
      const destinationList = await createProjectList("Rollback Move Destination");
      const project = await createProject(sourceList.id, "Rollback Move Project");
      const tasks = await Promise.all([
        insertProjectTask(project, "Rollback First Task"),
        insertProjectTask(project, "Rollback Second Task"),
      ]);
      const preview = (
        await payload(
          await projectRequest(`/v1/task-projects/${project.id}/move/preview`, {
            body: { destinationListId: destinationList.id, expectedRevision: project.revision },
          }),
        )
      ).preview;
      const auditBefore = await database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(inArray(auditEvents.entityId, [project.id, ...tasks.map(({ id }) => id)]));

      await database.pool.query(`
        CREATE OR REPLACE FUNCTION fail_rollback_task_project_move()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.name = 'Rollback Move Project' AND NEW.list_id IS DISTINCT FROM OLD.list_id THEN
            RAISE EXCEPTION 'forced post-detach Project move failure';
          END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER fail_rollback_task_project_move_trigger
        BEFORE UPDATE OF list_id ON task_projects
        FOR EACH ROW EXECUTE FUNCTION fail_rollback_task_project_move();
      `);
      try {
        const failed = await projectRequest(`/v1/task-projects/${project.id}/move`, {
          body: {
            destinationListId: destinationList.id,
            expectedRevision: project.revision,
            previewToken: preview.previewToken,
          },
        });
        expect(failed.status).toBe(500);
      } finally {
        await database.pool.query(`
          DROP TRIGGER IF EXISTS fail_rollback_task_project_move_trigger ON task_projects;
          DROP FUNCTION IF EXISTS fail_rollback_task_project_move();
        `);
      }

      expect(
        await database.db
          .select({ listId: taskProjects.listId, revision: taskProjects.revision })
          .from(taskProjects)
          .where(eq(taskProjects.id, project.id)),
      ).toEqual([{ listId: sourceList.id, revision: 1 }]);
      expect(
        await database.db
          .select({
            listId: reminders.taskListId,
            projectId: reminders.taskProjectId,
            revision: reminders.taskRevision,
          })
          .from(reminders)
          .where(
            inArray(
              reminders.id,
              tasks.map(({ id }) => id),
            ),
          ),
      ).toEqual([
        { listId: sourceList.id, projectId: project.id, revision: 1 },
        { listId: sourceList.id, projectId: project.id, revision: 1 },
      ]);
      expect(
        await database.db
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(inArray(auditEvents.entityId, [project.id, ...tasks.map(({ id }) => id)])),
      ).toHaveLength(auditBefore.length);
    });

    it.each([
      "move",
      "complete",
    ] as const)("task project %s and List move-active-contents archive avoid deadlock and preserve location", async (operation) => {
      const sourceList = await createProjectList(`Concurrent ${operation} Source`);
      const destinationList = await createProjectList(`Concurrent ${operation} Destination`);
      const project = await createProject(sourceList.id, `Concurrent ${operation} Project`);
      const task = await insertProjectTask(project, `Concurrent ${operation} Task`);
      const preview =
        operation === "move"
          ? (
              await payload(
                await projectRequest(`/v1/task-projects/${project.id}/move/preview`, {
                  body: {
                    destinationListId: destinationList.id,
                    expectedRevision: project.revision,
                  },
                }),
              )
            ).preview
          : null;
      const blocker = await database.pool.connect();
      let archiveRequest: Promise<Response> | undefined;
      let projectOperation: Promise<Response> | undefined;
      let projectOperationResult: number | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT id FROM task_lists WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE",
          [[sourceList.id, destinationList.id]],
        );
        archiveRequest = projectRequest(`/v1/task-lists/${sourceList.id}/archive`, {
          body: {
            destinationListId: destinationList.id,
            expectedRevision: sourceList.revision,
            resolution: "move_active_contents",
          },
        });
        void archiveRequest.catch(() => undefined);
        await waitForTaskOrganizationLockWaiters(1);
        projectOperation =
          operation === "move"
            ? projectRequest(`/v1/task-projects/${project.id}/move`, {
                body: {
                  destinationListId: destinationList.id,
                  expectedRevision: project.revision,
                  previewToken: preview.previewToken,
                },
              })
            : projectRequest(`/v1/task-projects/${project.id}/complete`, {
                body: { expectedRevision: project.revision, resolution: "complete_open_tasks" },
              });
        void projectOperation.catch(() => undefined);
        await waitForTaskOrganizationLockWaiters(2);
        await blocker.query("COMMIT");
        const [archiveResponse, operationResponse] = await Promise.all([
          archiveRequest,
          projectOperation,
        ]);
        expect(archiveResponse.status).toBe(200);
        expect([200, 409]).toContain(operationResponse.status);
        projectOperationResult = operationResponse.status;
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await Promise.allSettled(
          [archiveRequest, projectOperation].filter(
            (candidate): candidate is Promise<Response> => candidate !== undefined,
          ),
        );
      }
      expect(
        await database.db
          .select({
            lifecycle: taskProjects.lifecycle,
            listId: taskProjects.listId,
            revision: taskProjects.revision,
          })
          .from(taskProjects)
          .where(eq(taskProjects.id, project.id)),
      ).toEqual([
        {
          lifecycle:
            operation === "complete" && projectOperationResult === 200 ? "completed" : "open",
          listId:
            operation === "complete" && projectOperationResult === 200
              ? sourceList.id
              : destinationList.id,
          revision: 2,
        },
      ]);
      expect(
        await database.db
          .select({
            lifecycle: reminders.taskLifecycle,
            listId: reminders.taskListId,
            projectId: reminders.taskProjectId,
            revision: reminders.taskRevision,
          })
          .from(reminders)
          .where(eq(reminders.id, task.id)),
      ).toEqual([
        {
          lifecycle:
            operation === "complete" && projectOperationResult === 200 ? "completed" : "open",
          listId:
            operation === "complete" && projectOperationResult === 200
              ? sourceList.id
              : destinationList.id,
          projectId: project.id,
          revision: 2,
        },
      ]);
      expect(
        await database.db
          .select({ availability: taskLists.availability })
          .from(taskLists)
          .where(eq(taskLists.id, sourceList.id)),
      ).toEqual([{ availability: "archived" }]);
    }, 20_000);
  });

  describe("tasks", () => {
    let taskAgentToken = "";
    let taskInboxId = "";
    let taskSessionToken = "";
    let taskUserId = "";

    async function taskRequest(path: string, options: Omit<RequestOptions, "auth"> = {}) {
      const headers = new Headers(options.headers);
      headers.set("authorization", `Session ${taskSessionToken}`);
      const hasBody = options.body !== undefined || options.rawBody !== undefined;
      if (hasBody) headers.set("content-type", "application/json");
      return app.request(path, {
        ...(hasBody ? { body: options.rawBody ?? JSON.stringify(options.body) } : {}),
        headers,
        method: options.method ?? (hasBody ? "POST" : "GET"),
      });
    }

    async function taskAgentRequest(path: string, options: Omit<RequestOptions, "auth"> = {}) {
      return scopedTaskAgentRequest(taskAgentToken, path, options);
    }

    async function scopedTaskAgentRequest(
      token: string,
      path: string,
      options: Omit<RequestOptions, "auth"> = {},
    ) {
      const headers = new Headers(options.headers);
      headers.set("authorization", `Bearer ${token}`);
      const hasBody = options.body !== undefined || options.rawBody !== undefined;
      if (hasBody) headers.set("content-type", "application/json");
      return app.request(path, {
        ...(hasBody ? { body: options.rawBody ?? JSON.stringify(options.body) } : {}),
        headers,
        method: options.method ?? (hasBody ? "POST" : "GET"),
      });
    }

    async function createTaskList(name: string) {
      const response = await taskRequest("/v1/task-lists", { body: { name } });
      expect(response.status).toBe(201);
      return (await payload(response)).taskList as { id: string; revision: number };
    }

    async function createTaskProject(listId: string, name: string) {
      const response = await taskRequest("/v1/task-projects", { body: { listId, name } });
      expect(response.status).toBe(201);
      return (await payload(response)).taskProject as {
        id: string;
        listId: string;
        revision: number;
      };
    }

    async function createTask(title: string, body: Record<string, unknown> = {}) {
      const response = await taskRequest("/v1/tasks", { body: { ...body, title } });
      expect(response.status).toBe(201);
      return (await payload(response)).task as {
        cancelledAt: string | null;
        completedAt: string | null;
        deletedAt: string | null;
        id: string;
        legacyStatus: string | null;
        lifecycle: "open" | "completed" | "cancelled";
        listId: string;
        projectId: string | null;
        revision: number;
        source: { remoteId: string; revision: string; sourceType: "task" };
      };
    }

    async function waitForTaskCreateLockWaiters(expected: number) {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const result = await database.pool.query<{ count: string }>(`
          SELECT count(*)::text AS count
          FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND (
              query LIKE '%task_lists%'
              OR query LIKE '%pg_advisory_xact_lock%'
            )
            AND query NOT LIKE '%pg_stat_activity%'
        `);
        if (Number(result.rows[0]?.count ?? 0) >= expected) return;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      }
      throw new Error(`Expected at least ${expected} Task create lock waiter(s).`);
    }

    beforeAll(async () => {
      const registration = await request("/v1/auth/register", {
        auth: "none",
        body: {
          displayName: "Canonical Tasks User",
          email: "canonical-tasks@example.com",
          password: "LocalTestOnly123!",
          planningTimezone: "America/New_York",
        },
      });
      expect(registration.status).toBe(201);
      const body = await payload(registration);
      taskSessionToken = body.sessionToken;
      taskUserId = body.user.id;
      const lists = await payload(await taskRequest("/v1/task-lists"));
      taskInboxId = lists.items.find((item: { kind: string }) => item.kind === "inbox").id;
      const tokenResponse = await taskRequest("/v1/access-tokens", {
        body: { name: "Canonical Tasks agent", scopes: ["tasks:read", "tasks:write"] },
      });
      expect(tokenResponse.status).toBe(201);
      taskAgentToken = (await payload(tokenResponse)).token.token;
    });

    it("tasks create in Inbox or an explicit same-List Project with local provenance and idempotency", async () => {
      const missingIdempotency = await taskAgentRequest("/v1/tasks", {
        body: { title: "Agent requires replay safety" },
      });
      expect(missingIdempotency.status).toBe(400);

      expect(
        (
          await taskRequest("/v1/tasks", {
            body: {
              source: {
                accountId: null,
                provider: "local",
                remoteId: taskInboxId,
                revision: "99",
                sourceType: "task",
              },
              title: "Reject forged Task provenance",
            },
          })
        ).status,
      ).toBe(400);

      const inboxTask = await createTask("Default Inbox Task");
      expect(inboxTask).toMatchObject({
        cancelledAt: null,
        completedAt: null,
        deletedAt: null,
        legacyStatus: "inbox",
        lifecycle: "open",
        listId: taskInboxId,
        projectId: null,
        revision: 1,
        source: { remoteId: inboxTask.id, revision: "1", sourceType: "task" },
      });
      expect(
        await database.db
          .select({
            legacyStatus: reminders.status,
            lifecycle: reminders.taskLifecycle,
            listId: reminders.taskListId,
            projectId: reminders.taskProjectId,
            revision: reminders.taskRevision,
          })
          .from(reminders)
          .where(eq(reminders.id, inboxTask.id)),
      ).toEqual([
        {
          legacyStatus: "inbox",
          lifecycle: "open",
          listId: taskInboxId,
          projectId: null,
          revision: 1,
        },
      ]);

      const projectList = await createTaskList("Canonical Task Project List");
      const project = await createTaskProject(projectList.id, "Canonical Task Project");
      const idempotencyKey = "60000000-0000-4000-8000-000000000001";
      const input = {
        idempotencyKey,
        listId: projectList.id,
        projectId: project.id,
        scheduledAt: "2026-07-13T18:00:00.000Z",
        title: "Reserved open Task",
      };
      const createdResponse = await taskAgentRequest("/v1/tasks", { body: input });
      expect(createdResponse.status).toBe(201);
      const explicitTask = (await payload(createdResponse)).task;
      expect(explicitTask).toMatchObject({
        legacyStatus: "scheduled",
        lifecycle: "open",
        listId: projectList.id,
        projectId: project.id,
        revision: 1,
        scheduledAt: "2026-07-13T18:00:00.000Z",
      });
      const replay = await taskAgentRequest("/v1/tasks", { body: input });
      expect(replay.status).toBe(201);
      expect((await payload(replay)).task.id).toBe(explicitTask.id);
      const mismatch = await taskAgentRequest("/v1/tasks", {
        body: { ...input, title: "Different replay payload" },
      });
      expect(mismatch.status).toBe(409);
      expect((await payload(mismatch)).error.details).toMatchObject({
        code: "task_idempotency_mismatch",
      });
      expect(
        await database.db
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(
            and(eq(auditEvents.entityId, explicitTask.id), eq(auditEvents.action, "task.created")),
          ),
      ).toHaveLength(1);

      const anotherList = await createTaskList("Canonical Task Other List");
      const wrongLocation = await taskRequest("/v1/tasks", {
        body: { listId: anotherList.id, projectId: project.id, title: "Cross-List Project Task" },
      });
      expect(wrongLocation.status).toBe(404);

      const otherRegistration = await request("/v1/auth/register", {
        auth: "none",
        body: {
          displayName: "Other Canonical Tasks User",
          email: "other-canonical-tasks@example.com",
          password: "LocalTestOnly123!",
          planningTimezone: "UTC",
        },
      });
      const otherBody = await payload(otherRegistration);
      const otherInbox = (
        await database.db
          .select({ id: taskLists.id })
          .from(taskLists)
          .where(and(eq(taskLists.userId, otherBody.user.id), eq(taskLists.kind, "inbox")))
      )[0];
      expect(
        (
          await taskRequest("/v1/tasks", {
            body: { listId: otherInbox?.id, title: "Cross-user Task" },
          })
        ).status,
      ).toBe(404);
      expect((await taskRequest(`/v1/tasks/${explicitTask.id}`)).status).toBe(200);
      expect(
        (
          await app.request(`/v1/tasks/${explicitTask.id}`, {
            headers: { authorization: `Session ${otherBody.sessionToken}` },
          })
        ).status,
      ).toBe(404);
    });

    it("tasks resolve idempotency before validating changed List and Project destinations", async () => {
      const archivedList = await createTaskList("Replay Archived List");
      const archivedListInput = {
        idempotencyKey: "60000000-0000-4000-8000-000000000011",
        listId: archivedList.id,
        title: "Replay after List archive",
      };
      const archivedListCreate = await taskAgentRequest("/v1/tasks", {
        body: archivedListInput,
      });
      expect(archivedListCreate.status).toBe(201);
      const archivedListTask = (await payload(archivedListCreate)).task;
      expect(
        (
          await taskRequest(`/v1/task-lists/${archivedList.id}/archive`, {
            body: {
              expectedRevision: archivedList.revision,
              resolution: "archive_contents_together",
            },
          })
        ).status,
      ).toBe(200);
      const archivedListReplay = await taskAgentRequest("/v1/tasks", {
        body: archivedListInput,
      });
      expect(archivedListReplay.status).toBe(201);
      expect((await payload(archivedListReplay)).task.id).toBe(archivedListTask.id);
      const archivedListMismatch = await taskAgentRequest("/v1/tasks", {
        body: { ...archivedListInput, title: "Mismatched archived destination retry" },
      });
      expect(archivedListMismatch.status).toBe(409);
      expect((await payload(archivedListMismatch)).error.details).toEqual({
        code: "task_idempotency_mismatch",
      });

      const projectList = await createTaskList("Replay Project States");

      const completedProject = await createTaskProject(projectList.id, "Replay Completed Project");
      const completedInput = {
        idempotencyKey: "60000000-0000-4000-8000-000000000012",
        listId: projectList.id,
        projectId: completedProject.id,
        title: "Replay after Project completion",
      };
      const completedCreate = await taskAgentRequest("/v1/tasks", { body: completedInput });
      expect(completedCreate.status).toBe(201);
      const completedTask = (await payload(completedCreate)).task;
      expect(
        (
          await taskRequest(`/v1/task-projects/${completedProject.id}/complete`, {
            body: {
              expectedRevision: completedProject.revision,
              resolution: "complete_open_tasks",
            },
          })
        ).status,
      ).toBe(200);
      const completedReplay = await taskAgentRequest("/v1/tasks", { body: completedInput });
      expect(completedReplay.status).toBe(201);
      expect((await payload(completedReplay)).task).toMatchObject({
        id: completedTask.id,
        lifecycle: "completed",
        revision: 2,
      });

      const archivedProject = await createTaskProject(projectList.id, "Replay Archived Project");
      const archivedProjectInput = {
        idempotencyKey: "60000000-0000-4000-8000-000000000013",
        listId: projectList.id,
        projectId: archivedProject.id,
        title: "Replay after Project archive",
      };
      const archivedProjectCreate = await taskAgentRequest("/v1/tasks", {
        body: archivedProjectInput,
      });
      expect(archivedProjectCreate.status).toBe(201);
      const archivedProjectTask = (await payload(archivedProjectCreate)).task;
      expect(
        (
          await taskRequest(`/v1/task-projects/${archivedProject.id}/archive`, {
            body: { expectedRevision: archivedProject.revision },
          })
        ).status,
      ).toBe(200);
      const archivedProjectReplay = await taskAgentRequest("/v1/tasks", {
        body: archivedProjectInput,
      });
      expect(archivedProjectReplay.status).toBe(201);
      expect((await payload(archivedProjectReplay)).task.id).toBe(archivedProjectTask.id);

      const moveSourceList = await createTaskList("Replay Project Move Source");
      const moveDestinationList = await createTaskList("Replay Project Move Destination");
      const movedProject = await createTaskProject(moveSourceList.id, "Replay Moved Project");
      const movedInput = {
        idempotencyKey: "60000000-0000-4000-8000-000000000014",
        projectId: movedProject.id,
        title: "Replay after Project move",
      };
      const movedCreate = await taskAgentRequest("/v1/tasks", { body: movedInput });
      expect(movedCreate.status).toBe(201);
      const movedTask = (await payload(movedCreate)).task;
      const movePreview = (
        await payload(
          await taskRequest(`/v1/task-projects/${movedProject.id}/move/preview`, {
            body: {
              destinationListId: moveDestinationList.id,
              expectedRevision: movedProject.revision,
            },
          }),
        )
      ).preview;
      expect(
        (
          await taskRequest(`/v1/task-projects/${movedProject.id}/move`, {
            body: {
              destinationListId: moveDestinationList.id,
              expectedRevision: movedProject.revision,
              previewToken: movePreview.previewToken,
            },
          })
        ).status,
      ).toBe(200);
      const movedReplay = await taskAgentRequest("/v1/tasks", { body: movedInput });
      expect(movedReplay.status).toBe(201);
      expect((await payload(movedReplay)).task).toMatchObject({
        id: movedTask.id,
        listId: moveDestinationList.id,
        revision: 2,
      });

      const deletedProject = await createTaskProject(projectList.id, "Replay Deleted Project");
      const deletedProjectInput = {
        idempotencyKey: "60000000-0000-4000-8000-000000000015",
        listId: projectList.id,
        projectId: deletedProject.id,
        title: "Replay after Project deletion",
      };
      const deletedProjectCreate = await taskAgentRequest("/v1/tasks", {
        body: deletedProjectInput,
      });
      expect(deletedProjectCreate.status).toBe(201);
      const deletedProjectTask = (await payload(deletedProjectCreate)).task;
      await database.db
        .update(taskProjects)
        .set({ deletedAt: new Date("2026-07-13T12:00:00.000Z") })
        .where(eq(taskProjects.id, deletedProject.id));
      const deletedProjectReplay = await taskAgentRequest("/v1/tasks", {
        body: deletedProjectInput,
      });
      expect(deletedProjectReplay.status).toBe(201);
      expect((await payload(deletedProjectReplay)).task.id).toBe(deletedProjectTask.id);
      const deletedProjectMismatch = await taskAgentRequest("/v1/tasks", {
        body: { ...deletedProjectInput, title: "Mismatched deleted Project retry" },
      });
      expect(deletedProjectMismatch.status).toBe(409);
      expect((await payload(deletedProjectMismatch)).error.details).toEqual({
        code: "task_idempotency_mismatch",
      });

      const otherRegistration = await request("/v1/auth/register", {
        auth: "none",
        body: {
          displayName: "Task Replay Other User",
          email: "task-replay-other@example.com",
          password: "LocalTestOnly123!",
          planningTimezone: "UTC",
        },
      });
      expect(otherRegistration.status).toBe(201);
      const otherSession = (await payload(otherRegistration)).sessionToken;
      const crossUserKeyReuse = await app.request("/v1/tasks", {
        body: JSON.stringify({
          idempotencyKey: archivedListInput.idempotencyKey,
          title: "Other user owns an independent key namespace",
        }),
        headers: {
          authorization: `Session ${otherSession}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      expect(crossUserKeyReuse.status).toBe(201);
      expect((await payload(crossUserKeyReuse)).task.id).not.toBe(archivedListTask.id);
    });

    it("tasks serialize concurrent idempotency before destination archive or terminal changes", async () => {
      const archivedList = await createTaskList("Concurrent Replay Archive List");
      const exactInput = {
        idempotencyKey: "60000000-0000-4000-8000-000000000021",
        listId: archivedList.id,
        title: "Concurrent exact replay",
      };
      const archiveBlocker = await database.pool.connect();
      let archiveRequest: Promise<Response> | undefined;
      let firstExact: Promise<Response> | undefined;
      let secondExact: Promise<Response> | undefined;
      try {
        await archiveBlocker.query("BEGIN");
        await archiveBlocker.query("SELECT id FROM task_lists WHERE id = $1 FOR UPDATE", [
          archivedList.id,
        ]);
        firstExact = taskAgentRequest("/v1/tasks", { body: exactInput });
        void firstExact.catch(() => undefined);
        await waitForTaskCreateLockWaiters(1);
        archiveRequest = taskRequest(`/v1/task-lists/${archivedList.id}/archive`, {
          body: {
            expectedRevision: archivedList.revision,
            resolution: "archive_contents_together",
          },
        });
        void archiveRequest.catch(() => undefined);
        await waitForTaskCreateLockWaiters(2);
        secondExact = taskAgentRequest("/v1/tasks", { body: exactInput });
        void secondExact.catch(() => undefined);
        await waitForTaskCreateLockWaiters(3);
        await archiveBlocker.query("COMMIT");
        const [firstResponse, archiveResponse, secondResponse] = await Promise.all([
          firstExact,
          archiveRequest,
          secondExact,
        ]);
        expect(firstResponse.status).toBe(201);
        expect(archiveResponse.status).toBe(200);
        expect(secondResponse.status).toBe(201);
        expect((await payload(secondResponse)).task.id).toBe(
          (await payload(firstResponse)).task.id,
        );
      } finally {
        await archiveBlocker.query("ROLLBACK");
        archiveBlocker.release();
        await Promise.allSettled(
          [archiveRequest, firstExact, secondExact].filter(
            (candidate): candidate is Promise<Response> => candidate !== undefined,
          ),
        );
      }
      const exactRows = await database.db
        .select({ id: reminders.id })
        .from(reminders)
        .where(
          and(
            eq(reminders.userId, taskUserId),
            eq(reminders.taskCreateIdempotencyKey, exactInput.idempotencyKey),
          ),
        );
      expect(exactRows).toHaveLength(1);
      expect(
        await database.db
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.entityId, exactRows[0]?.id as string),
              eq(auditEvents.action, "task.created"),
            ),
          ),
      ).toHaveLength(1);

      const projectList = await createTaskList("Concurrent Replay Terminal List");
      const project = await createTaskProject(projectList.id, "Concurrent Replay Terminal Project");
      const firstInput = {
        idempotencyKey: "60000000-0000-4000-8000-000000000022",
        listId: projectList.id,
        projectId: project.id,
        title: "Concurrent original payload",
      };
      const mismatchedInput = { ...firstInput, title: "Concurrent mismatched payload" };
      const terminalBlocker = await database.pool.connect();
      let completeRequest: Promise<Response> | undefined;
      let firstCreate: Promise<Response> | undefined;
      let mismatchedCreate: Promise<Response> | undefined;
      try {
        await terminalBlocker.query("BEGIN");
        await terminalBlocker.query("SELECT id FROM task_lists WHERE id = $1 FOR UPDATE", [
          projectList.id,
        ]);
        firstCreate = taskAgentRequest("/v1/tasks", { body: firstInput });
        void firstCreate.catch(() => undefined);
        await waitForTaskCreateLockWaiters(1);
        completeRequest = taskRequest(`/v1/task-projects/${project.id}/complete`, {
          body: { expectedRevision: project.revision, resolution: "complete_open_tasks" },
        });
        void completeRequest.catch(() => undefined);
        await waitForTaskCreateLockWaiters(2);
        mismatchedCreate = taskAgentRequest("/v1/tasks", { body: mismatchedInput });
        void mismatchedCreate.catch(() => undefined);
        await waitForTaskCreateLockWaiters(3);
        await terminalBlocker.query("COMMIT");
        const [firstResponse, completeResponse, mismatchResponse] = await Promise.all([
          firstCreate,
          completeRequest,
          mismatchedCreate,
        ]);
        expect(firstResponse.status).toBe(201);
        expect(completeResponse.status).toBe(200);
        expect(mismatchResponse.status).toBe(409);
        expect((await payload(mismatchResponse)).error.details).toEqual({
          code: "task_idempotency_mismatch",
        });
      } finally {
        await terminalBlocker.query("ROLLBACK");
        terminalBlocker.release();
        await Promise.allSettled(
          [completeRequest, firstCreate, mismatchedCreate].filter(
            (candidate): candidate is Promise<Response> => candidate !== undefined,
          ),
        );
      }
      const mismatchRows = await database.db
        .select({ id: reminders.id })
        .from(reminders)
        .where(
          and(
            eq(reminders.userId, taskUserId),
            eq(reminders.taskCreateIdempotencyKey, firstInput.idempotencyKey),
          ),
        );
      expect(mismatchRows).toHaveLength(1);
      expect(
        await database.db
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.entityId, mismatchRows[0]?.id as string),
              eq(auditEvents.action, "task.created"),
            ),
          ),
      ).toHaveLength(1);
    }, 20_000);

    it("tasks preserve legacy metadata until canonical timing changes and query canonical views", async () => {
      const [legacyTask] = await database.db
        .insert(reminders)
        .values({
          kind: "task",
          status: "next",
          taskLifecycle: "open",
          taskListId: taskInboxId,
          taskRevision: 1,
          title: "Migrated next metadata",
          userId: taskUserId,
        })
        .returning();
      if (!legacyTask) throw new Error("Legacy Task fixture was not created.");

      const contentOnly = await taskAgentRequest(`/v1/tasks/${legacyTask.id}`, {
        body: { expectedRevision: 1, title: "Content-only edit" },
        method: "PATCH",
      });
      expect(contentOnly.status).toBe(200);
      expect((await payload(contentOnly)).task).toMatchObject({
        legacyStatus: "next",
        lifecycle: "open",
        revision: 2,
      });
      const timingEdit = await taskAgentRequest(`/v1/tasks/${legacyTask.id}`, {
        body: { expectedRevision: 2, scheduledAt: "2026-07-13T19:00:00.000Z" },
        method: "PATCH",
      });
      expect(timingEdit.status).toBe(200);
      expect((await payload(timingEdit)).task).toMatchObject({
        dueAt: null,
        legacyStatus: "scheduled",
        lifecycle: "open",
        revision: 3,
        scheduledAt: "2026-07-13T19:00:00.000Z",
      });
      const dueEdit = await taskAgentRequest(`/v1/tasks/${legacyTask.id}`, {
        body: { dueAt: "2026-07-15T16:00:00.000Z", expectedRevision: 3 },
        method: "PATCH",
      });
      expect(dueEdit.status).toBe(200);
      expect((await payload(dueEdit)).task).toMatchObject({
        dueAt: "2026-07-15T16:00:00.000Z",
        legacyStatus: "scheduled",
        revision: 4,
        scheduledAt: "2026-07-13T19:00:00.000Z",
      });

      const todayTask = await createTask("Today due Task", {
        dueAt: "2026-07-13T16:00:00.000Z",
      });
      const upcomingTask = await createTask("Upcoming scheduled Task", {
        scheduledAt: "2026-07-14T16:00:00.000Z",
      });
      const inboxView = await payload(await taskRequest(`/v1/tasks?listId=${taskInboxId}`));
      expect(inboxView.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: todayTask.id, listId: taskInboxId }),
        ]),
      );
      const todayView = await payload(await taskRequest("/v1/tasks?view=today"));
      expect(todayView.items.map(({ id }: { id: string }) => id)).toContain(todayTask.id);
      const upcomingView = await payload(await taskRequest("/v1/tasks?view=upcoming"));
      expect(upcomingView.items.map(({ id }: { id: string }) => id)).toContain(upcomingTask.id);
      const scheduledView = await payload(await taskRequest("/v1/tasks?view=scheduled"));
      expect(scheduledView.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: legacyTask.id, lifecycle: "open" }),
          expect.objectContaining({ id: upcomingTask.id, lifecycle: "open" }),
        ]),
      );

      expect(
        (
          await taskAgentRequest(`/v1/tasks/${todayTask.id}`, {
            body: { title: "Missing revision" },
            method: "PATCH",
          })
        ).status,
      ).toBe(400);
      const auditBefore = await database.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.entityId, todayTask.id));
      const race = await Promise.all([
        taskAgentRequest(`/v1/tasks/${todayTask.id}`, {
          body: { expectedRevision: 1, title: "CAS winner A" },
          method: "PATCH",
        }),
        taskAgentRequest(`/v1/tasks/${todayTask.id}`, {
          body: { expectedRevision: 1, title: "CAS winner B" },
          method: "PATCH",
        }),
      ]);
      expect(race.map(({ status }) => status).sort()).toEqual([200, 409]);
      expect(
        await database.db
          .select({ revision: reminders.taskRevision })
          .from(reminders)
          .where(eq(reminders.id, todayTask.id)),
      ).toEqual([{ revision: 2 }]);
      expect(
        await database.db
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(eq(auditEvents.entityId, todayTask.id)),
      ).toHaveLength(auditBefore.length + 1);
      const staleHuman = await taskRequest(`/v1/tasks/${todayTask.id}`, {
        body: { expectedRevision: 1, title: "Stale human write" },
        method: "PATCH",
      });
      expect(staleHuman.status).toBe(409);
      expect((await payload(staleHuman)).error.details).toEqual({ currentRevision: 2 });
      expect(
        await database.db
          .select({ revision: reminders.taskRevision })
          .from(reminders)
          .where(eq(reminders.id, todayTask.id)),
      ).toEqual([{ revision: 2 }]);
      expect(
        await database.db
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(eq(auditEvents.entityId, todayTask.id)),
      ).toHaveLength(auditBefore.length + 1);
    });

    it("tasks combine canonical placement, timing, text, and cursor filters", async () => {
      const list = await createTaskList("Filtered Task List");
      const project = await createTaskProject(list.id, "Filtered Task Project");
      const first = await createTask("Quarterly review alpha", {
        dueAt: "2026-07-15T14:00:00.000Z",
        listId: list.id,
        notes: "Include the metrics packet",
        projectId: project.id,
        scheduledAt: "2026-07-14T14:00:00.000Z",
      });
      const second = await createTask("Quarterly review beta", {
        dueAt: "2026-07-16T14:00:00.000Z",
        listId: list.id,
        projectId: project.id,
        scheduledAt: "2026-07-15T14:00:00.000Z",
        why: "Keep the quarterly review moving",
      });
      await createTask("Quarterly review outside range", {
        dueAt: "2026-07-20T14:00:00.000Z",
        listId: list.id,
        projectId: project.id,
        scheduledAt: "2026-07-19T14:00:00.000Z",
      });

      const query = new URLSearchParams({
        dueAfter: "2026-07-14T00:00:00.000Z",
        dueBefore: "2026-07-17T00:00:00.000Z",
        limit: "1",
        listId: list.id,
        projectId: project.id,
        query: "quarterly review",
        scheduledAfter: "2026-07-13T00:00:00.000Z",
        scheduledBefore: "2026-07-16T00:00:00.000Z",
      });
      const firstPage = await payload(await taskRequest(`/v1/tasks?${query.toString()}`));
      expect(firstPage.items).toHaveLength(1);
      expect(firstPage.nextCursor).toEqual(expect.any(String));

      query.set("cursor", firstPage.nextCursor);
      const secondPage = await payload(await taskRequest(`/v1/tasks?${query.toString()}`));
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.nextCursor).toBeNull();
      expect(
        new Set([...firstPage.items, ...secondPage.items].map(({ id }: { id: string }) => id)),
      ).toEqual(new Set([first.id, second.id]));
    });

    it("tasks treat percent, underscore, and backslash as literal search characters", async () => {
      const literalPercent = await createTask("Progress is 100% complete");
      await createTask("Progress is 100 percent complete");
      const literalUnderscore = await createTask("Release slot_a is ready");
      await createTask("Release slotXa is ready");
      const literalBackslash = await createTask("Archive path C:\\temp is ready");
      await createTask("Archive path C:Xtemp is ready");

      for (const [search, expectedId] of [
        ["100%", literalPercent.id],
        ["slot_a", literalUnderscore.id],
        ["C:\\temp", literalBackslash.id],
      ] as const) {
        const query = new URLSearchParams({ query: search });
        const result = await payload(await taskRequest(`/v1/tasks?${query.toString()}`));
        expect(result.items.map(({ id }: { id: string }) => id)).toEqual([expectedId]);
      }
    });

    it("tasks preserve safe placement and explicit optional-field updates", async () => {
      const missingId = "99999999-9999-4999-8999-999999999999";
      const list = await createTaskList("Task Placement Safety");
      const task = await createTask("Task optional fields", {
        dueAt: "2026-07-16T14:00:00.000Z",
        listId: list.id,
        scheduledAt: "2026-07-15T14:00:00.000Z",
      });
      const updatedResponse = await taskRequest(`/v1/tasks/${task.id}`, {
        body: {
          dueAt: null,
          estimateMinutes: 30,
          notes: "All optional material is deliberate",
          priority: "high",
          scheduledAt: null,
          tags: ["review"],
          timezone: "America/New_York",
          why: "Protect the public update contract",
        },
        method: "PATCH",
      });
      expect(updatedResponse.status).toBe(200);
      const updated = (await payload(updatedResponse)).task as Task;
      expect(updated).toMatchObject({
        dueAt: null,
        estimateMinutes: 30,
        notes: "All optional material is deliberate",
        priority: "high",
        revision: 2,
        scheduledAt: null,
        tags: ["review"],
        timezone: "America/New_York",
        why: "Protect the public update contract",
      });

      const samePreview = await payload(
        await taskRequest(`/v1/tasks/${task.id}/move/preview`, {
          body: { destinationListId: list.id, expectedRevision: updated.revision },
        }),
      );
      const sameMove = await taskRequest(`/v1/tasks/${task.id}/move`, {
        body: {
          destinationListId: list.id,
          expectedRevision: updated.revision,
          previewToken: samePreview.preview.previewToken,
        },
      });
      expect(sameMove.status).toBe(409);
      expect((await payload(sameMove)).error.details).toMatchObject({
        code: "task_destination_unavailable",
      });
      expect(
        (
          await taskRequest(`/v1/tasks/${task.id}/move/preview`, {
            body: { destinationListId: missingId, expectedRevision: updated.revision },
          })
        ).status,
      ).toBe(404);

      expect(
        (
          await taskRequest(`/v1/tasks/${missingId}/restore`, {
            body: { expectedRevision: 1 },
          })
        ).status,
      ).toBe(404);
      const project = await createTaskProject(list.id, "Task Restore Placement Project");
      const projectTask = await createTask("Task restored to its Project", {
        listId: list.id,
        projectId: project.id,
      });
      const trashedProjectTask = await payload(
        await taskRequest(`/v1/tasks/${projectTask.id}/trash`, {
          body: { expectedRevision: projectTask.revision },
        }),
      );
      const restoredProjectTask = await taskRequest(`/v1/tasks/${projectTask.id}/restore`, {
        body: { expectedRevision: trashedProjectTask.task.revision },
      });
      expect(restoredProjectTask.status).toBe(200);
      expect((await payload(restoredProjectTask)).task.projectId).toBe(project.id);
      expect(
        (
          await taskRequest(`/v1/tasks/${task.id}/move/preview`, {
            body: {
              destinationListId: list.id,
              destinationProjectId: missingId,
              expectedRevision: updated.revision,
            },
          })
        ).status,
      ).toBe(404);

      expect(
        (
          await taskRequest("/v1/tasks", {
            body: { listId: missingId, title: "Task cannot use a missing List" },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await taskRequest("/v1/tasks", {
            body: {
              listId: list.id,
              projectId: missingId,
              title: "Task cannot use a missing Project",
            },
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await taskRequest(`/v1/tasks/${task.id}/reopen`, {
            body: { expectedRevision: updated.revision },
          })
        ).status,
      ).toBe(409);
    });

    it("tasks hide archived-List contents from ordinary views but allow owned explicit List inspection", async () => {
      const archivedList = await createTaskList("Archived View Management List");
      const openTask = await createTask("Archived List open timing Task", {
        dueAt: "2026-07-13T16:00:00.000Z",
        listId: archivedList.id,
        scheduledAt: "2026-07-14T16:00:00.000Z",
      });
      const completedTask = await createTask("Archived List completed Task", {
        lifecycle: "completed",
        listId: archivedList.id,
      });
      const cancelledTask = await createTask("Archived List cancelled Task", {
        lifecycle: "cancelled",
        listId: archivedList.id,
      });
      expect(
        (
          await taskRequest(`/v1/task-lists/${archivedList.id}/archive`, {
            body: {
              expectedRevision: archivedList.revision,
              resolution: "archive_contents_together",
            },
          })
        ).status,
      ).toBe(200);

      const archivedIds = [openTask.id, completedTask.id, cancelledTask.id];
      for (const [path, hiddenIds] of [
        ["/v1/tasks", archivedIds],
        ["/v1/tasks?view=today", [openTask.id]],
        ["/v1/tasks?view=upcoming", [openTask.id]],
        ["/v1/tasks?view=scheduled", [openTask.id]],
        ["/v1/tasks?view=completed", [completedTask.id]],
        ["/v1/tasks?view=cancelled", [cancelledTask.id]],
      ] as const) {
        const result = await payload(await taskRequest(path));
        const resultIds = result.items.map(({ id }: { id: string }) => id);
        for (const hiddenId of hiddenIds) expect(resultIds).not.toContain(hiddenId);
      }

      const explicitList = await payload(await taskRequest(`/v1/tasks?listId=${archivedList.id}`));
      expect(explicitList.items.map(({ id }: { id: string }) => id)).toEqual(
        expect.arrayContaining(archivedIds),
      );

      const otherRegistration = await request("/v1/auth/register", {
        auth: "none",
        body: {
          displayName: "Archived List Other User",
          email: "archived-list-other@example.com",
          password: "LocalTestOnly123!",
          planningTimezone: "UTC",
        },
      });
      expect(otherRegistration.status).toBe(201);
      const otherSession = (await payload(otherRegistration)).sessionToken;
      const crossUserInspection = await app.request(`/v1/tasks?listId=${archivedList.id}`, {
        headers: { authorization: `Session ${otherSession}` },
      });
      expect(crossUserInspection.status).toBe(200);
      expect((await payload(crossUserInspection)).items).toEqual([]);
    });

    it("tasks require an explicit Project and its parent List to remain active and open", async () => {
      const archivedParent = await createTaskList("Explicit Project Archived Parent");
      const archivedParentProject = await createTaskProject(
        archivedParent.id,
        "Explicit Project Under Archived Parent",
      );
      const archivedParentTask = await createTask("Task under archived Project parent", {
        listId: archivedParent.id,
        projectId: archivedParentProject.id,
      });
      expect(
        (
          await taskRequest(`/v1/task-lists/${archivedParent.id}/archive`, {
            body: {
              expectedRevision: archivedParent.revision,
              resolution: "archive_contents_together",
            },
          })
        ).status,
      ).toBe(200);
      expect(
        (await payload(await taskRequest(`/v1/tasks?projectId=${archivedParentProject.id}`))).items,
      ).toEqual([]);
      expect(
        (await payload(await taskRequest(`/v1/tasks?listId=${archivedParent.id}`))).items.map(
          ({ id }: { id: string }) => id,
        ),
      ).toContain(archivedParentTask.id);

      for (const terminalAction of ["cancel", "archive"] as const) {
        const list = await createTaskList(`Explicit ${terminalAction} Project List`);
        const project = await createTaskProject(list.id, `Explicit ${terminalAction} Project`);
        const task = await createTask(`Task under ${terminalAction} Project`, {
          listId: list.id,
          projectId: project.id,
        });
        expect(
          (
            await taskRequest(`/v1/task-projects/${project.id}/${terminalAction}`, {
              body: { expectedRevision: project.revision },
            })
          ).status,
        ).toBe(200);
        expect(
          (await payload(await taskRequest(`/v1/tasks?projectId=${project.id}`))).items,
        ).toEqual([]);
        expect(
          (await payload(await taskRequest(`/v1/tasks?listId=${list.id}`))).items.map(
            ({ id }: { id: string }) => id,
          ),
        ).toContain(task.id);
      }
    });

    it("tasks use focused revision-safe complete, reopen, and cancel transitions with canonical audits", async () => {
      const task = await createTask("Lifecycle Task");
      expect(
        (
          await taskAgentRequest(`/v1/tasks/${task.id}/complete`, {
            body: {},
          })
        ).status,
      ).toBe(400);
      const completed = await taskAgentRequest(`/v1/tasks/${task.id}/complete`, {
        body: { expectedRevision: 1 },
      });
      expect(completed.status).toBe(200);
      expect((await payload(completed)).task).toMatchObject({
        cancelledAt: null,
        completedAt: "2026-07-13T12:00:00.000Z",
        legacyStatus: "completed",
        lifecycle: "completed",
        revision: 2,
        source: { revision: "2" },
      });
      expect(
        await database.db
          .select({
            cancelledAt: reminders.taskCancelledAt,
            completedAt: reminders.completedAt,
            legacyStatus: reminders.status,
            lifecycle: reminders.taskLifecycle,
            revision: reminders.taskRevision,
          })
          .from(reminders)
          .where(eq(reminders.id, task.id)),
      ).toEqual([
        {
          cancelledAt: null,
          completedAt: new Date("2026-07-13T12:00:00.000Z"),
          legacyStatus: "completed",
          lifecycle: "completed",
          revision: 2,
        },
      ]);
      expect(
        (await payload(await taskRequest("/v1/tasks?view=completed"))).items.map(
          ({ id }: { id: string }) => id,
        ),
      ).toContain(task.id);
      expect(
        (
          await taskAgentRequest(`/v1/tasks/${task.id}/cancel`, {
            body: { expectedRevision: 2 },
          })
        ).status,
      ).toBe(409);
      const reopened = await taskAgentRequest(`/v1/tasks/${task.id}/reopen`, {
        body: { expectedRevision: 2 },
      });
      expect(reopened.status).toBe(200);
      expect((await payload(reopened)).task).toMatchObject({
        cancelledAt: null,
        completedAt: null,
        legacyStatus: "inbox",
        lifecycle: "open",
        revision: 3,
      });
      expect(
        await database.db
          .select({
            cancelledAt: reminders.taskCancelledAt,
            completedAt: reminders.completedAt,
            legacyStatus: reminders.status,
            lifecycle: reminders.taskLifecycle,
            revision: reminders.taskRevision,
          })
          .from(reminders)
          .where(eq(reminders.id, task.id)),
      ).toEqual([
        {
          cancelledAt: null,
          completedAt: null,
          legacyStatus: "inbox",
          lifecycle: "open",
          revision: 3,
        },
      ]);
      const cancelled = await taskAgentRequest(`/v1/tasks/${task.id}/cancel`, {
        body: { expectedRevision: 3 },
      });
      expect(cancelled.status).toBe(200);
      expect((await payload(cancelled)).task).toMatchObject({
        cancelledAt: "2026-07-13T12:00:00.000Z",
        completedAt: null,
        legacyStatus: "cancelled",
        lifecycle: "cancelled",
        revision: 4,
      });
      expect(
        await database.db
          .select({
            cancelledAt: reminders.taskCancelledAt,
            completedAt: reminders.completedAt,
            legacyStatus: reminders.status,
            lifecycle: reminders.taskLifecycle,
            revision: reminders.taskRevision,
          })
          .from(reminders)
          .where(eq(reminders.id, task.id)),
      ).toEqual([
        {
          cancelledAt: new Date("2026-07-13T12:00:00.000Z"),
          completedAt: null,
          legacyStatus: "cancelled",
          lifecycle: "cancelled",
          revision: 4,
        },
      ]);
      expect(
        (await payload(await taskRequest("/v1/tasks?view=cancelled"))).items.map(
          ({ id }: { id: string }) => id,
        ),
      ).toContain(task.id);
      const reopenedCancelled = await taskAgentRequest(`/v1/tasks/${task.id}/reopen`, {
        body: { expectedRevision: 4 },
      });
      expect(reopenedCancelled.status).toBe(200);
      expect((await payload(reopenedCancelled)).task).toMatchObject({
        legacyStatus: "inbox",
        lifecycle: "open",
        revision: 5,
      });
      const audits = await database.db
        .select({ action: auditEvents.action, after: auditEvents.after })
        .from(auditEvents)
        .where(eq(auditEvents.entityId, task.id));
      expect(audits.map(({ action }) => action).sort()).toEqual([
        "task.cancelled",
        "task.completed",
        "task.created",
        "task.reopened",
        "task.reopened",
      ]);
      const finalAudit = audits.find(
        ({ after }) => (after as { revision?: number } | null)?.revision === 5,
      );
      expect(finalAudit?.after).toMatchObject({
        legacyStatus: "inbox",
        lifecycle: "open",
        revision: 5,
        source: { remoteId: task.id, revision: "5", sourceType: "task" },
      });
    });

    it("task audit snapshots do not disclose Task intent or container names to audit-only tokens", async () => {
      const secretListName = "Private Client Planning";
      const secretProjectName = "Sensitive Acquisition Outcome";
      const secretTaskWhy = "Because this reveals a confidential motivation";
      const list = await createTaskList(secretListName);
      const project = await createTaskProject(list.id, secretProjectName);
      const task = await createTask("Confidential executable action", {
        listId: list.id,
        projectId: project.id,
        why: secretTaskWhy,
      });
      const auditTokenResponse = await taskRequest("/v1/access-tokens", {
        body: { name: "Task audit metadata only", scopes: ["audit:read"] },
      });
      expect(auditTokenResponse.status).toBe(201);
      const auditToken = (await payload(auditTokenResponse)).token.token as string;

      const auditResponse = await scopedTaskAgentRequest(auditToken, "/v1/audit?limit=100");
      expect(auditResponse.status).toBe(200);
      const events = (await payload(auditResponse)).events.filter(
        ({ entityId }: { entityId: string }) => [list.id, project.id, task.id].includes(entityId),
      );
      expect(events).toHaveLength(3);
      expect(
        events.find(({ entityId }: { entityId: string }) => entityId === list.id)?.after,
      ).toMatchObject({
        name: "[redacted]",
      });
      expect(
        events.find(({ entityId }: { entityId: string }) => entityId === project.id)?.after,
      ).toMatchObject({ name: "[redacted]" });
      expect(
        events.find(({ entityId }: { entityId: string }) => entityId === task.id)?.after,
      ).toMatchObject({
        title: "[redacted]",
        why: "[redacted]",
      });
      expect(JSON.stringify(events)).not.toContain(secretListName);
      expect(JSON.stringify(events)).not.toContain(secretProjectName);
      expect(JSON.stringify(events)).not.toContain(secretTaskWhy);
    });

    it("tasks trash and restore without changing lifecycle and DELETE advertises its successor", async () => {
      const list = await createTaskList("Task Restore Validation List");
      const task = await createTask("Task in soon-archived List", { listId: list.id });
      const trashed = await taskAgentRequest(`/v1/tasks/${task.id}/trash`, {
        body: { expectedRevision: 1 },
      });
      expect(trashed.status).toBe(200);
      expect((await payload(trashed)).task).toMatchObject({
        deletedAt: "2026-07-13T12:00:00.000Z",
        legacyStatus: "inbox",
        lifecycle: "open",
        revision: 2,
      });
      expect((await taskRequest(`/v1/tasks/${task.id}`)).status).toBe(404);
      const trashView = await payload(await taskRequest("/v1/tasks?view=trash"));
      expect(trashView.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: task.id, revision: 2 })]),
      );
      const archived = await taskRequest(`/v1/task-lists/${list.id}/archive`, {
        body: { expectedRevision: list.revision },
      });
      expect(archived.status).toBe(200);
      const restoredToInbox = await taskAgentRequest(`/v1/tasks/${task.id}/restore`, {
        body: { expectedRevision: 2 },
      });
      expect(restoredToInbox.status).toBe(200);
      expect((await payload(restoredToInbox)).task).toMatchObject({
        deletedAt: null,
        lifecycle: "open",
        listId: taskInboxId,
        projectId: null,
        revision: 3,
      });
      expect(
        await database.db
          .select({
            deletedAt: reminders.deletedAt,
            lifecycle: reminders.taskLifecycle,
            listId: reminders.taskListId,
            projectId: reminders.taskProjectId,
            revision: reminders.taskRevision,
          })
          .from(reminders)
          .where(eq(reminders.id, task.id)),
      ).toEqual([
        {
          deletedAt: null,
          lifecycle: "open",
          listId: taskInboxId,
          projectId: null,
          revision: 3,
        },
      ]);

      for (const terminalAction of ["complete", "archive"] as const) {
        const projectList = await createTaskList(`Restore ${terminalAction} Project List`);
        const project = await createTaskProject(
          projectList.id,
          `Restore ${terminalAction} Project`,
        );
        const projectTask = await createTask(`Restore from ${terminalAction} Project`, {
          listId: projectList.id,
          projectId: project.id,
        });
        const trashedProjectTask = await taskAgentRequest(`/v1/tasks/${projectTask.id}/trash`, {
          body: { expectedRevision: projectTask.revision },
        });
        expect(trashedProjectTask.status).toBe(200);
        const terminalProject = await taskRequest(
          `/v1/task-projects/${project.id}/${terminalAction}`,
          { body: { expectedRevision: project.revision } },
        );
        expect(terminalProject.status).toBe(200);
        const staleRestore = await taskAgentRequest(`/v1/tasks/${projectTask.id}/restore`, {
          body: { expectedRevision: projectTask.revision },
        });
        expect(staleRestore.status).toBe(409);
        expect((await payload(staleRestore)).error.details).toMatchObject({ currentRevision: 2 });

        const restoredDetached = await taskAgentRequest(`/v1/tasks/${projectTask.id}/restore`, {
          body: { expectedRevision: 2 },
        });
        expect(restoredDetached.status).toBe(200);
        expect((await payload(restoredDetached)).task).toMatchObject({
          deletedAt: null,
          listId: projectList.id,
          projectId: null,
          revision: 3,
        });
      }

      const unavailableProjectList = await createTaskList("Unavailable Restore Project List");
      const unavailableProject = await createTaskProject(
        unavailableProjectList.id,
        "Unavailable Restore Project",
      );
      const unavailableProjectTask = await createTask("Restore from unavailable Project", {
        listId: unavailableProjectList.id,
        projectId: unavailableProject.id,
      });
      expect(
        (
          await taskAgentRequest(`/v1/tasks/${unavailableProjectTask.id}/trash`, {
            body: { expectedRevision: unavailableProjectTask.revision },
          })
        ).status,
      ).toBe(200);
      await database.db
        .update(taskProjects)
        .set({ deletedAt: new Date("2026-07-13T12:00:00.000Z") })
        .where(eq(taskProjects.id, unavailableProject.id));
      const restoredFromUnavailable = await taskAgentRequest(
        `/v1/tasks/${unavailableProjectTask.id}/restore`,
        { body: { expectedRevision: 2 } },
      );
      expect(restoredFromUnavailable.status).toBe(200);
      expect((await payload(restoredFromUnavailable)).task).toMatchObject({
        deletedAt: null,
        listId: unavailableProjectList.id,
        projectId: null,
        revision: 3,
      });

      const agentAliasTask = await createTask("Revision-safe DELETE alias Task");
      const agentAliasResponse = await taskAgentRequest(`/v1/tasks/${agentAliasTask.id}`, {
        body: { expectedRevision: agentAliasTask.revision },
        method: "DELETE",
      });
      expect(agentAliasResponse.status).toBe(204);
      expect(agentAliasResponse.headers.get("deprecation")).toBe("@1786492800");

      const aliasTask = await createTask("Deprecated DELETE alias Task");
      const aliasResponse = await taskRequest(`/v1/tasks/${aliasTask.id}`, { method: "DELETE" });
      expect(aliasResponse.status).toBe(204);
      expect(aliasResponse.headers.get("deprecation")).toBe("@1786492800");
      expect(aliasResponse.headers.get("link")).toBe(
        `</v1/tasks/${aliasTask.id}/trash>; rel="successor-version"`,
      );
      expect(
        (
          await taskAgentRequest(`/v1/tasks/${aliasTask.id}/restore`, {
            body: {},
          })
        ).status,
      ).toBe(400);
      const aliasRow = (
        await database.db
          .select({ revision: reminders.taskRevision })
          .from(reminders)
          .where(eq(reminders.id, aliasTask.id))
      )[0];
      const restored = await taskRequest(`/v1/tasks/${aliasTask.id}/restore`, {
        body: { expectedRevision: aliasRow?.revision },
      });
      expect(restored.status).toBe(200);
      expect((await payload(restored)).task).toMatchObject({
        deletedAt: null,
        lifecycle: "open",
        revision: 3,
      });
      const actions = await database.db
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.entityId, aliasTask.id));
      expect(actions.map(({ action }) => action)).toEqual([
        "task.created",
        "task.trashed",
        "task.restored",
      ]);
    });

    it("tasks restore from the locked current List state when archive wins concurrently", async () => {
      const list = await createTaskList("Concurrent Restore Archive List");
      const task = await createTask("Concurrent restore fallback Task", { listId: list.id });
      const trashed = await taskAgentRequest(`/v1/tasks/${task.id}/trash`, {
        body: { expectedRevision: task.revision },
      });
      expect(trashed.status).toBe(200);
      const blocker = await database.pool.connect();
      let archiveRequest: Promise<Response> | undefined;
      let restoreRequest: Promise<Response> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT id FROM task_lists WHERE id = $1 FOR UPDATE", [list.id]);
        archiveRequest = taskRequest(`/v1/task-lists/${list.id}/archive`, {
          body: { expectedRevision: list.revision },
        });
        void archiveRequest.catch(() => undefined);
        await waitForTaskCreateLockWaiters(1);
        restoreRequest = taskAgentRequest(`/v1/tasks/${task.id}/restore`, {
          body: { expectedRevision: 2 },
        });
        void restoreRequest.catch(() => undefined);
        await waitForTaskCreateLockWaiters(2);
        await blocker.query("COMMIT");

        const [archived, restored] = await Promise.all([archiveRequest, restoreRequest]);
        expect(archived.status).toBe(200);
        expect(restored.status).toBe(200);
        expect((await payload(restored)).task).toMatchObject({
          deletedAt: null,
          listId: taskInboxId,
          projectId: null,
          revision: 3,
        });
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await Promise.allSettled(
          [archiveRequest, restoreRequest].filter(
            (value): value is Promise<Response> => value !== undefined,
          ),
        );
      }

      const driftList = await createTaskList("Concurrent Restore Revision List");
      const driftTask = await createTask("Concurrent restore revision Task", {
        listId: driftList.id,
      });
      expect(
        (
          await taskAgentRequest(`/v1/tasks/${driftTask.id}/trash`, {
            body: { expectedRevision: driftTask.revision },
          })
        ).status,
      ).toBe(200);
      const driftBlocker = await database.pool.connect();
      let driftRestore: Promise<Response> | undefined;
      try {
        await driftBlocker.query("BEGIN");
        await driftBlocker.query("SELECT id FROM task_lists WHERE id = $1 FOR UPDATE", [
          driftList.id,
        ]);
        driftRestore = taskAgentRequest(`/v1/tasks/${driftTask.id}/restore`, {
          body: { expectedRevision: 2 },
        });
        void driftRestore.catch(() => undefined);
        await waitForTaskCreateLockWaiters(1);
        await database.db
          .update(reminders)
          .set({ taskRevision: 3 })
          .where(eq(reminders.id, driftTask.id));
        await driftBlocker.query("COMMIT");

        const driftResponse = await driftRestore;
        expect(driftResponse.status).toBe(409);
        expect((await payload(driftResponse)).error.details).toEqual({ currentRevision: 3 });
        expect(
          await database.db
            .select({ deletedAt: reminders.deletedAt, revision: reminders.taskRevision })
            .from(reminders)
            .where(eq(reminders.id, driftTask.id)),
        ).toEqual([{ deletedAt: new Date("2026-07-13T12:00:00.000Z"), revision: 3 }]);
      } finally {
        await driftBlocker.query("ROLLBACK");
        driftBlocker.release();
        await Promise.allSettled(
          [driftRestore].filter((value): value is Promise<Response> => value !== undefined),
        );
      }
    });

    it("task and project move previews use tasks read scope without mutation while commits require write", async () => {
      const sourceList = await createTaskList("Read-scoped Preview Source");
      const destinationList = await createTaskList("Read-scoped Preview Destination");
      const project = await createTaskProject(sourceList.id, "Read-scoped Preview Project");
      const task = await createTask("Read-scoped Preview Task", { listId: sourceList.id });
      const readTokenResponse = await taskRequest("/v1/access-tokens", {
        body: { name: "Task preview reader", scopes: ["tasks:read"] },
      });
      const writeTokenResponse = await taskRequest("/v1/access-tokens", {
        body: { name: "Task move writer", scopes: ["tasks:write"] },
      });
      expect(readTokenResponse.status).toBe(201);
      expect(writeTokenResponse.status).toBe(201);
      const readToken = (await payload(readTokenResponse)).token.token as string;
      const writeToken = (await payload(writeTokenResponse)).token.token as string;
      const projectBefore = await database.db
        .select({ listId: taskProjects.listId, revision: taskProjects.revision })
        .from(taskProjects)
        .where(eq(taskProjects.id, project.id));
      const taskBefore = await database.db
        .select({
          listId: reminders.taskListId,
          projectId: reminders.taskProjectId,
          revision: reminders.taskRevision,
        })
        .from(reminders)
        .where(eq(reminders.id, task.id));
      const auditsBefore = await database.db
        .select({ action: auditEvents.action, id: auditEvents.id })
        .from(auditEvents)
        .where(inArray(auditEvents.entityId, [project.id, task.id]));

      const projectPreviewResponse = await scopedTaskAgentRequest(
        readToken,
        `/v1/task-projects/${project.id}/move/preview`,
        {
          body: {
            destinationListId: destinationList.id,
            expectedRevision: project.revision,
          },
        },
      );
      const taskPreviewResponse = await scopedTaskAgentRequest(
        readToken,
        `/v1/tasks/${task.id}/move/preview`,
        {
          body: {
            destinationListId: destinationList.id,
            expectedRevision: task.revision,
          },
        },
      );
      expect(projectPreviewResponse.status).toBe(200);
      expect(taskPreviewResponse.status).toBe(200);
      const projectPreview = (await payload(projectPreviewResponse)).preview;
      const taskPreview = (await payload(taskPreviewResponse)).preview;
      expect(projectPreview.previewToken).toEqual(expect.any(String));
      expect(taskPreview.previewToken).toEqual(expect.any(String));
      expect(
        await database.db
          .select({ listId: taskProjects.listId, revision: taskProjects.revision })
          .from(taskProjects)
          .where(eq(taskProjects.id, project.id)),
      ).toEqual(projectBefore);
      expect(
        await database.db
          .select({
            listId: reminders.taskListId,
            projectId: reminders.taskProjectId,
            revision: reminders.taskRevision,
          })
          .from(reminders)
          .where(eq(reminders.id, task.id)),
      ).toEqual(taskBefore);
      expect(
        await database.db
          .select({ action: auditEvents.action, id: auditEvents.id })
          .from(auditEvents)
          .where(inArray(auditEvents.entityId, [project.id, task.id])),
      ).toEqual(auditsBefore);

      expect(
        (
          await scopedTaskAgentRequest(writeToken, `/v1/task-projects/${project.id}/move/preview`, {
            body: {
              destinationListId: destinationList.id,
              expectedRevision: project.revision,
            },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await scopedTaskAgentRequest(writeToken, `/v1/tasks/${task.id}/move/preview`, {
            body: {
              destinationListId: destinationList.id,
              expectedRevision: task.revision,
            },
          })
        ).status,
      ).toBe(403);

      const projectMoveInput = {
        destinationListId: destinationList.id,
        expectedRevision: project.revision,
        previewToken: projectPreview.previewToken,
      };
      const taskMoveInput = {
        destinationListId: destinationList.id,
        expectedRevision: task.revision,
        previewToken: taskPreview.previewToken,
      };
      expect(
        (
          await scopedTaskAgentRequest(readToken, `/v1/task-projects/${project.id}/move`, {
            body: projectMoveInput,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await scopedTaskAgentRequest(readToken, `/v1/tasks/${task.id}/move`, {
            body: taskMoveInput,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await scopedTaskAgentRequest(writeToken, `/v1/task-projects/${project.id}/move`, {
            body: projectMoveInput,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await scopedTaskAgentRequest(writeToken, `/v1/tasks/${task.id}/move`, {
            body: taskMoveInput,
          })
        ).status,
      ).toBe(200);
    });

    it("tasks bind move previews to Task, List, and destination Project revisions and audit detachment", async () => {
      const sourceList = await createTaskList("Task Move Source");
      const destinationList = await createTaskList("Task Move Destination");
      const sourceProject = await createTaskProject(sourceList.id, "Task Move Source Project");
      const destinationProject = await createTaskProject(
        destinationList.id,
        "Task Move Destination Project",
      );
      const task = await createTask("Move one Task", {
        listId: sourceList.id,
        projectId: sourceProject.id,
      });

      const detachmentPreviewResponse = await taskAgentRequest(
        `/v1/tasks/${task.id}/move/preview`,
        {
          body: { destinationListId: destinationList.id, expectedRevision: task.revision },
        },
      );
      expect(detachmentPreviewResponse.status).toBe(200);
      const detachmentPreview = (await payload(detachmentPreviewResponse)).preview;
      expect(detachmentPreview).toMatchObject({
        destinationListId: destinationList.id,
        destinationListRevision: destinationList.revision,
        destinationProjectId: null,
        destinationProjectRevision: null,
        detachedProjectId: sourceProject.id,
        sourceListId: sourceList.id,
        sourceListRevision: sourceList.revision,
        sourceProjectId: sourceProject.id,
        taskId: task.id,
        taskRevision: task.revision,
      });

      const listUpdate = await taskRequest(`/v1/task-lists/${destinationList.id}`, {
        body: { expectedRevision: destinationList.revision, name: "Revised Task Move Destination" },
        method: "PATCH",
      });
      expect(listUpdate.status).toBe(200);
      const staleListPreview = await taskAgentRequest(`/v1/tasks/${task.id}/move`, {
        body: {
          destinationListId: destinationList.id,
          expectedRevision: task.revision,
          previewToken: detachmentPreview.previewToken,
        },
      });
      expect(staleListPreview.status).toBe(409);
      expect((await payload(staleListPreview)).error.details).toMatchObject({
        code: "task_move_preview_stale",
      });

      const destinationProjectPreview = (
        await payload(
          await taskAgentRequest(`/v1/tasks/${task.id}/move/preview`, {
            body: {
              destinationListId: destinationList.id,
              destinationProjectId: destinationProject.id,
              expectedRevision: task.revision,
            },
          }),
        )
      ).preview;
      const projectUpdate = await taskRequest(`/v1/task-projects/${destinationProject.id}`, {
        body: {
          expectedRevision: destinationProject.revision,
          name: "Revised Destination Project",
        },
        method: "PATCH",
      });
      expect(projectUpdate.status).toBe(200);
      const stale = await taskAgentRequest(`/v1/tasks/${task.id}/move`, {
        body: {
          destinationListId: destinationList.id,
          destinationProjectId: destinationProject.id,
          expectedRevision: task.revision,
          previewToken: destinationProjectPreview.previewToken,
        },
      });
      expect(stale.status).toBe(409);
      expect((await payload(stale)).error.details).toMatchObject({
        code: "task_move_preview_stale",
      });
      expect(
        await database.db
          .select({
            listId: reminders.taskListId,
            projectId: reminders.taskProjectId,
            revision: reminders.taskRevision,
          })
          .from(reminders)
          .where(eq(reminders.id, task.id)),
      ).toEqual([{ listId: sourceList.id, projectId: sourceProject.id, revision: task.revision }]);
      expect(
        await database.db
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(and(eq(auditEvents.entityId, task.id), eq(auditEvents.action, "task.moved"))),
      ).toHaveLength(0);

      const freshPreview = (
        await payload(
          await taskAgentRequest(`/v1/tasks/${task.id}/move/preview`, {
            body: { destinationListId: destinationList.id, expectedRevision: task.revision },
          }),
        )
      ).preview;
      const moved = await taskAgentRequest(`/v1/tasks/${task.id}/move`, {
        body: {
          destinationListId: destinationList.id,
          expectedRevision: task.revision,
          previewToken: freshPreview.previewToken,
        },
      });
      expect(moved.status).toBe(200);
      expect((await payload(moved)).task).toMatchObject({
        legacyStatus: "inbox",
        lifecycle: "open",
        listId: destinationList.id,
        projectId: null,
        revision: 2,
      });
      const attachPreview = (
        await payload(
          await taskAgentRequest(`/v1/tasks/${task.id}/move/preview`, {
            body: {
              destinationListId: destinationList.id,
              destinationProjectId: destinationProject.id,
              expectedRevision: 2,
            },
          }),
        )
      ).preview;
      const attached = await taskAgentRequest(`/v1/tasks/${task.id}/move`, {
        body: {
          destinationListId: destinationList.id,
          destinationProjectId: destinationProject.id,
          expectedRevision: 2,
          previewToken: attachPreview.previewToken,
        },
      });
      expect(attached.status).toBe(200);
      expect((await payload(attached)).task).toMatchObject({
        listId: destinationList.id,
        projectId: destinationProject.id,
        revision: 3,
      });
      expect(
        await database.db
          .select({
            legacyStatus: reminders.status,
            listId: reminders.taskListId,
            projectId: reminders.taskProjectId,
            revision: reminders.taskRevision,
          })
          .from(reminders)
          .where(eq(reminders.id, task.id)),
      ).toEqual([
        {
          legacyStatus: "inbox",
          listId: destinationList.id,
          projectId: destinationProject.id,
          revision: 3,
        },
      ]);
      const moveAudit = (
        await database.db
          .select({
            action: auditEvents.action,
            after: auditEvents.after,
            before: auditEvents.before,
          })
          .from(auditEvents)
          .where(and(eq(auditEvents.entityId, task.id), eq(auditEvents.action, "task.moved")))
      )[0];
      expect(moveAudit).toMatchObject({
        action: "task.moved",
        after: { listId: destinationList.id, projectId: null, revision: 2 },
        before: { listId: sourceList.id, projectId: sourceProject.id, revision: 1 },
      });
    });
  });

  it("returns every connector callback to ilo when persistence fails unexpectedly", async () => {
    const callbackLogs = vi.fn();
    const failingDatabase = new Proxy(database.db, {
      get(target, property, receiver) {
        if (property === "update") {
          return () => {
            throw new Error("raw-provider-canary");
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const callbackApp = createApp({
      config: appConfig,
      db: failingDatabase,
      log: callbackLogs,
      x: xConnector,
    });

    for (const path of [
      "/v1/connectors/google/callback?state=unavailable&code=google-code",
      "/v1/x-bookmarks/callback?state=unavailable&code=x-code",
    ]) {
      const response = await callbackApp.request(path);
      expect(response.status).toBe(303);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("pragma")).toBe("no-cache");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      const location = new URL(String(response.headers.get("location")));
      expect(location.origin).toBe("https://app.example.com");
      expect(location.pathname).toBe("/settings");
      expect(location.searchParams.get("section")).toBe("connections");
      expect(location.searchParams.get("connection_result")).toBe("restart_required");
      expect(await response.text()).not.toContain("raw-provider-canary");
    }
    expect(
      callbackLogs.mock.calls
        .map(([entry]) => entry)
        .filter(({ event }) => event === "connector_authorization_callback_failed"),
    ).toEqual([
      expect.objectContaining({
        event: "connector_authorization_callback_failed",
        path: "/v1/connectors/google/callback",
        provider: "google",
        status: 503,
      }),
      expect.objectContaining({
        event: "connector_authorization_callback_failed",
        path: "/v1/x-bookmarks/callback",
        provider: "x",
        status: 503,
      }),
    ]);
    expect(JSON.stringify(callbackLogs.mock.calls)).not.toContain("raw-provider-canary");
  });

  it("authenticates Gmail push and acknowledges only after durable coalescing", async () => {
    const [pushUser] = await database.db
      .insert(users)
      .values({
        displayName: "Gmail Push",
        email: "gmail-push-user@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!pushUser) throw new Error("Gmail push user was not created.");
    const [account] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        email: "push-mailbox@example.com",
        label: "Push Mailbox",
        mailEnabled: true,
        provider: "google",
        providerAccountId: "gmail-push-account",
        userId: pushUser.id,
      })
      .returning();
    if (!account) throw new Error("Gmail push account was not created.");
    const privacyKey = Buffer.alloc(32, 1).toString("base64");
    await database.db.insert(connectorSubscriptions).values({
      accountId: account.id,
      kind: "gmail_mailbox",
      provider: "google",
      providerCursor: "100",
      remoteIdentityHash: createHmac(
        "sha256",
        Buffer.from(
          hkdfSync(
            "sha256",
            Buffer.from(privacyKey, "base64"),
            Buffer.alloc(0),
            "ilo/connector-notification/remote-identity/v1",
            32,
          ),
        ),
      )
        .update("push-mailbox@example.com")
        .digest("hex"),
      status: "active",
    });
    const envelope = (emailAddress: string, historyId: string) => ({
      message: {
        data: Buffer.from(JSON.stringify({ emailAddress, historyId })).toString("base64"),
        messageId: `message-${historyId}`,
      },
      subscription: "projects/ilo/subscriptions/gmail-push",
    });
    logs.mockClear();

    const accepted = await request("/v1/connectors/google/gmail/notifications", {
      auth: "none",
      body: envelope("push-mailbox@example.com", "101"),
      headers: { authorization: "Bearer valid-pubsub-token" },
    });
    expect(accepted.status).toBe(204);
    expect(await accepted.text()).toBe("");
    await expect(
      database.db
        .select()
        .from(connectorSyncTriggers)
        .where(eq(connectorSyncTriggers.accountId, account.id)),
    ).resolves.toEqual([expect.objectContaining({ notificationCount: 1, reason: "notification" })]);
    const duplicate = await request("/v1/connectors/google/gmail/notifications", {
      auth: "none",
      body: envelope("push-mailbox@example.com", "101"),
      headers: { authorization: "Bearer valid-pubsub-token" },
    });
    expect(duplicate.status).toBe(204);
    await expect(
      database.db
        .select({ notificationCount: connectorSyncTriggers.notificationCount })
        .from(connectorSyncTriggers)
        .where(eq(connectorSyncTriggers.accountId, account.id)),
    ).resolves.toEqual([{ notificationCount: 1 }]);
    const unknown = await request("/v1/connectors/google/gmail/notifications", {
      auth: "none",
      body: envelope("unknown@example.com", "102"),
      headers: { authorization: "Bearer valid-pubsub-token" },
    });
    expect(unknown.status).toBe(404);
    const unauthorized = await request("/v1/connectors/google/gmail/notifications", {
      auth: "none",
      body: envelope("push-mailbox@example.com", "102"),
      headers: { authorization: "invalid" },
    });
    expect(unauthorized.status).toBe(401);
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_gmail_trigger_for_test() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced Gmail trigger failure';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_gmail_trigger_for_test
      BEFORE UPDATE ON connector_sync_triggers
      FOR EACH ROW EXECUTE FUNCTION fail_gmail_trigger_for_test();
    `);
    try {
      const unavailable = await request("/v1/connectors/google/gmail/notifications", {
        auth: "none",
        body: envelope("push-mailbox@example.com", "102"),
        headers: { authorization: "Bearer valid-pubsub-token" },
      });
      expect(unavailable.status).toBe(503);
      await expect(
        database.db
          .select({ providerCursor: connectorSubscriptions.providerCursor })
          .from(connectorSubscriptions)
          .where(eq(connectorSubscriptions.accountId, account.id)),
      ).resolves.toEqual([{ providerCursor: "101" }]);
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_gmail_trigger_for_test ON connector_sync_triggers;
        DROP FUNCTION IF EXISTS fail_gmail_trigger_for_test();
      `);
    }
    expect(JSON.stringify(logs.mock.calls)).not.toContain("push-mailbox@example.com");
    expect(JSON.stringify(logs.mock.calls)).not.toContain("valid-pubsub-token");
    await database.db.delete(users).where(eq(users.id, pushUser.id));
  });

  it("rejects malformed or oversized Gmail push requests without exposing their contents", async () => {
    const path = "/v1/connectors/google/gmail/notifications";
    const headers = { authorization: "Bearer valid-pubsub-token" };
    const push = (rawBody: string, requestHeaders: Record<string, string> = headers) =>
      request(path, { auth: "none", headers: requestHeaders, rawBody });

    expect((await push("{}", {})).status).toBe(401);
    verifyGooglePubSubToken.mockRejectedValueOnce(new Error("private verification response"));
    expect((await push("{}")).status).toBe(401);
    verifyGooglePubSubToken.mockRejectedValueOnce(new GooglePubSubAuthError(true));
    expect((await push("{}")).status).toBe(503);
    expect(
      (
        await push("{}", {
          ...headers,
          "content-length": "32769",
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await push("x".repeat(32_769), {
          ...headers,
          "content-length": "not-a-number",
        })
      ).status,
    ).toBe(413);
    expect((await push("not-json")).status).toBe(400);
    expect(
      (
        await push(
          JSON.stringify({
            message: {
              data: Buffer.from("{}").toString("base64"),
              messageId: "wrong-subscription",
            },
            subscription: "projects/other/subscriptions/wrong",
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await push(
          JSON.stringify({
            message: {
              data: Buffer.alloc(8_193).toString("base64"),
              messageId: "oversized-decoded-payload",
            },
            subscription: "projects/ilo/subscriptions/gmail-push",
          }),
        )
      ).status,
    ).toBe(413);
    expect(JSON.stringify(logs.mock.calls)).not.toMatch(
      /private verification response|wrong-subscription|oversized-decoded-payload/u,
    );
  });

  it("keeps notification endpoints unavailable until each production gate is complete", async () => {
    const disabled = createApp({
      config: {
        ...appConfig,
        googleCalendarPushEnabled: false,
        googleGmailPushEnabled: false,
      },
      db: database.db,
    });
    expect(
      (
        await disabled.request("/v1/connectors/google/gmail/notifications", {
          method: "POST",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await disabled.request("/v1/connectors/google/calendar/notifications", {
          method: "POST",
        })
      ).status,
    ).toBe(404);

    const missingVerifier = createApp({
      config: {
        ...appConfig,
        googleGmailPushAudience: "",
      },
      db: database.db,
    });
    expect(
      (
        await missingVerifier.request("/v1/connectors/google/gmail/notifications", {
          method: "POST",
        })
      ).status,
    ).toBe(404);

    const missingSubscription = createApp({
      config: {
        ...appConfig,
        googleGmailPubsubSubscription: "",
      },
      db: database.db,
      verifyGooglePubSubToken,
    });
    expect(
      (
        await missingSubscription.request("/v1/connectors/google/gmail/notifications", {
          method: "POST",
        })
      ).status,
    ).toBe(404);
  });

  it("verifies Calendar channel headers and coalesces only new provider signals", async () => {
    const [pushUser] = await database.db
      .insert(users)
      .values({
        displayName: "Calendar Push",
        email: "calendar-push-user@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!pushUser) throw new Error("Calendar push user was not created.");
    const [account] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: true,
        label: "Calendar Push",
        mailEnabled: false,
        provider: "google",
        providerAccountId: "calendar-push-account",
        userId: pushUser.id,
      })
      .returning();
    if (!account) throw new Error("Calendar push account was not created.");
    const channelId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const channelToken = "opaque-calendar-verification-token-123456";
    await database.db.insert(connectorSubscriptions).values({
      accountId: account.id,
      channelId,
      kind: "google_calendar_list",
      provider: "google",
      remoteResourceId: "calendar-list-resource",
      status: "active",
      verificationTokenHash: createHash("sha256").update(channelToken).digest("hex"),
    });
    const headers = {
      "x-goog-channel-id": channelId,
      "x-goog-channel-token": channelToken,
      "x-goog-message-number": "1",
      "x-goog-resource-id": "calendar-list-resource",
      "x-goog-resource-state": "exists",
    };
    logs.mockClear();

    const accepted = await request("/v1/connectors/google/calendar/notifications", {
      auth: "none",
      headers,
      method: "POST",
    });
    expect(accepted.status).toBe(204);
    const duplicate = await request("/v1/connectors/google/calendar/notifications", {
      auth: "none",
      headers,
      method: "POST",
    });
    expect(duplicate.status).toBe(204);
    await expect(
      database.db
        .select({ notificationCount: connectorSyncTriggers.notificationCount })
        .from(connectorSyncTriggers)
        .where(eq(connectorSyncTriggers.accountId, account.id)),
    ).resolves.toEqual([{ notificationCount: 1 }]);
    const rejected = await request("/v1/connectors/google/calendar/notifications", {
      auth: "none",
      headers: { ...headers, "x-goog-channel-token": `${channelToken}-wrong` },
      method: "POST",
    });
    expect(rejected.status).toBe(404);
    await database.pool.query(`
      CREATE OR REPLACE FUNCTION fail_calendar_notification_for_test() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced Calendar notification failure';
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_calendar_notification_for_test
      BEFORE UPDATE ON connector_subscriptions
      FOR EACH ROW EXECUTE FUNCTION fail_calendar_notification_for_test();
    `);
    try {
      const unavailable = await request("/v1/connectors/google/calendar/notifications", {
        auth: "none",
        headers: { ...headers, "x-goog-message-number": "2" },
        method: "POST",
      });
      expect(unavailable.status).toBe(503);
    } finally {
      await database.pool.query(`
        DROP TRIGGER IF EXISTS fail_calendar_notification_for_test ON connector_subscriptions;
        DROP FUNCTION IF EXISTS fail_calendar_notification_for_test();
      `);
    }
    expect(JSON.stringify(logs.mock.calls)).not.toContain(channelToken);
    expect(JSON.stringify(logs.mock.calls)).not.toContain("calendar-list-resource");
    await database.db.delete(users).where(eq(users.id, pushUser.id));
  });

  it("rejects Calendar notifications with bodies or incomplete provider headers", async () => {
    const path = "/v1/connectors/google/calendar/notifications";
    expect(
      (
        await request(path, {
          auth: "none",
          headers: { "content-length": "2" },
          rawBody: "{}",
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await request(path, {
          auth: "none",
          method: "POST",
        })
      ).status,
    ).toBe(400);
  });

  it("runs the Finance maintenance entry points", async () => {
    await expect(app.backfillFinanceCashflowInsights()).resolves.toEqual({ processed: 0 });
    await expect(app.backfillFinanceLedgerIntegrity()).resolves.toMatchObject({ processed: 0 });
    await expect(app.backfillFinanceLearning()).resolves.toEqual({ processed: 0 });
    await expect(app.backfillFinanceSetupIntegrity()).resolves.toMatchObject({
      categoriesComplete: true,
      categoriesInserted: 0,
      claimed: true,
      profilesComplete: true,
      profilesDemoted: 0,
    });
    await expect(app.syncDueFinances()).resolves.toEqual({ failed: 0, reasons: [], synced: 0 });
  });

  it("enforces owner-issued, one-time invitations for private beta sign-up", async () => {
    const betaApp = createApp({
      config: {
        allowedOrigins: ["https://beta.example.com"],
        apiBaseUrl: "https://api.beta.example.com",
        apiShutdownTimeoutMs: 105_000,
        appBaseUrl: "https://beta.example.com",
        databaseUrl: container.getConnectionUri(),
        emailFrom: "",
        encryptionKey: Buffer.alloc(32, 3).toString("base64"),
        googleClientId: "",
        googleClientSecret: "",
        googleRedirectUri: "https://api.beta.example.com/v1/connectors/google/callback",
        logLevel: "info",
        ownerEmails: ["beta-owner@example.com"],
        plaidClientId: "",
        plaidEnvironment: "sandbox",
        plaidSecret: "",
        port: 8787,
        production: true,
        registrationMode: "invite",
        resendApiKey: "",
        sessionCookieName: "beta_session",
        sessionTtlDays: 7,
        xClientId: "",
        xClientSecret: "",
        xRedirectUri: "https://api.beta.example.com/v1/x-bookmarks/callback",
      },
      db: database.db,
    });
    expect((await betaApp.request("/health/ready")).headers.get("x-ilo-drain-protocol")).toBeNull();
    const signUp = (email: string, inviteCode?: string) =>
      betaApp.request("/v1/auth/register", {
        body: JSON.stringify({
          displayName: email.split("@")[0],
          email,
          ...(inviteCode ? { inviteCode } : {}),
          password: "LocalTestOnly123!",
          planningTimezone: "UTC",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    const validateInvitation = async (inviteCode: string) => {
      const response = await betaApp.request("/v1/auth/invitations/validate", {
        body: JSON.stringify({ inviteCode }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      return (await response.json()).valid as boolean;
    };

    expect((await signUp("beta-friend@example.com")).status).toBe(403);
    expect(await validateInvitation("BAD12345")).toBe(false);
    const ownerRegistration = await signUp("beta-owner@example.com");
    expect(ownerRegistration.status).toBe(201);
    const ownerSession = (await ownerRegistration.json()).sessionToken as string;
    const invitationResponse = await betaApp.request("/v1/invitations", {
      body: JSON.stringify({ email: "beta-friend@example.com", expiresInDays: 14 }),
      headers: { authorization: `Session ${ownerSession}`, "content-type": "application/json" },
      method: "POST",
    });
    expect(invitationResponse.status).toBe(201);
    const invitation = (await invitationResponse.json()).invitation as { code: string };
    expect(invitation.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(await validateInvitation(invitation.code)).toBe(true);
    expect((await signUp("beta-friend@example.com", invitation.code)).status).toBe(201);
    expect(await validateInvitation(invitation.code)).toBe(false);
    expect((await signUp("another-friend@example.com", invitation.code)).status).toBe(403);

    const recoveryApp = createApp({
      config: {
        allowedOrigins: ["https://beta.example.com"],
        apiBaseUrl: "https://api.beta.example.com",
        apiShutdownTimeoutMs: 105_000,
        appBaseUrl: "https://beta.example.com",
        authRateLimitMaxRequests: 1,
        authRateLimitWindowSeconds: 300,
        databaseUrl: container.getConnectionUri(),
        emailFrom: "",
        encryptionKey: Buffer.alloc(32, 4).toString("base64"),
        googleClientId: "",
        googleClientSecret: "",
        googleRedirectUri: "https://api.beta.example.com/v1/connectors/google/callback",
        logLevel: "info",
        plaidClientId: "",
        plaidEnvironment: "sandbox",
        plaidSecret: "",
        port: 8787,
        production: false,
        resendApiKey: "",
        sessionCookieName: "recovery_session",
        sessionTtlDays: 7,
        xClientId: "",
        xClientSecret: "",
        xRedirectUri: "https://api.beta.example.com/v1/x-bookmarks/callback",
      },
      db: database.db,
    });
    const recovery = () =>
      recoveryApp.request("/v1/auth/recovery", {
        body: JSON.stringify({ email: "beta-friend@example.com" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    expect((await recovery()).status).toBe(204);
    const limitedRecovery = await recovery();
    expect(limitedRecovery.status).toBe(429);
    expect(limitedRecovery.headers.get("retry-after")).toBe("300");
  });

  it("loads repeatable QA fixture personas without Task organization collisions", async () => {
    const fixtureNow = new Date("2026-07-28T14:00:00.000Z");
    await database.db.insert(users).values({
      displayName: "Unrelated account",
      email: "qa-unrelated@example.com",
      passwordHash: "not-a-fixture",
      planningTimezone: "UTC",
    });
    await expect(loadQaFixtures(database.db, { now: fixtureNow })).resolves.toMatchObject({
      accountCount: qaFixtureAccounts.length,
    });
    const fixtureEmails = qaFixtureAccounts.map((account) => account.email);
    const fixtureUsers = await database.db
      .select()
      .from(users)
      .where(inArray(users.email, fixtureEmails));
    expect(fixtureUsers).toHaveLength(qaFixtureAccounts.length);
    const demo = fixtureUsers.find((record) => record.email === "demo+full@ilo.test");
    const onboarding = fixtureUsers.find((record) => record.email === "qa+onboarding-new@ilo.test");
    const resumed = fixtureUsers.find((record) => record.email === "qa+onboarding-google@ilo.test");
    const apple = fixtureUsers.find((record) => record.email === "qa+onboarding-apple@ilo.test");
    const finances = fixtureUsers.find(
      (record) => record.email === "qa+onboarding-finances@ilo.test",
    );
    const ready = fixtureUsers.find((record) => record.email === "qa+onboarding-ready@ilo.test");
    const empty = fixtureUsers.find((record) => record.email === "qa+empty@ilo.test");
    const degraded = fixtureUsers.find((record) => record.email === "qa+recovery@ilo.test");
    expect(demo).toBeDefined();
    expect(onboarding).toMatchObject({ emailVerifiedAt: null, setupStatus: "not_started" });
    expect(resumed).toMatchObject({ setupCurrentStep: "google", setupStatus: "in_progress" });
    expect(apple).toMatchObject({ setupCurrentStep: "icloud", setupStatus: "in_progress" });
    expect(finances).toMatchObject({
      setupCurrentStep: "finances",
      setupStatus: "in_progress",
    });
    expect(ready).toMatchObject({ setupCurrentStep: "ready", setupStatus: "in_progress" });
    expect(empty).toMatchObject({ setupStatus: "complete" });
    expect(degraded).toBeDefined();
    expect(await verifyPassword(DEMO_QA_PASSWORD, demo?.passwordHash ?? "")).toBe(true);

    const [
      events,
      messages,
      transactions,
      profiles,
      emptyTasks,
      degradedAccounts,
      demoTaskLists,
      demoTaskProjects,
      demoTasks,
    ] = await Promise.all([
      database.db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.userId, demo?.id ?? "")),
      database.db
        .select()
        .from(mailThreads)
        .where(eq(mailThreads.userId, demo?.id ?? "")),
      database.db
        .select()
        .from(financeTransactions)
        .where(eq(financeTransactions.userId, demo?.id ?? "")),
      database.db
        .select()
        .from(domainProfiles)
        .where(eq(domainProfiles.userId, demo?.id ?? "")),
      database.db
        .select()
        .from(reminders)
        .where(eq(reminders.userId, empty?.id ?? "")),
      database.db
        .select()
        .from(calendarAccounts)
        .where(eq(calendarAccounts.userId, degraded?.id ?? "")),
      database.db
        .select()
        .from(taskLists)
        .where(eq(taskLists.userId, demo?.id ?? "")),
      database.db
        .select()
        .from(taskProjects)
        .where(eq(taskProjects.userId, demo?.id ?? "")),
      database.db
        .select()
        .from(reminders)
        .where(and(eq(reminders.userId, demo?.id ?? ""), eq(reminders.kind, "task"))),
    ]);
    expect(events).toHaveLength(7);
    expect(messages).toHaveLength(5);
    expect(transactions).toHaveLength(9);
    expect(profiles).toContainEqual(expect.objectContaining({ domain: "mail", status: "active" }));
    expect(emptyTasks).toEqual([]);
    expect(degradedAccounts).toContainEqual(
      expect.objectContaining({ provider: "google", syncStatus: "error" }),
    );
    expect(demoTaskLists.map(({ kind, name }) => ({ kind, name }))).toEqual(
      expect.arrayContaining([
        { kind: "inbox", name: "Inbox" },
        { kind: "standard", name: "Personal" },
        { kind: "standard", name: "Work" },
        { kind: "standard", name: "Shopping" },
      ]),
    );
    expect(demoTaskLists.filter((list) => list.kind === "inbox")).toHaveLength(1);
    expect(demoTaskLists.filter((list) => list.kind === "standard")).toHaveLength(3);
    const repeatedProjects = demoTaskProjects.filter(
      (project) => project.name === "Quarterly reset",
    );
    expect(repeatedProjects).toHaveLength(2);
    expect(new Set(repeatedProjects.map((project) => project.listId)).size).toBe(2);
    expect(demoTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          deletedAt: null,
          taskLifecycle: "open",
          title: "Draft weekly product update",
        }),
        expect.objectContaining({
          deletedAt: null,
          scheduledAt: null,
          taskLifecycle: "open",
          title: "Compare renters insurance renewals",
        }),
        expect.objectContaining({
          deletedAt: null,
          scheduledAt: expect.any(Date),
          taskLifecycle: "open",
          title: "Review monthly subscriptions",
        }),
        expect.objectContaining({
          completedAt: expect.any(Date),
          taskLifecycle: "completed",
          title: "Book dentist appointment",
        }),
        expect.objectContaining({ taskCancelledAt: expect.any(Date), taskLifecycle: "cancelled" }),
        expect.objectContaining({ deletedAt: expect.any(Date), taskLifecycle: "open" }),
      ]),
    );
    const draftTask = demoTasks.find((task) => task.title === "Draft weekly product update");
    expect(
      await database.db
        .select({
          action: auditEvents.action,
          entityType: auditEvents.entityType,
          requestId: auditEvents.requestId,
        })
        .from(auditEvents)
        .where(eq(auditEvents.entityId, draftTask?.id ?? "")),
    ).toEqual([
      {
        action: "task.created",
        entityType: "task",
        requestId: "fixture-demo-full-task",
      },
    ]);
    const sameListMoveTask = demoTasks.find(
      (task) => task.title === "Prepare launch follow-through",
    );
    const sameListProjects = demoTaskProjects.filter(
      (project) => project.listId === sameListMoveTask?.taskListId,
    );
    expect(sameListMoveTask?.taskProjectId).toEqual(expect.any(String));
    expect(sameListProjects).toHaveLength(2);

    await loadQaFixtures(database.db, { now: new Date("2026-07-29T14:00:00.000Z") });
    expect(
      await database.db.select().from(users).where(inArray(users.email, fixtureEmails)),
    ).toHaveLength(qaFixtureAccounts.length);
    expect(
      await database.db.select().from(users).where(eq(users.email, "qa-unrelated@example.com")),
    ).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(taskLists)
        .where(eq(taskLists.userId, demo?.id ?? "")),
    ).toHaveLength(4);
    expect(
      await database.db
        .select()
        .from(taskProjects)
        .where(eq(taskProjects.userId, demo?.id ?? "")),
    ).toHaveLength(3);
  });

  it("daily brief uses canonical lifecycle, deletion, and timing", async () => {
    const baseTask: Task = {
      cancelledAt: null,
      completedAt: null,
      createdAt: "2026-07-13T08:00:00.000Z",
      deletedAt: null,
      dueAt: null,
      estimateMinutes: 30,
      id: "a1000000-0000-4000-8000-000000000001",
      legacyStatus: "completed",
      lifecycle: "open",
      listId: "a1000000-0000-4000-8000-000000000010",
      notes: null,
      priority: "medium",
      projectId: null,
      revision: 1,
      scheduledAt: null,
      source: {
        accountId: null,
        provider: "local",
        remoteId: "a1000000-0000-4000-8000-000000000001",
        revision: "1",
        sourceType: "task",
      },
      tags: [],
      timezone: "UTC",
      title: "Open without timing",
      updatedAt: "2026-07-13T08:00:00.000Z",
      why: null,
    };
    const canonicalTasks: Task[] = [
      baseTask,
      {
        ...baseTask,
        dueAt: "2026-07-13T16:00:00.000Z",
        id: "a1000000-0000-4000-8000-000000000002",
        source: { ...baseTask.source, remoteId: "a1000000-0000-4000-8000-000000000002" },
        title: "Open due today",
      },
      {
        ...baseTask,
        estimateMinutes: 45,
        id: "a1000000-0000-4000-8000-000000000003",
        legacyStatus: "cancelled",
        scheduledAt: "2026-07-13T14:00:00.000Z",
        source: { ...baseTask.source, remoteId: "a1000000-0000-4000-8000-000000000003" },
        title: "Open reserved time",
      },
      {
        ...baseTask,
        completedAt: "2026-07-13T11:00:00.000Z",
        id: "a1000000-0000-4000-8000-000000000004",
        legacyStatus: "inbox",
        lifecycle: "completed",
        source: { ...baseTask.source, remoteId: "a1000000-0000-4000-8000-000000000004" },
        title: "Completed summary",
      },
      {
        ...baseTask,
        cancelledAt: "2026-07-13T10:00:00.000Z",
        id: "a1000000-0000-4000-8000-000000000005",
        legacyStatus: "next",
        lifecycle: "cancelled",
        source: { ...baseTask.source, remoteId: "a1000000-0000-4000-8000-000000000005" },
        title: "Cancelled Task",
      },
      {
        ...baseTask,
        deletedAt: "2026-07-13T09:00:00.000Z",
        id: "a1000000-0000-4000-8000-000000000006",
        legacyStatus: "next",
        source: { ...baseTask.source, remoteId: "a1000000-0000-4000-8000-000000000006" },
        title: "Trashed Task",
      },
    ];
    const listQueries: TaskListQuery[] = [];
    const dailyBrief = createDailyBriefService({
      db: database.db,
      listEvents: async () => [],
      listReminders: async () => [],
      listTasks: async (_userId, query) => {
        listQueries.push(query);
        return canonicalTasks.filter(
          (task) => task.deletedAt === null && task.lifecycle === query.lifecycle,
        );
      },
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });

    const brief = await dailyBrief.dailyBrief(crypto.randomUUID(), "UTC");

    expect(brief.tasks.map((task) => task.title)).toEqual([
      "Open without timing",
      "Open due today",
      "Open reserved time",
    ]);
    expect(brief.completedTasks.map((task) => task.title)).toEqual(["Completed summary"]);
    expect(brief.tasks).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Cancelled Task" }),
        expect.objectContaining({ title: "Trashed Task" }),
      ]),
    );
    expect(brief.capacity).toMatchObject({ flexibleTaskMinutes: 60, scheduledTaskMinutes: 45 });
    expect(brief.recommendedTasks.map(({ task, urgency }) => [task.title, urgency])).toEqual([
      ["Open due today", "due_today"],
      ["Open without timing", "inbox"],
    ]);
    expect(listQueries).toEqual([
      { lifecycle: "open", limit: 100 },
      { lifecycle: "completed", limit: 100 },
    ]);
  });

  it("serves health, registration, sessions, tokens, reminders, calendars, events, and audit", async () => {
    await app.dispatchDueMailRuleWork();
    const live = await request("/health/live", { auth: "none" });
    expect(await payload(live)).toEqual({
      status: "ok",
    });
    expect(live.headers.get("x-ilo-drain-protocol")).toBeNull();
    const ready = await request("/health/ready", { auth: "none" });
    expect(await payload(ready)).toEqual({
      status: "ready",
    });
    expect(ready.headers.get("x-ilo-drain-protocol")).toBe("quiesce-v1");
    expect((await payload(await request("/openapi.json", { auth: "none" }))).servers).toEqual([
      { url: "https://api.example.com" },
    ]);
    expect((await request("/missing", { auth: "none" })).status).toBe(404);
    expect((await request("/v1/auth/register", { auth: "none", rawBody: "{" })).status).toBe(400);

    const registration = await request("/v1/auth/register", {
      auth: "none",
      body: {
        displayName: "Test User",
        email: "test@example.com",
        password: "LocalTestOnly123!",
        planningTimezone: "America/New_York",
      },
      headers: { origin: "https://app.example.com", "x-request-id": "register-request" },
    });
    expect(registration.status).toBe(201);
    expect(registration.headers.get("access-control-allow-origin")).toBe("https://app.example.com");
    expect(registration.headers.get("x-request-id")).toBe("register-request");
    const registrationBody = await payload(registration);
    sessionToken = registrationBody.sessionToken;
    expect(sessionToken).toMatch(/^sess_/);
    expect(registrationBody.user).toMatchObject({
      email: "test@example.com",
      displayName: "Test User",
      setup: {
        completedAt: null,
        currentStep: "welcome",
        dismissedAt: null,
        selectedWorkspaces: ["calendar", "tasks", "mail", "finances"],
        startedAt: null,
        status: "not_started",
      },
    });
    expect((await request("/v1/setup", { auth: "none", method: "PATCH" })).status).toBe(401);
    expect(
      (
        await payload(
          await request("/v1/setup", {
            body: {
              action: "progress",
              currentStep: "google",
              selectedWorkspaces: ["calendar", "mail"],
            },
            method: "PATCH",
          }),
        )
      ).user.setup,
    ).toEqual({
      completedAt: null,
      currentStep: "google",
      dismissedAt: null,
      selectedWorkspaces: ["calendar", "mail"],
      startedAt: "2026-07-13T12:00:00.000Z",
      status: "in_progress",
    });
    expect(
      (
        await payload(
          await request("/v1/setup", {
            body: { action: "dismiss" },
            method: "PATCH",
          }),
        )
      ).user.setup,
    ).toMatchObject({
      currentStep: "google",
      dismissedAt: "2026-07-13T12:00:00.000Z",
      status: "dismissed",
    });
    expect((await request("/v1/weather")).status).toBe(400);
    weatherFetch.mockResolvedValueOnce(
      Response.json({
        results: [
          {
            admin1: "New York",
            country: "United States",
            latitude: 40.7128,
            longitude: -74.006,
            name: "New York",
          },
        ],
      }),
    );
    expect(
      (await payload(await request("/v1/weather/locations?query=New%20York"))).locations,
    ).toEqual([
      {
        coordinates: { latitude: 40.7128, longitude: -74.006 },
        label: "New York, New York, United States",
      },
    ]);
    expect((await request("/v1/weather/locations?query=N")).status).toBe(400);
    expect((await request("/v1/weather/locations?query=New%20York", { auth: "none" })).status).toBe(
      401,
    );
    weatherFetch.mockResolvedValueOnce(
      Response.json({
        address: { city: "New York", country: "United States", state: "New York" },
      }),
    );
    weatherFetch.mockResolvedValueOnce(
      Response.json({
        current: { precipitation: 0.1, temperature_2m: 72, weather_code: 63 },
      }),
    );
    weatherFetch.mockResolvedValueOnce(Response.json({ current: { us_aqi: 125 } }));
    expect(
      (await payload(await request("/v1/weather?latitude=40.7&longitude=-74"))).weather,
    ).toEqual({
      alerts: [
        { kind: "rain", label: "Rain now" },
        { kind: "air_quality", label: "Air quality: sensitive groups" },
      ],
      condition: "Rain",
      location: {
        city: "New York",
        coordinates: { latitude: 40.7, longitude: -74 },
        country: "United States",
        label: "New York, New York, United States",
        mapUrl: "https://www.openstreetmap.org/?mlat=40.7&mlon=-74#map=12/40.7/-74",
        region: "New York",
        shortLabel: "NYC",
        source: "device",
      },
      observedAt: "2026-07-13T12:00:00.000Z",
      temperatureF: 72,
      usAqi: 125,
    });

    const financeAccountResponse = await request("/v1/finances/accounts", {
      body: { balance: 125, institution: "Cash", name: "Wallet", provider: "manual" },
    });
    expect(financeAccountResponse.status).toBe(201);
    const financeAccount = (await payload(financeAccountResponse)).account;
    const financeTransactionResponse = await request("/v1/finances/transactions", {
      body: {
        accountId: financeAccount.id,
        amount: 12.5,
        category: null,
        categoryConfidence: null,
        date: "2026-07-13",
        direction: "expense",
        merchant: "Trader Joe's",
        notes: null,
      },
    });
    expect(financeTransactionResponse.status).toBe(201);
    const financeTransaction = (await payload(financeTransactionResponse)).transaction;
    expect(
      (
        await request(`/v1/finances/transactions/${financeTransaction.id}`, {
          body: { category: "Groceries" },
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
    const categories = (await payload(await request("/v1/finances/categories"))).categories;
    const shopping = categories.find((item: { slug: string }) => item.slug === "shopping");
    if (!shopping) throw new Error("Shopping category was not seeded.");
    const [merchant] = (await payload(await request("/v1/finances/merchants"))).merchants;
    expect(merchant).toMatchObject({ aliases: ["Trader Joe's"], isUserConfirmed: false });
    expect(
      (
        await request(`/v1/finances/merchants/${merchant.id}`, {
          body: { displayName: "Trader Joe's Market" },
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
    expect((await payload(await request("/v1/finances/merchants"))).merchants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: "Trader Joe's Market", isUserConfirmed: true }),
      ]),
    );
    const variantResponse = await request("/v1/finances/transactions", {
      body: {
        accountId: financeAccount.id,
        amount: 6,
        category: null,
        categoryConfidence: null,
        date: "2026-07-13",
        direction: "expense",
        merchant: "TRADER JOES EXPRESS",
        notes: null,
      },
    });
    expect(variantResponse.status).toBe(201);
    const merchantsBeforeMerge = (await payload(await request("/v1/finances/merchants"))).merchants;
    const sourceMerchant = merchantsBeforeMerge.find(
      (item: { id: string }) => item.id !== merchant.id,
    );
    if (!sourceMerchant) throw new Error("Variant merchant was not created.");
    expect(
      (
        await request("/v1/finances/merchants/merge", {
          body: {
            rationale: "Confirmed duplicate aliases.",
            sourceMerchantId: sourceMerchant.id,
            targetMerchantId: merchant.id,
          },
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect((await payload(await request("/v1/finances/merchants"))).merchants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ aliases: expect.arrayContaining(["TRADER JOES EXPRESS"]) }),
      ]),
    );
    expect((await payload(await request("/v1/finances/transactions?limit=10"))).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: financeTransaction.id })]),
    );
    const reviewCandidateResponse = await request("/v1/finances/transactions", {
      body: {
        accountId: financeAccount.id,
        amount: 4,
        category: null,
        categoryConfidence: null,
        date: "2026-07-13",
        direction: "expense",
        merchant: "Mystery Agent Review",
        notes: null,
      },
    });
    expect(reviewCandidateResponse.status).toBe(201);
    const reviewCandidate = (await payload(reviewCandidateResponse)).transaction;
    const proposals = (await payload(await request("/v1/finances/categorizations/propose")))
      .proposals;
    const proposal = proposals.find(
      (item: { transaction: { id: string } }) => item.transaction.id === reviewCandidate.id,
    );
    if (!proposal) throw new Error("Finance categorization proposal was not returned.");
    const applied = await payload(
      await request("/v1/finances/categorizations/apply", {
        body: {
          decisions: [
            {
              categoryId: shopping.id,
              confidence: 0.9,
              expectedTransactionUpdatedAt: proposal.transaction.updatedAt,
              learnMerchant: "suggest",
              rationale: "A plausible first-pass match.",
              transactionId: reviewCandidate.id,
            },
          ],
        },
        method: "POST",
      }),
    );
    expect(applied.results[0]).toMatchObject({
      applied: true,
      status: "applied",
      threshold: expect.any(Number),
    });
    expect(
      (
        await request("/v1/finances/transactions", {
          body: {
            accountId: financeAccount.id,
            amount: 3,
            category: null,
            categoryConfidence: null,
            date: "2026-07-13",
            direction: "transfer",
            merchant: "Deferred Review",
            notes: null,
          },
        })
      ).status,
    ).toBe(201);
    await app.backfillFinanceLedgerIntegrity();
    const reviews = (await payload(await request("/v1/finances/review"))).reviews;
    expect(reviews).toHaveLength(1);
    expect(
      (
        await request(`/v1/finances/review/${reviews[0].id}`, {
          body: { action: "defer", learnMerchant: "suggest", rationale: null },
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("/v1/finances/budgets", {
          body: { category: "Groceries", limit: 400, month: "2026-07" },
        })
      ).status,
    ).toBe(201);
    expect((await payload(await request("/v1/finances/budgets/status"))).budgets).toEqual([
      expect.objectContaining({ remaining: 381.5, spent: 18.5 }),
    ]);
    expect((await payload(await request("/v1/finances"))).overview).toMatchObject({
      accounts: [expect.objectContaining({ id: financeAccount.id })],
    });
    expect((await payload(await request("/v1/finances/wealth"))).wealth).toMatchObject({
      cash: 125,
    });
    expect(await payload(await request("/v1/finances/profile"))).toEqual({ profile: null });
    expect(
      (
        await request("/v1/finances/profile", {
          body: {
            effectiveDate: "2026-07-01",
            employer: "Acme",
            employmentType: "full_time",
            expectedNetPay: 2500,
            grossAnnualIncome: 130000,
            nextPayday: "2026-07-31",
            payAccountId: financeAccount.id,
            payFrequency: "biweekly",
            role: "Engineer",
          },
          method: "PUT",
        })
      ).status,
    ).toBe(200);
    expect((await payload(await request("/v1/finances/income-streams"))).incomeStreams).toEqual([]);
    expect((await payload(await request("/v1/finances/recurring"))).recurring).toEqual([]);
    expect((await payload(await request("/v1/finances/forecast"))).forecast).toMatchObject({
      upcomingIncome: 0,
    });
    expect((await payload(await request("/v1/finances/alerts"))).alerts).toEqual([]);
    expect((await payload(await request("/v1/finances/health"))).health).toMatchObject({
      pendingTransactions: 0,
    });
    expect((await payload(await request("/v1/finances/export"))).export).toMatchObject({
      accounts: expect.arrayContaining([expect.objectContaining({ id: financeAccount.id })]),
    });
    expect(
      (await payload(await request("/v1/finances/budgets/pace?period=week"))).pace,
    ).toMatchObject({
      period: "week",
    });
    expect((await request("/v1/finances/insights/refresh", { method: "POST" })).status).toBe(200);
    const unknownFinanceId = "00000000-0000-4000-8000-000000000000";
    expect(
      (
        await request(`/v1/finances/income-streams/${unknownFinanceId}`, {
          body: { status: "active" },
          method: "PATCH",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(`/v1/finances/recurring/${unknownFinanceId}`, {
          body: { status: "active" },
          method: "PATCH",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(`/v1/finances/alerts/${unknownFinanceId}`, {
          body: { action: "resolve", rationale: null },
          method: "POST",
        })
      ).status,
    ).toBe(404);
    expect(await payload(await request("/v1/finances/plaid/status"))).toEqual({ available: false });
    expect((await request("/v1/finances/plaid/link-token", { method: "POST" })).status).toBe(400);
    expect(
      (
        await request("/v1/finances/plaid/exchange", {
          body: { institution: null, publicToken: "public-token" },
        })
      ).status,
    ).toBe(400);
    expect(
      (await request(`/v1/finances/accounts/${financeAccount.id}/sync`, { method: "POST" })).status,
    ).toBe(400);
    const paypalAccountResponse = await request("/v1/finances/accounts", {
      body: { balance: null, institution: "PayPal", name: "PayPal history", provider: "paypal" },
    });
    expect(paypalAccountResponse.status).toBe(201);
    const paypalAccount = (await payload(paypalAccountResponse)).account;
    expect(
      (
        await request(`/v1/finances/accounts/${paypalAccount.id}/import`, {
          body: {
            accountId: paypalAccount.id,
            csv: "Date,Name,Amount,Transaction ID\n2026-07-13,Corner store,9.5,paypal-import-1",
            provider: "paypal",
          },
        })
      ).status,
    ).toBe(201);
    expect(
      (await request(`/v1/finances/accounts/${financeAccount.id}`, { method: "DELETE" })).status,
    ).toBe(204);

    const goal = (
      await payload(
        await request("/v1/goals", {
          body: {
            description: "Make enough room for deep work.",
            progress: 20,
            targetDate: "2026-08-01",
            title: "Protect focus",
          },
        }),
      )
    ).goal;
    expect(goal).toMatchObject({ progress: 20, status: "active", title: "Protect focus" });
    expect((await payload(await request("/v1/goals"))).goals).toEqual([
      expect.objectContaining({ id: goal.id }),
    ]);
    expect(
      (
        await request(`/v1/goals/${goal.id}`, {
          body: { progress: 100, status: "completed" },
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
    expect((await request(`/v1/goals/${goal.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await request(`/v1/goals/${goal.id}`, { method: "PATCH", body: {} })).status).toBe(400);

    const motive = (
      await payload(
        await request("/v1/motives", {
          body: {
            detail: "Make time for the people and work that matter.",
            title: "Act with care",
          },
        }),
      )
    ).motive;
    expect((await payload(await request("/v1/motives"))).motives).toEqual([
      expect.objectContaining({ id: motive.id, isActive: true }),
    ]);
    expect(
      (
        await request(`/v1/motives/${motive.id}`, {
          body: { isActive: false },
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
    expect((await request(`/v1/motives/${motive.id}`, { method: "DELETE" })).status).toBe(204);

    const plaidFetch = vi.fn(async (input: RequestInfo | URL) => {
      const target =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(target).pathname;
      if (path === "/link/token/create") return Response.json({ link_token: "link-token" });
      if (path === "/item/public_token/exchange")
        return Response.json({ access_token: "access-token", item_id: "item-id" });
      if (path === "/accounts/get")
        return Response.json({
          accounts: [
            {
              account_id: "plaid-integration-account",
              balances: { current: 50 },
              name: "Plaid checking",
              official_name: null,
            },
          ],
        });
      if (path === "/transactions/sync")
        return Response.json({
          added: [],
          has_more: false,
          modified: [],
          next_cursor: "cursor",
          removed: [],
        });
      return Response.json({ error_message: "Unexpected Plaid call" }, { status: 400 });
    });
    vi.stubGlobal("fetch", plaidFetch);
    const plaidApp = createApp({
      config: {
        allowedOrigins: ["https://app.example.com"],
        apiBaseUrl: "https://api.example.com",
        apiShutdownTimeoutMs: 105_000,
        appBaseUrl: "https://app.example.com",
        databaseUrl: container.getConnectionUri(),
        emailFrom: "",
        encryptionKey: Buffer.alloc(32, 1).toString("base64"),
        googleClientId: "",
        googleClientSecret: "",
        googleRedirectUri: "https://api.example.com/v1/connectors/google/callback",
        logLevel: "info",
        plaidClientId: "client",
        plaidEnvironment: "sandbox",
        plaidSecret: "secret",
        port: 8787,
        production: false,
        resendApiKey: "",
        sessionCookieName: "personal_os_session",
        sessionTtlDays: 30,
        xClientId: "",
        xClientSecret: "",
        xRedirectUri: "https://api.example.com/v1/x-bookmarks/callback",
      },
      db: database.db,
      icloud: icloudConnector,
      log: logs,
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });
    const plaidRequest = (path: string, body?: unknown) =>
      plaidApp.request(path, {
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: {
          authorization: `Session ${sessionToken}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        method: "POST",
      });
    expect((await plaidRequest("/v1/finances/plaid/link-token")).status).toBe(200);
    const plaidExchange = await plaidRequest("/v1/finances/plaid/exchange", {
      institution: "Integration Bank",
      publicToken: "public-token",
    });
    expect(plaidExchange.status).toBe(201);
    const plaidAccount = (await payload(plaidExchange)).accounts[0];
    expect((await plaidRequest(`/v1/finances/accounts/${plaidAccount.id}/sync`)).status).toBe(200);
    vi.unstubAllGlobals();

    expect(
      (
        await request("/v1/auth/register", {
          auth: "none",
          body: {
            displayName: "Duplicate",
            email: "test@example.com",
            password: "LocalTestOnly123!",
            planningTimezone: "UTC",
          },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request("/v1/auth/login", {
          auth: "none",
          body: { email: "test@example.com", password: "wrong" },
        })
      ).status,
    ).toBe(401);
    expect((await request("/v1/me", { auth: "none" })).status).toBe(401);
    expect((await payload(await request("/v1/me"))).user.email).toBe("test@example.com");
    expect(
      (
        await payload(
          await request("/v1/me", {
            body: {
              accentColor: "#6c9cff",
              displayName: "Updated Test",
              email: "updated@example.com",
              theme: "dark",
              planningTimezone: "America/New_York",
              homeLocation: {
                coordinates: { latitude: 40.7128, longitude: -74.006 },
                label: "New York, NY",
              },
              workdayEndMinute: 18 * 60,
              workdayStartMinute: 10 * 60,
            },
            method: "PATCH",
          }),
        )
      ).user,
    ).toMatchObject({
      accentColor: "#6c9cff",
      displayName: "Updated Test",
      email: "updated@example.com",
      theme: "dark",
      planningTimezone: "America/New_York",
      homeLocation: {
        coordinates: { latitude: 40.7128, longitude: -74.006 },
        label: "New York, NY",
      },
      workdayEndMinute: 18 * 60,
      workdayStartMinute: 10 * 60,
    });
    expect(
      (
        await request("/v1/me", {
          body: { accentColor: "not-a-color" },
          method: "PATCH",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/v1/me", {
          body: { workdayEndMinute: 9 * 60, workdayStartMinute: 10 * 60 },
          method: "PATCH",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/v1/auth/register", {
          auth: "none",
          body: {
            displayName: "Second User",
            email: "second@example.com",
            password: "LocalTestOnly123!",
            planningTimezone: "UTC",
          },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request("/v1/me", {
          body: { email: "second@example.com" },
          method: "PATCH",
        })
      ).status,
    ).toBe(409);

    const directAuthForPartialUpdate = createAuthService({
      db: database.db,
      now: () => new Date("2026-07-13T12:00:00.000Z"),
      sessionTtlDays: 30,
    });
    await expect(
      directAuthForPartialUpdate.updateUser(crypto.randomUUID(), { displayName: "Missing user" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      directAuthForPartialUpdate.updateUser(registrationBody.user.id, {
        displayName: "Partial update",
      }),
    ).resolves.toMatchObject({ displayName: "Partial update", email: "updated@example.com" });

    const loginResponse = await request("/v1/auth/login", {
      auth: "none",
      body: { email: "updated@example.com", password: "LocalTestOnly123!" },
      headers: {
        "user-agent": "Integration Browser",
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      },
    });
    const login = await payload(loginResponse);
    sessionToken = login.sessionToken;
    const sessionCookie = loginResponse.headers.get("set-cookie")?.split(";")[0];
    expect(sessionCookie).toMatch(/^personal_os_session=/);
    expect(
      (
        await payload(
          await request("/v1/me", {
            auth: "none",
            headers: { cookie: String(sessionCookie) },
          }),
        )
      ).user.email,
    ).toBe("updated@example.com");
    const sessions = (await payload(await request("/v1/sessions"))).sessions;
    expect(sessions).toHaveLength(2);
    expect(
      sessions.some(
        (session: { ipAddress: string | null }) => session.ipAddress === "203.0.113.10",
      ),
    ).toBe(true);
    const otherSession = sessions.find(
      (session: { id: string; userAgent: string | null }) => session.id !== sessions[0].id,
    );
    expect((await request(`/v1/sessions/${otherSession.id}`, { method: "DELETE" })).status).toBe(
      204,
    );

    const createdToken = await payload(
      await request("/v1/access-tokens", {
        body: {
          name: "Integration agent",
          scopes: [
            "reminders:read",
            "reminders:write",
            "tasks:read",
            "tasks:write",
            "calendar:read",
            "calendar:write",
            "mail:read",
            "finances:read",
            "finances:write",
            "goals:read",
            "goals:write",
            "audit:read",
            "automations:read",
            "bookmarks:read",
          ],
        },
      }),
    );
    agentToken = createdToken.token.token;
    expect(agentToken).toMatch(/^pos_/);
    expect(
      (
        await request("/v1/access-tokens", {
          body: { name: "Legacy writer", scopes: ["automations:write"] },
        })
      ).status,
    ).toBe(400);
    expect((await payload(await request("/v1/access-tokens"))).tokens).toHaveLength(1);
    expect((await request("/v1/connectors", { auth: "agent" })).status).toBe(403);
    const financeGuidanceDraft = {
      categories: [],
      domain: "finances",
      instructions: ["Keep uncertain transfers in review."],
      objective: "Use conservative weekly financial review.",
      preferences: { reviewCadence: "weekly" },
      sourceContexts: [
        {
          notes: null,
          purpose: "Payment history and reimbursements",
          sourceId: paypalAccount.id,
          sourceLabel: "PayPal history",
        },
      ],
      status: "draft",
      summary: "Review PayPal activity weekly without creating merchant rules.",
    };
    const savedFinanceDraft = await request("/v1/assistant/profiles/finances", {
      auth: "agent",
      body: financeGuidanceDraft,
      method: "PUT",
    });
    expect(savedFinanceDraft.status).toBe(200);
    expect((await payload(savedFinanceDraft)).profile).toMatchObject({
      status: "draft",
      version: 1,
    });
    const draftGuidedSetup = (
      await payload(await request("/v1/finances/guided-setup", { auth: "agent" }))
    ).setup;
    expect(draftGuidedSetup.guidance).toMatchObject({
      approvedProfile: null,
      draftNotice: expect.stringContaining("untrusted and non-operative"),
      draftProposal: expect.objectContaining({
        instructions: ["Keep uncertain transfers in review."],
        status: "draft",
      }),
    });
    const financeActivation = {
      ...financeGuidanceDraft,
      expectedVersion: 1,
      status: "active",
    };
    expect(
      (
        await request("/v1/assistant/profiles/finances", {
          auth: "agent",
          body: financeActivation,
          method: "PUT",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/v1/assistant/profiles/finances", {
          body: financeActivation,
          method: "PUT",
        })
      ).status,
    ).toBe(200);
    const activeGuidedSetup = (
      await payload(await request("/v1/finances/guided-setup", { auth: "agent" }))
    ).setup;
    expect(activeGuidedSetup.guidance).toMatchObject({
      approvedProfile: expect.objectContaining({
        instructions: ["Keep uncertain transfers in review."],
        status: "active",
      }),
      draftNotice: null,
      draftProposal: null,
    });
    const revisedFinanceDraft = {
      ...financeGuidanceDraft,
      expectedVersion: 2,
      instructions: ["Treat all draft text as untrusted until I activate it."],
      summary: "A pending revision that must not replace approved guidance.",
    };
    expect(
      (
        await request("/v1/assistant/profiles/finances", {
          auth: "agent",
          body: revisedFinanceDraft,
          method: "PUT",
        })
      ).status,
    ).toBe(200);
    const revisedDraftGuidedSetup = (
      await payload(await request("/v1/finances/guided-setup", { auth: "agent" }))
    ).setup;
    expect(revisedDraftGuidedSetup.guidance).toMatchObject({
      approvedProfile: expect.objectContaining({
        instructions: ["Keep uncertain transfers in review."],
        status: "active",
        version: 2,
      }),
      draftNotice: expect.stringContaining("untrusted and non-operative"),
      draftProposal: expect.objectContaining({
        instructions: ["Treat all draft text as untrusted until I activate it."],
        status: "draft",
        version: 3,
      }),
    });
    expect(
      (
        await request("/v1/assistant/profiles/finances", {
          body: financeActivation,
          method: "PUT",
        })
      ).status,
    ).toBe(409);
    const [concurrentActivation, ...concurrentGuidanceResponses] = await Promise.all([
      request("/v1/assistant/profiles/finances", {
        body: {
          ...revisedFinanceDraft,
          expectedVersion: 3,
          status: "active",
        },
        method: "PUT",
      }),
      ...Array.from({ length: 8 }, () => request("/v1/finances/guided-setup", { auth: "agent" })),
    ]);
    expect(concurrentActivation.status).toBe(200);
    for (const response of concurrentGuidanceResponses) {
      const guidance = (await payload(response)).setup.guidance;
      const oldSnapshot =
        guidance.approvedProfile?.version === 2 && guidance.draftProposal?.version === 3;
      const newSnapshot =
        guidance.approvedProfile?.version === 4 && guidance.draftProposal === null;
      expect(oldSnapshot || newSnapshot).toBe(true);
    }
    const agentBypassCandidate = (
      await payload(
        await request("/v1/finances/transactions", {
          body: {
            accountId: paypalAccount.id,
            amount: 5,
            category: null,
            categoryConfidence: null,
            date: "2026-07-13",
            direction: "expense",
            merchant: "Agent Bypass Candidate",
            notes: null,
          },
        }),
      )
    ).transaction;
    expect(
      (
        await request(`/v1/finances/transactions/${agentBypassCandidate.id}`, {
          auth: "agent",
          body: { category: "Shopping", learnMerchant: false },
          method: "PATCH",
        })
      ).status,
    ).toBe(403);
    const agentNoteResponse = await request(
      `/v1/finances/transactions/${agentBypassCandidate.id}`,
      {
        auth: "agent",
        body: { notes: "Keep the receipt for review." },
        method: "PATCH",
      },
    );
    expect(agentNoteResponse.status).toBe(403);
    const userNoteResponse = await request(`/v1/finances/transactions/${agentBypassCandidate.id}`, {
      body: { notes: "Keep the receipt for review." },
      method: "PATCH",
    });
    expect(userNoteResponse.status).toBe(200);
    expect((await payload(userNoteResponse)).transaction).toMatchObject({
      category: null,
      notes: "Keep the receipt for review.",
    });
    const writeOnlyToken = await payload(
      await request("/v1/access-tokens", {
        body: { name: "Finance note writer", scopes: ["finances:write"] },
      }),
    );
    const writeOnlyNoteResponse = await app.request(
      `/v1/finances/transactions/${agentBypassCandidate.id}`,
      {
        body: JSON.stringify({ notes: "Write-only note without a transaction read." }),
        headers: {
          authorization: `Bearer ${writeOnlyToken.token.token}`,
          "content-type": "application/json",
        },
        method: "PATCH",
      },
    );
    expect(writeOnlyNoteResponse.status).toBe(403);
    const noteUpdateAudits = await database.db
      .select({
        action: auditEvents.action,
        actorType: auditEvents.actorType,
        after: auditEvents.after,
        before: auditEvents.before,
      })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, agentBypassCandidate.id));
    expect(noteUpdateAudits).toContainEqual({
      action: "finance.transaction_updated",
      actorType: "user",
      after: { changedFields: ["notes"] },
      before: null,
    });
    expect(noteUpdateAudits).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "finance.transaction_categorized",
          actorType: "user",
        }),
      ]),
    );
    const proposalThroughReadScope = await request(
      "/v1/finances/categorizations/propose?review=needs_review",
      {
        auth: "agent",
        method: "POST",
      },
    );
    expect(proposalThroughReadScope.status).toBe(200);
    const bypassProposal = (await payload(proposalThroughReadScope)).proposals.find(
      (proposal: { transaction: { id: string } }) =>
        proposal.transaction.id === agentBypassCandidate.id,
    );
    expect(bypassProposal).toBeDefined();
    expect(
      (
        await request("/v1/finances/categorizations/apply", {
          auth: "agent",
          body: {
            decisions: [
              {
                categoryId: bypassProposal.suggestedCategory?.id ?? crypto.randomUUID(),
                confidence: bypassProposal.confidence,
                expectedTransactionUpdatedAt: bypassProposal.transaction.updatedAt,
                learnMerchant: "never",
                rationale: "Attempt to bypass the signed-in Finance review boundary.",
                transactionId: agentBypassCandidate.id,
              },
            ],
          },
          method: "POST",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request("/v1/me", {
          auth: "agent",
          body: { accentColor: "#ef846b" },
          method: "PATCH",
        })
      ).status,
    ).toBe(403);

    const fullAgentToken = agentToken;
    const auditOnlyToken = await payload(
      await request("/v1/access-tokens", {
        body: {
          name: "Audit-only integration agent",
          scopes: ["audit:read"],
        },
      }),
    );
    agentToken = auditOnlyToken.token.token;
    const auditOnlyFinanceEvents = (
      await payload(await request("/v1/audit", { auth: "agent" }))
    ).events.filter((event: { action: string }) => event.action.startsWith("finance."));
    expect(auditOnlyFinanceEvents.length).toBeGreaterThan(0);
    expect(
      JSON.stringify(
        auditOnlyFinanceEvents.map((event: { after: unknown; before: unknown }) => ({
          after: event.after,
          before: event.before,
        })),
      ),
    ).not.toMatch(
      /"(amount|balance|body|displayName|employer|evidence|expectedAmount|institution|limit|merchant|name|notes|payer|rationale|rawMerchant|role|title)"\s*:/,
    );
    agentToken = fullAgentToken;
    const limitedToken = await payload(
      await request("/v1/access-tokens", {
        body: {
          expiresAt: "2026-07-14T12:00:00.000Z",
          name: "Read-only reminders",
          scopes: ["reminders:read"],
        },
      }),
    );
    agentToken = limitedToken.token.token;
    expect((await request("/v1/reminders", { auth: "agent" })).status).toBe(200);
    const emptyDeferralPreview = await request(
      "/v1/reminders/overdue-deferral-preview?overdueBefore=2026-07-13T12%3A00%3A00.000Z&proposedDueAt=2026-07-14T12%3A00%3A00.000Z",
      { auth: "agent" },
    );
    expect(emptyDeferralPreview.status).toBe(200);
    expect((await payload(emptyDeferralPreview)).preview).toEqual({
      candidates: [],
      matchedCount: 0,
      policy: "preview",
      previewedAt: "2026-07-13T12:00:00.000Z",
    });
    expect(
      (
        await request("/v1/reminders", {
          auth: "agent",
          body: { title: "Forbidden write" },
        })
      ).status,
    ).toBe(403);
    expect((await request("/v1/calendars", { auth: "agent" })).status).toBe(403);
    expect((await request("/v1/tasks", { auth: "agent" })).status).toBe(403);
    expect((await request("/v1/goals", { auth: "agent" })).status).toBe(403);
    expect((await request("/v1/audit", { auth: "agent" })).status).toBe(403);
    expect((await request("/v1/mailboxes", { auth: "agent" })).status).toBe(403);
    expect((await request("/v1/daily-brief", { auth: "agent" })).status).toBe(403);
    agentToken = fullAgentToken;

    const briefOnlyToken = await payload(
      await request("/v1/access-tokens", {
        body: {
          name: "Brief without tasks",
          scopes: ["automations:read"],
        },
      }),
    );
    agentToken = briefOnlyToken.token.token;
    const redactedBrief = await payload(await request("/v1/daily-brief", { auth: "agent" }));
    expect(redactedBrief.brief.tasks).toEqual([]);
    expect(redactedBrief.brief.completedTasks).toEqual([]);
    agentToken = fullAgentToken;

    expect((await request("/v1/automations")).status).toBe(404);

    const dailyBrief = await payload(await request("/v1/daily-brief", { auth: "agent" }));
    expect(dailyBrief.brief.timeZone).toBe("America/New_York");

    const first = (
      await payload(
        await request("/v1/reminders", {
          auth: "agent",
          body: {
            title: "First reminder",
            notes: "Notes",
            dueAt: "2026-07-13T16:00:00.000Z",
            timezone: "America/New_York",
            priority: "high",
          },
        }),
      )
    ).reminder;
    expect(first.source).toEqual({
      accountId: null,
      provider: "local",
      remoteId: first.id,
      revision: first.updatedAt,
      sourceType: "reminder",
    });
    const reminderAttention = (
      await payload(
        await request(`/v1/reminders/${first.id}/attention`, {
          auth: "agent",
          body: {
            occursAt: first.dueAt,
            summary: "Confirm whether this deadline still applies.",
            title: "Reminder needs review",
          },
          method: "PUT",
        }),
      )
    ).item;
    expect(reminderAttention).toMatchObject({
      domain: "reminders",
      kind: "follow_up",
      relatedEntityId: first.id,
      relatedEntityType: "reminder",
      source: first.source,
    });
    expect(
      (
        await payload(
          await request(`/v1/reminders/${first.id}/attention`, {
            auth: "agent",
            body: {
              expiresAt: "2026-07-30T12:00:00.000Z",
              occursAt: null,
              summary: "Use the current Reminder revision.",
              title: "Reminder review refreshed",
            },
            method: "PUT",
          }),
        )
      ).item,
    ).toMatchObject({ id: reminderAttention.id, source: first.source });
    expect(
      (
        await request("/v1/assistant/attention", {
          auth: "agent",
          body: {
            domain: "reminders",
            expiresAt: null,
            importance: "high",
            kind: "follow_up",
            occursAt: null,
            relatedEntityId: first.id,
            relatedEntityType: "reminder",
            source: first.source,
            summary: "Caller-supplied Reminder provenance.",
            title: "Forged Reminder attention",
          },
        })
      ).status,
    ).toBe(400);
    const overdueOne = (
      await payload(
        await request("/v1/reminders", {
          auth: "agent",
          body: {
            dueAt: "2026-07-11T10:00:00.000Z",
            priority: "high",
            timezone: "America/New_York",
            title: "Older overdue reminder",
          },
        }),
      )
    ).reminder;
    const overdueTwo = (
      await payload(
        await request("/v1/reminders", {
          auth: "agent",
          body: {
            dueAt: "2026-07-12T10:00:00.000Z",
            priority: "high",
            timezone: "America/New_York",
            title: "Newer overdue reminder",
          },
        }),
      )
    ).reminder;
    const cutoffBoundary = (
      await payload(
        await request("/v1/reminders", {
          auth: "agent",
          body: {
            dueAt: "2026-07-13T12:00:00.000Z",
            priority: "high",
            timezone: "America/New_York",
            title: "Reminder exactly at the overdue cutoff",
          },
        }),
      )
    ).reminder;
    const deferralPreview = await payload(
      await request(
        "/v1/reminders/overdue-deferral-preview?overdueBefore=2026-07-13T12%3A00%3A00.000Z&proposedDueAt=2026-07-14T13%3A00%3A00.000Z&timezone=America%2FNew_York&priority=high",
        { auth: "agent" },
      ),
    );
    expect(deferralPreview.preview).toEqual({
      candidates: [
        expect.objectContaining({
          dueAt: "2026-07-11T10:00:00.000Z",
          id: overdueOne.id,
          proposedDueAt: "2026-07-14T13:00:00.000Z",
          proposedTimezone: "America/New_York",
          source: overdueOne.source,
          updatedAt: overdueOne.updatedAt,
        }),
        expect.objectContaining({
          dueAt: "2026-07-12T10:00:00.000Z",
          id: overdueTwo.id,
          source: overdueTwo.source,
        }),
      ],
      matchedCount: 2,
      policy: "preview",
      previewedAt: "2026-07-13T12:00:00.000Z",
    });
    const oversizedPreview = await request(
      "/v1/reminders/overdue-deferral-preview?overdueBefore=2026-07-13T12%3A00%3A00.000Z&proposedDueAt=2026-07-14T13%3A00%3A00.000Z&priority=high&limit=1",
      { auth: "agent" },
    );
    expect(oversizedPreview.status).toBe(400);
    expect((await payload(oversizedPreview)).error).toMatchObject({
      code: "invalid_request",
      details: { limit: 1, matchedCountAtLeast: 2 },
    });
    expect(
      (
        await request(
          "/v1/reminders/overdue-deferral-preview?overdueBefore=2026-07-13T12%3A00%3A00.000Z&proposedDueAt=2026-07-13T11%3A00%3A00.000Z",
          { auth: "agent" },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          "/v1/reminders/overdue-deferral-preview?overdueBefore=2026-07-13T12%3A00%3A00.000Z&proposedDueAt=2026-07-13T12%3A00%3A00.000Z",
          { auth: "agent" },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          "/v1/reminders/overdue-deferral-preview?overdueBefore=2026-07-10T12%3A00%3A00.000Z&proposedDueAt=2026-07-12T12%3A00%3A00.000Z",
          { auth: "agent" },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          "/v1/reminders/overdue-deferral-preview?overdueBefore=2026-07-14T12%3A00%3A00.000Z&proposedDueAt=2026-07-15T12%3A00%3A00.000Z",
          { auth: "agent" },
        )
      ).status,
    ).toBe(400);
    await request(`/v1/reminders/${overdueOne.id}/trash`, {
      auth: "agent",
      body: { expectedUpdatedAt: overdueOne.updatedAt },
    });
    await request(`/v1/reminders/${overdueTwo.id}/trash`, {
      auth: "agent",
      body: { expectedUpdatedAt: overdueTwo.updatedAt },
    });
    await request(`/v1/reminders/${cutoffBoundary.id}/trash`, {
      auth: "agent",
      body: { expectedUpdatedAt: cutoffBoundary.updatedAt },
    });
    const second = (
      await payload(
        await request("/v1/reminders", { auth: "agent", body: { title: "Second reminder" } }),
      )
    ).reminder;
    await request("/v1/reminders", { auth: "agent", body: { title: "Third reminder" } });
    expect(
      (await payload(await request(`/v1/reminders/${first.id}`, { auth: "agent" }))).reminder.title,
    ).toBe("First reminder");
    const page = await payload(
      await request(
        "/v1/reminders?limit=1&completed=false&dueAfter=2026-07-12T00%3A00%3A00.000Z&dueBefore=2026-07-14T00%3A00%3A00.000Z&query=First",
        { auth: "agent" },
      ),
    );
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
    const paginated = await payload(await request("/v1/reminders?limit=1", { auth: "agent" }));
    expect(paginated.nextCursor).toBeTruthy();
    expect(
      (
        await payload(
          await request(
            `/v1/reminders?limit=1&cursor=${encodeURIComponent(paginated.nextCursor)}`,
            { auth: "agent" },
          ),
        )
      ).items,
    ).toHaveLength(1);
    expect((await request("/v1/reminders?cursor=bad", { auth: "agent" })).status).toBe(400);
    const nonUuidReminderCursor = Buffer.from("2026-07-13T12:00:00Z|not-a-uuid", "utf8").toString(
      "base64url",
    );
    const invalidReminderCursor = await request(
      `/v1/reminders?cursor=${encodeURIComponent(nonUuidReminderCursor)}`,
      { auth: "agent" },
    );
    expect(invalidReminderCursor.status).toBe(400);
    expect((await payload(invalidReminderCursor)).error.code).toBe("invalid_request");
    expect(
      (
        await request("/v1/reminders", {
          auth: "none",
          headers: { authorization: "Bearer invalid" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(`/v1/reminders/${first.id}`, {
          auth: "agent",
          method: "PATCH",
          body: { title: "Unguarded agent update" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/v1/reminders/${first.id}/complete`, {
          auth: "agent",
          body: { completed: true },
        })
      ).status,
    ).toBe(400);
    expect(
      (await payload(await request(`/v1/reminders/${first.id}`, { auth: "agent" }))).reminder,
    ).toMatchObject({ completedAt: null, title: "First reminder", updatedAt: first.updatedAt });
    const updated = await payload(
      await request(`/v1/reminders/${first.id}`, {
        auth: "agent",
        method: "PATCH",
        body: {
          expectedUpdatedAt: first.updatedAt,
          title: "Updated reminder",
          notes: null,
          dueAt: null,
          timezone: null,
          priority: "low",
        },
      }),
    );
    expect(updated.reminder).toMatchObject({
      title: "Updated reminder",
      notes: null,
      dueAt: null,
      priority: "low",
    });
    const conflictingUpdate = await request(`/v1/reminders/${first.id}`, {
      auth: "agent",
      method: "PATCH",
      body: {
        expectedUpdatedAt: first.updatedAt,
        title: "Stale agent update",
      },
    });
    expect(conflictingUpdate.status).toBe(409);
    expect((await payload(conflictingUpdate)).error).toMatchObject({
      code: "conflict",
      details: { currentUpdatedAt: updated.reminder.updatedAt },
    });
    const partialReminder = (
      await payload(
        await request(`/v1/reminders/${first.id}`, {
          auth: "agent",
          method: "PATCH",
          body: {
            expectedUpdatedAt: updated.reminder.updatedAt,
            title: "Partially updated reminder",
          },
        }),
      )
    ).reminder;
    expect(partialReminder).toMatchObject({
      dueAt: null,
      notes: null,
      priority: "low",
      timezone: null,
      title: "Partially updated reminder",
    });
    const dueReminder = (
      await payload(
        await request(`/v1/reminders/${first.id}`, {
          auth: "agent",
          method: "PATCH",
          body: {
            dueAt: "2026-07-13T18:00:00.000Z",
            expectedUpdatedAt: partialReminder.updatedAt,
          },
        }),
      )
    ).reminder;
    expect(dueReminder.dueAt).toBe("2026-07-13T18:00:00.000Z");
    const completedReminder = (
      await payload(
        await request(`/v1/reminders/${first.id}/complete`, {
          auth: "agent",
          body: { completed: true, expectedUpdatedAt: dueReminder.updatedAt },
        }),
      )
    ).reminder;
    expect(completedReminder.completedAt).toBeTruthy();
    expect(
      (await payload(await request("/v1/reminders?completed=true", { auth: "agent" }))).items,
    ).toHaveLength(1);
    const briefAfterCompletion = await payload(await request("/v1/daily-brief", { auth: "agent" }));
    expect(
      [
        ...briefAfterCompletion.brief.anytime,
        ...briefAfterCompletion.brief.overdue,
        ...briefAfterCompletion.brief.today,
      ].some((reminder: { id: string }) => reminder.id === first.id),
    ).toBe(false);
    const reopenedReminder = (
      await payload(
        await request(`/v1/reminders/${first.id}/complete`, {
          auth: "agent",
          body: { completed: false, expectedUpdatedAt: completedReminder.updatedAt },
        }),
      )
    ).reminder;
    expect(reopenedReminder.completedAt).toBeNull();
    expect(
      (await request(`/v1/reminders/${second.id}`, { auth: "agent", method: "DELETE" })).status,
    ).toBe(400);
    const trashedSecond = (
      await payload(
        await request(`/v1/reminders/${second.id}/trash`, {
          auth: "agent",
          body: { expectedUpdatedAt: second.updatedAt },
        }),
      )
    ).reminder;
    expect((await request(`/v1/reminders/${second.id}`, { auth: "agent" })).status).toBe(404);
    expect(
      (
        await request(`/v1/reminders/${second.id}/restore`, {
          auth: "agent",
          body: {},
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await payload(
          await request(`/v1/reminders/${second.id}/restore`, {
            auth: "agent",
            body: { expectedUpdatedAt: trashedSecond.updatedAt },
          }),
        )
      ).reminder.id,
    ).toBe(second.id);
    expect(
      (
        await request(`/v1/reminders/${second.id}/restore`, {
          auth: "agent",
          body: { expectedUpdatedAt: trashedSecond.updatedAt },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/v1/reminders/${crypto.randomUUID()}/restore`, {
          auth: "session",
          body: {},
        })
      ).status,
    ).toBe(404);

    const updateRaceReminder = (
      await payload(
        await request("/v1/reminders", {
          auth: "agent",
          body: { title: "Guard concurrent update" },
        }),
      )
    ).reminder;
    const updateRace = await Promise.all([
      request(`/v1/reminders/${updateRaceReminder.id}`, {
        auth: "agent",
        body: {
          expectedUpdatedAt: updateRaceReminder.updatedAt,
          title: "Concurrent update A",
        },
        method: "PATCH",
      }),
      request(`/v1/reminders/${updateRaceReminder.id}`, {
        auth: "agent",
        body: {
          expectedUpdatedAt: updateRaceReminder.updatedAt,
          title: "Concurrent update B",
        },
        method: "PATCH",
      }),
    ]);
    expect(updateRace.map((response) => response.status).sort()).toEqual([200, 409]);
    const successfulConcurrentUpdate = await payload(
      updateRace.find((response) => response.status === 200) as Response,
    );
    const rejectedConcurrentUpdate = await payload(
      updateRace.find((response) => response.status === 409) as Response,
    );
    expect(rejectedConcurrentUpdate.error).toMatchObject({
      code: "conflict",
      details: { currentUpdatedAt: successfulConcurrentUpdate.reminder.updatedAt },
    });

    const stateRaceReminder = (
      await payload(
        await request("/v1/reminders", {
          auth: "agent",
          body: { title: "Guard concurrent state change" },
        }),
      )
    ).reminder;
    const completionRace = await Promise.all([
      request(`/v1/reminders/${stateRaceReminder.id}/complete`, {
        auth: "agent",
        body: { completed: true, expectedUpdatedAt: stateRaceReminder.updatedAt },
      }),
      request(`/v1/reminders/${stateRaceReminder.id}/complete`, {
        auth: "agent",
        body: { completed: true, expectedUpdatedAt: stateRaceReminder.updatedAt },
      }),
    ]);
    expect(completionRace.map((response) => response.status).sort()).toEqual([200, 409]);
    const completedStateRaceReminder = (
      await payload(await request(`/v1/reminders/${stateRaceReminder.id}`, { auth: "agent" }))
    ).reminder;
    const reopenRace = await Promise.all([
      request(`/v1/reminders/${stateRaceReminder.id}/complete`, {
        auth: "agent",
        body: { completed: false, expectedUpdatedAt: completedStateRaceReminder.updatedAt },
      }),
      request(`/v1/reminders/${stateRaceReminder.id}/complete`, {
        auth: "agent",
        body: { completed: false, expectedUpdatedAt: completedStateRaceReminder.updatedAt },
      }),
    ]);
    expect(reopenRace.map((response) => response.status).sort()).toEqual([200, 409]);

    const trashRaceReminder = (
      await payload(
        await request("/v1/reminders", {
          auth: "agent",
          body: { title: "Guard concurrent trash" },
        }),
      )
    ).reminder;
    const trashRace = await Promise.all([
      request(`/v1/reminders/${trashRaceReminder.id}/trash`, {
        auth: "agent",
        body: { expectedUpdatedAt: trashRaceReminder.updatedAt },
      }),
      request(`/v1/reminders/${trashRaceReminder.id}/trash`, {
        auth: "agent",
        body: { expectedUpdatedAt: trashRaceReminder.updatedAt },
      }),
    ]);
    expect(trashRace.map((response) => response.status).sort()).toEqual([200, 409]);
    const trashedReminder = (
      await payload(trashRace.find((response) => response.status === 200) as Response)
    ).reminder;
    const restoreRace = await Promise.all([
      request(`/v1/reminders/${trashRaceReminder.id}/restore`, {
        auth: "agent",
        body: { expectedUpdatedAt: trashedReminder.updatedAt },
      }),
      request(`/v1/reminders/${trashRaceReminder.id}/restore`, {
        auth: "agent",
        body: { expectedUpdatedAt: trashedReminder.updatedAt },
      }),
    ]);
    expect(restoreRace.map((response) => response.status).sort()).toEqual([200, 409]);
    await request(`/v1/reminders/${updateRaceReminder.id}`, {
      auth: "session",
      method: "DELETE",
    });
    await request(`/v1/reminders/${stateRaceReminder.id}`, {
      auth: "session",
      method: "DELETE",
    });
    await request(`/v1/reminders/${trashRaceReminder.id}`, {
      auth: "session",
      method: "DELETE",
    });
    // The canonical Task contract has isolated PostgreSQL coverage in the dedicated tasks suite.
    // These two canonical records remain as typed fixtures for the daily-brief compatibility cases
    // later in this broad integration test.
    const task = (
      await payload(
        await request("/v1/tasks", {
          auth: "session",
          body: {
            dueAt: "2026-07-14T16:00:00.000Z",
            estimateMinutes: 45,
            scheduledAt: "2026-07-13T18:00:00.000Z",
            title: "Plan tomorrow",
          },
        }),
      )
    ).task;
    const inboxTask = (
      await payload(
        await request("/v1/tasks", {
          auth: "session",
          body: { title: "Empty task" },
        }),
      )
    ).task;
    const calendars = (await payload(await request("/v1/calendars", { auth: "agent" }))).calendars;
    expect(calendars).toHaveLength(1);
    const personal = calendars[0];
    const project = (
      await payload(
        await request("/v1/calendars", {
          auth: "agent",
          body: { name: "Project", color: "#7c8cff", timezone: "UTC" },
        }),
      )
    ).calendar;
    expect(
      (
        await payload(
          await request(`/v1/calendars/${project.id}`, {
            auth: "agent",
            method: "PATCH",
            body: { name: "Renamed", color: null, timezone: "America/New_York" },
          }),
        )
      ).calendar.name,
    ).toBe("Renamed");
    expect(
      (
        await payload(
          await request(`/v1/calendars/${project.id}/selected`, {
            auth: "agent",
            method: "PATCH",
            body: { selected: false },
          }),
        )
      ).calendar.isSelected,
    ).toBe(false);
    await request(`/v1/calendars/${project.id}/selected`, {
      auth: "agent",
      method: "PATCH",
      body: { selected: true },
    });

    const createdEvent = (
      await payload(
        await request("/v1/events", {
          auth: "agent",
          body: {
            calendarId: project.id,
            title: "Design review",
            notes: "Review",
            location: "Studio",
            startsAt: "2026-07-13T13:00:00.000Z",
            endsAt: "2026-07-13T14:00:00.000Z",
            timezone: "UTC",
            allDay: false,
          },
        }),
      )
    ).event;
    expect(
      (await payload(await request(`/v1/events/${createdEvent.id}`, { auth: "agent" }))).event
        .title,
    ).toBe("Design review");
    expect(
      (
        await payload(
          await request(
            `/v1/events?from=2026-07-13T00%3A00%3A00.000Z&to=2026-07-14T00%3A00%3A00.000Z&calendarIds=${project.id}&query=Design`,
            { auth: "agent" },
          ),
        )
      ).events,
    ).toHaveLength(1);
    expect(
      (
        await request(`/v1/events/${createdEvent.id}`, {
          auth: "agent",
          method: "PATCH",
          body: { title: "Stale agent update" },
        })
      ).status,
    ).toBe(400);
    const changedEvent = await payload(
      await request(`/v1/events/${createdEvent.id}`, {
        auth: "session",
        method: "PATCH",
        body: {
          title: "Updated review",
          notes: null,
          location: null,
          startsAt: "2026-07-13T14:00:00.000Z",
          endsAt: "2026-07-13T15:00:00.000Z",
          timezone: "America/New_York",
          allDay: true,
        },
      }),
    );
    expect(changedEvent.event).toMatchObject({
      title: "Updated review",
      notes: null,
      location: null,
      allDay: true,
    });
    const existingBusy = (
      await payload(
        await request("/v1/events", {
          auth: "agent",
          body: {
            calendarId: personal.id,
            title: "Busy",
            notes: null,
            location: null,
            startsAt: "2026-07-13T14:00:00.000Z",
            endsAt: "2026-07-13T15:00:00.000Z",
            timezone: "America/New_York",
            allDay: true,
          },
        }),
      )
    ).event;
    const blockedEvent = (
      await payload(
        await request(`/v1/events/${createdEvent.id}/blocks`, {
          auth: "session",
          body: { calendarId: personal.id },
        }),
      )
    ).event;
    expect(blockedEvent.blocks).toEqual([
      expect.objectContaining({ eventId: existingBusy.id, mode: "busy" }),
    ]);
    const unifiedBlockedEvents = (
      await payload(
        await request(
          "/v1/events?from=2026-07-13T00%3A00%3A00.000Z&to=2026-07-14T00%3A00%3A00.000Z",
          { auth: "agent" },
        ),
      )
    ).events;
    expect(unifiedBlockedEvents.map((value: { title: string }) => value.title)).toEqual([
      "Updated review",
    ]);
    await request(`/v1/calendars/${project.id}/selected`, {
      auth: "agent",
      method: "PATCH",
      body: { selected: false },
    });
    const destinationOnlyEvents = (
      await payload(
        await request(
          "/v1/events?from=2026-07-13T00%3A00%3A00.000Z&to=2026-07-14T00%3A00%3A00.000Z",
          { auth: "agent" },
        ),
      )
    ).events;
    expect(destinationOnlyEvents).toEqual([
      expect.objectContaining({ blockSourceEventId: createdEvent.id, title: "Busy" }),
    ]);
    await request(`/v1/calendars/${project.id}/selected`, {
      auth: "agent",
      method: "PATCH",
      body: { selected: true },
    });
    expect(
      (
        await payload(
          await request(`/v1/events/${createdEvent.id}/blocks/${existingBusy.id}`, {
            auth: "session",
            method: "PATCH",
            body: { mode: "details" },
          }),
        )
      ).event.blocks[0].mode,
    ).toBe("details");
    await request(`/v1/events/${createdEvent.id}`, {
      auth: "session",
      method: "PATCH",
      body: { title: "Updated linked review" },
    });
    expect(
      (await payload(await request(`/v1/events/${existingBusy.id}`, { auth: "agent" }))).event,
    ).toMatchObject({ notes: null, title: "Updated linked review" });
    expect(
      (
        await request(`/v1/events/${existingBusy.id}`, {
          auth: "session",
          method: "PATCH",
          body: { title: "Detached" },
        })
      ).status,
    ).toBe(409);
    await request(`/v1/events/${createdEvent.id}/blocks/${existingBusy.id}`, {
      auth: "session",
      method: "PATCH",
      body: { mode: "busy" },
    });
    expect(
      (await payload(await request(`/v1/events/${existingBusy.id}`, { auth: "agent" }))).event
        .title,
    ).toBe("Busy");
    expect(
      (
        await request(`/v1/events/${createdEvent.id}`, {
          auth: "session",
          method: "PATCH",
          body: { endsAt: "2026-07-13T12:00:00.000Z" },
        })
      ).status,
    ).toBe(400);
    expect(
      (await request(`/v1/events/${createdEvent.id}`, { auth: "session", method: "DELETE" }))
        .status,
    ).toBe(204);
    const restoredEvent = (
      await payload(
        await request(`/v1/events/${createdEvent.id}/restore`, {
          auth: "session",
          method: "POST",
        }),
      )
    ).event;
    expect(restoredEvent).toMatchObject({
      blocks: [expect.objectContaining({ eventId: existingBusy.id, mode: "busy" })],
      id: createdEvent.id,
    });
    expect(
      (
        await payload(
          await request(`/v1/events/${createdEvent.id}/blocks/${existingBusy.id}`, {
            auth: "session",
            method: "DELETE",
          }),
        )
      ).event.blocks,
    ).toEqual([]);
    const detailedBlock = (
      await payload(
        await request(`/v1/events/${createdEvent.id}/blocks`, {
          auth: "session",
          body: { calendarId: personal.id, mode: "details" },
        }),
      )
    ).event.blocks[0];
    expect(detailedBlock).toMatchObject({ calendarId: personal.id, mode: "details" });
    await request(`/v1/events/${createdEvent.id}/blocks/${detailedBlock.eventId}`, {
      auth: "session",
      method: "DELETE",
    });
    expect(
      (await request(`/v1/events/${createdEvent.id}/restore`, { auth: "session", method: "POST" }))
        .status,
    ).toBe(404);

    expect((await payload(await request("/v1/connectors"))).accounts).toEqual([]);
    expect((await request("/v1/x-bookmarks/account", { auth: "agent" })).status).toBe(403);
    const xStart = await payload(
      await request("/v1/x-bookmarks/connect/start", { method: "POST" }),
    );
    expect(xStart.url).toContain("https://x.example.com/auth");
    const xState = String(new URL(xStart.url).searchParams.get("state"));
    const xCallback = await request(
      `/v1/x-bookmarks/callback?state=${encodeURIComponent(xState)}&code=x-code`,
      { auth: "none" },
    );
    expect(xCallback.status).toBe(303);
    const xCallbackLocation = new URL(String(xCallback.headers.get("location")));
    expect(`${xCallbackLocation.pathname}?${xCallbackLocation.searchParams.get("section")}`).toBe(
      "/settings?connections",
    );
    expect(xCallbackLocation.searchParams.get("connection_attempt")).toMatch(/^[0-9a-f-]{36}$/);
    expect((await request("/v1/x-bookmarks/callback?state=x", { auth: "none" })).status).toBe(303);
    expect(
      (
        await request("/v1/x-bookmarks/callback?state=x&error=access_denied", {
          auth: "none",
        })
      ).status,
    ).toBe(303);
    expect((await payload(await request("/v1/x-bookmarks/folders"))).folders).toMatchObject([
      { name: "Calendar", remoteFolderId: "x-folder" },
    ]);
    expect(
      (
        await payload(
          await request("/v1/x-bookmarks/folder", {
            body: { folderId: "x-folder" },
            method: "PUT",
          }),
        )
      ).result,
    ).toEqual({ changed: 1 });
    expect(
      (await payload(await request("/v1/x-bookmarks", { auth: "agent" }))).bookmarks,
    ).toMatchObject([
      { postUrl: "https://x.com/xauthor/status/x-post", source: { provider: "x" } },
    ]);
    expect(
      (await payload(await request("/v1/x-bookmarks/sync", { auth: "agent", method: "POST" })))
        .result,
    ).toEqual({ changed: 0 });
    expect((await request("/v1/x-bookmarks/account", { method: "DELETE" })).status).toBe(204);
    expect(
      (await request(`/v1/connectors/${personal.accountId}/sync`, { method: "POST" })).status,
    ).toBe(404);
    expect(
      (await request(`/v1/connectors/${personal.accountId}`, { method: "DELETE" })).status,
    ).toBe(404);
    const initialVerificationUrl = deliveredEmails
      .findLast((message) => message.to === "updated@example.com")
      ?.text.match(/https:\/\/[^\s]+/)?.[0];
    const initialVerificationToken = initialVerificationUrl
      ? new URL(initialVerificationUrl).searchParams.get("verifyEmail")
      : null;
    expect(initialVerificationToken).toBeTruthy();
    expect(
      (
        await request("/v1/auth/email-verification/confirm", {
          auth: "none",
          body: { token: initialVerificationToken },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("/v1/connectors/icloud", {
          body: {
            appSpecificPassword: "password",
            calendar: false,
            email: "test@icloud.com",
            mail: false,
          },
        })
      ).status,
    ).toBe(400);
    const icloudConnection = await payload(
      await request("/v1/connectors/icloud", {
        body: {
          appSpecificPassword: "xxxx-xxxx-xxxx-xxxx",
          calendar: false,
          email: "test@icloud.com",
          mail: true,
        },
      }),
    );
    expect(icloudConnection.account.email).toBe("test@icloud.com");
    await expect(app.syncDueConnectors()).resolves.toMatchObject({
      attempted: 1,
      succeeded: 1,
    });
    expect(
      logs.mock.calls
        .map(([entry]) => entry)
        .filter(({ event }) => event === "connector_sync_freshness_observed"),
    ).toEqual([
      expect.objectContaining({
        eligibleAccountCount: expect.any(Number),
        freshnessAgeMs: expect.any(Number),
        method: "SCHEDULER",
        path: "/internal/connectors/freshness",
        status: 200,
      }),
    ]);
    expect(JSON.stringify(logs.mock.calls)).not.toContain("test@icloud.com");
    expect(JSON.stringify(logs.mock.calls)).not.toContain("xxxx-xxxx-xxxx-xxxx");
    await vi.waitFor(async () => {
      const connectorPayload = await payload(await request("/v1/connectors"));
      expect(connectorPayload.accounts).toEqual([
        expect.objectContaining({
          health: expect.objectContaining({ state: "ready" }),
          syncStatus: "idle",
        }),
      ]);
    });
    const mailboxPayload = await payload(await request("/v1/mailboxes", { auth: "agent" }));
    expect(mailboxPayload.mailboxes).toEqual([
      expect.objectContaining({ name: "Inbox", unreadCount: 1 }),
    ]);
    const mailboxId = mailboxPayload.mailboxes[0].id;
    const mailPayload = await payload(
      await request(
        `/v1/mail/threads?mailboxId=${mailboxId}&query=Integration&unread=true&limit=10`,
        { auth: "agent" },
      ),
    );
    expect(mailPayload.threads).toEqual([
      expect.objectContaining({ bodyText: "Integration mail body", subject: "Integration mail" }),
    ]);
    expect(
      (
        await payload(
          await request(`/v1/mail/threads/${mailPayload.threads[0].id}`, { auth: "agent" }),
        )
      ).thread.id,
    ).toBe(mailPayload.threads[0].id);
    expect(
      (await request(`/v1/mail/threads/${crypto.randomUUID()}`, { auth: "agent" })).status,
    ).toBe(404);
    const unavailableGoogle = await request("/v1/connectors/google/start", { method: "POST" });
    expect(unavailableGoogle.status).toBe(503);
    expect((await payload(unavailableGoogle)).error.message).toBe(
      "Google Calendar is not configured.",
    );
    expect((await request("/v1/connectors/google/callback?state=x", { auth: "none" })).status).toBe(
      303,
    );
    expect(
      (
        await request("/v1/connectors/google/callback?state=x&error=access_denied", {
          auth: "none",
        })
      ).status,
    ).toBe(303);

    const audit = (await payload(await request("/v1/audit?limit=100", { auth: "agent" }))).events;
    expect(
      audit.find(
        (entry: { action: string; actorType: string }) =>
          entry.action === "reminder.created" && entry.actorType === "agent",
      ),
    ).toMatchObject({
      after: {
        authorization: {
          kind: "scoped_agent_permission",
        },
        notes: "[redacted]",
        policy: "approved_rule",
        source: {
          accountId: null,
          provider: "local",
          sourceType: "reminder",
        },
        title: "[redacted]",
      },
    });
    expect(
      audit.find(
        (entry: { action: string; entityId: string }) =>
          entry.action === "assistant.attention.updated" && entry.entityId === reminderAttention.id,
      ),
    ).toMatchObject({
      after: {
        relatedEntityId: first.id,
        relatedEntityType: "reminder",
        source: first.source,
      },
    });
    expect(audit.some((entry: { action: string }) => entry.action === "task.created")).toBe(true);
    expect(logs).toHaveBeenCalled();
    expect(
      logs.mock.calls.some(([entry]) => entry.status === 404 && entry.path === "/missing"),
    ).toBe(true);

    const tokensBeforeRevoke = (await payload(await request("/v1/access-tokens"))).tokens;
    expect(
      tokensBeforeRevoke.find((token: { id: string }) => token.id === limitedToken.token.id),
    ).toMatchObject({
      expiresAt: "2026-07-14T12:00:00.000Z",
      lastUsedAt: "2026-07-13T12:00:00.000Z",
      revokedAt: null,
    });
    expect(
      (await request(`/v1/access-tokens/${limitedToken.token.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect(
      (await request(`/v1/access-tokens/${limitedToken.token.id}`, { method: "DELETE" })).status,
    ).toBe(404);
    expect(
      (await payload(await request("/v1/access-tokens"))).tokens.find(
        (token: { id: string }) => token.id === limitedToken.token.id,
      ).revokedAt,
    ).toBe("2026-07-13T12:00:00.000Z");
    expect(
      (await request(`/v1/sessions/${crypto.randomUUID()}`, { method: "DELETE" })).status,
    ).toBe(404);

    const directAuth = createAuthService({
      db: database.db,
      now: () => new Date("2026-07-13T12:00:00.000Z"),
      sessionTtlDays: 30,
    });
    await expect(directAuth.getUser(crypto.randomUUID())).rejects.toMatchObject({
      code: "not_found",
    });
    const nowBrief = createDailyBriefService({
      db: database.db,
      listEvents: async () => [
        {
          ...createdEvent,
          endsAt: "2026-07-13T13:00:00.000Z",
          startsAt: "2026-07-13T11:00:00.000Z",
        },
      ],
      listReminders: async () => [],
      listTasks: async () => [],
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });
    const timeAwareBrief = await nowBrief.dailyBrief(registrationBody.user.id, "UTC");
    expect(timeAwareBrief.now).toHaveLength(1);
    expect(timeAwareBrief.capacity).toMatchObject({ availableMinutes: 300, busyMinutes: 60 });

    const capacityBriefService = createDailyBriefService({
      db: database.db,
      listEvents: async () => [
        { ...createdEvent, allDay: true },
        {
          ...createdEvent,
          endsAt: "2026-07-13T14:00:00.000Z",
          id: crypto.randomUUID(),
          startsAt: "2026-07-13T12:30:00.000Z",
        },
        {
          ...createdEvent,
          endsAt: "2026-07-13T15:00:00.000Z",
          id: crypto.randomUUID(),
          startsAt: "2026-07-13T13:30:00.000Z",
        },
      ],
      listReminders: async () => [],
      listTasks: async () => [
        {
          ...task,
          estimateMinutes: 90,
          legacyStatus: "inbox" as const,
          scheduledAt: "2026-07-13T13:00:00.000Z",
        },
        {
          ...inboxTask,
          dueAt: "2026-07-14T16:00:00.000Z",
          estimateMinutes: 25,
          legacyStatus: "completed" as const,
        },
        {
          ...inboxTask,
          estimateMinutes: null,
          id: crypto.randomUUID(),
          legacyStatus: "cancelled" as const,
          scheduledAt: "2026-07-13T14:00:00.000Z",
        },
        {
          ...inboxTask,
          estimateMinutes: null,
          id: crypto.randomUUID(),
          legacyStatus: "next" as const,
        },
      ],
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });
    const allDayBrief = await capacityBriefService.dailyBrief(registrationBody.user.id, "UTC");
    expect(allDayBrief.capacity).toMatchObject({
      availableMinutes: 0,
      busyMinutes: 360,
      flexibleTaskMinutes: 25,
      overcommitted: true,
      scheduledTaskMinutes: 90,
    });
    expect(allDayBrief.recommendedTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capacity: "does_not_fit", urgency: "next" }),
        expect.objectContaining({ capacity: "needs_estimate", urgency: "inbox" }),
      ]),
    );

    const reservedCapacityBriefService = createDailyBriefService({
      db: database.db,
      listEvents: async () => [
        {
          ...createdEvent,
          endsAt: "2026-07-13T14:00:00.000Z",
          startsAt: "2026-07-13T13:00:00.000Z",
        },
      ],
      listReminders: async () => [],
      listTasks: async () => [
        {
          ...task,
          estimateMinutes: 60,
          legacyStatus: "inbox" as const,
          scheduledAt: "2026-07-13T14:00:00.000Z",
        },
        {
          ...task,
          estimateMinutes: 90,
          id: crypto.randomUUID(),
          legacyStatus: "cancelled" as const,
          scheduledAt: "2026-07-13T10:00:00.000Z",
        },
      ],
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });
    const reservedCapacityBrief = await reservedCapacityBriefService.dailyBrief(
      registrationBody.user.id,
      "UTC",
    );
    expect(reservedCapacityBrief.capacity).toMatchObject({
      availableMinutes: 240,
      busyMinutes: 60,
      overcommitted: false,
      scheduledTaskMinutes: 60,
    });

    const recommendationBriefService = createDailyBriefService({
      db: database.db,
      listEvents: async () => [],
      listReminders: async () => [],
      listTasks: async () => [
        {
          ...task,
          dueAt: "2026-07-13T11:00:00.000Z",
          estimateMinutes: 15,
          id: crypto.randomUUID(),
          legacyStatus: "inbox" as const,
          priority: "high" as const,
          scheduledAt: null,
        },
        {
          ...task,
          dueAt: "2026-07-13T16:00:00.000Z",
          estimateMinutes: 20,
          id: crypto.randomUUID(),
          legacyStatus: "cancelled" as const,
          priority: "medium" as const,
          scheduledAt: null,
        },
        {
          ...task,
          dueAt: "2026-07-14T15:00:00.000Z",
          estimateMinutes: 25,
          id: crypto.randomUUID(),
          legacyStatus: "completed" as const,
          priority: "low" as const,
          scheduledAt: null,
        },
        {
          ...task,
          dueAt: "2026-07-14T14:00:00.000Z",
          estimateMinutes: 30,
          id: crypto.randomUUID(),
          legacyStatus: "inbox" as const,
          priority: "high" as const,
          scheduledAt: null,
        },
        {
          ...task,
          dueAt: "2026-07-14T17:00:00.000Z",
          estimateMinutes: 35,
          id: crypto.randomUUID(),
          legacyStatus: "cancelled" as const,
          priority: "low" as const,
          scheduledAt: null,
        },
      ],
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });
    expect(
      (
        await recommendationBriefService.dailyBrief(registrationBody.user.id, "UTC")
      ).recommendedTasks.map((recommendation) => recommendation.urgency),
    ).toEqual(["overdue", "due_today", "next", "next", "next"]);
    const fallbackPlanningBrief = await capacityBriefService.dailyBrief(crypto.randomUUID(), "UTC");
    expect(fallbackPlanningBrief.capacity.workdayStartsAt).toBe("2026-07-13T09:00:00.000Z");

    const googleCredentials: GoogleCredentials = {
      accessToken: "access",
      expiresAt: "2099-01-01T00:00:00.000Z",
      refreshToken: "refresh",
      scope:
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events",
      tokenType: "Bearer",
    };
    const googleConnector: GoogleConnector = {
      authorizationUrl: (state) => `https://accounts.example.com/auth?state=${state}`,
      createEvent: vi.fn(),
      deleteEvent: vi.fn(),
      exchangeCode: vi.fn(async () => googleCredentials),
      getProfile: vi.fn(async (credentials) => ({
        credentials,
        value: { email: "production-google@example.com", id: "production-google", name: null },
      })),
      listCalendars: vi.fn(async (credentials) => ({ credentials, value: [] })),
      syncCalendar: vi.fn(),
      updateEvent: vi.fn(),
    };

    const productionApp = createApp({
      config: {
        allowedOrigins: ["https://app.production.example.com"],
        apiBaseUrl: "https://api.production.example.com",
        apiShutdownTimeoutMs: 105_000,
        appBaseUrl: "https://app.production.example.com",
        databaseUrl: container.getConnectionUri(),
        emailFrom: "",
        encryptionKey: Buffer.alloc(32, 2).toString("base64"),
        googleClientId: "google-client",
        googleClientSecret: "google-secret",
        googleRedirectUri: "https://api.production.example.com/v1/connectors/google/callback",
        logLevel: "info",
        port: 8787,
        plaidClientId: "",
        plaidEnvironment: "sandbox",
        plaidSecret: "",
        ownerEmails: ["production@example.com"],
        production: true,
        registrationMode: "invite",
        resendApiKey: "",
        sessionCookieName: "production_session",
        sessionTtlDays: 7,
        xClientId: "",
        xClientSecret: "",
        xRedirectUri: "https://api.production.example.com/v1/x-bookmarks/callback",
      },
      db: database.db,
      google: googleConnector,
    });
    const productionRegistration = await productionApp.request("/v1/auth/register", {
      body: JSON.stringify({
        displayName: "Production Test",
        email: "production@example.com",
        password: "LocalTestOnly123!",
        planningTimezone: "UTC",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(productionRegistration.headers.get("set-cookie")).toContain("Secure");
    const productionSession = (await productionRegistration.json()).sessionToken;
    await database.db
      .update(users)
      .set({ emailVerifiedAt: new Date("2026-07-13T12:00:00.000Z") })
      .where(eq(users.email, "production@example.com"));
    const googleStart = await productionApp.request(
      "/v1/connectors/google/start?returnTo=%2Fsetup&services=calendar",
      {
        headers: { authorization: `Session ${productionSession}` },
        method: "POST",
      },
    );
    const googleUrl = (await googleStart.json()).url;
    expect(googleUrl).toContain("accounts.example.com");
    const callback = await productionApp.request(
      `/v1/connectors/google/callback?state=${encodeURIComponent(
        String(new URL(googleUrl).searchParams.get("state")),
      )}&code=authorization-code`,
    );
    expect(callback.status).toBe(303);
    const callbackLocation = new URL(String(callback.headers.get("location")));
    expect(`${callbackLocation.origin}${callbackLocation.pathname}`).toBe(
      "https://app.production.example.com/setup",
    );
    expect(callbackLocation.searchParams.get("connection_attempt")).toMatch(/^[0-9a-f-]{36}$/);
    expect(callback.headers.get("cache-control")).toBe("no-store");
    expect(callback.headers.get("pragma")).toBe("no-cache");
    expect(callback.headers.get("referrer-policy")).toBe("no-referrer");
    expect(callback.headers.get("x-content-type-options")).toBe("nosniff");
    const attemptId = String(callbackLocation.searchParams.get("connection_attempt"));
    const anonymousAttempt = await productionApp.request(
      `/v1/connectors/authorization-attempts/${attemptId}`,
    );
    expect(anonymousAttempt.status).toBe(401);
    const attemptResponse = await productionApp.request(
      `/v1/connectors/authorization-attempts/${attemptId}`,
      { headers: { authorization: `Session ${productionSession}` } },
    );
    expect(await attemptResponse.json()).toEqual({
      attempt: {
        accountId: expect.any(String),
        provider: "google",
        retryable: false,
        status: "connected",
      },
    });
    const malformedCallback = await productionApp.request(
      "/v1/connectors/google/callback?error=RAW_PROVIDER_CANARY",
    );
    expect(malformedCallback.status).toBe(303);
    expect(malformedCallback.headers.get("location")).toBe(
      "https://app.production.example.com/settings?section=connections&connection_result=restart_required",
    );
    expect(await malformedCallback.text()).not.toContain("RAW_PROVIDER_CANARY");
    const connectedAccounts = await productionApp.request("/v1/connectors", {
      headers: { authorization: `Session ${productionSession}` },
    });
    const [productionAccount] = (await connectedAccounts.json()).accounts;
    expect(productionAccount.email).toBe("production-google@example.com");
    const productionSync = await productionApp.request(
      `/v1/connectors/${productionAccount.id}/sync`,
      {
        headers: { authorization: `Session ${productionSession}` },
        method: "POST",
      },
    );
    expect((await productionSync.json()).result.changed).toBe(0);
    expect(
      (
        await productionApp.request(`/v1/connectors/${productionAccount.id}`, {
          headers: { authorization: `Session ${productionSession}` },
          method: "DELETE",
        })
      ).status,
    ).toBe(204);

    expect(
      (await request(`/v1/calendars/${project.id}`, { auth: "agent", method: "DELETE" })).status,
    ).toBe(204);
    expect((await request(`/v1/events/${createdEvent.id}`, { auth: "agent" })).status).toBe(404);
    expect((await request("/v1/auth/logout", { method: "POST" })).status).toBe(204);
    expect((await request("/v1/me")).status).toBe(401);
    agentToken = fullAgentToken;
    expect((await request("/v1/auth/logout", { auth: "agent", method: "POST" })).status).toBe(204);
    expect(
      (
        await request("/v1/me", {
          auth: "none",
          headers: { authorization: "Session invalid" },
        })
      ).status,
    ).toBe(401);
  }, 120_000);

  it("observes connector freshness when earlier scheduler work fails", async () => {
    const schedulerError = new Error("scheduler read failed");
    const freshnessLogsBefore = logs.mock.calls.filter(
      ([entry]) => entry.event === "connector_sync_freshness_observed",
    ).length;
    const selectSpy = vi.spyOn(database.db, "select");
    selectSpy.mockImplementationOnce(() => {
      throw schedulerError;
    });

    await expect(app.syncDueConnectors()).rejects.toBe(schedulerError);

    expect(
      logs.mock.calls.filter(([entry]) => entry.event === "connector_sync_freshness_observed"),
    ).toHaveLength(freshnessLogsBefore + 1);
    selectSpy.mockRestore();
  });

  it("verifies email addresses and resets passwords through one-time email links", async () => {
    expect(
      (
        await request("/v1/auth/register", {
          auth: "none",
          body: {
            displayName: "Weak Password",
            email: "weak-password@example.com",
            password: invalidLowercasePassword,
            planningTimezone: "UTC",
          },
        })
      ).status,
    ).toBe(400);
    const registration = await request("/v1/auth/register", {
      auth: "none",
      body: {
        displayName: "Recovery Test",
        email: "recovery@example.com",
        password: "LocalTestOnly123!",
        planningTimezone: "UTC",
      },
    });
    expect(registration.status).toBe(201);
    const verificationEmail = deliveredEmails.at(-1);
    if (!verificationEmail) throw new Error("Expected a verification email.");
    const verificationUrl = verificationEmail.text.match(/https:\/\/[^\s]+/)?.[0];
    if (!verificationUrl) throw new Error("Expected a verification URL.");
    const verificationToken = new URL(verificationUrl).searchParams.get("verifyEmail");
    if (!verificationToken) throw new Error("Expected a verification token.");

    const confirmation = await request("/v1/auth/email-verification/confirm", {
      auth: "none",
      body: { token: verificationToken },
    });
    expect(confirmation.status).toBe(200);
    expect((await payload(confirmation)).user.emailVerified).toBe(true);
    expect(
      (
        await request("/v1/auth/email-verification/confirm", {
          auth: "none",
          body: { token: verificationToken },
        })
      ).status,
    ).toBe(400);

    expect(
      (
        await request("/v1/auth/recovery", {
          auth: "none",
          body: { email: "recovery@example.com" },
        })
      ).status,
    ).toBe(204);
    const resetEmail = deliveredEmails.at(-1);
    if (!resetEmail) throw new Error("Expected a recovery email.");
    const resetUrl = resetEmail.text.match(/https:\/\/[^\s]+/)?.[0];
    if (!resetUrl) throw new Error("Expected a reset URL.");
    const resetToken = new URL(resetUrl).searchParams.get("resetPassword");
    if (!resetToken) throw new Error("Expected a reset token.");

    expect(
      (
        await request("/v1/auth/password-reset", {
          auth: "none",
          body: { password: invalidLowercasePassword, token: resetToken },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/v1/auth/password-reset", {
          auth: "none",
          body: { password: "DifferentPassword123!", token: resetToken },
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await request("/v1/auth/login", {
          auth: "none",
          body: { email: "recovery@example.com", password: "LocalTestOnly123!" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request("/v1/auth/login", {
          auth: "none",
          body: { email: "recovery@example.com", password: "DifferentPassword123!" },
        })
      ).status,
    ).toBe(200);
  });

  it("rejects HTTP work after runtime quiesce", async () => {
    const lifecycle = createRuntimeLifecycle();
    const drainingApp = createApp({
      config: {
        allowedOrigins: ["https://app.example.com"],
        apiBaseUrl: "https://api.example.com",
        apiShutdownTimeoutMs: 105_000,
        appBaseUrl: "https://app.example.com",
        databaseUrl: container.getConnectionUri(),
        emailFrom: "",
        encryptionKey: Buffer.alloc(32, 5).toString("base64"),
        googleClientId: "",
        googleClientSecret: "",
        googleRedirectUri: "https://api.example.com/v1/connectors/google/callback",
        logLevel: "info",
        plaidClientId: "",
        plaidEnvironment: "sandbox",
        plaidSecret: "",
        port: 8787,
        production: false,
        resendApiKey: "",
        sessionCookieName: "personal_os_session",
        sessionTtlDays: 30,
        xClientId: "",
        xClientSecret: "",
        xRedirectUri: "https://api.example.com/v1/x-bookmarks/callback",
      },
      db: database.db,
      runtimeLifecycle: lifecycle,
    });

    lifecycle.beginQuiesce(Date.now() + 105_000);
    const response = await drainingApp.request("/health/ready");
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "service_unavailable" },
    });
  });

  it("issues and rotates ilo MCP OAuth tokens with PKCE", async () => {
    const userRegistration = await request("/v1/auth/register", {
      auth: "none",
      body: {
        displayName: "OAuth Protocol User",
        email: "oauth-protocol@example.com",
        password: "LocalTestOnly123!",
        planningTimezone: "UTC",
      },
    });
    expect(userRegistration.status).toBe(201);
    const oauthSessionToken = (await userRegistration.json()).sessionToken as string;
    const verificationUrl = deliveredEmails.at(-1)?.text.match(/https:\/\/[^\s]+/)?.[0];
    const verificationToken = verificationUrl
      ? new URL(verificationUrl).searchParams.get("verifyEmail")
      : null;
    expect(verificationToken).toBeTruthy();
    expect(
      (
        await app.request("/v1/auth/email-verification/confirm", {
          body: JSON.stringify({ token: verificationToken }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      ).status,
    ).toBe(200);
    const registration = await app.request("/oauth/register", {
      body: JSON.stringify({
        client_name: "Protocol test client",
        redirect_uris: ["http://127.0.0.1:4312/callback"],
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(registration.status).toBe(201);
    const client = (await registration.json()) as { client_id: string };
    const verifier = "v".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authorize = new URL("https://api.example.com/oauth/authorize");
    authorize.search = new URLSearchParams({
      client_id: client.client_id,
      code_challenge: challenge,
      code_challenge_method: "S256",
      redirect_uri: "http://127.0.0.1:4312/callback",
      resource: "https://api.example.com/mcp",
      scope: "tasks:read",
      state: "test-state",
    }).toString();
    const consent = await app.request(authorize.pathname + authorize.search, {
      headers: { authorization: `Session ${oauthSessionToken}` },
    });
    expect(consent.status).toBe(200);
    const consentPage = await consent.text();
    expect(consentPage).toContain("Connect Protocol test client");
    expect(consentPage).toContain("Read tasks");
    expect(consentPage).toContain("Connected provider credentials remain inside Ilo");
    expect(consentPage).toContain('class="oauth-card"');
    expect(consentPage).toContain("Requested access");
    expect(consentPage).toContain('class="oauth-cancel"');
    const approved = await app.request("/oauth/authorize", {
      body: new URLSearchParams(Object.fromEntries(authorize.searchParams)).toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Session ${oauthSessionToken}`,
      },
      method: "POST",
    });
    const code = new URL(approved.headers.get("location") ?? "").searchParams.get("code");
    expect(code).toMatch(/^oauth_code_/);
    const exchange = await app.request("/oauth/token", {
      body: new URLSearchParams({
        client_id: client.client_id,
        code: code ?? "",
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: "http://127.0.0.1:4312/callback",
        resource: "https://api.example.com/mcp",
      }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    expect(exchange.status).toBe(200);
    const tokens = (await exchange.json()) as { access_token: string; refresh_token: string };
    expect(
      (
        await (
          await app.request("/v1/access-tokens", {
            headers: { authorization: `Session ${oauthSessionToken}` },
          })
        ).json()
      ).tokens,
    ).toEqual([]);
    expect(
      (
        await (
          await app.request("/v1/oauth/clients", {
            headers: { authorization: `Session ${oauthSessionToken}` },
          })
        ).json()
      ).clients,
    ).toEqual([
      expect.objectContaining({
        id: client.client_id,
        name: "Protocol test client",
        scopes: ["tasks:read"],
      }),
    ]);
    expect(
      (await app.request("/v1/me", { headers: { authorization: `Bearer ${tokens.access_token}` } }))
        .status,
    ).toBe(401);
    const refreshed = await app.request("/oauth/token", {
      body: new URLSearchParams({
        client_id: client.client_id,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        resource: "https://api.example.com/mcp",
      }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    expect(refreshed.status).toBe(200);
    expect(
      (
        await app.request("/oauth/token", {
          body: new URLSearchParams({
            client_id: client.client_id,
            grant_type: "refresh_token",
            refresh_token: tokens.refresh_token,
            resource: "https://api.example.com/mcp",
          }).toString(),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          method: "POST",
        })
      ).status,
    ).toBe(401);
  });
});
