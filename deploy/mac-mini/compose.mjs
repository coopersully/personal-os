import { isAbsolute, resolve } from "node:path";

const services = ["api", "mcp", "web", "postgres", "gateway", "tunnel"];
const digest = /^(?:[a-zA-Z0-9./:_-]+@)?sha256:[a-f0-9]{64}$/;

export function validateConfig(config) {
  const allowed = new Set([
    "version",
    "root",
    "dockerHost",
    "revision",
    "images",
    "postgresMajor",
    "backupRecipient",
  ]);
  if (!config || Object.keys(config).some((key) => !allowed.has(key)) || config.version !== 1)
    throw new Error("Invalid production configuration version or keys.");
  if (
    typeof config.root !== "string" ||
    !isAbsolute(config.root) ||
    resolve(config.root) !== config.root ||
    !config.root.endsWith("/nohmi-production") ||
    /[\s$]/.test(config.root)
  )
    throw new Error(
      "Runtime root must be an absolute path ending in /nohmi-production, without whitespace or interpolation.",
    );
  if (!/^unix:\/\/\/[^\s]+\/\.colima\/nohmi-production\/docker\.sock$/.test(config.dockerHost))
    throw new Error("Use the dedicated nohmi-production Colima socket.");
  if (!/^[a-f0-9]{40}$/.test(config.revision))
    throw new Error("A full release commit is required.");
  if (
    !config.images ||
    Object.keys(config.images).sort().join() !== [...services].sort().join() ||
    services.some((key) => !digest.test(config.images[key]))
  )
    throw new Error("Every image must be pinned by digest or local image ID.");
  // PostgreSQL 18 changes its volume layout. Add explicit support only with a tested migration.
  if (![16, 17].includes(config.postgresMajor))
    throw new Error("Supported PostgreSQL majors are 16 and 17; match live RDS before choosing.");
  if (typeof config.backupRecipient !== "string" || !/^age1[a-z0-9]+$/.test(config.backupRecipient))
    throw new Error("An age public backup recipient is required.");
  return config;
}

export function composeModel(input) {
  const c = validateConfig(input);
  const common = {
    restart: "unless-stopped",
    cap_drop: ["ALL"],
    security_opt: ["no-new-privileges:true"],
    logging: { driver: "json-file", options: { "max-size": "10m", "max-file": "3" } },
  };
  const envFile = (name) => [{ path: `${c.root}/${name}.env`, format: "raw" }];
  const health = (port, path) => ({
    test: [
      "CMD",
      "node",
      "-e",
      `fetch('http://127.0.0.1:${port}${path}').then(r=>{if(!r.ok)process.exit(1)})`,
    ],
    interval: "10s",
    timeout: "5s",
    retries: 12,
    start_period: "60s",
  });
  const app = (name, memory, cpus) => ({
    ...common,
    image: c.images[name],
    mem_limit: memory,
    cpus,
    read_only: true,
    tmpfs: ["/tmp:rw,noexec,nosuid,size=64m"],
    labels: { "org.opencontainers.image.revision": c.revision },
  });
  return {
    name: "nohmi-production",
    services: {
      postgres: {
        ...common,
        image: c.images.postgres,
        user: "postgres",
        mem_limit: "1g",
        cpus: 1,
        env_file: envFile("postgres"),
        networks: ["database"],
        volumes: ["postgres-data:/var/lib/postgresql/data"],
        healthcheck: {
          test: ["CMD-SHELL", "pg_isready -U personal_os -d personal_os"],
          interval: "5s",
          timeout: "3s",
          retries: 20,
        },
        stop_grace_period: "120s",
      },
      api: {
        ...app("api", "1536m", 1.5),
        env_file: envFile("api"),
        networks: ["database", "origin", "provider"],
        depends_on: { postgres: { condition: "service_healthy" } },
        healthcheck: health(8787, "/health/ready"),
        stop_grace_period: "120s",
      },
      mcp: {
        ...app("mcp", "384m", 0.5),
        env_file: envFile("mcp"),
        networks: ["origin"],
        depends_on: { api: { condition: "service_healthy" } },
        healthcheck: health(8788, "/health/live"),
        stop_grace_period: "120s",
      },
      web: { ...app("web", "128m", 0.25), networks: ["origin"] },
      gateway: {
        ...app("gateway", "128m", 0.25),
        networks: { edge: { ipv4_address: "172.30.253.2" }, origin: {} },
        volumes: [`${c.root}/gateway.conf:/etc/nginx/conf.d/default.conf:ro`],
        depends_on: {
          api: { condition: "service_healthy" },
          mcp: { condition: "service_healthy" },
          web: { condition: "service_started" },
        },
      },
      tunnel: {
        ...app("tunnel", "128m", 0.25),
        user: "0:0",
        networks: ["edge"],
        command: ["tunnel", "--no-autoupdate", "run", "--token-file", "/run/secrets/tunnel-token"],
        volumes: [`${c.root}/tunnel-token:/run/secrets/tunnel-token:ro`],
        depends_on: { gateway: { condition: "service_started" } },
      },
    },
    networks: {
      database: { internal: true },
      origin: { internal: true },
      provider: {},
      edge: { ipam: { config: [{ subnet: "172.30.253.0/29" }] } },
    },
    volumes: { "postgres-data": {} },
  };
}

