import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const config = readFileSync(join(root, "config.alloy"), "utf8");
const image = readFileSync(join(root, "compose.yaml"), "utf8").match(/image: (\S+)/)[1];
const temporary = mkdtempSync(join(tmpdir(), "nohmi-alloy-"));
const name = `nohmi-alloy-validation-${process.pid}`;
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
try {
  writeFileSync(join(temporary, "token"), "validation-only", { mode: 0o600 });
  docker(
    "run",
    "--rm",
    "--network",
    "none",
    "-v",
    `${root}/config.alloy:/etc/alloy/config.alloy:ro`,
    "-v",
    `${temporary}/token:/run/secrets/grafana-token:ro`,
    "-e",
    "GRAFANA_PROMETHEUS_URL=https://example.invalid/api/prom/push",
    "-e",
    "GRAFANA_LOKI_URL=https://example.invalid/loki/api/v1/push",
    "-e",
    "GRAFANA_PROMETHEUS_USER=validation",
    "-e",
    "GRAFANA_LOKI_USER=validation",
    image,
    "validate",
    "/etc/alloy/config.alloy",
  );
  const pipeline = config
    .slice(config.indexOf('loki.process "safe_events"'), config.indexOf('loki.write "cloud"'))
    .replace("loki.write.cloud.receiver", "loki.echo.test.receiver");
  writeFileSync(
    join(temporary, "smoke.alloy"),
    `logging { level = "info" }\n${pipeline}\nloki.echo "test" {}\nloki.source.api "test" {\n http { listen_address = "0.0.0.0"\n listen_port = 12346 }\n forward_to = [loki.process.safe_events.receiver]\n}\n`,
  );
  docker(
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "-p",
    "127.0.0.1::12346",
    "-v",
    `${temporary}/smoke.alloy:/etc/alloy/config.alloy:ro`,
    image,
    "run",
    "/etc/alloy/config.alloy",
  );
  const address = docker("port", name, "12346").trim();
  const lines = [
    JSON.stringify({
      event: "connector_capability_failed",
      provider: "google",
      capability: "mail",
      status: 403,
      code: "plaid_authorization_failed",
      freshnessAgeMs: 172800000,
      durationMs: 172800000,
      failureCount: 1000000,
      transportCode: "ENOTFOUND",
      transportPhase: "dns",
      syncSource: "scheduled",
      email: "PRIVATE_CANARY",
      message: "PRIVATE_CANARY",
    }),
    JSON.stringify({
      event: "request",
      status: 500,
      path: "PRIVATE_CANARY",
      code: "PRIVATE_CANARY",
      transportCode: "PRIVATE_CANARY",
      transportPhase: "PRIVATE_CANARY",
      syncSource: "PRIVATE_CANARY",
    }),
    JSON.stringify({ event: "private_PRIVATE_CANARY", provider: "PRIVATE_CANARY" }),
    JSON.stringify({
      event: "request",
      provider: "PRIVATE_CANARY",
      status: "PRIVATE_CANARY",
      capability: "PRIVATE_CANARY",
    }),
    "malformed_PRIVATE_CANARY",
    // The final record marks completion of this ordered stream, including rejected inputs.
    JSON.stringify({ event: "request", status: 204 }),
  ];
  const payload = {
    streams: [
      {
        stream: { job: "nohmi-api", private: "PRIVATE_CANARY" },
        values: lines.map((line, i) => [
          (BigInt(Date.now()) * 1_000_000n + BigInt(i)).toString(),
          line,
        ]),
      },
    ],
  };
  let sent = false;
  for (let attempt = 0; attempt < 50 && !sent; attempt++) {
    try {
      const response = await fetch(`http://${address}/loki/api/v1/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(1000),
      });
      assert.equal(response.status, 204);
      sent = true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!sent) console.error(docker("logs", name));
  assert.ok(sent, "Alloy test receiver did not start");
  let logs = "";
  for (let attempt = 0; attempt < 30; attempt++) {
    const captured = spawnSync("docker", ["logs", name], { encoding: "utf8" });
    logs = captured.stdout + captured.stderr;
    if (
      logs.includes("event=connector_capability_failed") &&
      logs.includes("status=500") &&
      logs.includes("status=204") &&
      (logs.match(/received log entry/g) ?? []).length >= 4
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(logs.includes("code=plaid_authorization_failed"), "Expected safe event missing");
  assert.ok(logs.includes("status=500"), "Expected safe request missing");
  assert.ok(logs.includes("status=204"), "Final stream record missing");
  assert.match(
    logs,
    /freshnessAgeMs=(172800000|1[.]728e[+]08)/,
    "Stale freshness must survive numeric JSON extraction",
  );
  assert.match(logs, /durationMs=(172800000|1[.]728e[+]08)/);
  assert.match(logs, /transportCode=ENOTFOUND/);
  assert.match(logs, /transportPhase=dns/);
  assert.match(logs, /syncSource=scheduled/);
  assert.match(logs, /failureCount=(1000000|1e[+]06)/);
  assert.equal(logs.includes("PRIVATE_CANARY"), false, "Privacy filter forwarded private content");
  assert.equal((logs.match(/received log entry/g) ?? []).length, 4, "Unexpected records forwarded");
  console.log("Alloy configuration and real log-pipeline privacy checks passed.");
} finally {
  try {
    docker("rm", "-f", name);
  } catch {}
  rmSync(temporary, { recursive: true, force: true });
}
