import { createServer, request, type Server } from "node:http";
import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  type AuthInfo,
  createMcpHandler,
  type McpRequestContext,
  McpServer,
  requireScopes,
} from "@modelcontextprotocol/server";
import express from "express";
import { describe, expect, it, vi } from "vitest";

type PostOptions = { modern?: boolean; raw?: boolean; chunked?: boolean };

function post(server: Server, body: unknown, options: PostOptions = {}) {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP fixture did not bind.");
  const data = options.raw ? String(body) : JSON.stringify(body);
  return new Promise<{ status: number; body: string; challenge: string | undefined }>(
    (resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          method: "POST",
          path: "/mcp",
          agent: false,
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            ...(options.chunked ? {} : { "content-length": Buffer.byteLength(data) }),
            ...(options.modern
              ? {
                  "mcp-protocol-version": "2026-07-28",
                  "mcp-method": "tools/call",
                  "mcp-name": "probe",
                }
              : {}),
          },
        },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            text += chunk;
          });
          response.on("error", reject);
          response.on("end", () =>
            resolve({
              status: response.statusCode ?? 0,
              body: text,
              challenge: response.headers["www-authenticate"],
            }),
          );
        },
      );
      req.setTimeout(1000, () =>
        req.destroy(new Error("HTTP fixture request exceeded its deadline.")),
      );
      req.on("error", reject);
      if (options.chunked) {
        req.write(data.slice(0, 128));
        req.end(data.slice(128));
      } else {
        req.end(data);
      }
    },
  );
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "fixture", version: "1" },
  },
};

function modernCall(id: number) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: "probe",
      arguments: {},
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };
}

type RpcReply = { id?: number; result?: unknown; error?: { code: number; message: string } };

function rpcMessages(text: string): RpcReply[] {
  const events = text
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n"),
    )
    .filter(Boolean);
  return (events.length ? events : [text]).flatMap((data) => {
    const parsed: RpcReply | RpcReply[] = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [parsed];
  });
}

function rpcBody(text: string) {
  return rpcMessages(text)[0];
}

async function peer(parsedBody: boolean, adapterLimit?: number) {
  const invoked = vi.fn(() => ({ content: [{ type: "text" as const, text: "confirmed" }] }));
  const products: McpServer[] = [];
  const observedAuth: Array<AuthInfo | undefined> = [];
  const observedHeaders: Array<{
    contentLength: string | undefined;
    transferEncoding: string | undefined;
  }> = [];
  let validatedAuth: AuthInfo | undefined;
  const factory = vi.fn(({ authInfo }: McpRequestContext) => {
    observedAuth.push(authInfo);
    const server = new McpServer({ name: "transport-boundary", version: "1" });
    server.registerTool(
      "probe",
      { description: "Local fixture only", scopeChallenge: requireScopes("fixture:read") },
      invoked,
    );
    products.push(server);
    return server;
  });
  const handler = createMcpHandler(factory, { legacy: "stateless" });
  const nodeHandler = toNodeHandler(handler, {
    ...(adapterLimit === undefined ? {} : { maxRequestBodySize: adapterLimit }),
  });
  const app = express();
  app.use((req, _res, next) => {
    observedHeaders.push({
      contentLength: req.headers["content-length"],
      transferEncoding: req.headers["transfer-encoding"],
    });
    // Models the already-validated context attached by the production API auth gate.
    // This fixture does not validate credentials or grant production authority.
    if (validatedAuth) (req as express.Request & { auth?: AuthInfo }).auth = validatedAuth;
    next();
  });
  if (parsedBody) app.use(express.json({ limit: "100kb" }));
  app.post("/mcp", (req, res, next) => {
    nodeHandler(req, res, parsedBody ? req.body : undefined).catch(next);
  });
  app.use(
    (
      error: { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(error.status ?? 500).json({ error: "Rejected fixture request" });
    },
  );
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    server,
    factory,
    invoked,
    products,
    observedAuth,
    observedHeaders,
    setValidatedAuth(auth: AuthInfo | undefined) {
      validatedAuth = auth;
    },
    async close() {
      const cleanups = [
        async () => {
          server.closeAllConnections();
          await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
        },
        () => handler.close(),
        ...products.map((product) => () => product.close()),
      ];
      const errors: unknown[] = [];
      for (const cleanup of cleanups) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "HTTP fixture cleanup failed.");
    },
  };
}