const apiKeys = new Set(
  `APP_BASE_URL ALLOWED_ORIGINS API_BASE_URL API_SHUTDOWN_TIMEOUT_MS AGENT_SKILL_REVISION AGENT_SKILL_SOURCE_URL AGENT_SKILL_VERSION AUTH_RATE_LIMIT_MAX_REQUESTS AUTH_RATE_LIMIT_WINDOW_SECONDS APP_ENCRYPTION_KEY DATABASE_URL EMAIL_FROM GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_CALENDAR_PUSH_ENABLED GOOGLE_CALENDAR_WEBHOOK_URL GOOGLE_GMAIL_PUBSUB_SUBSCRIPTION GOOGLE_GMAIL_PUBSUB_TOPIC GOOGLE_GMAIL_PUSH_AUDIENCE GOOGLE_GMAIL_PUSH_ENABLED GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT GOOGLE_REDIRECT_URI ICLOUD_MAIL_IDLE_CONCURRENCY ICLOUD_MAIL_IDLE_ENABLED LOG_LEVEL MCP_RESOURCE_URL MCP_INTERNAL_SECRET NODE_ENV OWNER_EMAILS PORT PLAID_CLIENT_ID PLAID_ENV PLAID_SECRET RESEND_API_KEY REGISTRATION_MODE SESSION_COOKIE_NAME SESSION_TTL_DAYS TEXTING_ENABLED TRUST_PROXY TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_MESSAGING_SERVICE_SID TWILIO_PHONE_NUMBER TWILIO_VERIFY_SERVICE_SID X_CLIENT_ID X_CLIENT_SECRET X_REDIRECT_URI`.split(
    " ",
  ),
);

function serialize(env) {
  return Object.entries(env)
    .map(([key, value]) => {
      if (typeof value !== "string" || /[\r\n\0]/.test(value))
        throw new Error(`Invalid single-line environment value for ${key}.`);
      return `${key}=${value}\n`;
    })
    .join("");
}

