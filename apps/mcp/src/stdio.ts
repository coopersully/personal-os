#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createApiClient } from "@personal-os/api-client";
import { resolveAppBaseUrl } from "./app-links.js";
import { createPersonalOsMcpServer } from "./server.js";

const apiUrl = process.env.PERSONAL_OS_API_URL ?? "http://127.0.0.1:8788";
const appBaseUrl = resolveAppBaseUrl(process.env, {
  production: process.env.NODE_ENV === "production",
});
const token = process.env.PERSONAL_OS_TOKEN;

if (!token) {
  process.stderr.write("PERSONAL_OS_TOKEN is required. Create one in Nomi settings.\n");
  process.exit(1);
}

const api = createApiClient({ baseUrl: apiUrl, token });
const context = await api.getIloContext();

serveStdio(() =>
  createPersonalOsMcpServer({
    api,
    appBaseUrl,
    includeCompatibilityTools: process.env.MCP_INCLUDE_COMPATIBILITY_TOOLS === "true",
    scopes: new Set(context.access.grantedScopes),
    timeZone:
      process.env.PERSONAL_OS_TIMEZONE ??
      context.time.timezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone,
  }),
);
