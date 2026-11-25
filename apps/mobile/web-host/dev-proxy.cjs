// Development-only middleware: forward the web UI's same-origin API paths from the Metro dev
// server to the local API and MCP servers, matching apps/web/vite.config.ts. Production web
// hosting is unchanged and does not use this.
const http = require("node:http");
const https = require("node:https");

const defaultTargets = {
  api: "http://127.0.0.1:8788",
  mcp: "http://127.0.0.1:8789",
};

function proxyTargets(environment = process.env) {
  return {
    api:
      environment.PERSONAL_OS_WEB_API_PROXY_TARGET ||
      environment.VITE_PROXY_API_TARGET ||
      defaultTargets.api,
    mcp:
      environment.PERSONAL_OS_WEB_MCP_PROXY_TARGET ||
      environment.VITE_PROXY_MCP_TARGET ||
      defaultTargets.mcp,
  };
}

/** Selects the upstream for a request path, or null when Metro should serve it. */
function upstreamFor(pathname, targets) {
  if (pathname === "/health" || pathname.startsWith("/health/"))
    return { target: targets.api, changeOrigin: true };
  if (pathname === "/v1" || pathname.startsWith("/v1/"))
    return { target: targets.api, changeOrigin: true };
  if (pathname === "/mcp" || pathname.startsWith("/mcp/"))
    return { target: targets.mcp, changeOrigin: false };
  return null;
}

function createDevProxyMiddleware(targets = proxyTargets()) {
  return (request, response, next) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const upstream = upstreamFor(pathname, targets);
    if (!upstream) {
      next();
      return;
    }
    const target = new URL(upstream.target);
    const transport = target.protocol === "https:" ? https : http;
    const headers = { ...request.headers };
    if (upstream.changeOrigin) headers.host = target.host;
    const proxied = transport.request(
      {
        headers,
        hostname: target.hostname,
        method: request.method,
        path: request.url,
        port: target.port,
        protocol: target.protocol,
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        upstreamResponse.pipe(response);
      },
    );
    proxied.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "Content-Type": "text/plain" });
      response.end("The local nohmi API is not reachable from the Expo dev server.");
    });
    request.pipe(proxied);
  };
}

module.exports = { createDevProxyMiddleware, proxyTargets, upstreamFor };