describe("MCP Node HTTP dependency boundary", () => {
  it("serves legacy initialization and independent modern requests through the real adapter", async () => {
    const fixture = await peer(true);
    try {
      const legacy = await post(fixture.server, initialize);
      expect(legacy.status, legacy.body).toBe(200);
      expect(rpcBody(legacy.body)).toMatchObject({
        id: 1,
        result: { protocolVersion: "2025-03-26" },
      });
      for (const id of [2, 3]) {
        const modern = await post(fixture.server, modernCall(id), { modern: true });
        expect(modern.status, modern.body).toBe(200);
        expect(rpcBody(modern.body)).toMatchObject({
          id,
          result: { content: [{ type: "text", text: "confirmed" }] },
        });
      }
      expect(fixture.invoked).toHaveBeenCalledTimes(2);
      expect(fixture.factory).toHaveBeenCalledTimes(3);
      expect(new Set(fixture.products).size).toBe(3);
    } finally {
      await fixture.close();
    }
  });

  it("enforces the new adapter read bound before the handler and accepts the next request", async () => {
    const fixture = await peer(false, 256);
    try {
      const oversized = await post(fixture.server, { ...initialize, padding: "x".repeat(512) });
      expect(oversized.status, oversized.body).toBe(413);
      expect(fixture.factory).not.toHaveBeenCalled();
      expect(fixture.invoked).not.toHaveBeenCalled();
      const next = await post(fixture.server, initialize);
      expect(next.status, next.body).toBe(200);
      expect(rpcBody(next.body)).toMatchObject({
        id: 1,
        result: { protocolVersion: "2025-03-26" },
      });
    } finally {
      await fixture.close();
    }
  });

  it("preserves the Express 100kb limit and rejects malformed JSON before dispatch", async () => {
    const fixture = await peer(true);
    try {
      const oversized = await post(fixture.server, {
        ...initialize,
        padding: "x".repeat(101 * 1024),
      });
      expect(oversized.status, oversized.body).toBe(413);
      const malformed = await post(fixture.server, "{invalid", { raw: true });
      expect(malformed.status, malformed.body).toBe(400);
      expect(fixture.factory).not.toHaveBeenCalled();
      expect(fixture.invoked).not.toHaveBeenCalled();
      const next = await post(fixture.server, modernCall(2), { modern: true });
      expect(next.status, next.body).toBe(200);
      expect(rpcBody(next.body)).toMatchObject({
        id: 2,
        result: { content: [{ text: "confirmed" }] },
      });
      expect(fixture.invoked).toHaveBeenCalledTimes(1);
    } finally {
      await fixture.close();
    }
  });

  it("accepts 100 legacy calls and rejects 101 without additional dispatch", async () => {
    const fixture = await peer(true);
    try {
      const batch = Array.from({ length: 101 }, (_, id) => ({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "probe", arguments: {} },
      }));
      const accepted = await post(fixture.server, batch.slice(0, 100));
      expect(accepted.status, accepted.body).toBe(200);
      const replies = rpcMessages(accepted.body);
      expect(replies).toHaveLength(100);
      expect(replies.map((reply) => reply.id).sort((a, b) => (a ?? -1) - (b ?? -1))).toEqual(
        Array.from({ length: 100 }, (_, id) => id),
      );
      for (const reply of replies) {
        expect(reply).toMatchObject({ result: { content: [{ text: "confirmed" }] } });
      }
      expect(fixture.invoked).toHaveBeenCalledTimes(100);
      const rejected = await post(fixture.server, batch);
      expect(rejected.status, rejected.body).toBe(400);
      expect(rpcBody(rejected.body)).toMatchObject({
        error: { code: -32600, message: "Invalid Request: Batch must not exceed 100 messages" },
      });
      expect(fixture.invoked).toHaveBeenCalledTimes(100);
      const next = await post(fixture.server, modernCall(102), { modern: true });
      expect(next.status, next.body).toBe(200);
      expect(rpcBody(next.body)).toMatchObject({
        id: 102,
        result: { content: [{ text: "confirmed" }] },
      });
      expect(fixture.invoked).toHaveBeenCalledTimes(101);
    } finally {
      await fixture.close();
    }
  });

  it("bounds chunked bodies without a declared length and preserves the next request", async () => {
    const fixture = await peer(false, 256);
    try {
      const oversized = await post(
        fixture.server,
        { ...initialize, padding: "x".repeat(512) },
        { chunked: true },
      );
      expect(fixture.observedHeaders[0]).toEqual({
        contentLength: undefined,
        transferEncoding: "chunked",
      });
      expect(oversized.status, oversized.body).toBe(413);
      expect(fixture.factory).not.toHaveBeenCalled();
      expect(fixture.invoked).not.toHaveBeenCalled();
      const next = await post(fixture.server, initialize);
      expect(next.status, next.body).toBe(200);
      expect(rpcBody(next.body)).toMatchObject({
        id: 1,
        result: { protocolVersion: "2025-03-26" },
      });
    } finally {
      await fixture.close();
    }
  });

  it("forwards validated auth per request and challenges missing scopes before dispatch", async () => {
    const fixture = await peer(true);
    const resource = new URL("https://example.test/mcp");
    const resourceMetadataUrl = "https://example.test/.well-known/oauth-protected-resource/mcp";
    const denied: AuthInfo = {
      token: "synthetic-denied",
      clientId: "first-fixture-client",
      resource,
      resourceMetadataUrl,
      scopes: [],
      extra: { subject: "first-fixture-identity" },
    };
    const allowed: AuthInfo = {
      token: "synthetic-allowed",
      clientId: "second-fixture-client",
      resource,
      resourceMetadataUrl,
      scopes: ["fixture:read"],
      extra: { subject: "second-fixture-identity" },
    };
    try {
      fixture.setValidatedAuth(denied);
      const rejected = await post(fixture.server, modernCall(1), { modern: true });
      expect(rejected.status, rejected.body).toBe(403);
      expect(rejected.challenge).toContain('error="insufficient_scope"');
      expect(rejected.challenge).toContain('scope="fixture:read"');
      expect(rejected.challenge).toContain(`resource_metadata="${resourceMetadataUrl}"`);
      expect(fixture.observedAuth[0]).toBe(denied);
      expect(fixture.invoked).not.toHaveBeenCalled();

      fixture.setValidatedAuth(allowed);
      const accepted = await post(fixture.server, modernCall(2), { modern: true });
      expect(accepted.status, accepted.body).toBe(200);
      expect(rpcBody(accepted.body)).toMatchObject({
        id: 2,
        result: { content: [{ text: "confirmed" }] },
      });
      expect(fixture.observedAuth[1]).toBe(allowed);
      expect(fixture.observedAuth[1]).toMatchObject({
        clientId: "second-fixture-client",
        resource,
        scopes: ["fixture:read"],
        extra: { subject: "second-fixture-identity" },
      });
      expect(fixture.invoked).toHaveBeenCalledTimes(1);

      fixture.setValidatedAuth(denied);
      const deniedAgain = await post(fixture.server, modernCall(3), { modern: true });
      expect(deniedAgain.status, deniedAgain.body).toBe(403);
      expect(fixture.observedAuth[2]).toBe(denied);
      expect(fixture.invoked).toHaveBeenCalledTimes(1);
    } finally {
      await fixture.close();
    }
  });
});
