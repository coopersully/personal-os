#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApiClient } from "@personal-os/api-client";
import { createPersonalOsMcpServer } from "./server.js";

const apiUrl = process.env.PERSONAL_OS_API_URL ?? "http://127.0.0.1:8787";
const token = process.env.PERSONAL_OS_TOKEN;

if (!token) {
  process.stderr.write("PERSONAL_OS_TOKEN is required. Create one in ilo settings.\n");
  process.exit(1);
}

const server = createPersonalOsMcpServer({
  api: createApiClient({ baseUrl: apiUrl, token }),
  timeZone: process.env.PERSONAL_OS_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
});

await server.connect(new StdioServerTransport());
