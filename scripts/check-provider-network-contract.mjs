import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const compute = readFileSync(resolve(root, "infra/compute.tf"), "utf8");
const locals = readFileSync(resolve(root, "infra/locals.tf"), "utf8");
const network = readFileSync(resolve(root, "infra/network.tf"), "utf8");
const operations = readFileSync(resolve(root, "infra/operations.tf"), "utf8");
const variables = readFileSync(resolve(root, "infra/variables.tf"), "utf8");
const waf = readFileSync(resolve(root, "infra/waf.tf"), "utf8");
const config = readFileSync(resolve(root, "apps/api/src/config.ts"), "utf8");
const providerHttp = readFileSync(resolve(root, "packages/connectors/src/http.ts"), "utf8");
const google = readFileSync(resolve(root, "packages/connectors/src/google.ts"), "utf8");
const icloud = readFileSync(resolve(root, "packages/connectors/src/icloud.ts"), "utf8");
const mailMcp = readFileSync(resolve(root, "apps/mcp/src/tools/mail.ts"), "utf8");

function rejectContract(source, pattern, description) {
  if (pattern.test(source)) {
    throw new Error(`Provider network contract forbids ${description}.`);
  }
}

function numericSetting(source, pattern, description) {
  const match = source.match(pattern);
  if (!match) throw new Error(`Provider network contract is missing ${description}.`);
  return Number(match[1].replaceAll("_", ""));
}

function requireApplicationEgress(port, description) {
  const application = network.match(
    /resource "aws_security_group" "application" \{(?<body>[\s\S]*?)\n\}/,
  )?.groups?.body;
  if (
    !application ||
    !new RegExp(
      `egress \\{[\\s\\S]*?description\\s*=\\s*"${description}"[\\s\\S]*?from_port\\s*=\\s*${port}[\\s\\S]*?to_port\\s*=\\s*${port}[\\s\\S]*?protocol\\s*=\\s*"tcp"`,
    ).test(application)
  ) {
    throw new Error(
      `Provider network contract requires application TCP egress ${port} (${description}).`,
    );
  }
}

function requireSsmRuntimeKey(name) {
  if (!new RegExp(`"${name}"`).test(locals)) {
    throw new Error(`Provider runtime contract requires ${name} in Parameter Store.`);
  }
  if (
    !new RegExp(
      `name\\s*=\\s*"${name}"\\s*,\\s*valueFrom\\s*=\\s*local\\.runtime_parameter_arns\\.${name}`,
    ).test(compute)
  ) {
    throw new Error(`Provider runtime contract requires an ECS secret reference for ${name}.`);
  }
}

function requireTerraformContract(source, pattern, description) {
  if (!pattern.test(source)) {
    throw new Error(`Provider operations contract is missing ${description}.`);
  }
}

const edgeTimeoutSeconds = numericSetting(
  compute,
  /idle_timeout\s*=\s*(\d+)/,
  "the ALB idle timeout",
);
const providerTimeoutMs = numericSetting(
  providerHttp,
  /PROVIDER_REQUEST_TIMEOUT_MS\s*=\s*([\d_]+)/,
  "the shared provider request timeout",
);

if (providerTimeoutMs >= edgeTimeoutSeconds * 1_000) {
  throw new Error(
    `Provider timeout ${providerTimeoutMs}ms must remain below the ${edgeTimeoutSeconds}s edge timeout.`,
  );
}

if (!/connectionTimeout:\s*PROVIDER_REQUEST_TIMEOUT_MS/.test(icloud)) {
  throw new Error("iCloud IMAP must use the shared provider connection timeout.");
}

if (!/host:\s*"imap\.mail\.me\.com"[\s\S]*?port:\s*993/.test(icloud)) {
  throw new Error("iCloud IMAP must declare imap.mail.me.com:993.");
}

