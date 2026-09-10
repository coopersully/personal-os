import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const ACKNOWLEDGEMENT = "I_UNDERSTAND_THIS_IS_PRODUCTION";
const DATABASE_IDENTIFIER = "personal-os-prod-postgres";
const TUNNEL_NAME = "personal-os-prod-local-db-tunnel";
const CLUSTER_NAME = "personal-os-prod";
const API_SERVICE_NAME = "personal-os-prod-api";
const CERTIFICATE_URL = "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem";
const CERTIFICATE_SHA256 = "e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3";

export function assertProductionAcknowledgement(environment) {
  if (environment.ILO_PRODUCTION_RUNTIME !== ACKNOWLEDGEMENT) {
    throw new Error(
      `Set ILO_PRODUCTION_RUNTIME=${ACKNOWLEDGEMENT} to acknowledge that every local action affects production.`,
    );
  }
}

export function validateProductionDatabase(instance) {
  if (
    instance?.DBInstanceIdentifier !== DATABASE_IDENTIFIER ||
    instance?.DBInstanceStatus !== "available" ||
    instance?.PubliclyAccessible !== false ||
    typeof instance?.Endpoint?.Address !== "string" ||
    instance.Endpoint.Address.length === 0 ||
    instance?.Endpoint?.Port !== 5432
  ) {
    throw new Error(
      "Refusing to connect because the production database identity, availability, private state, or endpoint is invalid.",
    );
  }
  return { endpoint: instance.Endpoint.Address, port: instance.Endpoint.Port };
}

export function selectTunnelInstance(instances) {
  const matches = instances.filter((instance) => {
    const tags = new Map((instance.Tags ?? []).map((tag) => [tag.Key, tag.Value]));
    return tags.get("Name") === TUNNEL_NAME && tags.get("LocalProductionRuntime") === "true";
  });
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one tagged local production tunnel; found ${matches.length}.`,
    );
  }
  return matches[0];
}

export function rewriteDatabaseUrl(databaseUrl, localPort, certificatePath) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Production DATABASE_URL must use PostgreSQL.");
  }
  url.hostname = "127.0.0.1";
  url.port = String(localPort);
  url.searchParams.set("sslmode", "verify-ca");
  url.searchParams.set("sslrootcert", certificatePath);
  return url.toString();
}

function parameterName(valueFrom) {
  const marker = ":parameter";
  const index = valueFrom.indexOf(marker);
  if (index === -1) throw new Error("The deployed API task references a non-SSM secret.");
  const name = valueFrom.slice(index + marker.length);
  return name.startsWith("/") ? name : `/${name}`;
}

export function projectProductionEnvironment({ certificatePath, local, parameters, task }) {
  const projected = Object.fromEntries(
    (task.environment ?? []).map((entry) => [entry.name, entry.value]),
  );
  for (const secret of task.secrets ?? []) {
    const name = parameterName(secret.valueFrom);
    const value = parameters[name];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Production runtime parameter ${secret.name} was not resolved.`);
    }
    projected[secret.name] = value;
  }
  if (!projected.DATABASE_URL) {
    throw new Error("The deployed API task does not provide DATABASE_URL.");
  }

  return {
    ...projected,
    ALLOWED_ORIGINS: `${local.webUrl},tauri://localhost,http://tauri.localhost`,
    API_BASE_URL: local.apiUrl,
    APP_BASE_URL: local.webUrl,
    DATABASE_URL: rewriteDatabaseUrl(projected.DATABASE_URL, local.databasePort, certificatePath),
    GOOGLE_CALENDAR_PUSH_ENABLED: "false",
    GOOGLE_GMAIL_PUSH_ENABLED: "false",
    GOOGLE_REDIRECT_URI: `${local.apiUrl}/v1/connectors/google/callback`,
    MCP_RESOURCE_URL: `${local.mcpUrl}/mcp`,
    NODE_ENV: "development",
    PORT: String(local.apiPort),
    TRUST_PROXY: "false",
    X_REDIRECT_URI: `${local.apiUrl}/v1/x-bookmarks/callback`,
  };
}

export function redactProductionError(error, secretValues) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [...secretValues].sort((left, right) => right.length - left.length)) {
    if (secret) message = message.split(secret).join("[REDACTED]");
  }
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/giu, "[REDACTED_DATABASE_URL]");
}

