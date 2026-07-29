import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { createApiClient } from "@personal-os/api-client";
import express, { type Request, type Response } from "express";
import {
  createFixedWindowRateLimiter,
  isAllowedOrigin,
  loadMcpSecurityConfig,
  requestIp,
  tokenFingerprint,
} from "./security.js";
import { createPersonalOsMcpServer } from "./server.js";

const apiUrl = process.env.PERSONAL_OS_API_URL ?? "http://127.0.0.1:8788";
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8789);
const publicUrl = (process.env.MCP_PUBLIC_URL ?? `http://${host}:${port}`).replace(/\/$/, "");
const authorizationServer = (
  process.env.OAUTH_AUTHORIZATION_SERVER_URL ??
  process.env.PERSONAL_OS_API_URL ??
  apiUrl
).replace(/\/$/, "");
const security = loadMcpSecurityConfig(process.env);
const rateLimiter = createFixedWindowRateLimiter({
  maxRequests: security.rateLimitMaxRequests,
  windowMs: security.rateLimitWindowMs,
});
const app = express();
app.disable("x-powered-by");
app.use(express.json());

app.get("/health/live", (_request, response) => response.json({ status: "ok" }));
app.use(hostHeaderValidation([new URL(publicUrl).hostname]));
app.get("/.well-known/oauth-protected-resource", (_request, response) =>
  response.json({ authorization_servers: [authorizationServer], resource: `${publicUrl}/mcp` }),
);
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);
app.post("/mcp", async (request, response) => {
  if (!isAllowedOrigin(request.header("origin"), security.allowedOrigins)) {
    response.status(403).json({
      error: { code: -32_001, message: "This browser origin is not allowed." },
      id: null,
      jsonrpc: "2.0",
    });
    return;
  }

  const token = bearerToken(request);
  if (!token) {
    response.setHeader(
      "www-authenticate",
      `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource"`,
    );
    response.status(401).json({
      error: "An ilo bearer token is required.",
      jsonrpc: "2.0",
      id: null,
    });
    return;
  }

  const rateLimit = rateLimiter.check(
    `${tokenFingerprint(token)}:${requestIp(request, security.trustProxy)}`,
  );
  if (!rateLimit.allowed) {
    response.setHeader("retry-after", String(rateLimit.retryAfterSeconds));
    response.status(429).json({
      error: { code: -32_002, message: "Too many MCP requests. Please retry shortly." },
      id: null,
      jsonrpc: "2.0",
    });
    return;
  }

  const server = createPersonalOsMcpServer({
    api: createApiClient({
      baseUrl: apiUrl,
      headers: {
        "x-personal-os-mcp-key": process.env.MCP_INTERNAL_SECRET ?? "",
        "x-personal-os-mcp-resource": `${publicUrl}/mcp`,
      },
      token,
    }),
    timeZone: request.header("x-personal-os-timezone") ?? process.env.PERSONAL_OS_TIMEZONE ?? "UTC",
  });
  const transport = new StreamableHTTPServerTransport();
  response.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    // SDK 1.29's accessor declarations conflict with exactOptionalPropertyTypes even
    // though the transport implements the SDK's Transport interface at runtime.
    await server.connect(transport as unknown as Transport);
    await transport.handleRequest(request, response, request.body);
  } catch (error) {
    process.stderr.write(
      `[personal-os-mcp] request failed: ${error instanceof Error ? error.name : "unknown error"}\n`,
    );
    if (!response.headersSent) {
      response.status(500).json({
        error: { code: -32603, message: "Internal server error" },
        id: null,
        jsonrpc: "2.0",
      });
    }
  }
});

const listener = app.listen(port, host, () => {
  process.stderr.write(`ilo MCP listening at http://${host}:${port}/mcp\n`);
});

process.on("SIGINT", () => listener.close(() => process.exit(0)));
process.on("SIGTERM", () => listener.close(() => process.exit(0)));

function bearerToken(request: Request): string | null {
  const authorization = request.header("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
}

function methodNotAllowed(_request: Request, response: Response): void {
  response.status(405).json({
    error: { code: -32_000, message: "Method not allowed." },
    id: null,
    jsonrpc: "2.0",
  });
}
