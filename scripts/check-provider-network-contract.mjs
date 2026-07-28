import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const compute = readFileSync(resolve(root, "infra/compute.tf"), "utf8");
const network = readFileSync(resolve(root, "infra/network.tf"), "utf8");
const providerHttp = readFileSync(resolve(root, "packages/connectors/src/http.ts"), "utf8");
const icloud = readFileSync(resolve(root, "packages/connectors/src/icloud.ts"), "utf8");

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

if (!/host:\s*"smtp\.mail\.me\.com"[\s\S]*?port:\s*587/.test(icloud)) {
  throw new Error("iCloud SMTP must declare smtp.mail.me.com:587.");
}

requireApplicationEgress(993, "iCloud Mail IMAP over TLS");
requireApplicationEgress(587, "iCloud Mail SMTP submission");

console.log("Provider timeout and network contract passed.");
