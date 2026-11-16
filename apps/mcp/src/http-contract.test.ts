import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

describe("MCP OAuth resource metadata", () => {
  it("does not advertise the retired automation write authority", async () => {
    const source = await readFile(new URL("./http.ts", import.meta.url), "utf8");
    const metadata = source.slice(
      source.indexOf("const protectedResourceMetadata"),
      source.indexOf('app.get("/.well-known/oauth-protected-resource"'),
    );

    expect(metadata).toContain('"automations:read"');
    expect(metadata).not.toContain('"automations:write"');
    expect(metadata).toContain('"finances:maintain"');
  });

  it("validates one explicit application origin at every entry point", async () => {
    const [httpSource, stdioSource] = await Promise.all([
      readFile(new URL("./http.ts", import.meta.url), "utf8"),
      readFile(new URL("./stdio.ts", import.meta.url), "utf8"),
    ]);

    expect(httpSource).toContain("resolveAppBaseUrl(process.env");
    expect(httpSource).toContain('createPersonalOsAppLinks(appBaseUrl, "assistant")');
    expect(httpSource).toContain("resource_documentation: appLinks.agentAccess");
    expect(httpSource).not.toContain('APP_BASE_URL ?? "http://localhost:8081"');
    expect(stdioSource).toContain("resolveAppBaseUrl(process.env");
    expect(stdioSource).not.toContain('APP_BASE_URL ?? "http://localhost:8081"');
  });
});

describe("public MCP protected-resource metadata", () => {
  let api: Server;
  let child: ChildProcess;
  let origin: string;
  let diagnostics = "";

  beforeAll(async () => {
    // Discovery asks the API for live grants on each request.
    api = createServer((request, response) => {
      if (
        request.url !== "/v1/assistant/context" ||
        request.headers.authorization !== "Bearer knowledge-test"
      ) {
        response.writeHead(401).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          context: {
            time: { timezone: "UTC" },
            access: { grantedScopes: ["knowledge:read", "knowledge:write"] },
          },
        }),
      );
    });
    api.listen(0, "127.0.0.1");
    await once(api, "listening");
    const apiAddress = api.address();
    if (!apiAddress || typeof apiAddress === "string") throw new Error("Missing test API port");
    // Run the actual HTTP entry point. Report its kernel-assigned test port
    // through IPC without changing the application's public metadata origin.
    child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `import { Server } from "node:net";
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  this.once("listening", () => process.send({ port: this.address().port }));
  return listen.apply(this, args);
};
await import("./apps/mcp/src/http.ts");`,
      ],
      {
        cwd: new URL("../../..", import.meta.url),
        env: {
          ...process.env,
          NODE_ENV: "test",
          HOST: "127.0.0.1",
          PORT: "0",
          APP_BASE_URL: "https://app.example.test",
          MCP_PUBLIC_URL: "http://127.0.0.1:8789",
          OAUTH_AUTHORIZATION_SERVER_URL: "https://api.example.test",
          PERSONAL_OS_API_URL: `http://127.0.0.1:${apiAddress.port}`,
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    child.stdout?.on("data", (data) => {
      diagnostics += String(data);
    });
    child.stderr?.on("data", (data) => {
      diagnostics += String(data);
    });
    const message = await Promise.race([
      once(child, "message"),
      once(child, "exit").then(([code]) => {
        throw new Error(`HTTP entry point exited ${code}: ${diagnostics}`);
      }),
    ]);
    const { port } = message[0] as { port: number };
    expect(port).toBeGreaterThan(0);
    origin = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      await exited;
    }
    if (api?.listening) {
      const closed = once(api, "close");
      api.close();
      await closed;
    }
  });

  it("advertises opt-in knowledge scopes on both discovery routes without granting access", async () => {
    const aliases = [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ];
    const documents = [];
    for (const path of aliases) {
      const response = await fetch(`${origin}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      const metadata = (await response.json()) as { scopes_supported: string[] };
      expect(metadata).toMatchObject({
        resource: "http://127.0.0.1:8789/mcp",
        authorization_servers: ["https://api.example.test"],
        resource_name: "nohmi",
        scopes_supported: expect.arrayContaining([
          "knowledge:read",
          "knowledge:write",
          "automations:read",
          "finances:maintain",
        ]),
      });
      expect(metadata.scopes_supported).not.toContain("automations:write");
      expect(metadata.scopes_supported.filter((scope) => scope.startsWith("knowledge:"))).toEqual([
        "knowledge:read",
        "knowledge:write",
      ]);
      documents.push(metadata);
    }
    expect(documents[0]).toEqual(documents[1]);
    const denied = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="http://127.0.0.1:8789/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it.each([
    [
      "/mcp",
      [
        "get_context_for_intent",
        "get_knowledge",
        "merge_knowledge_tags",
        "save_knowledge",
        "search_user_knowledge",
        "update_knowledge",
      ],
    ],
    ["/mcp/readonly", ["get_context_for_intent", "get_knowledge", "search_user_knowledge"]],
  ])("discovers the permitted knowledge tools at %s", async (path, expected) => {
    const client = new Client({ name: "knowledge-discovery", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL(path, origin), {
      requestInit: { headers: { authorization: "Bearer knowledge-test" } },
    });
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools.filter(
        (tool) => tool._meta?.["ilo/domain"] === "knowledge",
      );
      expect(tools.map((tool) => tool.name).sort()).toEqual(expected);
      for (const tool of tools) {
        const write = ["merge_knowledge_tags", "save_knowledge", "update_knowledge"].includes(
          tool.name,
        );
        expect(tool.annotations?.readOnlyHint).toBe(!write);
        expect(tool.outputSchema?.properties).toHaveProperty("_ilo");
      }
    } finally {
      await client.close();
    }
  });

  it("update_knowledge offers agents only the agent actions", async () => {
    const client = new Client({ name: "knowledge-actions", version: "1" });
    const transport = new StreamableHTTPClientTransport(new URL("/mcp", origin), {
      requestInit: { headers: { authorization: "Bearer knowledge-test" } },
    });
    try {
      await client.connect(transport);
      const tool = (await client.listTools()).tools.find(({ name }) => name === "update_knowledge");
      const actions = new Set<string>();
      const visit = (node: unknown) => {
        if (Array.isArray(node)) return node.forEach(visit);
        if (!node || typeof node !== "object") return;
        const action = (node as { properties?: { action?: { const?: unknown } } }).properties
          ?.action?.const;
        if (typeof action === "string") actions.add(action);
        Object.values(node).forEach(visit);
      };
      visit(tool?.inputSchema);
      expect([...actions].sort()).toEqual(
        [
          "archive",
          "dispute",
          "raise_sensitivity",
          "restrict",
          "revise",
          "supersede",
          "unarchive",
        ].sort(),
      );
      for (const action of [
        "confirm",
        "set_access",
        "widen",
        "set_sensitivity",
        "resolve_conflict",
        "trash",
        "restore",
        "delete_now",
      ])
        expect(actions).not.toContain(action);
    } finally {
      await client.close();
    }
  });
});
