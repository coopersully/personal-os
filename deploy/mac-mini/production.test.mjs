import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { composeModel, environmentFiles, validateConfig } from "./compose.mjs";
import { assertEmptyDatabase, validateRestoreReceipt, withLock } from "./safety.mjs";

function fixture(root = "/Users/nohmi-production/nohmi-production") {
  const image = `example.invalid/ilo@sha256:${"a".repeat(64)}`;
  return {
    version: 1,
    root,
    dockerHost: "unix:///Users/nohmi-production/.colima/nohmi-production/docker.sock",
    revision: "b".repeat(40),
    images: Object.fromEntries(
      ["api", "mcp", "web", "postgres", "gateway", "tunnel"].map((k) => [k, image]),
    ),
    postgresMajor: 17,
    backupRecipient: "age1example",
  };
}

test("production has isolated storage, no published ports and explicit resource limits", () => {
  const model = composeModel(fixture());
  assert.equal(model.name, "nohmi-production");
  for (const service of Object.values(model.services)) {
    assert.equal(service.ports, undefined);
    assert.equal(service.build, undefined);
    assert.ok(service.mem_limit);
    assert.ok(service.cpus);
    assert.deepEqual(service.cap_drop, ["ALL"]);
    assert.ok(!JSON.stringify(service).includes("docker.sock"));
  }
  assert.equal(model.networks.database.internal, true);
  assert.deepEqual(model.services.tunnel.networks, ["edge"]);
  assert.deepEqual(model.services.web.networks, ["origin"]);
  assert.equal(model.services.api.stop_grace_period, "120s");
  assert.deepEqual(model.services.postgres.volumes, ["postgres-data:/var/lib/postgresql/data"]);
});

test("refuses mutable images, unknown keys, shared runtime sockets and unsafe paths", () => {
  for (const mutate of [
    (c) => {
      c.images.api = "api:latest";
    },
    (c) => {
      c.dockerHost = "unix:///var/run/docker.sock";
    },
    (c) => {
      c.dockerHost = "unix:///Users/nohmi-production/.colima/ilo-production/docker.sock";
    },
    (c) => {
      c.root = "/Users/nohmi-production/ilo-production";
    },
    (c) => {
      c.root = "/";
    },
    (c) => {
      c.root = "relative";
    },
    (c) => {
      c.revision = "main";
    },
    (c) => {
      c.postgresMajor = 18;
    },
    (c) => {
      c.extra = "ignored?";
    },
  ]) {
    const config = fixture();
    mutate(config);
    assert.throws(() => validateConfig(config));
  }
});

