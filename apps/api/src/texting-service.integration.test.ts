import { resolve } from "node:path";
import type { TwilioConnector } from "@personal-os/connectors";
import {
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  textingConnections,
  textingVerificationChallenges,
  textMessages,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { AppError } from "./errors.js";
import { createTextingService } from "./texting-service.js";
import type { Principal } from "./types.js";

describe.sequential("texting service", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let current = new Date("2026-08-28T16:30:00.000Z");
  const encryptionKey = Buffer.alloc(32, 7).toString("base64");
  const userId = "11111111-1111-4111-8111-111111111111";
  const principal: Principal = {
    actorId: "agent-token",
    actorType: "agent",
    scopes: new Set(["texting:read", "texting:write"]),
    userId,
  };
  const twilio: TwilioConnector = {
    checkVerification: vi.fn(async (_sid, code) =>
      code === "123456" ? "approved" : code === "000000" ? "failed" : "pending",
    ),
    getMessageOccurredAt: vi.fn(async () => current),
    sendMessage: vi.fn(async () => ({ sid: `SM${crypto.randomUUID()}`, status: "queued" })),
    startVerification: vi.fn(async () => ({ sid: `VE${crypto.randomUUID()}`, status: "pending" })),
    validateWebhook: vi.fn(() => true),
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    await database.db.insert(users).values({
      displayName: "Text User",
      email: "text@example.com",
      id: userId,
      passwordHash: "unused",
    });
    await database.db.insert(users).values({
      displayName: "Second Text User",
      email: "text2@example.com",
      id: "22222222-2222-4222-8222-222222222222",
      passwordHash: "unused",
    });
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("persists verification before and after the provider handoff", async () => {
    const service = createTextingService({
      apiBaseUrl: "https://api.example.com",
      db: database.db,
      enabled: true,
      encryptionKey,
      now: () => current,
      senderPhoneNumber: "+18885550100",
      twilio,
    });
    let releaseProvider: ((value: { sid: string; status: string }) => void) | undefined;
    let providerStarted: (() => void) | undefined;
    const started = new Promise<void>((resolveStarted) => {
      providerStarted = resolveStarted;
    });
    vi.mocked(twilio.startVerification).mockImplementationOnce(
      () =>
        new Promise((resolveProvider) => {
          releaseProvider = resolveProvider;
          providerStarted?.();
        }),
    );
    const request = service.startVerification("22222222-2222-4222-8222-222222222222", {
      consentAccepted: true,
      country: "US",
      phoneNumber: "+12025550124",
    });
    await started;
    const startingChallenge = await database.db.query.textingVerificationChallenges.findFirst({
      orderBy: (challenge, { desc }) => [desc(challenge.createdAt), desc(challenge.id)],
      where: eq(textingVerificationChallenges.userId, "22222222-2222-4222-8222-222222222222"),
    });
    expect(startingChallenge).toMatchObject({ providerVerificationSid: null, status: "starting" });
    await expect(
      service.startVerification("22222222-2222-4222-8222-222222222222", {
        consentAccepted: true,
        country: "US",
        phoneNumber: "+12025550124",
      }),
    ).resolves.toMatchObject({ status: "pending" });
    releaseProvider?.({ sid: "VEdurable", status: "pending" });
    await expect(request).rejects.toBeInstanceOf(AppError);
    expect(
      await database.db.query.textingVerificationChallenges.findFirst({
        where: eq(textingVerificationChallenges.id, startingChallenge?.id ?? crypto.randomUUID()),
      }),
    ).toMatchObject({ status: "cancelled" });

    vi.mocked(twilio.startVerification).mockRejectedValueOnce(new Error("verify unavailable"));
    await expect(
      service.startVerification("22222222-2222-4222-8222-222222222222", {
        consentAccepted: true,
        country: "US",
        phoneNumber: "+12025550124",
      }),
    ).rejects.toThrow("verify unavailable");
    expect(
      await database.db.query.textingVerificationChallenges.findFirst({
        orderBy: (challenge, { desc }) => [desc(challenge.createdAt), desc(challenge.id)],
        where: eq(textingVerificationChallenges.userId, "22222222-2222-4222-8222-222222222222"),
      }),
    ).toMatchObject({ status: "uncertain" });
  }, 15_000);

  it("runs verification, conversation safety, sending, consent synchronization, and disconnect", async () => {
    const service = createTextingService({
      apiBaseUrl: "https://api.example.com",
      db: database.db,
      enabled: true,
      encryptionKey,
      now: () => current,
      senderPhoneNumber: "+18885550100",
      twilio,
    });

    expect(await service.getConnection(userId)).toMatchObject({ id: null, providerReady: true });
    const challenge = await service.startVerification(userId, {
      consentAccepted: true,
      country: "US",
      phoneNumber: "+1 212 555 0123",
    });
    expect(challenge).toMatchObject({ maskedPhoneNumber: "••• ••• 0123", status: "pending" });
    await expect(
      service.checkVerification(userId, crypto.randomUUID(), "123456"),
    ).rejects.toMatchObject({ code: "not_found" });
    const failedChallenge = await service.startVerification(userId, {
      consentAccepted: true,
      country: "US",
      phoneNumber: "+12125550123",
    });
    await expect(
      service.checkVerification(userId, failedChallenge.id, "000000"),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(service.checkVerification(userId, challenge.id, "123456")).rejects.toMatchObject({
      code: "not_found",
    });
    const approvedChallenge = await service.startVerification(userId, {
      consentAccepted: true,
      country: "US",
      phoneNumber: "+12125550123",
    });
    const connection = await service.checkVerification(userId, approvedChallenge.id, "123456");
    expect(connection).toMatchObject({ state: "active", senderPhoneNumber: "+18885550100" });

    const empty = await service.conversation(principal, "America/New_York", { limit: 100 });
    expect(empty.currentLocalDateTime).toContain("12:30:00 PM");
    expect(empty.conversationReceipt).toBeTruthy();
    const sent = await service.send(principal, "America/New_York", {
      body: "The appointment is at 3 PM.",
      contentKind: "concise",
      conversationReceipt: empty.conversationReceipt ?? "",
    });
    expect(sent.body).toBe("ilo: The appointment is at 3 PM.\nReply STOP to unsubscribe.");
    expect(twilio.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+12125550123" }),
    );
    await expect(
      service.send(principal, "America/New_York", {
        body: "Stale retry",
        contentKind: "concise",
        conversationReceipt: empty.conversationReceipt ?? "",
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    await service.inbound({ Body: "Got it", From: "+12125550123", MessageSid: "SMinbound1" });
    const read = await service.conversation(principal, "America/New_York", { limit: 100 });
    expect(read.messages).toHaveLength(2);
    expect(read.messages.every((message) => message.localDateTime.includes("12:30:00 PM"))).toBe(
      true,
    );
    expect(read.messages.every((message) => message.localDateTime.includes("GMT-04:00"))).toBe(
      true,
    );
    const latestPage = await service.conversation(principal, "UTC", { limit: 1 });
    expect(latestPage.hasEarlierMessages).toBe(true);
    expect(latestPage.conversationReceipt).toBeTruthy();
    const earlierPage = await service.conversation(principal, "UTC", {
      beforeCursor: latestPage.earlierCursor ?? undefined,
      limit: 1,
    });
    expect(earlierPage.conversationReceipt).toBeNull();
    expect(earlierPage.messages).toHaveLength(1);
    const newerPage = await service.conversation(principal, "UTC", {
      afterCursor: earlierPage.newerCursor ?? earlierPage.messages[0]?.id,
      limit: 1,
    });
    expect(newerPage.conversationReceipt).toBeNull();
    expect(newerPage.messages).toHaveLength(1);
    await expect(
      service.send(principal, "America/New_York", {
        body: "series",
        contentKind: "concise",
        conversationReceipt: read.conversationReceipt ?? "",
        seriesId: crypto.randomUUID(),
        seriesPart: 1,
        seriesTotal: 2,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.send(principal, "America/New_York", {
        body: "a".repeat(400),
        contentKind: "essential_context",
        conversationReceipt: read.conversationReceipt ?? "",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const longRead = await service.conversation(principal, "America/New_York", { limit: 100 });
    await expect(
      service.send(principal, "America/New_York", {
        body: "a".repeat(700),
        contentKind: "essential_context",
        conversationReceipt: longRead.conversationReceipt ?? "",
        necessity: "The requested details cannot be safely shortened.",
      }),
    ).rejects.toMatchObject({ code: "conflict", details: { predictedSegments: 5 } });
    await expect(
      service.send(principal, "America/New_York", {
        body: "a".repeat(1000),
        contentKind: "requested_large_content",
        conversationReceipt: longRead.conversationReceipt ?? "",
        necessity: "The user explicitly requested the complete dataset.",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.send(principal, "America/New_York", {
        body: "a".repeat(1600),
        contentKind: "requested_large_content",
        conversationReceipt: longRead.conversationReceipt ?? "",
        necessity: "The user explicitly requested the complete dataset.",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const messageCountBeforeStop = (await service.conversation(principal, "UTC", { limit: 100 }))
      .messages.length;
    const stopOccurredAt = new Date(current.getTime() + 2_000);
    vi.mocked(twilio.getMessageOccurredAt).mockResolvedValueOnce(stopOccurredAt);
    await service.inbound({
      Body: "UNSUBSCRIBE",
      From: "+12125550123",
      MessageSid: "SMstop",
      OptOutType: "STOP",
    });
    expect((await service.getConnection(userId)).state).toBe("opted_out");
    const stoppedConversation = await service.conversation(principal, "UTC", { limit: 100 });
    expect(stoppedConversation.messages).toHaveLength(messageCountBeforeStop);
    await service.inbound({
      Body: "UNSUBSCRIBE",
      From: "+12125550123",
      MessageSid: "SMstop",
      OptOutType: "STOP",
    });
    expect((await service.conversation(principal, "UTC", { limit: 100 })).messages).toHaveLength(
      stoppedConversation.messages.length,
    );
    await expect(
      service.send(principal, "America/New_York", {
        body: "Blocked",
        contentKind: "concise",
        conversationReceipt: read.conversationReceipt ?? "",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    vi.mocked(twilio.getMessageOccurredAt).mockResolvedValueOnce(
      new Date(stopOccurredAt.getTime() - 1_000),
    );
    await service.inbound({ Body: "START", From: "+12125550123", MessageSid: "SMstart-delayed" });
    expect((await service.getConnection(userId)).state).toBe("opted_out");
    vi.mocked(twilio.getMessageOccurredAt).mockResolvedValueOnce(
      new Date(stopOccurredAt.getTime() + 1_000),
    );
    await service.inbound({ Body: "START", From: "+12125550123", MessageSid: "SMstart" });
    expect((await service.getConnection(userId)).state).toBe("active");
    const tiedConsentTime = new Date(stopOccurredAt.getTime() + 1_000);
    vi.mocked(twilio.getMessageOccurredAt).mockResolvedValueOnce(tiedConsentTime);
    await service.inbound({ Body: "STOP", From: "+12125550123", MessageSid: "SMstop-tied" });
    expect((await service.getConnection(userId)).state).toBe("opted_out");
    vi.mocked(twilio.getMessageOccurredAt).mockResolvedValueOnce(
      new Date(tiedConsentTime.getTime() + 1_000),
    );
    await service.inbound({ Body: "START", From: "+12125550123", MessageSid: "SMrestart" });
    expect((await service.getConnection(userId)).state).toBe("active");

    await service.updateStatus({
      MessageSid: sent.providerMessageSid ?? "",
      MessageStatus: "delivered",
      NumSegments: "2",
    });
    await service.updateStatus({
      MessageSid: sent.providerMessageSid ?? "",
      MessageStatus: "failed",
    });
    const stored = await database.db.query.textMessages.findFirst({
      where: eq(textMessages.id, sent.id),
    });
    expect(stored).toMatchObject({ actualSegments: 2, status: "delivered" });
    await service.updateStatus({});
    await service.inbound({ Body: "Unknown", From: "+14165550123", MessageSid: "SMunknown" });

    await service.disconnect(userId);
    expect((await service.getConnection(userId)).state).toBe("disconnected");
    const reconnect = await service.startVerification(userId, {
      consentAccepted: true,
      country: "US",
      phoneNumber: "+12125550123",
    });
    expect((await service.checkVerification(userId, reconnect.id, "123456")).state).toBe("active");
    await service.disconnect("22222222-2222-4222-8222-222222222222");
  }, 15_000);

  it("fails closed when the provider is disabled and validates message stops", async () => {
    const disabled = createTextingService({
      apiBaseUrl: "https://api.example.com",
      db: database.db,
      enabled: false,
      encryptionKey,
      senderPhoneNumber: "",
    });
    expect(await disabled.getConnection("22222222-2222-4222-8222-222222222222")).toMatchObject({
      providerReady: false,
    });
    await expect(
      disabled.conversation(
        { ...principal, userId: "22222222-2222-4222-8222-222222222222" },
        "UTC",
        { limit: 10 },
      ),
    ).resolves.toMatchObject({ conversationReceipt: null, messages: [] });
    await expect(
      disabled.startVerification(userId, {
        consentAccepted: true,
        country: "US",
        phoneNumber: "+12125550123",
      }),
    ).rejects.toBeInstanceOf(AppError);
  }, 15_000);

  it("enforces graduated length reviews, series rules, quotas, and provider blocks", async () => {
    const service = createTextingService({
      apiBaseUrl: "https://api.example.com",
      db: database.db,
      enabled: true,
      encryptionKey,
      now: () => current,
      senderPhoneNumber: "+18885550100",
      twilio,
    });
    await service.inbound({ Body: "START", From: "+12125550123", MessageSid: "SMstart2" });
    const sendWithFreshRead = async (input: {
      body: string;
      contentKind: "concise" | "essential_context" | "requested_large_content" | "structured_data";
      exceptionalLengthToken?: string;
      lengthReviewToken?: string;
      necessity?: string;
      seriesId?: string;
      seriesPart?: number;
      seriesTotal?: number;
    }) => {
      const read = await service.conversation(principal, "UTC", { limit: 100 });
      return service.send(principal, "UTC", {
        ...input,
        conversationReceipt: read.conversationReceipt ?? "",
      });
    };
    await sendWithFreshRead({
      body: "a".repeat(400),
      contentKind: "essential_context",
      necessity: "The timing details are all required.",
    });
    await sendWithFreshRead({
      body: "one item",
      contentKind: "structured_data",
      seriesId: crypto.randomUUID(),
      seriesPart: 1,
      seriesTotal: 2,
    });

    const reviewedBody = "a".repeat(700);
    let lengthReviewToken = "";
    try {
      await sendWithFreshRead({
        body: reviewedBody,
        contentKind: "essential_context",
        necessity: "The user needs every instruction.",
      });
    } catch (error) {
      expect(error).toMatchObject({ code: "conflict" });
      lengthReviewToken = (error as AppError).details
        ? ((error as AppError).details as { lengthReviewToken: string }).lengthReviewToken
        : "";
    }
    await sendWithFreshRead({
      body: reviewedBody,
      contentKind: "essential_context",
      lengthReviewToken,
      necessity: "The user needs every instruction.",
    });

    const exceptionalBody = "a".repeat(1000);
    let exceptionalLengthToken = "";
    try {
      await sendWithFreshRead({
        body: exceptionalBody,
        contentKind: "requested_large_content",
        necessity: "The user explicitly requested the complete dataset.",
      });
    } catch (error) {
      exceptionalLengthToken = ((error as AppError).details as { exceptionalLengthToken: string })
        .exceptionalLengthToken;
    }
    await sendWithFreshRead({
      body: exceptionalBody,
      contentKind: "requested_large_content",
      exceptionalLengthToken,
      necessity: "The user explicitly requested the complete dataset.",
    });
    await expect(
      sendWithFreshRead({ body: "rate limited", contentKind: "concise" }),
    ).rejects.toMatchObject({ code: "rate_limited" });

    current = new Date(Date.now() + 2 * 60_000);
    vi.mocked(twilio.sendMessage).mockRejectedValueOnce({ code: 21610 });
    await expect(
      sendWithFreshRead({ body: "provider blocked", contentKind: "concise" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect((await service.getConnection(userId)).state).toBe("opted_out");

    await service.disconnect(userId);
    const blockedReconnect = await service.startVerification(userId, {
      consentAccepted: true,
      country: "US",
      phoneNumber: "+12125550123",
    });
    expect((await service.checkVerification(userId, blockedReconnect.id, "123456")).state).toBe(
      "opted_out",
    );
    current = new Date(current.getTime() + 1_000);
    await service.inbound({ Body: "START", From: "+12125550123", MessageSid: "SMstart3" });
    await service.disconnect(userId);
    const activeReconnect = await service.startVerification(userId, {
      consentAccepted: true,
      country: "US",
      phoneNumber: "+12125550123",
    });
    expect((await service.checkVerification(userId, activeReconnect.id, "123456")).state).toBe(
      "active",
    );

    vi.mocked(twilio.sendMessage).mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(
      sendWithFreshRead({ body: "temporary failure", contentKind: "concise" }),
    ).rejects.toThrow("provider unavailable");
    const uncertainMessage = await database.db.query.textMessages.findFirst({
      orderBy: (message, { desc }) => [desc(message.createdAt), desc(message.id)],
      where: eq(textMessages.body, "ilo: temporary failure"),
    });
    expect(uncertainMessage?.status).toBe("unknown");
    vi.mocked(twilio.sendMessage).mockRejectedValueOnce({ status: 400 });
    await expect(
      sendWithFreshRead({ body: "definite rejection", contentKind: "concise" }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await database.db.query.textMessages.findFirst({
        where: eq(textMessages.body, "ilo: definite rejection"),
      }),
    ).toMatchObject({ status: "failed" });
    vi.mocked(twilio.sendMessage).mockResolvedValueOnce({ sid: "SMaccepted", status: "sent" });
    await sendWithFreshRead({ body: "accepted status", contentKind: "concise" });
    await expect(service.inbound({ MessageSid: "SMmissing" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await service.inbound({ From: "+12125550123", MessageSid: "SMempty" });

    await service.updateStatus({ MessageSid: "missing", MessageStatus: "mystery" });
    await service.updateStatus({ MessageSid: "SMaccepted", MessageStatus: "sent" });
    await service.updateStatus({ MessageSid: "SMaccepted", MessageStatus: "failed" });
    expect(
      await database.db.query.textMessages.findFirst({
        where: eq(textMessages.providerMessageSid, "SMaccepted"),
      }),
    ).toMatchObject({ status: "sent" });
    const expired = await service.startVerification(userId, {
      consentAccepted: true,
      country: "US",
      phoneNumber: "+12125550123",
    });
    await database.db
      .update(textingVerificationChallenges)
      .set({ expiresAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(textingVerificationChallenges.id, expired.id));
    await expect(service.checkVerification(userId, expired.id, "123456")).rejects.toMatchObject({
      code: "invalid_request",
    });
  }, 15_000);

  it("rejects phone reassignment and counts conservative fallback segments", async () => {
    const service = createTextingService({
      apiBaseUrl: "https://api.example.com",
      db: database.db,
      enabled: true,
      encryptionKey,
      now: () => current,
      senderPhoneNumber: "+18885550100",
      twilio,
    });
    const conflict = await service.startVerification("22222222-2222-4222-8222-222222222222", {
      consentAccepted: true,
      country: "US",
      phoneNumber: "+12125550123",
    });
    await expect(
      service.checkVerification("22222222-2222-4222-8222-222222222222", conflict.id, "123456"),
    ).rejects.toMatchObject({ code: "conflict" });

    const connection = await database.db.query.textingConnections.findFirst({
      where: eq(textingConnections.userId, userId),
    });
    expect(connection).toBeTruthy();
    if (!connection) return;
    await database.db.insert(textMessages).values({
      body: "legacy outbound",
      connectionId: connection.id,
      direction: "outbound",
      occurredAt: current,
      occurredAtSource: "ilo",
      status: "sent",
      userId,
    });
    const read = await service.conversation(principal, "UTC", { limit: 100 });
    await expect(
      service.send(principal, "UTC", {
        body: "Fallback quota accounting still sends safely.",
        contentKind: "concise",
        conversationReceipt: read.conversationReceipt ?? "",
      }),
    ).resolves.toMatchObject({ status: "queued" });

    await service.disconnect(userId);
    const reassigned = await service.startVerification("22222222-2222-4222-8222-222222222222", {
      consentAccepted: true,
      country: "US",
      phoneNumber: "+12125550123",
    });
    expect(
      await service.checkVerification(
        "22222222-2222-4222-8222-222222222222",
        reassigned.id,
        "123456",
      ),
    ).toMatchObject({ state: "active" });
    await service.inbound({ Body: "New owner", From: "+12125550123", MessageSid: "SMreassigned" });
    expect(
      await database.db.query.textMessages.findFirst({
        where: eq(textMessages.providerMessageSid, "SMreassigned"),
      }),
    ).toMatchObject({ userId: "22222222-2222-4222-8222-222222222222" });

    const secondPrincipal = {
      ...principal,
      userId: "22222222-2222-4222-8222-222222222222",
    };
    const secondRead = await service.conversation(secondPrincipal, "UTC", { limit: 100 });
    const concurrent = await Promise.allSettled([
      service.send(secondPrincipal, "UTC", {
        body: "Only once",
        contentKind: "concise",
        conversationReceipt: secondRead.conversationReceipt ?? "",
      }),
      service.send(secondPrincipal, "UTC", {
        body: "Only once",
        contentKind: "concise",
        conversationReceipt: secondRead.conversationReceipt ?? "",
      }),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
});
