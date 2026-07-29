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
  createAutomationRoutineInputSchema,
  createInvitationInputSchema,
  featureAccessPolicies,
  loginInputSchema,
  registerInputSchema,
  requestPasswordResetInputSchema,
  resetPasswordInputSchema,
  startGoogleAuthorizationInputSchema,
  updateAccountSetupInputSchema,
  updateAutomationRoutineInputSchema,
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
import { createAssistantService } from "./assistant-service.js";
import { createAuditService } from "./audit.js";
import { createAuthService } from "./auth-service.js";
import { createAutomationService } from "./automation-service.js";
import { createCalendarService } from "./calendar-service.js";
import { createConnectorService } from "./connector-service.js";
import { createEmailDelivery } from "./email-delivery.js";
import { AppError, errorResponse } from "./errors.js";
import { createFinanceService } from "./finance-service.js";
import { createGoalsService } from "./goals-service.js";
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
import { registerTaskRoutes } from "./routes/tasks.js";
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
  dispatchDueAutomations: () => Promise<void>;
  syncDueFinances: () => Promise<{ failed: number; reasons: string[]; synced: number }>;
};

const auditQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });
const automationRunsQuerySchema = z.object({ routineId: z.uuid().optional() });
const runAutomationInputSchema = z.object({ dryRun: z.boolean().default(false) });
const googleCallbackSchema = z.object({
  code: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  state: z.string().min(1),
});
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
const defaultAgentSkillSourceUrl =
  "https://github.com/coopersully/personal-os/tree/main/skills/ilo-setup";

