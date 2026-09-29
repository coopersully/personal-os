#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { prepare, run } from "./commands.mjs";
import { composeModel, environmentFiles } from "./compose.mjs";
import { privateFile, writePrivate } from "./safety.mjs";

// Disposable full-stack test. Never read production provider configuration or
// restore personal data. All cleanup is scoped to this newly generated project.
process.umask(0o077);
let compose;
let failurePath;
try {
  const [manifestPath, destination, postgresImage, tunnelImage] = process.argv.slice(2);
  const built = JSON.parse(privateFile(manifestPath));
  mkdirSync(resolve(destination), { mode: 0o700 });
  const root = join(realpathSync(resolve(destination)), "nohmi-production");
  mkdirSync(root, { mode: 0o700 });
  failurePath = join(root, "smoke-errors.log");
  const config = {
    version: 1,
    root,
    dockerHost: "unix:///Users/nohmi-production/.colima/nohmi-production/docker.sock",
    revision: built.revision,
    postgresMajor: 17,
    backupRecipient: "age1smoketest",
    images: {
      ...built.images,
      postgres: postgresImage,
      gateway: built.images.web,
      tunnel: tunnelImage,
    },
  };
  const source = {
    APP_BASE_URL: "https://app.ilo.coopersully.me",
    API_BASE_URL: "https://api.ilo.coopersully.me",
    APP_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
    MCP_INTERNAL_SECRET: "synthetic-smoke-secret-with-at-least-32-characters",
    GOOGLE_CLIENT_ID: "synthetic",
    GOOGLE_CLIENT_SECRET: "synthetic",
    GOOGLE_REDIRECT_URI: "https://api.ilo.coopersully.me/v1/connectors/google/callback",
    X_REDIRECT_URI: "https://api.ilo.coopersully.me/v1/x-bookmarks/callback",
    EMAIL_FROM: "smoke@example.invalid",
    RESEND_API_KEY: "synthetic",
    OWNER_EMAILS: "smoke@example.invalid",
    REGISTRATION_MODE: "invite",
  };
  environmentFiles(source, "a".repeat(64));
  const sourcePath = join(root, "synthetic-source.json");
  writePrivate(sourcePath, JSON.stringify(source));
  await prepare({ root, config }, sourcePath);
  const name = `ilo-mac-smoke-${randomUUID()}`;
  writePrivate(
    join(root, "compose.json"),
    JSON.stringify({ ...composeModel(config), name }, null, 2),
  );
  compose = (args, options) =>
    run(
      "docker",
      [
        "compose",
        "--project-name",
        name,
        "--project-directory",
        root,
        "--env-file",
        "/dev/null",
        "-f",
        join(root, "compose.json"),
        ...args,
      ],
      options,
    );
  await compose(["config", "--quiet"]);
  await compose(["up", "-d", "--wait", "api", "mcp", "web", "gateway"], {
    timeout: 300000,
    errorLog: failurePath,
  });
  for (const [host, route] of [
    ["nohmi.coopersully.me", "/"],
    ["nohmi-api.coopersully.me", "/health/ready"],
    ["nohmi-mcp.coopersully.me", "/health/live"],
  ]) {
    await compose([
      "exec",
      "-T",
      "gateway",
      "wget",
      "-q",
      "-O",
      "/dev/null",
      "--header",
      `Host: ${host}`,
      `http://172.30.253.2:8080${route}`,
    ]);
  }
  writePrivate(
    join(root, "smoke-result.json"),
    JSON.stringify(
      {
        revision: built.revision,
        completedAt: new Date().toISOString(),
        publicTunnelStarted: false,
        productionDataUsed: false,
        routesPassed: 3,
      },
      null,
      2,
    ),
  );
  console.log(
    "Full-stack synthetic smoke passed: app/API/MCP gateway routes. No public tunnel or production data used.",
  );
} catch (error) {
  if (compose && failurePath) {
    const logs = await compose(["logs", "--no-color", "--tail", "50"]).catch(
      () => "Logs unavailable.",
    );
    writePrivate(`${failurePath}.services`, logs);
  }
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (compose)
    await compose(["down", "--volumes", "--remove-orphans"], { timeout: 180000 }).catch(() => {
      console.error("Disposable smoke cleanup failed; inspect its private Compose project.");
      process.exitCode = 1;
    });
}