export function buildPortForwardingSessionArgs({
  databaseEndpoint,
  databasePort,
  instanceId,
  localPort,
  region,
}) {
  return [
    "ssm",
    "start-session",
    "--region",
    region,
    "--target",
    instanceId,
    "--document-name",
    "AWS-StartPortForwardingSessionToRemoteHost",
    "--parameters",
    JSON.stringify({
      host: [databaseEndpoint],
      portNumber: [String(databasePort)],
      localPortNumber: [String(localPort)],
    }),
  ];
}

export function createServiceDefinitions({ environment, local, root }) {
  return [
    {
      args: ["--filter", "@personal-os/api", "exec", "tsx", "src/main.ts"],
      command: "pnpm",
      environment: {
        ...environment,
        MIGRATIONS_DIR: join(root, "packages/database/migrations"),
        PORT: String(local.apiPort),
      },
      name: "api",
      readyUrl: `${local.apiUrl}/health/ready`,
    },
    {
      args: ["--filter", "@personal-os/mcp", "exec", "tsx", "src/http.ts"],
      command: "pnpm",
      environment: {
        APP_BASE_URL: local.webUrl,
        HOST: "127.0.0.1",
        MCP_INTERNAL_SECRET: environment.MCP_INTERNAL_SECRET,
        MCP_PUBLIC_URL: local.mcpUrl,
        MCP_RESOURCE_URL: `${local.mcpUrl}/mcp`,
        OAUTH_AUTHORIZATION_SERVER_URL: local.apiUrl,
        PERSONAL_OS_API_URL: local.apiUrl,
        PORT: String(local.mcpPort),
      },
      name: "mcp",
      readyUrl: `${local.mcpUrl}/health/live`,
    },
    {
      args: [
        "--filter",
        "@personal-os/web",
        "exec",
        "vite",
        "--host",
        "127.0.0.1",
        "--port",
        String(local.webPort),
        "--strictPort",
      ],
      command: "pnpm",
      environment: {
        VITE_API_BASE_URL: "/",
        VITE_PROXY_API_TARGET: local.apiUrl,
      },
      name: "web",
      readyUrl: local.webUrl,
    },
  ];
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid production runtime option ${key ?? "<missing>"}.`);
    }
    options[key.slice(2)] = value;
  }
  return options;
}

function numberOption(options, key) {
  const value = Number(options[key]);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`--${key} must be a valid port.`);
  }
  return value;
}

function requiredOption(options, key) {
  const value = options[key];
  if (!value) throw new Error(`Missing --${key}.`);
  return value;
}

function processStartIdentity(pid) {
  return spawnSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" }).stdout.trim();
}

function processWorkingDirectory(pid) {
  const output = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
    encoding: "utf8",
  }).stdout;
  return output
    .split("\n")
    .find((line) => line.startsWith("n"))
    ?.slice(1);
}

function processIsRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function metadataMatches(metadata) {
  return (
    Number.isInteger(metadata?.pid) &&
    processIsRunning(metadata.pid) &&
    processStartIdentity(metadata.pid) === metadata.startIdentity &&
    processWorkingDirectory(metadata.pid) === metadata.root
  );
}

function awsJson(args, environment) {
  const result = spawnSync("aws", args, {
    encoding: "utf8",
    env: environment,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`AWS ${args[0]} ${args[1]} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`AWS ${args[0]} ${args[1]} returned invalid JSON.`);
  }
}

