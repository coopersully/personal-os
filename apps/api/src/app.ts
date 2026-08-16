import { randomUUID } from "node:crypto";
import {
  createGoogleConnector,
  createICloudConnector,
  createXConnector,
} from "@personal-os/connectors";
import {
  type AgentConnectionGuide,
  assistantDomains,
  confirmEmailVerificationInputSchema,
  connectICloudInputSchema,
  createAccessTokenInputSchema,
  createInvitationInputSchema,
  featureAccessPolicies,
  loginInputSchema,
  registerInputSchema,
  requestPasswordResetInputSchema,
  resetPasswordInputSchema,
  startGoogleAuthorizationInputSchema,
  updateAccountSetupInputSchema,
  updatePinterestWallpaperSettingsInputSchema,
  updateUserInputSchema,
  validateInvitationInputSchema,
  weatherLocationSearchQuerySchema,
  weatherQuerySchema,
} from "@personal-os/domain";
import { sql } from "drizzle-orm";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { createAgentAccessWorkItemService } from "./agent-access-work-items.js";
import { createAssistantService } from "./assistant-service.js";
import { createAuditService } from "./audit.js";
import { createAuthService } from "./auth-service.js";
import { calendarProviderReconciliationLog } from "./calendar-provider-log.js";
import { createCalendarService } from "./calendar-service.js";
import { officialAgentSkill } from "./config.js";
import { createConnectorService } from "./connector-service.js";
import { createDailyBriefService } from "./daily-brief-service.js";
import { createEmailDelivery } from "./email-delivery.js";
import { AppError, errorResponse } from "./errors.js";
import { createFinanceService } from "./finance-service.js";
import { createGoalsService } from "./goals-service.js";
import { createGooglePubSubAuth, GooglePubSubAuthError } from "./google-pubsub-auth.js";
import { createMailService } from "./mail-service.js";
import { createOAuthService } from "./oauth-service.js";
import { createOpenApiDocument } from "./openapi.js";
import { createPinterestService } from "./pinterest-service.js";
import { createFixedWindowRateLimiter } from "./rate-limit.js";
import { createReminderService } from "./reminder-service.js";
import { registerAssistantRoutes } from "./routes/assistant.js";
import { registerCalendarRoutes } from "./routes/calendar.js";
import { registerFinanceRoutes } from "./routes/finances.js";
import { registerGoalsRoutes } from "./routes/goals.js";
import { registerMailRoutes } from "./routes/mail.js";
import { registerReminderRoutes } from "./routes/reminders.js";
import {
  requestMetadata as metadata,
  parseBody,
  requestIp,
  requireHuman,
  requireScope,
} from "./routes/support.js";
import { registerTaskListRoutes } from "./routes/task-lists.js";
import { registerTaskProjectRoutes } from "./routes/task-projects.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { createTaskListService } from "./task-list-service.js";
import { createTaskProjectService } from "./task-project-service.js";
import { createTaskService } from "./task-service.js";
import type { AppDependencies, AppEnv, Principal } from "./types.js";
import { createWeatherService } from "./weather-service.js";
import { createXBookmarksService } from "./x-bookmarks-service.js";

export type PersonalOsApp = Hono<AppEnv> & {
  backfillFinanceCashflowInsights: () => Promise<{ processed: number }>;
  backfillFinanceLedgerIntegrity: () => Promise<{
    confirmedMovements: number;
    paired: number;
    processed: number;
  }>;
  backfillFinanceLearning: () => Promise<{ processed: number }>;
  backfillFinanceSetupIntegrity: () => Promise<{
    categoriesComplete: boolean;
    categoriesInserted: number;
    claimed: boolean;
    processed: number;
    profileRowsScanned: number;
    profilesComplete: boolean;
    profilesDemoted: number;
    userRowsScanned: number;
  }>;
  dispatchDueMailRuleWork: () => Promise<void>;
  superviseICloudMail: () => Promise<void>;
  syncDueConnectors: () => Promise<{
    attempted: number;
    failed: number;
    recovered: number;
    skipped: number;
    succeeded: number;
  }>;
  syncDueFinances: () => Promise<{ failed: number; reasons: string[]; synced: number }>;
};

const auditQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });
const googleCallbackSchema = z.object({
  code: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  iss: z.string().min(1).optional(),
  state: z.string().min(1),
});
const gmailPushEnvelopeSchema = z.object({
  message: z.object({
    data: z.string().min(1).max(16_384),
    messageId: z.string().min(1).max(256),
  }),
  subscription: z.string().min(1).max(512),
});
const gmailPushDataSchema = z.object({
  emailAddress: z.email().max(320),
  historyId: z.string().regex(/^\d+$/u).max(64),
});
const calendarNotificationHeadersSchema = z.object({
  channelId: z.string().uuid(),
  messageNumber: z.string().regex(/^\d+$/u).max(64),
  resourceId: z.string().min(1).max(512),
  resourceState: z.enum(["exists", "not_exists", "sync"]),
  token: z.string().min(32).max(512),
});
const GMAIL_PUSH_BODY_LIMIT_BYTES = 32_768;

async function readBoundedRequestBody(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let value = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      value += decoder.decode(chunk.value, { stream: true });
    }
    return value + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
const oauthAuthorizeSchema = z.object({
  client_id: z.string().min(1),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  redirect_uri: z.url(),
  resource: z.url(),
  scope: z.string().optional(),
  state: z.string().max(1024).optional(),
});
const oauthRegisterSchema = z.object({
  client_name: z.string().trim().min(1).max(120),
  redirect_uris: z.array(z.url()).min(1).max(20),
});
const xCallbackSchema = googleCallbackSchema;
const xBookmarkListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const xFolderInputSchema = z.object({ folderId: z.string().min(1).max(100) });
const pinterestPinsQuerySchema = z.object({
  limit: z.coerce.number().int().min(4).max(20).default(12),
});
const agentDomainSupport = {
  calendar: "profile_and_attention",
  finances: "profile_and_attention",
  goals: "profile_and_attention",
  mail: "executable_rules",
  reminders: "profile_and_attention",
  tasks: "profile_and_attention",
} as const satisfies Record<
  (typeof assistantDomains)[number],
  AgentConnectionGuide["domains"][number]["support"]
