import { hostHeaderValidation } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { type AuthInfo, createMcpHandler } from "@modelcontextprotocol/server";
import { ApiClientError, createApiClient } from "@personal-os/api-client";
import type { IloAgentContext } from "@personal-os/domain";
import express, { type Request, type Response } from "express";
import { createIloAppLinks, resolveAppBaseUrl } from "./app-links.js";
import {
  createFixedWindowRateLimiter,
  isAllowedOrigin,
  loadMcpSecurityConfig,
  requestIp,
  tokenFingerprint,
} from "./security.js";
import { createPersonalOsMcpServer } from "./server.js";

const apiUrl = process.env.PERSONAL_OS_API_URL ?? "http://127.0.0.1:8788";
const appBaseUrl = resolveAppBaseUrl(process.env, {
  production: process.env.NODE_ENV === "production",
});
const appLinks = createIloAppLinks(appBaseUrl, "assistant");
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 8789);
const publicUrl = (process.env.MCP_PUBLIC_URL ?? `http://${host}:${port}`).replace(/\/$/, "");
const resourceUrl = new URL(`${publicUrl}/mcp`);
const resourceMetadataUrl = `${publicUrl}/.well-known/oauth-protected-resource/mcp`;
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

type IloAuthExtra = {
  context: IloAgentContext;
  readOnly: boolean;
  timeZone: string;
};

const handler = createMcpHandler(
  ({ authInfo }) => {
    if (!authInfo) throw new Error("Authenticated MCP context is required.");
    const extra = authInfo.extra as IloAuthExtra | undefined;
    if (!extra?.context) throw new Error("Validated Ilo context is required.");
    return createPersonalOsMcpServer({
      api: apiClient(authInfo.token),
      appBaseUrl,
      includeCompatibilityTools: process.env.MCP_INCLUDE_COMPATIBILITY_TOOLS === "true",
      readOnly: extra.readOnly,
      scopes: new Set(extra.context.access.grantedScopes),
      timeZone: extra.timeZone,
    });
  },
  {
    legacy: "stateless",
    onerror(error) {
      process.stderr.write(`[ilo-mcp] ${error.name}: ${error.message}\n`);
    },
  },
);
const nodeHandler = toNodeHandler(handler, {
  onerror(error) {
    process.stderr.write(`[ilo-mcp] adapter ${error.name}: ${error.message}\n`);
  },
});

const app = express();
app.disable("x-powered-by");
app.use(express.json());

app.get("/health/live", (_request, response) => response.json({ status: "ok" }));
app.use(hostHeaderValidation([new URL(publicUrl).hostname]));
const protectedResourceMetadata = {
  authorization_servers: [authorizationServer],
  resource: resourceUrl.href,
  resource_documentation: appLinks.agentAccess,
  resource_name: "ilo",
  scopes_supported: [
    "tasks:read",
    "tasks:write",
    "reminders:read",
    "reminders:write",
    "calendar:read",
    "calendar:write",
    "mail:read",
    "mail:write",
    "goals:read",
    "goals:write",
    "automations:read",
    "audit:read",
    "finances:read",
    "finances:write",
    "bookmarks:read",
  ],
};
app.get("/.well-known/oauth-protected-resource", (_request, response) =>
  response.json(protectedResourceMetadata),
);
app.get("/.well-known/oauth-protected-resource/mcp", (_request, response) =>
  response.json(protectedResourceMetadata),
);

for (const path of ["/mcp", "/mcp/readonly"]) {
  app.get(path, methodNotAllowed);
  app.delete(path, methodNotAllowed);
}
app.post("/mcp", (request, response) => serveMcp(request, response, false));
app.post("/mcp/readonly", (request, response) => serveMcp(request, response, true));

const listener = app.listen(port, host, () => {
  process.stderr.write(`ilo MCP listening at http://${host}:${port}/mcp\n`);
});

async function serveMcp(request: Request, response: Response, readOnly: boolean): Promise<void> {
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
    response.setHeader("www-authenticate", `Bearer resource_metadata="${resourceMetadataUrl}"`);
    response.status(401).json({
      error: "An Ilo bearer token is required.",
      id: null,
      jsonrpc: "2.0",
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

  try {
    const context = await apiClient(token).getIloContext();
    const timeZone = request.header("x-personal-os-timezone") ?? context.time.timezone ?? "UTC";
    const auth: AuthInfo = {
      clientId: "ilo-mcp-client",
      extra: { context, readOnly, timeZone } satisfies IloAuthExtra,
      resource: resourceUrl,
      scopes: context.access.grantedScopes,
      token,
    };
    (request as Request & { auth?: AuthInfo }).auth = auth;
    await nodeHandler(request, response, request.body);
  } catch (error) {
    if (error instanceof ApiClientError) {
      response.setHeader("www-authenticate", `Bearer resource_metadata="${resourceMetadataUrl}"`);
      response.status(error.status === 403 ? 403 : 401).json({
        error: "The Ilo bearer token could not be authorized.",
        id: null,
        jsonrpc: "2.0",
      });
      return;
    }
    process.stderr.write(
      `[ilo-mcp] request failed: ${error instanceof Error ? error.name : "unknown error"}\n`,
    );
    if (!response.headersSent) {
      response.status(500).json({
        error: { code: -32603, message: "Internal server error" },
        id: null,
        jsonrpc: "2.0",
      });
    }
  }
}

function apiClient(token: string) {
  return createApiClient({
    baseUrl: apiUrl,
    headers: {
      "x-personal-os-mcp-key": process.env.MCP_INTERNAL_SECRET ?? "",
      "x-personal-os-mcp-resource": resourceUrl.href,
    },
    token,
  });
}

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

async function shutdown(): Promise<void> {
  await handler.close();
  listener.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
