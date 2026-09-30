import { describe, expect, it } from "vitest";
import {
  assertProductionAcknowledgement,
  buildPortForwardingSessionArgs,
  createServiceDefinitions,
  projectProductionEnvironment,
  redactProductionError,
  rewriteDatabaseUrl,
  selectTunnelInstance,
  validateProductionDatabase,
} from "./production-runtime.mjs";

describe("local production runtime", () => {
  it("requires the exact production acknowledgement", () => {
    expect(() => assertProductionAcknowledgement({})).toThrow("I_UNDERSTAND_THIS_IS_PRODUCTION");
    expect(() => assertProductionAcknowledgement({ ILO_PRODUCTION_RUNTIME: "yes" })).toThrow(
      "I_UNDERSTAND_THIS_IS_PRODUCTION",
    );
    expect(() =>
      assertProductionAcknowledgement({
        ILO_PRODUCTION_RUNTIME: "I_UNDERSTAND_THIS_IS_PRODUCTION",
      }),
    ).not.toThrow();
  });

  it("accepts only the private, available production database", () => {
    expect(
      validateProductionDatabase({
        DBInstanceIdentifier: "personal-os-prod-postgres",
        DBInstanceStatus: "available",
        PubliclyAccessible: false,
        Endpoint: { Address: "prod.internal", Port: 5432 },
      }),
    ).toEqual({ endpoint: "prod.internal", port: 5432 });

    for (const invalid of [
      {
        DBInstanceIdentifier: "personal-os-stage-postgres",
        DBInstanceStatus: "available",
        PubliclyAccessible: false,
        Endpoint: { Address: "stage.internal", Port: 5432 },
      },
      {
        DBInstanceIdentifier: "personal-os-prod-postgres",
        DBInstanceStatus: "available",
        PubliclyAccessible: true,
        Endpoint: { Address: "public.example", Port: 5432 },
      },
      {
        DBInstanceIdentifier: "personal-os-prod-postgres",
        DBInstanceStatus: "stopping",
        PubliclyAccessible: false,
        Endpoint: { Address: "prod.internal", Port: 5432 },
      },
    ]) {
      expect(() => validateProductionDatabase(invalid)).toThrow("production database");
    }
  });

  it("selects one tagged tunnel and rejects ambiguous or untagged instances", () => {
    const tunnel = {
      InstanceId: "i-tunnel",
      State: { Name: "stopped" },
      Tags: [
        { Key: "Name", Value: "personal-os-prod-local-db-tunnel" },
        { Key: "LocalProductionRuntime", Value: "true" },
      ],
    };
    expect(selectTunnelInstance([tunnel])).toEqual(tunnel);
    expect(() => selectTunnelInstance([])).toThrow("exactly one");
    expect(() => selectTunnelInstance([tunnel, { ...tunnel, InstanceId: "i-other" }])).toThrow(
      "exactly one",
    );
  });

  it("rewrites only database transport details and preserves TLS verification", () => {
    const rewritten = new URL(
      rewriteDatabaseUrl(
        "postgresql://app:secret@prod.internal:5432/personal_os?sslmode=verify-full&application_name=ilo",
        55438,
        "/tmp/aws-rds-global-bundle.pem",
      ),
    );
    expect(rewritten.hostname).toBe("127.0.0.1");
    expect(rewritten.port).toBe("55438");
    expect(rewritten.username).toBe("app");
    expect(rewritten.password).toBe("secret");
    expect(rewritten.pathname).toBe("/personal_os");
    expect(rewritten.searchParams.get("sslmode")).toBe("verify-ca");
    expect(rewritten.searchParams.get("sslrootcert")).toBe("/tmp/aws-rds-global-bundle.pem");
    expect(rewritten.searchParams.get("application_name")).toBe("ilo");
  });

  it("projects deployed production configuration into localhost without dropping secrets", () => {
    const environment = projectProductionEnvironment({
      certificatePath: "/tmp/aws-rds-global-bundle.pem",
      local: {
        apiPort: 8793,
        apiUrl: "http://127.0.0.1:8793",
        databasePort: 55438,
        mcpUrl: "http://127.0.0.1:8794",
        webUrl: "http://localhost:8086",
      },
      parameters: {
        "/personal-os/prod/APP_ENCRYPTION_KEY": "encryption-secret",
        "/personal-os/prod/DATABASE_URL":
          "postgresql://app:db-secret@prod.internal:5432/personal_os?sslmode=verify-full",
        "/personal-os/prod/GOOGLE_CLIENT_ID": "google-client",
        "/personal-os/prod/GOOGLE_CLIENT_SECRET": "google-secret",
        "/personal-os/prod/MCP_INTERNAL_SECRET": "mcp-secret-value-that-is-at-least-32-characters",
        "/personal-os/prod/RESEND_API_KEY": "resend-secret",
      },
      task: {
        environment: [
          { name: "APP_BASE_URL", value: "https://app.example.com" },
          { name: "API_BASE_URL", value: "https://api.example.com" },
          { name: "NODE_ENV", value: "production" },
          { name: "REGISTRATION_MODE", value: "invite" },
          { name: "GOOGLE_GMAIL_PUSH_ENABLED", value: "true" },
        ],
        secrets: [
          {
            name: "APP_ENCRYPTION_KEY",
            valueFrom:
              "arn:aws:ssm:us-east-1:123456789012:parameter/personal-os/prod/APP_ENCRYPTION_KEY",
          },
          {
            name: "DATABASE_URL",
            valueFrom: "arn:aws:ssm:us-east-1:123456789012:parameter/personal-os/prod/DATABASE_URL",
          },
          {
            name: "GOOGLE_CLIENT_ID",
            valueFrom:
              "arn:aws:ssm:us-east-1:123456789012:parameter/personal-os/prod/GOOGLE_CLIENT_ID",
          },
          {
            name: "GOOGLE_CLIENT_SECRET",
            valueFrom:
              "arn:aws:ssm:us-east-1:123456789012:parameter/personal-os/prod/GOOGLE_CLIENT_SECRET",
          },
          {
            name: "MCP_INTERNAL_SECRET",
            valueFrom:
              "arn:aws:ssm:us-east-1:123456789012:parameter/personal-os/prod/MCP_INTERNAL_SECRET",
          },
          {
            name: "RESEND_API_KEY",
            valueFrom:
              "arn:aws:ssm:us-east-1:123456789012:parameter/personal-os/prod/RESEND_API_KEY",
          },
        ],
      },
    });

    expect(environment).toMatchObject({
      ALLOWED_ORIGINS: "http://localhost:8086,tauri://localhost,http://tauri.localhost",
      API_BASE_URL: "http://127.0.0.1:8793",
      APP_BASE_URL: "http://localhost:8086",
      APP_ENCRYPTION_KEY: "encryption-secret",
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
      GOOGLE_GMAIL_PUSH_ENABLED: "false",
      GOOGLE_REDIRECT_URI: "http://127.0.0.1:8793/v1/connectors/google/callback",
      MCP_INTERNAL_SECRET: "mcp-secret-value-that-is-at-least-32-characters",
      MCP_RESOURCE_URL: "http://127.0.0.1:8794/mcp",
      NODE_ENV: "development",
      PORT: "8793",
      RESEND_API_KEY: "resend-secret",
      TRUST_PROXY: "false",
      X_REDIRECT_URI: "http://127.0.0.1:8793/v1/x-bookmarks/callback",
    });
    expect(new URL(environment.DATABASE_URL).hostname).toBe("127.0.0.1");
  });

  it("fails when a deployed secret has no resolved parameter", () => {
    expect(() =>
      projectProductionEnvironment({
        certificatePath: "/tmp/cert.pem",
        local: {
          apiPort: 8793,
          apiUrl: "http://127.0.0.1:8793",
          databasePort: 55438,
          mcpUrl: "http://127.0.0.1:8794",
          webUrl: "http://localhost:8086",
        },
        parameters: {},
        task: {
          environment: [],
          secrets: [
            {
              name: "DATABASE_URL",
              valueFrom:
                "arn:aws:ssm:us-east-1:123456789012:parameter/personal-os/prod/DATABASE_URL",
            },
          ],
        },
      }),
    ).toThrow("DATABASE_URL");
  });

  it("redacts every known production value from errors", () => {
    expect(
      redactProductionError(new Error("failed with db-secret and google-secret"), [
        "db-secret",
        "google-secret",
      ]),
    ).toBe("failed with [REDACTED] and [REDACTED]");
  });

  it("opens only the remote-host PostgreSQL forwarding document", () => {
    expect(
      buildPortForwardingSessionArgs({
        databaseEndpoint: "prod.internal",
        databasePort: 5432,
        instanceId: "i-tunnel",
        localPort: 55438,
        region: "us-east-1",
      }),
    ).toEqual([
      "ssm",
      "start-session",
      "--region",
      "us-east-1",
      "--target",
      "i-tunnel",
      "--document-name",
      "AWS-StartPortForwardingSessionToRemoteHost",
      "--parameters",
      '{"host":["prod.internal"],"portNumber":["5432"],"localPortNumber":["55438"]}',
    ]);
  });

  it("keeps secrets in child environments rather than command arguments", () => {
    const definitions = createServiceDefinitions({
      environment: {
        APP_ENCRYPTION_KEY: "encryption-secret",
        DATABASE_URL: "postgresql://app:db-secret@127.0.0.1:55438/personal_os",
        MCP_INTERNAL_SECRET: "mcp-secret-value-that-is-at-least-32-characters",
      },
      local: {
        apiPort: 8793,
        apiUrl: "http://127.0.0.1:8793",
        mcpPort: 8794,
        mcpUrl: "http://127.0.0.1:8794",
        webPort: 8086,
        webUrl: "http://localhost:8086",
      },
      root: "/workspace",
    });

    expect(definitions.map(({ name }) => name)).toEqual(["api", "mcp", "web"]);
    expect(definitions[0].args).toEqual([
      "--filter",
      "@personal-os/api",
      "exec",
      "tsx",
      "src/main.ts",
    ]);
    expect(definitions[1].environment).toMatchObject({
      MCP_INTERNAL_SECRET: "mcp-secret-value-that-is-at-least-32-characters",
      PERSONAL_OS_API_URL: "http://127.0.0.1:8793",
      PORT: "8794",
    });
    expect(definitions[2].args).toEqual([
      "--filter",
      "@personal-os/web",
      "exec",
      "vite",
      "--host",
      "127.0.0.1",
      "--port",
      "8086",
      "--strictPort",
    ]);
    expect(JSON.stringify(definitions.map(({ args }) => args))).not.toContain("secret");
  });
});