function assumedAwsEnvironment(sourceProfile, region, sessionName) {
  const sourceEnvironment = { ...process.env, AWS_PROFILE: sourceProfile, AWS_REGION: region };
  const identity = awsJson(
    ["sts", "get-caller-identity", "--region", region, "--output", "json"],
    sourceEnvironment,
  );
  const partition = identity.Arn.split(":")[1] || "aws";
  const roleArn =
    process.env.ILO_PRODUCTION_RUNTIME_ROLE_ARN ??
    `arn:${partition}:iam::${identity.Account}:role/personal-os-prod-local-production-runtime`;
  const assumption = awsJson(
    [
      "sts",
      "assume-role",
      "--region",
      region,
      "--role-arn",
      roleArn,
      "--role-session-name",
      sessionName,
      "--duration-seconds",
      "14400",
      "--output",
      "json",
    ],
    sourceEnvironment,
  );
  if (!assumption.Credentials?.AccessKeyId || !assumption.Credentials?.SecretAccessKey) {
    throw new Error("The local production runtime role returned incomplete credentials.");
  }
  const environment = { ...process.env, AWS_REGION: region };
  delete environment.AWS_PROFILE;
  environment.AWS_ACCESS_KEY_ID = assumption.Credentials.AccessKeyId;
  environment.AWS_SECRET_ACCESS_KEY = assumption.Credentials.SecretAccessKey;
  environment.AWS_SESSION_TOKEN = assumption.Credentials.SessionToken;
  return environment;
}

async function waitFor(condition, description, timeoutMs = 90_000, intervalMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function waitForTcp(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.setTimeout(1_000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    const unavailable = () => {
      socket.destroy();
      resolve(false);
    };
    socket.once("error", unavailable);
    socket.once("timeout", unavailable);
  });
}

