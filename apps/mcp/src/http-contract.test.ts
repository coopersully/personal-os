import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";

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
    expect(httpSource).toContain('createIloAppLinks(appBaseUrl, "assistant")');
    expect(httpSource).toContain("resource_documentation: appLinks.agentAccess");
    expect(httpSource).not.toContain('APP_BASE_URL ?? "http://localhost:8081"');
    expect(stdioSource).toContain("resolveAppBaseUrl(process.env");
    expect(stdioSource).not.toContain('APP_BASE_URL ?? "http://localhost:8081"');
  });
});

describe("public MCP protected-resource metadata", () => {
  let child: ChildProcess;
  let origin: string;
  let diagnostics = "";

  beforeAll(async () => {
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
});