export function createApp(dependencies: AppDependencies): PersonalOsApp {
  const app = new Hono<AppEnv>();
  const now = dependencies.now ?? (() => new Date());
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
  const tasks = createTaskService({ db: dependencies.db, now });
  const google =
    dependencies.google ??
    createGoogleConnector({
      clientId: dependencies.config.googleClientId,
      clientSecret: dependencies.config.googleClientSecret,
      now,
      redirectUri: dependencies.config.googleRedirectUri,
    });
  const connectors = createConnectorService({
    db: dependencies.db,
    encryptionKey: dependencies.config.encryptionKey,
    google,
    icloud: dependencies.icloud ?? createICloudConnector(),
    now,
  });
  const xBookmarks = createXBookmarksService({
    db: dependencies.db,
    encryptionKey: dependencies.config.encryptionKey,
    now,
    x:
      dependencies.x ??
      createXConnector({
        clientId: dependencies.config.xClientId,
        clientSecret: dependencies.config.xClientSecret,
        now,
        redirectUri: dependencies.config.xRedirectUri,
      }),
  });
  const calendar = createCalendarService({
    connectedEvents: connectors.eventGateway,
    db: dependencies.db,
    now,
    observeProviderFailure: (entry) =>
      dependencies.log?.({
        calendarProviderReconciliation: entry,
        durationMs: 0,
        event: "calendar_provider_reconciliation",
        method: "CALENDAR",
        path: `/internal/calendar/provider-effects/${entry.operation}`,
        requestId: entry.requestId,
        status: entry.status,
      }),
  });
  const automations = createAutomationService({
    db: dependencies.db,
    listEvents: calendar.listEvents,
    listReminders: async (userId) =>
      (await reminders.list(userId, { completed: false, limit: 100 })).items,
    listTasks: async (userId, completed) =>
      (await tasks.list(userId, { completed, limit: 100 })).items,
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
      if (domain === "finances") {
        await finances.validateProfileSources(transaction, userId, sourceIds, status, actorType);
      }
    },
  });
  const agentSkillSourceUrl = dependencies.config.agentSkillSourceUrl ?? defaultAgentSkillSourceUrl;
  const agentConnectionGuide: AgentConnectionGuide = {
    domains: assistantDomains.map((domain) => ({
      domain,
      readScope: featureAccessPolicies[domain].readScope,
      support: domain === "mail" ? "executable_rules" : "profile_and_attention",
      writeScope: featureAccessPolicies[domain].writeScope,
    })),
    mcpUrl: dependencies.config.mcpResourceUrl ?? `${dependencies.config.apiBaseUrl}/mcp`,
    skill: {
      displayName: "Ilo Guided Setup",
      installPrompt: `Install the Ilo Guided Setup skill from ${agentSkillSourceUrl}. Make it available as $ilo-setup, then tell me when it is ready.`,
      invocation: "$ilo-setup",
      name: "ilo-setup",
      setupPrompt:
        "Use $ilo-setup to inspect my connected Ilo domains and run the shortest useful setup interview.",
      sourceUrl: agentSkillSourceUrl,
      version: "0.1.0",
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
    const query = googleCallbackSchema.parse(context.req.query());
    if (query.error || !query.code) {
      throw new AppError(
        "invalid_request",
        query.error
          ? `Google authorization failed: ${query.error}`
          : "Google did not return an authorization code.",
      );
    }
    const result = await connectors.completeGoogleAuthorization(query.state, query.code);
    void connectors.syncAccount(result.userId, result.accountId).catch(() => {
      // The account and credentials are already saved, while syncAccount records
      // the provider error for the settings UI and a later manual retry.
    });
    const separator = result.returnPath.includes("?") ? "&" : "?";
    return context.redirect(
      `${dependencies.config.appBaseUrl}${result.returnPath}${separator}google=connected`,
    );
  });
  app.get("/v1/x-bookmarks/callback", async (context) => {
    const query = xCallbackSchema.parse(context.req.query());
    if (query.error || !query.code) {
      throw new AppError(
        "invalid_request",
        query.error
          ? `X authorization failed: ${query.error}`
          : "X did not return an authorization code.",
      );
    }
    await xBookmarks.completeAuthorization(query.state, query.code);
    return context.redirect(`${dependencies.config.appBaseUrl}/settings/connectors?x=connected`);
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
  app.use("/v1/automations", authenticate);
  app.use("/v1/automations/*", authenticate);
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
    void connectors.syncAccount(result.userId, result.accountId).catch(() => {
      // The account and credentials are already saved, while syncAccount records
      // the provider error for the settings UI and a later manual retry.
    });
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
      brief: await automations.dailyBrief(
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

  app.get("/v1/automations", requireScope("automations:read"), async (context) =>
    context.json({ routines: await automations.list(context.get("principal").userId) }),
  );
  app.post("/v1/automations", requireHuman, async (context) => {
    const routine = await automations.create(
      context.get("principal").userId,
      await parseBody(context, createAutomationRoutineInputSchema),
    );
    return context.json({ routine }, 201);
  });
  app.patch("/v1/automations/:id", requireHuman, async (context) =>
    context.json({
      routine: await automations.update(
        context.req.param("id"),
        await parseBody(context, updateAutomationRoutineInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.get("/v1/automations/runs", requireScope("automations:read"), async (context) =>
    context.json({
      runs: await automations.listRuns(
        context.get("principal").userId,
        automationRunsQuerySchema.parse(context.req.query()).routineId,
      ),
    }),
  );
  app.post("/v1/automations/:id/runs", requireScope("automations:write"), async (context) =>
    context.json(
      {
        run: await automations.run(
          context.req.param("id"),
          (await parseBody(context, runAutomationInputSchema)).dryRun,
          mutationContext(context),
        ),
      },
      201,
    ),
  );

  registerMailRoutes({ app, mail, mutationContext });

  registerAssistantRoutes({
    app,
    assistant,
    connectionGuide: agentConnectionGuide,
    mutationContext,
  });

  registerGoalsRoutes({ app, goals: goalService, mutationContext });

  registerFinanceRoutes({ app, finances, mutationContext });

  registerReminderRoutes({ app, mutationContext, reminders });

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
    async dispatchDueAutomations() {
      await connectors.syncStaleAccounts();
      await automations.dispatchDue();
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
  "automations:read": "Read automations",
  "automations:write": "Run approved automations",
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
</head>
<body>
  <main>
    <p>Ilo agent access</p>
    <h1>Connect ${escapeHtml(clientName)}</h1>
    <p>This agent host is requesting access to your Ilo account. Connected provider credentials remain inside Ilo.</p>
    <h2>Requested permissions</h2>
    <ul>${scopes.map((scope) => `<li>${escapeHtml(oauthScopeLabels[scope] ?? scope)}</li>`).join("")}</ul>
    <p>You can revoke this connection at any time from Settings → Agent access.</p>
    <form method="post">
      ${Object.entries(fields)
        .map(
          ([name, value]) =>
            `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
        )
        .join("")}
      <button type="submit">Authorize ${escapeHtml(clientName)}</button>
      <a href="${escapeHtml(cancel.toString())}">Cancel</a>
    </form>
  </main>
</body>
</html>`;
}
