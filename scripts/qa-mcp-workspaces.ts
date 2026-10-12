import { writeFile } from "node:fs/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const endpoint = new URL(process.env.QA_MCP_URL ?? "http://127.0.0.1:59467/mcp");
if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) {
  throw Error("This fixture smoke runner accepts only loopback runtimes.");
}
const origin = endpoint.origin;
const token = process.env.QA_MCP_TOKEN;
const fixture = process.env.QA_MCP_FIXTURE;
if (!token && fixture !== "qa+loaded@nohmi.test") {
  throw Error(
    "Set QA_MCP_TOKEN for reads or QA_MCP_FIXTURE=qa+loaded@nohmi.test for fixture mutations.",
  );
}
const results: Array<{ operation: string; passed: boolean }> = [];
const clients: Client[] = [];
let session: string | undefined;
let credential: { id: string; token: string } | undefined;
let oldPolicy: { version: number; reviewBypassEnabled: boolean } | undefined;
async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(new URL(path, origin), {
    method,
    headers: {
      "content-type": "application/json",
      ...(session ? { authorization: `Session ${session}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw Error(`Fixture API ${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? undefined : response.json();
}
async function connect(path: string, value: string) {
  const client = new Client({ name: "workspace-http-smoke", version: "1" });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(path, origin), {
      authProvider: { token: async () => value },
      fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30_000) }),
    }),
  );
  return client;
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 30_000 });
  if (response.isError || !response.structuredContent)
    throw Error(`MCP ${name} did not return a successful domain payload`);
  results.push({ operation: name, passed: true });
  return response.structuredContent as {
    result: { revision: number; preferences: { includeArchivedInSearch: boolean } };
  };
}
try {
  if (fixture) {
    if (fixture !== "qa+loaded@nohmi.test")
      throw Error("Only the named disposable fixture may be mutated.");
    session = (
      await request("/v1/auth/login", "POST", { email: fixture, password: "Testing12345!" })
    ).sessionToken;
    credential = (
      await request("/v1/access-tokens", "POST", {
        name: "Disposable workspace HTTP smoke",
        scopes: [
          "mail:read",
          "mail:write",
          "mail:execute",
          "calendar:read",
          "calendar:write",
          "calendar:execute",
          "tasks:read",
          "tasks:write",
          "tasks:execute",
          "reminders:read",
          "finances:read",
          "finances:write",
          "finances:execute",
        ],
      })
    ).token;
  }
  const bearer = credential?.token ?? token!;
  const normal = await connect("/mcp", bearer);
  const readonly = await connect("/mcp/readonly", bearer);
  const discovered = await normal.listTools();
  const readTools = await readonly.listTools();
  if (readTools.tools.some((tool) => !tool.annotations?.readOnlyHint))
    throw Error("Read-only endpoint advertised a mutation.");
  results.push({ operation: "normal-and-readonly-discovery", passed: true });
  for (const name of [
    "list_calendars",
    "list_task_lists",
    "get_mail_settings",
    "get_finance_overview",
  ])
    await call(normal, name);
  if (fixture) {
    oldPolicy = (await request("/v1/assistant/execution-policy")).settings;
    if (!oldPolicy) throw Error("Missing execution policy readback");
    await request("/v1/assistant/execution-policy", "PATCH", {
      expectedVersion: oldPolicy.version,
      reviewBypassEnabled: true,
    });
    for (const domain of ["calendar", "task", "mail", "finance"]) {
      const before = (await call(normal, `get_${domain}_settings`)).result;
      await call(normal, `update_${domain}_settings`, {
        expectedRevision: before.revision,
        preferences: { includeArchivedInSearch: !before.preferences.includeArchivedInSearch },
      });
      const after = (await call(normal, `get_${domain}_settings`)).result;
      if (
        after.revision !== before.revision + 1 ||
        after.preferences.includeArchivedInSearch === before.preferences.includeArchivedInSearch
      )
        throw Error(`${domain}: settings mutation did not persist`);
      await call(normal, `update_${domain}_settings`, {
        expectedRevision: after.revision,
        preferences: { includeArchivedInSearch: before.preferences.includeArchivedInSearch },
      });
    }
    if (!credential) throw Error("Missing fixture credential");
    const audit = (await request("/v1/audit?limit=100")).events as Array<{
      actorId: string;
      actorType: string;
      action: string;
      entityType: string;
    }>;
    for (const workspace of ["mail", "calendar", "tasks", "finances"]) {
      if (
        !audit.some(
          (event) =>
            event.actorId === credential?.id &&
            event.actorType === "agent" &&
            event.action === "workspace.preferences_updated" &&
            event.entityType === workspace + "_workspace_settings",
        )
      )
        throw Error(workspace + ": missing mutation audit");
      results.push({ operation: workspace + "-mutation-audit", passed: true });
    }
    let hiddenDenied = false;
    try {
      const hidden = await readonly.callTool({
        name: "create_calendar",
        arguments: { name: "Must not exist", timezone: "UTC" },
      });
      hiddenDenied = hidden.isError === true;
    } catch (error) {
      hiddenDenied = error instanceof Error && error.message.includes("not found");
    }
    if (!hiddenDenied) throw Error("Read-only endpoint accepted a mutation.");
    results.push({ operation: "readonly-mutation-denial", passed: true });
    await request(`/v1/access-tokens/${credential!.id}`, "DELETE");
    let rejected = false;
    try {
      const response = await normal.callTool({ name: "list_calendars", arguments: {} });
      rejected = response.isError === true;
    } catch {
      rejected = true;
    }
    if (!rejected) throw Error("Revoked credential still accepted");
    results.push({ operation: "revoked-token-denial", passed: true });
    credential = undefined;
  }
  const report = {
    timestamp: new Date().toISOString(),
    endpoint: origin,
    transport: "Streamable HTTP",
    providerVerification: "not performed",
    discovered: discovered.tools.length,
    results,
  };
  await writeFile(
    process.env.QA_MCP_REPORT ?? "/tmp/workspace-mcp-http-evidence.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `Passed ${results.length} local HTTP checks; ${discovered.tools.length} tools discovered. No real provider effects attempted.`,
  );
} finally {
  await Promise.allSettled(clients.map((client) => client.close()));
  if (oldPolicy && session) {
    const current = (await request("/v1/assistant/execution-policy")).settings;
    await request("/v1/assistant/execution-policy", "PATCH", {
      expectedVersion: current.version,
      reviewBypassEnabled: oldPolicy.reviewBypassEnabled,
    });
  }
  if (credential) await request(`/v1/access-tokens/${credential.id}`, "DELETE");
}