test("configuration preserves provider values without interpolation or cross-service leakage", () => {
  const source = {
    APP_BASE_URL: "https://app.ilo.coopersully.me",
    API_BASE_URL: "https://api.ilo.coopersully.me",
    APP_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
    MCP_INTERNAL_SECRET: "x".repeat(32),
    GOOGLE_CLIENT_ID: "google",
    GOOGLE_CLIENT_SECRET: "literal$secret#value",
    GOOGLE_REDIRECT_URI: "https://api.ilo.coopersully.me/v1/connectors/google/callback",
    X_REDIRECT_URI: "https://api.ilo.coopersully.me/v1/x-bookmarks/callback",
    EMAIL_FROM: "ilo <no@example.com>",
    RESEND_API_KEY: "resend",
    OWNER_EMAILS: "owner@example.com",
    DATABASE_URL: "postgres://old:old@rds/db",
    REGISTRATION_MODE: "invite",
    TEXTING_ENABLED: "true",
    TWILIO_AUTH_TOKEN: "preserve-me",
    ALLOWED_ORIGINS: "https://app.ilo.coopersully.me,tauri://localhost",
    GOOGLE_CALENDAR_WEBHOOK_URL:
      "https://api.ilo.coopersully.me/v1/connectors/google/calendar/notifications",
    GOOGLE_GMAIL_PUSH_AUDIENCE:
      "https://api.ilo.coopersully.me/v1/connectors/google/gmail/notifications",
    MCP_RESOURCE_URL: "https://mcp.ilo.coopersully.me/mcp",
  };
  const files = environmentFiles(source, "a".repeat(64));
  assert.ok(files.api.includes("APP_BASE_URL=https://nohmi.coopersully.me\n"));
  assert.ok(files.api.includes("API_BASE_URL=https://nohmi-api.coopersully.me\n"));
  assert.ok(files.api.includes("ALLOWED_ORIGINS=https://nohmi.coopersully.me,tauri://localhost\n"));
  assert.ok(
    files.api.includes(
      "GOOGLE_REDIRECT_URI=https://nohmi-api.coopersully.me/v1/connectors/google/callback\n",
    ),
  );
  assert.ok(
    files.api.includes("X_REDIRECT_URI=https://nohmi-api.coopersully.me/v1/x-bookmarks/callback\n"),
  );
  assert.ok(
    files.api.includes(
      "GOOGLE_CALENDAR_WEBHOOK_URL=https://nohmi-api.coopersully.me/v1/connectors/google/calendar/notifications\n",
    ),
  );
  assert.ok(
    files.api.includes(
      "GOOGLE_GMAIL_PUSH_AUDIENCE=https://nohmi-api.coopersully.me/v1/connectors/google/gmail/notifications\n",
    ),
  );
  assert.ok(files.api.includes("EMAIL_FROM=nohmi <no@example.com>\n"));
  assert.ok(files.api.includes("MCP_RESOURCE_URL=https://nohmi-mcp.coopersully.me/mcp\n"));
  assert.ok(
    files.mcp.includes("OAUTH_AUTHORIZATION_SERVER_URL=https://nohmi-api.coopersully.me\n"),
  );
  assert.ok(files.mcp.includes("MCP_PUBLIC_URL=https://nohmi-mcp.coopersully.me\n"));
  assert.equal(source.APP_BASE_URL, "https://app.ilo.coopersully.me");
  assert.ok(files.api.includes("GOOGLE_CLIENT_SECRET=literal$secret#value\n"));
  assert.ok(files.api.includes("TWILIO_AUTH_TOKEN=preserve-me\n"));
  assert.ok(!files.mcp.includes("TWILIO_AUTH_TOKEN"));
  assert.ok(!files.postgres.includes("APP_ENCRYPTION_KEY"));
  assert.ok(!files.api.includes("@rds/"));
  assert.throws(() =>
    environmentFiles({ ...source, RESEND_API_KEY: "bad\nINJECT=yes" }, "a".repeat(64)),
  );
  assert.throws(() =>
    environmentFiles({ ...source, APP_ENCRYPTION_KEY: "missing" }, "a".repeat(64)),
  );
});

test("restore requires an empty database and a matching completed restore receipt", () => {
  assertEmptyDatabase("0\n");
  for (const value of ["1", "", "error", "0\n1"]) assert.throws(() => assertEmptyDatabase(value));
  const config = fixture();
  assert.throws(() => validateRestoreReceipt({ status: "restoring" }, config));
  assert.throws(() =>
    validateRestoreReceipt({ status: "restored", revision: "c".repeat(40) }, config),
  );
  validateRestoreReceipt(
    {
      status: "restored",
      mode: "final-frozen",
      revision: config.revision,
      postgresImage: config.images.postgres,
      dumpSha256: "d".repeat(64),
    },
    config,
  );
  assert.throws(() =>
    validateRestoreReceipt(
      {
        status: "restored",
        mode: "rehearsal",
        revision: config.revision,
        postgresImage: config.images.postgres,
        dumpSha256: "d".repeat(64),
      },
      config,
    ),
  );
  const recovery = {
    status: "restored",
    mode: "recovery",
    revision: config.revision,
    postgresImage: config.images.postgres,
    dumpSha256: "d".repeat(64),
  };
  assert.throws(() => validateRestoreReceipt(recovery, config));
  validateRestoreReceipt(recovery, config, "recovery");
});

test("operation lock excludes concurrent work and releases after failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "ilo-lock-test-"));
  try {
    await assert.rejects(
      withLock(root, async () => {
        await assert.rejects(
          withLock(root, async () => {}),
          /locked/,
        );
        throw new Error("interrupted");
      }),
      /interrupted/,
    );
    await withLock(root, async () => {});
    mkdirSync(join(root, "operation.lock"));
    await assert.rejects(
      withLock(root, async () => {}),
      /locked/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
