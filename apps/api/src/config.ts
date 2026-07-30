import { iloSetupRelease, semanticVersionSchema } from "@personal-os/domain";
import { z } from "zod";

export const officialAgentSkill = iloSetupRelease;

const configSchema = z
  .object({
    APP_BASE_URL: z.url(),
    ALLOWED_ORIGINS: z.string().optional(),
    AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).max(1_000).default(20),
    AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3_600).default(300),
    API_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(110_000).default(105_000),
    API_BASE_URL: z.url(),
    AGENT_SKILL_REVISION: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
      .default(officialAgentSkill.revision),
    AGENT_SKILL_SOURCE_URL: z.url().default(officialAgentSkill.sourceUrl),
    AGENT_SKILL_VERSION: semanticVersionSchema.default(officialAgentSkill.version),
    APP_ENCRYPTION_KEY: z.string().min(1),
    DATABASE_URL: z.string().min(1),
    EMAIL_FROM: z.string().default(""),
    GOOGLE_CLIENT_ID: z.string().default(""),
    GOOGLE_CLIENT_SECRET: z.string().default(""),
    GOOGLE_REDIRECT_URI: z.url(),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    MCP_RESOURCE_URL: z.url().optional(),
    MCP_INTERNAL_SECRET: z.string().min(32).optional(),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    OWNER_EMAILS: z.string().default(""),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8788),
    PLAID_CLIENT_ID: z.string().default(""),
    PLAID_ENV: z.enum(["sandbox", "development", "production"]).default("sandbox"),
    PLAID_SECRET: z.string().default(""),
    RESEND_API_KEY: z.string().default(""),
    REGISTRATION_MODE: z.enum(["invite", "open"]).default("invite"),
    SESSION_COOKIE_NAME: z.string().min(1).default("personal_os_session"),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    TRUST_PROXY: z.enum(["true", "false"]).default("false"),
    X_CLIENT_ID: z.string().default(""),
    X_CLIENT_SECRET: z.string().default(""),
    X_REDIRECT_URI: z.url(),
  })
  .superRefine((value, context) => {
    if (!sourceIdentifiesRevision(value.AGENT_SKILL_SOURCE_URL, value.AGENT_SKILL_REVISION)) {
      context.addIssue({
        code: "custom",
        message:
          "AGENT_SKILL_SOURCE_URL must include AGENT_SKILL_REVISION so the guide identifies a release instead of a generic latest endpoint.",
        path: ["AGENT_SKILL_SOURCE_URL"],
      });
    }
    if (value.NODE_ENV !== "production") return;
    if (!value.EMAIL_FROM) {
      context.addIssue({
        code: "custom",
        message: "EMAIL_FROM is required in production for account verification and recovery.",
        path: ["EMAIL_FROM"],
      });
    }
    if (!value.RESEND_API_KEY) {
      context.addIssue({
        code: "custom",
        message: "RESEND_API_KEY is required in production for account verification and recovery.",
        path: ["RESEND_API_KEY"],
      });
    }
    if (!value.OWNER_EMAILS.trim()) {
      context.addIssue({
        code: "custom",
        message: "OWNER_EMAILS is required in production to control invitations.",
        path: ["OWNER_EMAILS"],
      });
    }
    if (!value.MCP_INTERNAL_SECRET) {
      context.addIssue({
        code: "custom",
        message:
          "MCP_INTERNAL_SECRET is required in production to protect the MCP-to-API boundary.",
        path: ["MCP_INTERNAL_SECRET"],
      });
    }
    if (value.REGISTRATION_MODE !== "invite") {
      context.addIssue({
        code: "custom",
        message: "Production registration must remain invite-only.",
        path: ["REGISTRATION_MODE"],
      });
    }
  });

function sourceIdentifiesRevision(sourceUrl: string, revision: string): boolean {
  const url = new URL(sourceUrl);
  const pathSegments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  return (
    pathSegments.includes(revision) ||
    [...url.searchParams.values()].includes(revision) ||
    url.hash.slice(1).split(/[/:]/).filter(Boolean).map(decodeURIComponent).includes(revision)
  );
}

