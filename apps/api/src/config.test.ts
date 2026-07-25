import { loadConfig } from "./config.js";

const required = {
  APP_BASE_URL: "https://app.example.com",
  API_BASE_URL: "https://api.example.com",
  APP_ENCRYPTION_KEY: "secret",
  DATABASE_URL: "postgres://localhost/personal_os",
  GOOGLE_REDIRECT_URI: "https://api.example.com/v1/connectors/google/callback",
  X_REDIRECT_URI: "https://api.example.com/v1/x-bookmarks/callback",
};

describe("API configuration", () => {
  it("applies development defaults", () => {
    expect(loadConfig(required)).toEqual({
      allowedOrigins: ["https://app.example.com"],
      authRateLimitMaxRequests: 20,
      authRateLimitWindowSeconds: 300,
      apiBaseUrl: "https://api.example.com",
      appBaseUrl: "https://app.example.com",
      databaseUrl: "postgres://localhost/personal_os",
      emailFrom: "",
      encryptionKey: "secret",
      googleClientId: "",
      googleClientSecret: "",
      googleRedirectUri: "https://api.example.com/v1/connectors/google/callback",
      logLevel: "info",
      mcpResourceUrl: "https://api.example.com/mcp",
      port: 8787,
      plaidClientId: "",
      plaidEnvironment: "sandbox",
      plaidSecret: "",
      production: false,
      ownerEmails: [],
      registrationMode: "invite",
      resendApiKey: "",
      sessionCookieName: "personal_os_session",
      sessionTtlDays: 30,
      trustProxy: false,
      xClientId: "",
      xClientSecret: "",
      xRedirectUri: "https://api.example.com/v1/x-bookmarks/callback",
    });
  });

  it("allows an explicitly empty local email sender outside production", () => {
    expect(loadConfig({ ...required, EMAIL_FROM: "" }).emailFrom).toBe("");
  });

  it("normalizes production overrides and de-duplicates origins", () => {
    expect(
      loadConfig({
        ...required,
        ALLOWED_ORIGINS:
          " https://mobile.example.com,https://app.example.com,https://desktop.example.com ",
        EMAIL_FROM: "ilo <noreply@example.com>",
        GOOGLE_CLIENT_ID: "client",
        GOOGLE_CLIENT_SECRET: "secret",
        LOG_LEVEL: "warn",
        MCP_INTERNAL_SECRET: "mcp-internal-secret-that-is-long-enough",
        NODE_ENV: "production",
        OWNER_EMAILS: "owner@example.com",
        PORT: "9000",
        AUTH_RATE_LIMIT_MAX_REQUESTS: "10",
        AUTH_RATE_LIMIT_WINDOW_SECONDS: "60",
        PLAID_CLIENT_ID: "plaid-client",
        PLAID_ENV: "development",
        PLAID_SECRET: "plaid-secret",
        RESEND_API_KEY: "resend-key",
        SESSION_COOKIE_NAME: "session",
        SESSION_TTL_DAYS: "7",
      }),
    ).toMatchObject({
      allowedOrigins: [
        "https://app.example.com",
        "https://mobile.example.com",
        "https://desktop.example.com",
      ],
      googleClientId: "client",
      googleClientSecret: "secret",
      authRateLimitMaxRequests: 10,
      authRateLimitWindowSeconds: 60,
      logLevel: "warn",
      port: 9000,
      plaidClientId: "plaid-client",
      plaidEnvironment: "development",
      plaidSecret: "plaid-secret",
      production: true,
      ownerEmails: ["owner@example.com"],
      registrationMode: "invite",
      resendApiKey: "resend-key",
      sessionCookieName: "session",
      sessionTtlDays: 7,
      trustProxy: false,
    });
  });

  it("rejects incomplete or invalid deployment configuration", () => {
    expect(() => loadConfig({ ...required, PORT: "0" })).toThrow();
    expect(() => loadConfig({ ...required, NODE_ENV: "production" })).toThrow();
    expect(() =>
      loadConfig({
        ...required,
        EMAIL_FROM: "ilo <noreply@example.com>",
        MCP_INTERNAL_SECRET: "mcp-internal-secret-that-is-long-enough",
        NODE_ENV: "production",
        OWNER_EMAILS: "owner@example.com",
        REGISTRATION_MODE: "open",
        RESEND_API_KEY: "resend-key",
      }),
    ).toThrow("Production registration must remain invite-only.");
    expect(() => loadConfig({})).toThrow();
  });
});