export function environmentFiles(source, password) {
  // Project a preserved AWS export onto the approved free-tier nohmi origins.
  // Do not rewrite arbitrary secret strings or mutate the recovery export.
  source = { ...source };
  const origins = {
    "https://app.ilo.coopersully.me": "https://nohmi.coopersully.me",
    "https://api.ilo.coopersully.me": "https://nohmi-api.coopersully.me",
    "https://mcp.ilo.coopersully.me": "https://nohmi-mcp.coopersully.me",
  };
  const rehost = (value) => {
    for (const [oldOrigin, newOrigin] of Object.entries(origins)) {
      if (value === oldOrigin || value.startsWith(`${oldOrigin}/`))
        return newOrigin + value.slice(oldOrigin.length);
    }
    return value;
  };
  for (const key of [
    "APP_BASE_URL",
    "API_BASE_URL",
    "MCP_RESOURCE_URL",
    "GOOGLE_REDIRECT_URI",
    "X_REDIRECT_URI",
    "GOOGLE_CALENDAR_WEBHOOK_URL",
    "GOOGLE_GMAIL_PUSH_AUDIENCE",
    "AGENT_SKILL_SOURCE_URL",
  ])
    if (source[key]) source[key] = rehost(source[key]);
  for (const key of ["ALLOWED_ORIGINS", "MCP_ALLOWED_ORIGINS"])
    if (source[key])
      source[key] = source[key]
        .split(",")
        .map((value) => rehost(value.trim()))
        .join(",");
  source.ALLOWED_ORIGINS ??= "https://nohmi.coopersully.me";
  if (source.EMAIL_FROM)
    source.EMAIL_FROM = source.EMAIL_FROM.replace(/^(?:ilo|nomi)\s*</i, "nohmi <");
  if (!/^[a-f0-9]{64}$/.test(password))
    throw new Error("Database password must be 32 random hex bytes.");
  for (const key of [
    "APP_ENCRYPTION_KEY",
    "MCP_INTERNAL_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "EMAIL_FROM",
    "RESEND_API_KEY",
    "OWNER_EMAILS",
    "GOOGLE_REDIRECT_URI",
    "X_REDIRECT_URI",
  ]) {
    if (!source[key]) throw new Error(`Missing production configuration: ${key}.`);
  }
  if (Buffer.from(source.APP_ENCRYPTION_KEY, "base64").length !== 32)
    throw new Error("Preserve the valid production encryption key.");
  if (source.MCP_INTERNAL_SECRET.length < 32) throw new Error("Invalid MCP internal secret.");
  if (
    source.APP_BASE_URL !== "https://nohmi.coopersully.me" ||
    source.API_BASE_URL !== "https://nohmi-api.coopersully.me" ||
    source.REGISTRATION_MODE !== "invite"
  )
    throw new Error("Expected canonical production URLs and invite-only registration.");
  const api = Object.fromEntries(Object.entries(source).filter(([key]) => apiKeys.has(key)));
  Object.assign(api, {
    NODE_ENV: "production",
    PORT: "8787",
    DATABASE_URL: `postgres://personal_os:${password}@postgres:5432/personal_os`,
    TRUST_PROXY: "true",
    API_SHUTDOWN_TIMEOUT_MS: "105000",
    MCP_RESOURCE_URL: "https://nohmi-mcp.coopersully.me/mcp",
  });
  const mcp = {
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    PORT: "8788",
    APP_BASE_URL: source.APP_BASE_URL,
    PERSONAL_OS_API_URL: "http://api:8787",
    OAUTH_AUTHORIZATION_SERVER_URL: source.API_BASE_URL,
    MCP_PUBLIC_URL: "https://nohmi-mcp.coopersully.me",
    MCP_RESOURCE_URL: "https://nohmi-mcp.coopersully.me/mcp",
    MCP_INTERNAL_SECRET: source.MCP_INTERNAL_SECRET,
    MCP_TRUST_PROXY: "true",
  };
  for (const key of [
    "MCP_ALLOWED_ORIGINS",
    "MCP_RATE_LIMIT_MAX_REQUESTS",
    "MCP_RATE_LIMIT_WINDOW_SECONDS",
    "MCP_INCLUDE_COMPATIBILITY_TOOLS",
  ])
    if (source[key] !== undefined) mcp[key] = source[key];
  return {
    api: serialize(api),
    mcp: serialize(mcp),
    postgres: serialize({
      POSTGRES_DB: "personal_os",
      POSTGRES_USER: "personal_os",
      POSTGRES_PASSWORD: password,
    }),
  };
}