export type AppConfig = {
  agentSkillRevision?: string;
  agentSkillSourceUrl?: string;
  agentSkillVersion?: string;
  allowedOrigins: string[];
  authRateLimitMaxRequests?: number;
  authRateLimitWindowSeconds?: number;
  apiBaseUrl: string;
  apiShutdownTimeoutMs: number;
  appBaseUrl: string;
  databaseUrl: string;
  emailFrom: string;
  encryptionKey: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  logLevel: "debug" | "info" | "warn" | "error";
  mcpResourceUrl?: string;
  mcpInternalSecret?: string;
  port: number;
  plaidClientId: string;
  plaidEnvironment: "sandbox" | "development" | "production";
  plaidSecret: string;
  production: boolean;
  ownerEmails?: string[];
  registrationMode?: "invite" | "open";
  resendApiKey: string;
  sessionCookieName: string;
  sessionTtlDays: number;
  trustProxy?: boolean;
  xClientId: string;
  xClientSecret: string;
  xRedirectUri: string;
};

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const value = configSchema.parse(migrateLegacyOfficialAgentSkill(environment));
  return {
    agentSkillRevision: value.AGENT_SKILL_REVISION,
    agentSkillSourceUrl: value.AGENT_SKILL_SOURCE_URL,
    agentSkillVersion: value.AGENT_SKILL_VERSION,
    allowedOrigins: value.ALLOWED_ORIGINS
      ? [
          ...new Set([
            value.APP_BASE_URL,
            ...value.ALLOWED_ORIGINS.split(",").map((item) => item.trim()),
          ]),
        ]
      : [value.APP_BASE_URL],
    authRateLimitMaxRequests: value.AUTH_RATE_LIMIT_MAX_REQUESTS,
    authRateLimitWindowSeconds: value.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    apiBaseUrl: value.API_BASE_URL,
    apiShutdownTimeoutMs: value.API_SHUTDOWN_TIMEOUT_MS,
    appBaseUrl: value.APP_BASE_URL,
    databaseUrl: value.DATABASE_URL,
    emailFrom: value.EMAIL_FROM,
    encryptionKey: value.APP_ENCRYPTION_KEY,
    googleClientId: value.GOOGLE_CLIENT_ID,
    googleClientSecret: value.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: value.GOOGLE_REDIRECT_URI,
    logLevel: value.LOG_LEVEL,
    mcpResourceUrl: value.MCP_RESOURCE_URL ?? `${value.API_BASE_URL}/mcp`,
    ...(value.MCP_INTERNAL_SECRET ? { mcpInternalSecret: value.MCP_INTERNAL_SECRET } : {}),
    port: value.PORT,
    plaidClientId: value.PLAID_CLIENT_ID,
    plaidEnvironment: value.PLAID_ENV,
    plaidSecret: value.PLAID_SECRET,
    production: value.NODE_ENV === "production",
    ownerEmails: value.OWNER_EMAILS.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    registrationMode: value.REGISTRATION_MODE,
    resendApiKey: value.RESEND_API_KEY,
    sessionCookieName: value.SESSION_COOKIE_NAME,
    sessionTtlDays: value.SESSION_TTL_DAYS,
    trustProxy: value.TRUST_PROXY === "true",
    xClientId: value.X_CLIENT_ID,
    xClientSecret: value.X_CLIENT_SECRET,
    xRedirectUri: value.X_REDIRECT_URI,
  };
}

function migrateLegacyOfficialAgentSkill(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (environment.AGENT_SKILL_SOURCE_URL !== officialAgentSkill.legacySourceUrl) {
    return environment;
  }
  if (
    environment.AGENT_SKILL_VERSION &&
    environment.AGENT_SKILL_VERSION !== officialAgentSkill.version
  ) {
    return environment;
  }
  if (
    environment.AGENT_SKILL_REVISION &&
    environment.AGENT_SKILL_REVISION !== officialAgentSkill.revision
  ) {
    return environment;
  }
  return {
    ...environment,
    AGENT_SKILL_REVISION: officialAgentSkill.revision,
    AGENT_SKILL_SOURCE_URL: officialAgentSkill.sourceUrl,
    AGENT_SKILL_VERSION: officialAgentSkill.version,
  };
}