requireApplicationEgress(993, "iCloud Mail IMAP over TLS");
rejectContract(google, /gmail\.send/, "Gmail send authority");
rejectContract(icloud, /smtp\.mail\.me\.com|nodemailer|createTransport/, "iCloud SMTP delivery");
rejectContract(mailMcp, /["'](?:create_mail_draft|send_mail)["']/, "Mail delivery MCP tools");
rejectContract(
  network,
  /description\s*=\s*"iCloud Mail SMTP submission"[\s\S]*?from_port\s*=\s*587/,
  "Mail SMTP egress",
);
requireSsmRuntimeKey("GOOGLE_CLIENT_ID");
requireSsmRuntimeKey("GOOGLE_CLIENT_SECRET");
if (/name\s*=\s*"GOOGLE_CLIENT_ID"\s*,\s*value\s*=/.test(compute)) {
  throw new Error(
    "Production Google client ID must not be emitted as a plain ECS environment value.",
  );
}
requireTerraformContract(
  operations,
  /pattern\s*=\s*"\{ \$\.event = \\"connector_sync_failed\\" \}"/,
  "the connector sync failure metric",
);
requireTerraformContract(
  operations,
  /\$\.category = \\"configuration\\"/,
  "the connector configuration failure metric",
);
function validateNotificationContract(sources) {
  requireTerraformContract(
    sources.variables,
    /variable "google_gmail_push_enabled"[\s\S]*?default\s*=\s*false/,
    "an independently disabled Gmail push gate",
  );
  requireTerraformContract(
    sources.variables,
    /variable "google_calendar_push_enabled"[\s\S]*?default\s*=\s*false/,
    "an independently disabled Calendar push gate",
  );
  requireTerraformContract(
    sources.variables,
    /variable "icloud_mail_idle_enabled"[\s\S]*?default\s*=\s*false/,
    "an independently disabled iCloud IDLE gate",
  );
  requireTerraformContract(
    sources.variables,
    /check "gmail_push_configuration"[\s\S]*?google_gmail_pubsub_topic[\s\S]*?google_gmail_pubsub_subscription[\s\S]*?google_gmail_push_service_account/,
    "fail-closed Gmail Terraform values",
  );
  for (const [gate, names] of [
    [
      "google_gmail_push_enabled",
      [
        "GOOGLE_GMAIL_PUBSUB_SUBSCRIPTION",
        "GOOGLE_GMAIL_PUBSUB_TOPIC",
        "GOOGLE_GMAIL_PUSH_AUDIENCE",
        "GOOGLE_GMAIL_PUSH_ENABLED",
        "GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT",
      ],
    ],
    [
      "google_calendar_push_enabled",
      ["GOOGLE_CALENDAR_PUSH_ENABLED", "GOOGLE_CALENDAR_WEBHOOK_URL"],
    ],
    ["icloud_mail_idle_enabled", ["ICLOUD_MAIL_IDLE_CONCURRENCY", "ICLOUD_MAIL_IDLE_ENABLED"]],
  ]) {
    const gatedBlock = sources.compute.match(
      new RegExp(`var\\.${gate} \\? \\[([\\s\\S]*?)\\] : \\[\\]`),
    )?.[1];
    if (!gatedBlock) throw new Error(`Provider operations contract is missing the ${gate} block.`);
    for (const name of names) {
      requireTerraformContract(
        gatedBlock,
        new RegExp(`name\\s*=\\s*"${name}"`),
        `the gated ${name} runtime value`,
      );
    }
  }
  for (const path of [
    "/v1/connectors/google/gmail/notifications",
    "/v1/connectors/google/calendar/notifications",
  ]) {
    requireTerraformContract(
      sources.waf,
      new RegExp(`regex_string\\s*=\\s*"\\^${path}\\$"`),
      `the exact ${path} WAF path`,
    );
  }
  requireTerraformContract(
    sources.waf,
    /name\s*=\s*"connector-webhook-rate-limit"[\s\S]*?action\s*\{\s*block[\s\S]*?scope_down_statement[\s\S]*?regex_pattern_set_reference_statement/,
    "a bounded exact-path webhook ingress policy",
  );
  requireTerraformContract(
    sources.waf,
    /name\s*=\s*"connector-webhook-rate-limit"[\s\S]*?limit\s*=\s*var\.connector_webhook_rate_limit/,
    "the dedicated connector webhook rate limit",
  );
  requireTerraformContract(
    sources.config,
    /GOOGLE_GMAIL_PUSH_ENABLED[\s\S]*?GOOGLE_GMAIL_PUBSUB_SUBSCRIPTION[\s\S]*?GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT/,
    "the fail-closed Gmail push runtime validation",
  );
}

const notificationSources = { compute, config, variables, waf };
validateNotificationContract(notificationSources);
const mutations = [
  ["variables", 'variable "google_gmail_push_enabled"'],
  ["variables", 'variable "google_calendar_push_enabled"'],
  ["variables", 'variable "icloud_mail_idle_enabled"'],
  ["variables", 'check "gmail_push_configuration"'],
  ["compute", 'name = "GOOGLE_GMAIL_PUBSUB_SUBSCRIPTION"'],
  ["compute", 'name = "GOOGLE_GMAIL_PUBSUB_TOPIC"'],
  ["compute", 'name = "GOOGLE_GMAIL_PUSH_AUDIENCE"'],
  ["compute", 'name = "GOOGLE_GMAIL_PUSH_SERVICE_ACCOUNT"'],
  ["compute", 'name = "GOOGLE_CALENDAR_WEBHOOK_URL"'],
  ["compute", 'name = "ICLOUD_MAIL_IDLE_CONCURRENCY"'],
  ["waf", "^/v1/connectors/google/gmail/notifications$"],
  ["waf", "^/v1/connectors/google/calendar/notifications$"],
  ["waf", 'name     = "connector-webhook-rate-limit"'],
  ["waf", "limit              = var.connector_webhook_rate_limit"],
];
for (const [sourceName, target] of mutations) {
  const source = notificationSources[sourceName];
  const mutated = source.replace(target, "MUTATED_CONTRACT_VALUE");
  if (mutated === source) throw new Error(`Mutation fixture could not find ${target}.`);
  let rejected = false;
  try {
    validateNotificationContract({ ...notificationSources, [sourceName]: mutated });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`Provider notification mutation was not rejected: ${target}.`);
}

console.log("Provider timeout and network contract passed.");