>;
export function createApp(dependencies: AppDependencies): PersonalOsApp {
  const app = new Hono<AppEnv>();
  const now = dependencies.now ?? (() => new Date());
  const observeRejectedNotification = (
    requestId: string,
    status: number,
    subscriptionKind?: "gmail_mailbox",
  ) =>
    dependencies.log?.({
      durationMs: 0,
      event: "connector_notification_received",
      method: "POST",
      notificationDisposition: "rejected",
      path: "/v1/connectors/google/notifications",
      provider: "google",
      requestId,
      status,
      subscriptionKind,
    });
  const authRateLimiter = createFixedWindowRateLimiter({
    maxRequests: dependencies.config.authRateLimitMaxRequests ?? 20,
    now: () => now().getTime(),
    windowMs: (dependencies.config.authRateLimitWindowSeconds ?? 300) * 1_000,
  });
  const auth = createAuthService({
    db: dependencies.db,
    now,
    ...(dependencies.config.ownerEmails ? { ownerEmails: dependencies.config.ownerEmails } : {}),
    registrationMode:
      dependencies.config.registrationMode ?? (dependencies.config.production ? "invite" : "open"),
    sessionTtlDays: dependencies.config.sessionTtlDays,
  });
  const oauth = createOAuthService({
    db: dependencies.db,
    now,
    resource: dependencies.config.mcpResourceUrl ?? `${dependencies.config.apiBaseUrl}/mcp`,
  });
  const email =
    dependencies.email ??
    createEmailDelivery({
      from: dependencies.config.emailFrom,
      resendApiKey: dependencies.config.resendApiKey,
    });
  const reminders = createReminderService({ db: dependencies.db, now });
  const taskLists = createTaskListService({ db: dependencies.db, now });
  const taskProjects = createTaskProjectService({
    db: dependencies.db,
    movePreviewSecret: dependencies.config.encryptionKey,
    now,
  });
  const tasks = createTaskService({
    db: dependencies.db,
    movePreviewSecret: dependencies.config.encryptionKey,
    now,
  });
  const google =
    dependencies.google ??
    createGoogleConnector({
      clientId: dependencies.config.googleClientId,
      clientSecret: dependencies.config.googleClientSecret,
      now,
      redirectUri: dependencies.config.googleRedirectUri,
    });
  const verifyGooglePubSubToken =
    dependencies.verifyGooglePubSubToken ??
    (dependencies.config.googleGmailPushEnabled &&
    dependencies.config.googleGmailPushAudience &&
    dependencies.config.googleGmailPushServiceAccount
      ? createGooglePubSubAuth({
          audience: dependencies.config.googleGmailPushAudience,
          serviceAccount: dependencies.config.googleGmailPushServiceAccount,
        })
      : null);
  const connectors = createConnectorService({
    db: dependencies.db,
    encryptionKey: dependencies.config.encryptionKey,
    google,
    ...(dependencies.config.googleCalendarPushEnabled &&
    dependencies.config.googleCalendarWebhookUrl
      ? { googleCalendarWebhookUrl: dependencies.config.googleCalendarWebhookUrl }
      : {}),
    ...(dependencies.config.googleGmailPushEnabled && dependencies.config.googleGmailPubsubTopic
      ? { googleGmailTopicName: dependencies.config.googleGmailPubsubTopic }
      : {}),
    googleRedirectUri: dependencies.config.googleRedirectUri,
    icloud: dependencies.icloud ?? createICloudConnector(),
    ...(dependencies.config.icloudMailIdleConcurrency
      ? { icloudMailIdleConcurrency: dependencies.config.icloudMailIdleConcurrency }
      : {}),
    ...(dependencies.config.icloudMailIdleEnabled ? { icloudMailIdleEnabled: true } : {}),
    now,
    ...(dependencies.log ? { log: dependencies.log } : {}),
    observeRecoveryFailure: (entry) =>
      dependencies.log?.({
        durationMs: 0,
        event: "connector_recovery_failed",
        method: "SCHEDULER",
        path: `/internal/connectors/recovery/${entry.operation}`,
        requestId: entry.claimId,
        status: 503,
      }),
    ...(dependencies.runtimeLifecycle
      ? {
          shutdown: {
            deadlineMs: dependencies.runtimeLifecycle.deadlineMs,
            signal: dependencies.runtimeLifecycle.signal,
          },
        }
      : {}),
  });
  const xBookmarks = createXBookmarksService({
    db: dependencies.db,
    encryptionKey: dependencies.config.encryptionKey,
    now,
    xRedirectUri: dependencies.config.xRedirectUri,
    x:
      dependencies.x ??
      createXConnector({
        clientId: dependencies.config.xClientId,
        clientSecret: dependencies.config.xClientSecret,
        now,
        redirectUri: dependencies.config.xRedirectUri,
      }),
  });
  function connectorCallbackRedirect(
    context: Context<AppEnv>,
    returnPath: "/setup" | "/settings?section=connections",
    attemptId: string | null,
  ): Response {
    const location = new URL(returnPath, dependencies.config.appBaseUrl);
    if (attemptId) location.searchParams.set("connection_attempt", attemptId);
    else location.searchParams.set("connection_result", "restart_required");
    context.header("Cache-Control", "no-store");
    context.header("Pragma", "no-cache");
    context.header("Referrer-Policy", "no-referrer");
    context.header("X-Content-Type-Options", "nosniff");
    return context.redirect(location.toString(), 303);
  }
  async function completeConnectorCallback(
    context: Context<AppEnv>,
    provider: "google" | "x",
    operation: () => Promise<{
      attemptId: string | null;
      returnPath: "/setup" | "/settings?section=connections";
    }>,
  ): Promise<Response> {
    try {
      const result = await operation();
      return connectorCallbackRedirect(context, result.returnPath, result.attemptId);
    } catch {
      dependencies.log?.({
        durationMs: 0,
        event: "connector_authorization_callback_failed",
        method: "GET",
        path: context.req.path,
        provider,
        requestId: context.get("requestId"),
        status: 503,
      });
      return connectorCallbackRedirect(context, "/settings?section=connections", null);
    }
  }
  const calendar = createCalendarService({
    connectedEvents: connectors.eventGateway,
    db: dependencies.db,
    now,
    observeProviderFailure: (entry) =>
      dependencies.log?.({
        calendarProviderReconciliation: calendarProviderReconciliationLog(entry),
        durationMs: 0,
        event: "calendar_provider_reconciliation",
        method: "CALENDAR",
        path: `/internal/calendar/provider-effects/${entry.operation}`,
        requestId: entry.requestId,
        status: entry.status,
      }),
  });
  const dailyBrief = createDailyBriefService({
    db: dependencies.db,
    listEvents: calendar.listEvents,
    listReminders: async (userId) =>
      (await reminders.list(userId, { completed: false, limit: 100 })).items,
    listTasks: (userId, query) => tasks.list(userId, query),
    now,
  });
  const audit = createAuditService(dependencies.db);
  const mail = createMailService({
    db: dependencies.db,
    gateway: connectors.mailGateway,
    now,
    reviewSigningKey: dependencies.config.encryptionKey,
  });
  const finances = createFinanceService({
    db: dependencies.db,
    now,
    plaid: {
      clientId: dependencies.config.plaidClientId,
      encryptionKey: dependencies.config.encryptionKey,
      environment: dependencies.config.plaidEnvironment,
      secret: dependencies.config.plaidSecret,
    },
  });
  const assistant = createAssistantService({
    appBaseUrl: dependencies.config.appBaseUrl,
    db: dependencies.db,
    now,
    profileRequiresApproval: (domain) => domain === "finances",
    validateProfileSources: async (
      transaction,
      domain,
      userId,
      sourceIds,
      status,
      actorType,
      preferences,
    ) => {
      if (domain === "mail") {
        await mail.validateProfileSources(transaction, userId, sourceIds);
      }
      if (domain === "calendar") {
        await calendar.validateProfileSources(transaction, userId, sourceIds, status, preferences);
      }
      if (domain === "reminders") {
        return reminders.validateProfileSources(
          transaction,
          userId,
          sourceIds,
          status,
          preferences,
        );
      }
      if (domain === "finances") {
        await finances.validateProfileSources(transaction, userId, sourceIds, status, actorType);
      }
    },
  });
  const agentAccessWorkItems = createAgentAccessWorkItemService({
    cursorSigningKey: dependencies.config.encryptionKey,
    db: dependencies.db,
    now,
  });
  const agentSkillRevision = dependencies.config.agentSkillRevision ?? officialAgentSkill.revision;
  const agentSkillSourceUrl =
    dependencies.config.agentSkillSourceUrl ??
    new URL(officialAgentSkill.sourcePath, dependencies.config.appBaseUrl).href;
  const agentSkillVersion = dependencies.config.agentSkillVersion ?? officialAgentSkill.version;
  const agentConnectionGuide: AgentConnectionGuide = {
    domains: assistantDomains.map((domain) => ({
      domain,
      readScope: featureAccessPolicies[domain].readScope,
      support: agentDomainSupport[domain],
      writeScope: featureAccessPolicies[domain].writeScope,
    })),
    mcpUrl: dependencies.config.mcpResourceUrl ?? `${dependencies.config.apiBaseUrl}/mcp`,
    skill: {
      displayName: "Ilo Guided Setup",
      installPrompt: `Install the ilo-setup skill from ${agentSkillSourceUrl}.`,
      invocation: "$ilo-setup",
      name: "ilo-setup",
      revision: agentSkillRevision,
      setupPrompt:
        "Set up Ilo for me. Start with get_ilo_context, then call get_ilo_setup and do the work it assigns before asking me for input.",
      sourceUrl: agentSkillSourceUrl,
      version: agentSkillVersion,
    },
  };
  const weather = createWeatherService({
    ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
    now,
  });
  const goalService = createGoalsService({ db: dependencies.db, now });
  const pinterest = createPinterestService({ db: dependencies.db, now });

  app.use("*", async (context, next) => {
    const requestId = context.req.header("x-request-id") ?? randomUUID();
    context.set("requestId", requestId);
    context.header("x-request-id", requestId);
    await next();
  });
  app.use("*", async (_context, next) => {
    if (!dependencies.runtimeLifecycle) {
      await next();
      return;
    }
    const request = dependencies.runtimeLifecycle.runRequest(next);
    if (!request) {
      throw new AppError(
        "service_unavailable",
        "The API is draining and is not accepting new work.",
      );
    }
    await request;
  });
  app.use("*", async (context, next) => {
    const startedAt = performance.now();
    try {
      await next();
    } finally {
      dependencies.log?.({
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        event: "request",
        method: context.req.method,
        path: context.req.path,
        requestId: context.get("requestId"),
        status: context.res.status,
      });
    }
  });
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      allowMethods: ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"],
      credentials: true,
      origin: dependencies.config.allowedOrigins,
    }),
  );
  app.onError(errorResponse);
  app.notFound((_context) => {
    throw new AppError("not_found", "The requested endpoint does not exist.");
  });

  const rateLimitAuth: MiddlewareHandler<AppEnv> = async (context, next) => {
    const source = requestIp(context, dependencies.config.trustProxy) ?? "direct";
    const result = authRateLimiter.check(`${context.req.path}:${source}`);
    if (!result.allowed) {
      context.header("retry-after", String(result.retryAfterSeconds));
      throw new AppError("rate_limited", "Too many account requests. Please try again shortly.");
    }
    await next();
  };
  app.use("/v1/auth/register", rateLimitAuth);
  app.use("/v1/auth/invitations/validate", rateLimitAuth);
  app.use("/v1/auth/login", rateLimitAuth);
  app.use("/v1/auth/recovery", rateLimitAuth);
  app.use("/v1/auth/password-reset", rateLimitAuth);
  app.use("/v1/auth/email-verification/confirm", rateLimitAuth);

  app.get("/health/live", (context) => context.json({ status: "ok" }));
  app.get("/health/ready", async (context) => {
    await dependencies.db.execute(sql`select 1`);
    if (dependencies.runtimeLifecycle) {
      context.header("X-Ilo-Drain-Protocol", "quiesce-v1");
    }
    return context.json({ status: "ready" });
  });
  app.get("/openapi.json", (context) =>
    context.json(createOpenApiDocument(dependencies.config.apiBaseUrl)),
  );

  app.post("/v1/auth/register", async (context) => {
    const result = await auth.register(
      await parseBody(context, registerInputSchema),
      metadata(context, dependencies.config.trustProxy),
    );
    await sendEmailVerification(result.user.email, result.user.id);
    setSessionCookie(context, dependencies, result.token, result.expiresAt);
    return context.json({ sessionToken: result.token, user: result.user }, 201);
  });
  app.post("/v1/auth/invitations/validate", async (context) => {
    const { inviteCode } = await parseBody(context, validateInvitationInputSchema);
    return context.json({ valid: await auth.validateInvitationCode(inviteCode) });
  });
  app.post("/v1/auth/login", async (context) => {
    const result = await auth.login(
      await parseBody(context, loginInputSchema),
      metadata(context, dependencies.config.trustProxy),
    );
    setSessionCookie(context, dependencies, result.token, result.expiresAt);
    return context.json({ sessionToken: result.token, user: result.user });
  });
  app.post("/v1/auth/recovery", async (context) => {
    const input = await parseBody(context, requestPasswordResetInputSchema);
    const reset = await auth.createPasswordResetToken(input.email);
    if (reset) {
      try {
        await sendPasswordReset(reset.email, reset.token);
      } catch {
        // Keep this response identical whether the account exists or delivery is temporarily unavailable.
      }
    }
    return context.body(null, 204);
  });
  app.post("/v1/auth/password-reset", async (context) => {
    const input = await parseBody(context, resetPasswordInputSchema);
    await auth.resetPassword(input.token, input.password);
    return context.body(null, 204);
  });
  app.post("/v1/auth/email-verification/confirm", async (context) => {
    const input = await parseBody(context, confirmEmailVerificationInputSchema);
    return context.json({ user: await auth.verifyEmail(input.token) });
  });
  app.get("/v1/connectors/google/callback", async (context) => {
    const parsed = googleCallbackSchema.safeParse(context.req.query());
    if (!parsed.success) {
      return connectorCallbackRedirect(context, "/settings?section=connections", null);
    }
    const query = parsed.data;
    return completeConnectorCallback(context, "google", () =>
      connectors.handleGoogleAuthorizationCallback({
        ...(query.code ? { code: query.code } : {}),
        ...(query.error ? { error: query.error } : {}),
        ...(query.iss ? { issuer: query.iss } : {}),
        requestId: context.get("requestId"),
        state: query.state,
      }),
    );
  });
  app.post("/v1/connectors/google/gmail/notifications", async (context) => {
    if (
      !dependencies.config.googleGmailPushEnabled ||
      !verifyGooglePubSubToken ||
      !dependencies.config.googleGmailPubsubSubscription
    ) {
      return context.body(null, 404);
    }
    const authorizationHeader = context.req.header("authorization") ?? "";
    const match = /^Bearer ([A-Za-z0-9._~-]+)$/u.exec(authorizationHeader);
    if (!match?.[1]) {
      observeRejectedNotification(context.get("requestId"), 401, "gmail_mailbox");
      return context.body(null, 401);
    }
    try {
      await verifyGooglePubSubToken(match[1]);
    } catch (error) {
      const status = error instanceof GooglePubSubAuthError && error.retryable ? 503 : 401;
      observeRejectedNotification(context.get("requestId"), status, "gmail_mailbox");
      return context.body(null, status);
    }
    const contentLength = Number(context.req.header("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > GMAIL_PUSH_BODY_LIMIT_BYTES) {
      observeRejectedNotification(context.get("requestId"), 413, "gmail_mailbox");
      return context.body(null, 413);
    }
    const raw = await readBoundedRequestBody(context.req.raw, GMAIL_PUSH_BODY_LIMIT_BYTES);
    if (raw === null) {
      observeRejectedNotification(context.get("requestId"), 413, "gmail_mailbox");
      return context.body(null, 413);
    }
    let envelope: z.infer<typeof gmailPushEnvelopeSchema>;
    let data: z.infer<typeof gmailPushDataSchema>;
    try {
      envelope = gmailPushEnvelopeSchema.parse(JSON.parse(raw));
      if (envelope.subscription !== dependencies.config.googleGmailPubsubSubscription) {
        observeRejectedNotification(context.get("requestId"), 404, "gmail_mailbox");
        return context.body(null, 404);
      }
      const decoded = Buffer.from(envelope.message.data, "base64");
      if (decoded.length > 8_192) {
        observeRejectedNotification(context.get("requestId"), 413, "gmail_mailbox");
        return context.body(null, 413);
      }
      data = gmailPushDataSchema.parse(JSON.parse(decoded.toString("utf8")));
    } catch {
      observeRejectedNotification(context.get("requestId"), 400, "gmail_mailbox");
      return context.body(null, 400);
    }
    try {
      const result = await connectors.receiveGmailNotification(data.emailAddress, data.historyId);
      return context.body(null, result === "unknown" ? 404 : 204);
    } catch {
      observeRejectedNotification(context.get("requestId"), 503, "gmail_mailbox");
      return context.body(null, 503);
    }
  });
  app.post("/v1/connectors/google/calendar/notifications", async (context) => {
    if (!dependencies.config.googleCalendarPushEnabled) return context.body(null, 404);
    const contentLength = Number(context.req.header("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 0) {
      observeRejectedNotification(context.get("requestId"), 413);
      return context.body(null, 413);
    }
    const parsed = calendarNotificationHeadersSchema.safeParse({
      channelId: context.req.header("x-goog-channel-id"),
      messageNumber: context.req.header("x-goog-message-number"),
      resourceId: context.req.header("x-goog-resource-id"),
      resourceState: context.req.header("x-goog-resource-state"),
      token: context.req.header("x-goog-channel-token"),
    });
    if (!parsed.success) {
      observeRejectedNotification(context.get("requestId"), 400);
      return context.body(null, 400);
    }
    try {
      const result = await connectors.receiveCalendarNotification(parsed.data);
      return context.body(null, result === "unknown" ? 404 : 204);
    } catch {
      observeRejectedNotification(context.get("requestId"), 503);
      return context.body(null, 503);
    }
  });
  app.get("/v1/x-bookmarks/callback", async (context) => {
    const parsed = xCallbackSchema.safeParse(context.req.query());
    if (!parsed.success) {
      return connectorCallbackRedirect(context, "/settings?section=connections", null);
    }
    const query = parsed.data;
    return completeConnectorCallback(context, "x", () =>
      xBookmarks.handleAuthorizationCallback({
        ...(query.code ? { code: query.code } : {}),
        ...(query.error ? { error: query.error } : {}),
        requestId: context.get("requestId"),
        state: query.state,
      }),
    );
  });

  const oauthSession = async (context: Context<AppEnv>) => {
    const authorization = context.req.header("authorization");
    const token = authorization?.startsWith("Session ")
      ? authorization.slice(8)
      : getCookie(context, dependencies.config.sessionCookieName);
    if (!token)
      throw new AppError("unauthorized", "Sign in to ilo before authorizing an MCP client.");
    const principal = await auth.authenticateSession(token);
    if (!(await auth.getUser(principal.userId)).emailVerified)
      throw new AppError("forbidden", "Verify your email before authorizing an MCP client.");
    return principal;
  };
  app.get("/.well-known/oauth-authorization-server", (context) =>
    context.json({
      authorization_endpoint: `${dependencies.config.apiBaseUrl}/oauth/authorize`,
      code_challenge_methods_supported: ["S256"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      issuer: dependencies.config.apiBaseUrl,
      registration_endpoint: `${dependencies.config.apiBaseUrl}/oauth/register`,
      response_types_supported: ["code"],
      token_endpoint: `${dependencies.config.apiBaseUrl}/oauth/token`,
    }),
  );
  app.post("/oauth/register", async (context) => {
    const input = await parseBody(context, oauthRegisterSchema);
    return context.json(await oauth.registerClient(input.client_name, input.redirect_uris), 201);
  });
  app.get("/oauth/authorize", async (context) => {
    const query = oauthAuthorizeSchema.parse(context.req.query());
    if (
      query.resource !==
      (dependencies.config.mcpResourceUrl ?? `${dependencies.config.apiBaseUrl}/mcp`)
    )
      throw new AppError(
        "invalid_request",
        "This authorization server only issues tokens for the ilo MCP resource.",
      );
    await oauthSession(context);
    const client = await oauth.getAuthorizationClient(query.client_id, query.redirect_uri);
    const scopes = oauth.parseScopes(query.scope);
    return context.html(oauthConsentPage({ clientName: client.name, query, scopes }));
  });
  app.post("/oauth/authorize", async (context) => {
    const input = oauthAuthorizeSchema.parse(await context.req.parseBody());
    if (
      input.resource !==
      (dependencies.config.mcpResourceUrl ?? `${dependencies.config.apiBaseUrl}/mcp`)
    )
      throw new AppError(
        "invalid_request",
        "This authorization server only issues tokens for the ilo MCP resource.",
      );
    const principal = await oauthSession(context);
    const code = await oauth.authorize({
      clientId: input.client_id,
      codeChallenge: input.code_challenge,
      redirectUri: input.redirect_uri,
      scopes: oauth.parseScopes(input.scope),
      userId: principal.userId,
    });
    const redirect = new URL(input.redirect_uri);
    redirect.searchParams.set("code", code);
    if (input.state) redirect.searchParams.set("state", input.state);
    return context.redirect(redirect.toString());
  });
  app.post("/oauth/token", async (context) => {
    const input = await context.req.parseBody();
    const grant = String(input.grant_type ?? "");
    if (grant === "authorization_code")
      return context.json(
        await oauth.exchangeCode({
          clientId: String(input.client_id),
          code: String(input.code),
          codeVerifier: String(input.code_verifier),
          redirectUri: String(input.redirect_uri),
          resource: String(input.resource),
        }),
      );
    if (grant === "refresh_token")
      return context.json(
        await oauth.refresh({
          clientId: String(input.client_id),
          refreshToken: String(input.refresh_token),
          resource: String(input.resource),
        }),
      );
    throw new AppError("invalid_request", "Unsupported OAuth grant type.");
  });

  const authenticate: MiddlewareHandler<AppEnv> = async (context, next) => {
    const authorization = context.req.header("authorization");
    let principal: Principal;
    if (authorization?.startsWith("Bearer ")) {
      const audience = context.req.header("x-personal-os-mcp-resource");
      const internalKey = context.req.header("x-personal-os-mcp-key");
      principal = await auth.authenticateAccessToken(
        authorization.slice(7),
        audience && internalKey === dependencies.config.mcpInternalSecret ? audience : undefined,
      );
    } else if (authorization?.startsWith("Session ")) {
      principal = await auth.authenticateSession(authorization.slice(8));
    } else {
      const token = getCookie(context, dependencies.config.sessionCookieName);
      if (!token) {
        throw new AppError("unauthorized", "Authentication is required.");
      }
      principal = await auth.authenticateSession(token);
    }
    context.set("principal", principal);
    await next();
  };
  app.use("/v1/auth/logout", authenticate);
  app.use("/v1/auth/email-verification", authenticate, requireHuman);
  app.use("/v1/me", authenticate);
  app.use("/v1/setup", authenticate, requireHuman);
  app.use("/v1/sessions/*", authenticate, requireHuman);
  app.use("/v1/sessions", authenticate, requireHuman);
  app.use("/v1/access-tokens/*", authenticate, requireHuman);
  app.use("/v1/access-tokens", authenticate, requireHuman);
  app.use("/v1/oauth/clients/*", authenticate, requireHuman);
  app.use("/v1/oauth/clients", authenticate, requireHuman);
  app.use("/v1/invitations", authenticate, requireHuman);
  app.use("/v1/reminders/*", authenticate);
  app.use("/v1/reminders", authenticate);
  app.use("/v1/task-lists/*", authenticate);
  app.use("/v1/task-lists", authenticate);
  app.use("/v1/task-projects/*", authenticate);
  app.use("/v1/task-projects", authenticate);
  app.use("/v1/tasks/*", authenticate);
  app.use("/v1/tasks", authenticate);
  app.use("/v1/calendars/*", authenticate);
  app.use("/v1/calendars", authenticate);
  app.use("/v1/events/*", authenticate);
  app.use("/v1/events", authenticate);
  app.use("/v1/mail/*", authenticate);
  app.use("/v1/goals/*", authenticate);
  app.use("/v1/goals", authenticate);
  app.use("/v1/motives/*", authenticate);
  app.use("/v1/motives", authenticate);
  app.use("/v1/finances/*", authenticate);
  app.use("/v1/finances", authenticate);
  app.use("/v1/mailboxes", authenticate);
  app.use("/v1/audit", authenticate, requireScope("audit:read"));
  app.use("/v1/daily-brief", authenticate, requireScope("automations:read"));
  app.use("/v1/weather", authenticate, requireHuman);
  app.use("/v1/weather/*", authenticate, requireHuman);
  app.use("/v1/assistant/*", authenticate);
  const requireVerifiedEmail: MiddlewareHandler<AppEnv> = async (context, next) => {
    if (!(await auth.getUser(context.get("principal").userId)).emailVerified)
      throw new AppError("forbidden", "Verify your email before connecting an account.");
    await next();
  };
  app.use("/v1/connectors", authenticate, requireHuman);
  app.use("/v1/connectors/*", authenticate, requireHuman);
  app.use("/v1/connectors/google/start", requireVerifiedEmail);
  app.use("/v1/connectors/icloud", requireVerifiedEmail);
  app.use("/v1/x-bookmarks", authenticate);
  app.use("/v1/x-bookmarks/*", authenticate);
  app.use("/v1/pinterest", authenticate, requireHuman);
  app.use("/v1/pinterest/*", authenticate, requireHuman);

  app.post("/v1/auth/logout", async (context) => {
    const authorization = context.req.header("authorization");
    const token = authorization?.startsWith("Session ")
      ? authorization.slice(8)
      : getCookie(context, dependencies.config.sessionCookieName);
    if (token) {
      await auth.revokeSessionToken(token);
    }
    setCookie(context, dependencies.config.sessionCookieName, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "Lax",
      secure: dependencies.config.production,
    });
    return context.body(null, 204);
  });
  app.get("/v1/me", async (context) =>
    context.json({ user: await auth.getUser(context.get("principal").userId) }),
  );
  app.patch("/v1/me", requireHuman, async (context) => {
    const input = await parseBody(context, updateUserInputSchema);
    const user = await auth.updateUser(context.get("principal").userId, input);
    if (input.email !== undefined) await sendEmailVerification(user.email, user.id);
    return context.json({ user });
  });
  app.patch("/v1/setup", async (context) =>
    context.json({
      user: await auth.updateAccountSetup(
        context.get("principal").userId,
        await parseBody(context, updateAccountSetupInputSchema),
      ),
    }),
  );
  app.post("/v1/auth/email-verification", async (context) => {
    const user = await auth.getUser(context.get("principal").userId);
    await sendEmailVerification(user.email, user.id);
    return context.body(null, 204);
  });

  const requireOwner: MiddlewareHandler<AppEnv> = async (context, next) => {
    if (!(await auth.isOwner(context.get("principal").userId))) {
      throw new AppError("forbidden", "Only workspace owners can manage invitations.");
    }
    await next();
  };
  app.get("/v1/invitations", requireOwner, async (context) =>
    context.json({ invitations: await auth.listInvitations() }),
  );
  app.post("/v1/invitations", requireOwner, async (context) =>
    context.json(
      {
        invitation: await auth.createInvitation(
          context.get("principal").userId,
          await parseBody(context, createInvitationInputSchema),
        ),
      },
      201,
    ),
  );

  app.get("/v1/sessions", async (context) =>
    context.json({ sessions: await auth.listSessions(context.get("principal").userId) }),
  );
  app.delete("/v1/sessions/:id", async (context) => {
    await auth.revokeSession(context.get("principal").userId, context.req.param("id"));
    return context.body(null, 204);
  });
  app.get("/v1/access-tokens", async (context) =>
    context.json({ tokens: await auth.listAccessTokens(context.get("principal").userId) }),
  );
  app.post("/v1/access-tokens", async (context) => {
    const token = await auth.createAccessToken(
      context.get("principal").userId,
      await parseBody(context, createAccessTokenInputSchema),
    );
    return context.json({ token }, 201);
  });
  app.delete("/v1/access-tokens/:id", async (context) => {
    await auth.revokeAccessToken(context.get("principal").userId, context.req.param("id"));
    return context.body(null, 204);
  });
  app.get("/v1/oauth/clients", async (context) =>
    context.json({ clients: await oauth.listAuthorizedClients(context.get("principal").userId) }),
  );
  app.delete("/v1/oauth/clients/:id", async (context) => {
    await oauth.revokeAuthorizedClient(context.get("principal").userId, context.req.param("id"));
    return context.body(null, 204);
  });

  app.get("/v1/connectors", async (context) =>
    context.json({ accounts: await connectors.listAccounts(context.get("principal").userId) }),
  );
  app.get("/v1/connectors/authorization-attempts/:id", async (context) =>
    context.json({
      attempt: await connectors.authorizationOutcome(
        context.get("principal").userId,
        context.req.param("id"),
      ),
    }),
  );
  app.post("/v1/connectors/google/start", async (context) => {
    const input = startGoogleAuthorizationInputSchema.parse({
      ...(context.req.query("accountId") ? { accountId: context.req.query("accountId") } : {}),
      ...(context.req.query("returnTo") ? { returnTo: context.req.query("returnTo") } : {}),
      ...(context.req.query("services")
        ? { services: context.req.query("services")?.split(",") }
        : {}),
    });
    return context.json({
      url: await connectors.startGoogleAuthorization(context.get("principal").userId, input),
    });
  });
  app.post("/v1/connectors/icloud", async (context) => {
    const result = await connectors.connectICloud(
      context.get("principal").userId,
      await parseBody(context, connectICloudInputSchema),
      context.get("requestId"),
    );
    return context.json({ account: { accountId: result.accountId, email: result.email } }, 201);
  });
  app.post("/v1/connectors/:id/sync", async (context) =>
    context.json({
      result: await connectors.syncAccount(
        context.get("principal").userId,
        context.req.param("id"),
      ),
    }),
  );
  app.delete("/v1/connectors/:id", async (context) => {
    await connectors.disconnect(
      context.get("principal").userId,
      context.req.param("id"),
      context.get("requestId"),
    );
    return context.body(null, 204);
  });

  app.post("/v1/x-bookmarks/connect/start", requireHuman, async (context) =>
    context.json({ url: await xBookmarks.startAuthorization(context.get("principal").userId) }),
  );
  app.get("/v1/x-bookmarks/account", requireHuman, async (context) =>
    context.json({ account: await xBookmarks.getAccount(context.get("principal").userId) }),
  );
  app.get("/v1/x-bookmarks/folders", requireHuman, async (context) =>
    context.json({ folders: await xBookmarks.folders(context.get("principal").userId) }),
  );
  app.put("/v1/x-bookmarks/folder", requireHuman, async (context) =>
    context.json({
      result: await xBookmarks.selectFolder(
        context.get("principal").userId,
        (await parseBody(context, xFolderInputSchema)).folderId,
      ),
    }),
  );
  app.post("/v1/x-bookmarks/sync", requireScope("bookmarks:read"), async (context) =>
    context.json({ result: await xBookmarks.sync(context.get("principal").userId) }),
  );
  app.get("/v1/x-bookmarks", requireScope("bookmarks:read"), async (context) =>
    context.json({
      bookmarks: await xBookmarks.list(
        context.get("principal").userId,
        xBookmarkListQuerySchema.parse(context.req.query()).limit,
      ),
    }),
  );
  app.delete("/v1/x-bookmarks/account", requireHuman, async (context) => {
    await xBookmarks.disconnect(context.get("principal").userId);
    return context.body(null, 204);
  });

  app.get("/v1/pinterest", async (context) =>
    context.json({ settings: await pinterest.settings(context.get("principal").userId) }),
  );
  app.get("/v1/pinterest/pins", async (context) => {
    const query = pinterestPinsQuerySchema.parse(context.req.query());
    return context.json({
      pins: await pinterest.pins(context.get("principal").userId, query.limit),
    });
  });
  app.patch("/v1/pinterest", async (context) =>
    context.json({
      settings: await pinterest.updateSettings(
        context.get("principal").userId,
        await parseBody(context, updatePinterestWallpaperSettingsInputSchema),
      ),
    }),
  );
  app.post("/v1/pinterest/applied", async (context) => {
    await pinterest.recordApplied(context.get("principal").userId);
    return context.body(null, 204);
  });

  app.get("/v1/daily-brief", async (context) => {
    const user = await auth.getUser(context.get("principal").userId);
    return context.json({
      brief: await dailyBrief.dailyBrief(
        user.id,
        user.planningTimezone,
        context.get("principal").scopes,
      ),
    });
  });
  app.get("/v1/weather/locations", async (context) => {
    const { query } = weatherLocationSearchQuerySchema.parse({
      query: context.req.query("query"),
    });
    return context.json({ locations: await weather.searchLocations(query) });
  });
  app.get("/v1/weather", async (context) => {
    const query = weatherQuerySchema.parse({
      latitude: context.req.query("latitude"),
      longitude: context.req.query("longitude"),
    });
    const user = await auth.getUser(context.get("principal").userId);
    return context.json({
      weather: await weather.current({
        ...(query.latitude === undefined || query.longitude === undefined
          ? {}
          : { coordinates: { latitude: query.latitude, longitude: query.longitude } }),
        savedLocation: user.homeLocation,
      }),
    });
  });

  registerMailRoutes({ app, mail, mutationContext });

  registerAssistantRoutes({
    workItems: agentAccessWorkItems,
    app,
    assistant,
    connectionGuide: agentConnectionGuide,
    mutationContext,
  });

  registerGoalsRoutes({ app, goals: goalService, mutationContext });

  registerFinanceRoutes({ app, finances, mutationContext });

  registerReminderRoutes({ app, mutationContext, reminders });

  registerTaskListRoutes({ app, mutationContext, taskLists });

  registerTaskProjectRoutes({ app, mutationContext, taskProjects });

  registerTaskRoutes({ app, mutationContext, tasks });

  registerCalendarRoutes({ app, calendar, mutationContext });

  app.get("/v1/audit", async (context) => {
    const query = auditQuerySchema.parse(context.req.query());
    return context.json({ events: await audit.list(context.get("principal").userId, query.limit) });
  });

  async function sendEmailVerification(emailAddress: string, userId: string): Promise<void> {
    const token = await auth.createEmailVerificationToken(userId);
    const url = `${dependencies.config.appBaseUrl}/?verifyEmail=${encodeURIComponent(token)}`;
    await email.send({
      html: `<p>Confirm your email address for ilo:</p><p><a href="${url}">Confirm email</a></p>`,
      subject: "Confirm your ilo email",
      text: `Confirm your ilo email: ${url}`,
      to: emailAddress,
    });
  }

  async function sendPasswordReset(emailAddress: string, token: string): Promise<void> {
    const url = `${dependencies.config.appBaseUrl}/?resetPassword=${encodeURIComponent(token)}`;
    await email.send({
      html: `<p>Reset your ilo password:</p><p><a href="${url}">Reset password</a></p>`,
      subject: "Reset your ilo password",
      text: `Reset your ilo password: ${url}`,
      to: emailAddress,
    });
  }

  return Object.assign(app, {
    async backfillFinanceCashflowInsights() {
      return finances.backfillCashflowInsights();
    },
    async backfillFinanceLedgerIntegrity() {
      return finances.backfillLedgerIntegrity();
    },
    async backfillFinanceLearning() {
      return finances.backfillLearning();
    },
    async backfillFinanceSetupIntegrity() {
      return finances.backfillSetupIntegrity();
    },
    async dispatchDueMailRuleWork() {
      const mailDispatchStartedAt = Date.now();
      await connectors.dispatchDueMailRuleWork().catch((error: unknown) => {
        dependencies.log?.({
          durationMs: Date.now() - mailDispatchStartedAt,
          event: "mail_rule_work_dispatch_failed",
          method: "SCHEDULER",
          path: "/internal/mail/rule-work/dispatch",
          requestId: randomUUID(),
          status: 500,
        });
        throw error;
      });
    },
    async syncDueConnectors() {
      const observeFreshness = async () => {
        const freshnessStartedAt = Date.now();
        const freshness = await connectors.observeSyncFreshness();
        dependencies.log?.({
          durationMs: Date.now() - freshnessStartedAt,
          eligibleAccountCount: freshness.eligibleAccountCount,
          event: "connector_sync_freshness_observed",
          freshnessAgeMs: freshness.freshnessAgeMs,
          method: "SCHEDULER",
          path: "/internal/connectors/freshness",
          requestId: randomUUID(),
          status: 200,
        });
      };
      let syncResult: Awaited<ReturnType<PersonalOsApp["syncDueConnectors"]>>;
      try {
        await connectors.purgeExpiredAuthorizationAttempts();
        await connectors.renewSubscriptions();
        const triggered = await connectors.dispatchTriggeredSyncs();
        const scheduled = await connectors.syncDueAccounts();
        syncResult = {
          attempted: triggered.attempted + scheduled.attempted,
          failed: triggered.failed + scheduled.failed,
          recovered: scheduled.recovered,
          skipped: scheduled.skipped,
          succeeded: triggered.succeeded + scheduled.succeeded,
        };
      } catch (error: unknown) {
        await observeFreshness().catch(() => undefined);
        throw error;
      }
      await observeFreshness();
      return syncResult;
    },
    async superviseICloudMail() {
      if (!dependencies.config.icloudMailIdleEnabled) return;
      const signal = dependencies.runtimeLifecycle?.signal;
      if (!signal) {
        await connectors.runICloudIdlePass();
        return;
      }
      while (!signal?.aborted) {
        const startedAt = Date.now();
        try {
          await connectors.runICloudIdlePass();
        } catch {
          dependencies.log?.({
            code: "icloud_idle_supervisor_failed",
            durationMs: Date.now() - startedAt,
            event: "connector_subscription_failed",
            method: "SCHEDULER",
            path: "/internal/connectors/icloud/mail-idle",
            provider: "icloud",
            requestId: randomUUID(),
            status: 503,
            subscriptionKind: "icloud_mail_idle",
          });
        }
        await new Promise<void>((resolveDelay) => {
          const timeout = setTimeout(resolveDelay, 5_000);
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              resolveDelay();
            },
            { once: true },
          );
        });
      }
    },
    async syncDueFinances() {
      return finances.syncDuePlaidAccounts();
    },
  });
}