async function waitForUrl(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureCertificate(path) {
  if (existsSync(path)) {
    const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
    if (digest === CERTIFICATE_SHA256) return;
  }
  const response = await fetch(CERTIFICATE_URL, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Could not download the AWS RDS CA bundle.");
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== CERTIFICATE_SHA256) throw new Error("The AWS RDS CA bundle checksum is invalid.");
  writeFileSync(path, bytes, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function parameterPath(valueFrom) {
  const marker = ":parameter";
  const index = valueFrom.indexOf(marker);
  if (index === -1) throw new Error("The deployed API task references a non-SSM secret.");
  const path = valueFrom.slice(index + marker.length);
  return path.startsWith("/") ? path : `/${path}`;
}

function scrubAwsEnvironment(environment) {
  const scrubbed = { ...environment };
  for (const key of [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_PROFILE",
    "AWS_DEFAULT_PROFILE",
  ]) {
    delete scrubbed[key];
  }
  return scrubbed;
}

function signalProcessGroup(child, signal = "SIGTERM") {
  if (!child?.pid || !processIsRunning(child.pid)) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

async function commandStart(options) {
  assertProductionAcknowledgement(process.env);
  const root = requiredOption(options, "root");
  const runDir = requiredOption(options, "run-dir");
  const productionDir = join(runDir, "production");
  const metadataPath = join(productionDir, "supervisor.json");
  const logsDir = join(productionDir, "logs");
  const local = {
    apiPort: numberOption(options, "api-port"),
    apiUrl: requiredOption(options, "api-url"),
    databasePort: numberOption(options, "database-port"),
    mcpPort: numberOption(options, "mcp-port"),
    mcpUrl: requiredOption(options, "mcp-url"),
    webPort: numberOption(options, "web-port"),
    webUrl: requiredOption(options, "web-url"),
  };
  const region = process.env.ILO_PRODUCTION_AWS_REGION ?? "us-east-1";
  const sourceProfile = process.env.ILO_PRODUCTION_SOURCE_PROFILE ?? "default";

  mkdirSync(logsDir, { recursive: true, mode: 0o700 });
  if (existsSync(metadataPath)) {
    const existing = JSON.parse(readFileSync(metadataPath, "utf8"));
    if (metadataMatches(existing))
      throw new Error("This worktree's local production runtime is already running.");
    rmSync(metadataPath, { force: true });
  }
  const metadata = { pid: process.pid, root, startIdentity: processStartIdentity(process.pid) };
  writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`, { mode: 0o600 });

  const children = [];
  const secretValues = [];
  let stopping = false;
  const cleanup = async () => {
    if (stopping) return;
    stopping = true;
    for (const child of [...children].reverse()) signalProcessGroup(child);
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const child of [...children].reverse()) signalProcessGroup(child, "SIGKILL");
    rmSync(metadataPath, { force: true });
  };
  const shutdown = () => void cleanup().then(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    const sessionName = `ilo-local-${basename(root)
      .replace(/[^a-zA-Z0-9+=,.@_-]/g, "-")
      .slice(0, 32)}-${process.pid}`;
    const awsEnvironment = assumedAwsEnvironment(sourceProfile, region, sessionName);
    const rds = awsJson(
      [
        "rds",
        "describe-db-instances",
        "--region",
        region,
        "--db-instance-identifier",
        DATABASE_IDENTIFIER,
        "--output",
        "json",
      ],
      awsEnvironment,
    );
    const database = validateProductionDatabase(rds.DBInstances?.[0]);

    const ec2 = awsJson(
      [
        "ec2",
        "describe-instances",
        "--region",
        region,
        "--filters",
        `Name=tag:Name,Values=${TUNNEL_NAME}`,
        "Name=tag:LocalProductionRuntime,Values=true",
        "Name=instance-state-name,Values=pending,running,stopping,stopped",
        "--output",
        "json",
      ],
      awsEnvironment,
    );
    const tunnelInstance = selectTunnelInstance(
      (ec2.Reservations ?? []).flatMap((reservation) => reservation.Instances ?? []),
    );
    if (tunnelInstance.State?.Name === "stopping") {
      spawnSync(
        "aws",
        [
          "ec2",
          "wait",
          "instance-stopped",
          "--region",
          region,
          "--instance-ids",
          tunnelInstance.InstanceId,
        ],
        {
          env: awsEnvironment,
          stdio: "ignore",
        },
      );
      tunnelInstance.State.Name = "stopped";
    }
    if (tunnelInstance.State?.Name === "stopped") {
      awsJson(
        [
          "ec2",
          "start-instances",
          "--region",
          region,
          "--instance-ids",
          tunnelInstance.InstanceId,
          "--output",
          "json",
        ],
        awsEnvironment,
      );
      const waited = spawnSync(
        "aws",
        [
          "ec2",
          "wait",
          "instance-running",
          "--region",
          region,
          "--instance-ids",
          tunnelInstance.InstanceId,
        ],
        { env: awsEnvironment, stdio: "ignore" },
      );
      if (waited.status !== 0)
        throw new Error("The local production tunnel instance did not start.");
    }
    await waitFor(() => {
      const result = awsJson(
        [
          "ssm",
          "describe-instance-information",
          "--region",
          region,
          "--filters",
          `Key=InstanceIds,Values=${tunnelInstance.InstanceId}`,
          "--output",
          "json",
        ],
        awsEnvironment,
      );
      return result.InstanceInformationList?.[0]?.PingStatus === "Online";
    }, "the tunnel instance to register with Systems Manager");

    const services = awsJson(
      [
        "ecs",
        "describe-services",
        "--region",
        region,
        "--cluster",
        CLUSTER_NAME,
        "--services",
        API_SERVICE_NAME,
        "--output",
        "json",
      ],
      awsEnvironment,
    );
    const taskDefinitionArn = services.services?.[0]?.taskDefinition;
    if (!taskDefinitionArn) throw new Error("The production API service has no task definition.");
    const describedTask = awsJson(
      [
        "ecs",
        "describe-task-definition",
        "--region",
        region,
        "--task-definition",
        taskDefinitionArn,
        "--output",
        "json",
      ],
      awsEnvironment,
    );
    const apiTask = describedTask.taskDefinition?.containerDefinitions?.find(
      (container) => container.name === "api",
    );
    if (!apiTask) throw new Error("The production task definition has no API container.");
    const parameterNames = (apiTask.secrets ?? []).map((secret) => parameterPath(secret.valueFrom));
    const resolved = awsJson(
      [
        "ssm",
        "get-parameters",
        "--region",
        region,
        "--with-decryption",
        "--names",
        ...parameterNames,
        "--output",
        "json",
      ],
      awsEnvironment,
    );
    if (resolved.InvalidParameters?.length) {
      throw new Error(
        `Production runtime parameters are unavailable: ${resolved.InvalidParameters.join(", ")}.`,
      );
    }
    const parameters = Object.fromEntries(
      (resolved.Parameters ?? []).map((parameter) => [parameter.Name, parameter.Value]),
    );
    secretValues.push(...Object.values(parameters));

    const certificatePath = join(productionDir, "aws-rds-global-bundle.pem");
    await ensureCertificate(certificatePath);
    const tunnelLog = openSync(join(logsDir, "tunnel.log"), "w", 0o600);
    const tunnel = spawn(
      "aws",
      buildPortForwardingSessionArgs({
        databaseEndpoint: database.endpoint,
        databasePort: database.port,
        instanceId: tunnelInstance.InstanceId,
        localPort: local.databasePort,
        region,
      }),
      { cwd: root, detached: true, env: awsEnvironment, stdio: ["ignore", tunnelLog, tunnelLog] },
    );
    closeSync(tunnelLog);
    children.push(tunnel);
    await waitFor(
      async () => {
        if (tunnel.exitCode !== null)
          throw new Error("The production database tunnel exited before becoming ready.");
        return waitForTcp(local.databasePort);
      },
      "the production database tunnel",
      45_000,
      500,
    );

    const environment = projectProductionEnvironment({
      certificatePath,
      local,
      parameters,
      task: apiTask,
    });
    const baseServiceEnvironment = scrubAwsEnvironment(process.env);
    const definitions = createServiceDefinitions({ environment, local, root });
    for (const definition of definitions) {
      const logDescriptor = openSync(join(logsDir, `${definition.name}.log`), "w", 0o600);
      const child = spawn(definition.command, definition.args, {
        cwd: root,
        detached: true,
        env: { ...baseServiceEnvironment, ...definition.environment },
        stdio: ["ignore", logDescriptor, logDescriptor],
      });
      closeSync(logDescriptor);
      children.push(child);
      await waitFor(
        async () => {
          if (child.exitCode !== null)
            throw new Error(`${definition.name} exited before becoming ready.`);
          return waitForUrl(definition.readyUrl);
        },
        `${definition.name} at ${definition.readyUrl}`,
        60_000,
        500,
      );
    }

    process.stdout.write("[personal-os] ilo local production runtime is ready.\n");
    process.stdout.write(`  App:       ${local.webUrl}\n`);
    process.stdout.write(`  API:       ${local.apiUrl}/health/ready\n`);
    process.stdout.write(`  MCP:       ${local.mcpUrl}/mcp\n`);
    process.stdout.write(`  PostgreSQL 127.0.0.1:${local.databasePort} → production\n`);
    process.stdout.write(`  Logs:      ${logsDir}\n`);
    process.stdout.write(
      "[personal-os] Every action affects production. This command remains attached.\n",
    );

    await new Promise((resolve, reject) => {
      for (const child of children) {
        child.once("exit", (code, signal) => {
          if (!stopping)
            reject(new Error(`A local production process exited (${code ?? signal}).`));
        });
      }
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  } catch (error) {
    throw new Error(redactProductionError(error, secretValues));
  } finally {
    await cleanup();
  }
}

async function commandStop(options) {
  const root = requiredOption(options, "root");
  const metadataPath = join(requiredOption(options, "run-dir"), "production", "supervisor.json");
  if (!existsSync(metadataPath)) {
    process.stdout.write("[personal-os] local production runtime is not running.\n");
    return;
  }
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (metadata.root !== root || !metadataMatches(metadata)) {
    throw new Error(
      "Refusing to stop a local production runtime whose process ownership cannot be verified.",
    );
  }
  process.kill(metadata.pid, "SIGTERM");
  await waitFor(
    () => !processIsRunning(metadata.pid),
    "the local production runtime to stop",
    20_000,
    250,
  );
  process.stdout.write("[personal-os] local production runtime stopped.\n");
}

async function commandStatus(options) {
  const root = requiredOption(options, "root");
  const metadataPath = join(requiredOption(options, "run-dir"), "production", "supervisor.json");
  let state = "down";
  if (existsSync(metadataPath)) {
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    state = metadata.root === root && metadataMatches(metadata) ? "running" : "stale";
  }
  process.stdout.write(`[personal-os] local production runtime: ${state}\n`);
  if (state === "stale") process.exitCode = 1;
}

async function main() {
  const command = process.argv[2];
  const options = parseOptions(process.argv.slice(3));
  if (command === "start") return commandStart(options);
  if (command === "stop") return commandStop(options);
  if (command === "status") return commandStatus(options);
  throw new Error("Use start, stop, or status.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[personal-os] error: ${redactProductionError(error, [])}\n`);
    process.exitCode = 1;
  });
}