function mutationContext(context: Context<AppEnv>) {
  return { principal: context.get("principal"), requestId: context.get("requestId") };
}

function setSessionCookie(
  context: Context,
  dependencies: AppDependencies,
  token: string,
  expiresAt: string,
): void {
  setCookie(context, dependencies.config.sessionCookieName, token, {
    expires: new Date(expiresAt),
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: dependencies.config.production,
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ??
      character,
  );
}

const oauthScopeLabels: Record<string, string> = {
  "audit:read": "Read Ilo activity history",
  "automations:read": "Read the generated daily brief",
  "automations:write": "Legacy automation access (inactive)",
  "bookmarks:read": "Read synchronized bookmarks",
  "calendar:read": "Read calendars and events",
  "calendar:write": "Create and manage events",
  "finances:read": "Read sensitive financial accounts, balances, and activity",
  "finances:write": "Save Finance setup guidance drafts",
  "goals:read": "Read goals and motives",
  "goals:write": "Manage goals and motives",
  "mail:read": "Read connected mail",
  "mail:write": "Manage mail and approved Mail rules",
  "reminders:read": "Read reminders",
  "reminders:write": "Create and manage reminders",
  "tasks:read": "Read tasks",
  "tasks:write": "Create and manage tasks",
};

function oauthConsentPage({
  clientName,
  query,
  scopes,
}: {
  clientName: string;
  query: z.infer<typeof oauthAuthorizeSchema>;
  scopes: string[];
}): string {
  const cancel = new URL(query.redirect_uri);
  cancel.searchParams.set("error", "access_denied");
  if (query.state) cancel.searchParams.set("state", query.state);
  const fields = {
    client_id: query.client_id,
    code_challenge: query.code_challenge,
    code_challenge_method: "S256",
    redirect_uri: query.redirect_uri,
    resource: query.resource,
    scope: scopes.join(" "),
    state: query.state ?? "",
  };
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize ${escapeHtml(clientName)} · Ilo</title>
  <style>
    :root {
      color: #252524;
      background: #f0f0ef;
      font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }

    body {
      align-items: center;
      background: linear-gradient(180deg, #f7f7f6 0%, #f0f0ef 68%);
      display: flex;
      justify-content: center;
      margin: 0;
      min-height: 100vh;
      padding: 1.5rem;
    }

    .oauth-page { width: min(100%, 30rem); }

    .oauth-brand {
      align-items: center;
      display: flex;
      font-size: 0.9375rem;
      font-weight: 700;
      gap: 0.625rem;
      letter-spacing: -0.02em;
      margin: 0 0 1.5rem;
    }

    .oauth-brand__mark {
      align-items: center;
      background: #fbfbfa;
      border: 2px solid currentColor;
      border-radius: 0.5625rem;
      display: inline-flex;
      height: 1.875rem;
      justify-content: center;
      width: 1.875rem;
    }

    .oauth-brand__mark::before {
      border: 1px solid currentColor;
      border-radius: 50%;
      content: "";
      height: 0.6875rem;
      width: 0.6875rem;
    }

    .oauth-card {
      background: #fbfbfa;
      border: 1px solid #d7d7d4;
      border-radius: 0.875rem;
      box-shadow: 0 0.75rem 2.5rem #25252412;
      overflow: hidden;
    }

    .oauth-header { padding: 1.75rem 1.75rem 1.5rem; }

    .oauth-eyebrow {
      color: #686865;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.6875rem;
      font-weight: 600;
      letter-spacing: 0.12em;
      margin: 0 0 0.625rem;
      text-transform: uppercase;
    }

    h1 {
      font-size: clamp(1.75rem, 6vw, 2.25rem);
      letter-spacing: -0.045em;
      line-height: 1.1;
      margin: 0;
      overflow-wrap: anywhere;
    }

    .oauth-intro {
      color: #686865;
      font-size: 0.9375rem;
      line-height: 1.6;
      margin: 0.875rem 0 0;
    }

    .oauth-permissions {
      border-block: 1px solid #d7d7d4;
      padding: 1.25rem 1.75rem;
    }

    h2 {
      font-size: 0.8125rem;
      letter-spacing: -0.01em;
      margin: 0 0 0.75rem;
    }

    .oauth-permissions ul {
      display: grid;
      gap: 0.625rem;
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .oauth-permissions li {
      align-items: flex-start;
      display: flex;
      font-size: 0.875rem;
      gap: 0.625rem;
      line-height: 1.45;
    }

    .oauth-permissions li::before {
      background: #252524;
      border-radius: 50%;
      content: "";
      flex: 0 0 auto;
      height: 0.375rem;
      margin-top: 0.4375rem;
      width: 0.375rem;
    }

    .oauth-actions {
      align-items: center;
      display: flex;
      gap: 0.75rem;
      justify-content: flex-end;
      padding: 1.25rem 1.75rem;
    }

    .oauth-button,
    .oauth-cancel {
      border-radius: 0.5rem;
      font-size: 0.875rem;
      font-weight: 650;
      min-height: 2.5rem;
      padding: 0.625rem 0.875rem;
    }

    .oauth-button {
      background: #252524;
      border: 1px solid #252524;
      color: #f3f3f1;
      cursor: pointer;
    }

    .oauth-button:hover { background: #3b3b39; border-color: #3b3b39; }

    .oauth-cancel {
      color: #686865;
      text-decoration: none;
    }

    .oauth-cancel:hover { color: #252524; text-decoration: underline; text-underline-offset: 0.25rem; }

    .oauth-button:focus-visible {
      background: #3b3b39;
      border-color: #a2a29e;
    }

    .oauth-cancel:focus-visible {
      background: #e8e8e6;
      color: #252524;
    }

    .oauth-security-note {
      color: #686865;
      font-size: 0.75rem;
      line-height: 1.55;
      margin: 1rem 0 0;
      text-align: center;
    }

    @media (max-width: 32rem) {
      body { align-items: flex-start; padding: 1rem; }
      .oauth-brand { margin-bottom: 1rem; }
      .oauth-header, .oauth-permissions, .oauth-actions { padding-inline: 1.25rem; }
      .oauth-actions { align-items: stretch; flex-direction: column; }
      .oauth-button, .oauth-cancel { text-align: center; width: 100%; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto; transition-duration: 0.01ms; }
    }
  </style>
</head>
<body>
  <main class="oauth-page">
    <p class="oauth-brand"><span aria-hidden="true" class="oauth-brand__mark"></span>ilo</p>
    <section aria-labelledby="consent-title" class="oauth-card">
      <header class="oauth-header">
        <p class="oauth-eyebrow">Agent access</p>
        <h1 id="consent-title">Connect ${escapeHtml(clientName)}</h1>
        <p class="oauth-intro">This agent host is requesting access to your Ilo account. Connected provider credentials remain inside Ilo.</p>
      </header>
      <section aria-labelledby="permissions-title" class="oauth-permissions">
        <h2 id="permissions-title">Requested access</h2>
        <ul>${scopes.map((scope) => `<li>${escapeHtml(oauthScopeLabels[scope] ?? scope)}</li>`).join("")}</ul>
      </section>
      <form class="oauth-actions" method="post">
        ${Object.entries(fields)
          .map(
            ([name, value]) =>
              `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
          )
          .join("")}
        <a class="oauth-cancel" href="${escapeHtml(cancel.toString())}">Cancel</a>
        <button class="oauth-button" type="submit">Authorize ${escapeHtml(clientName)}</button>
      </form>
    </section>
    <p class="oauth-security-note">You can revoke this connection at any time from Settings &rarr; Agent access.</p>
  </main>
</body>
</html>`;
}
