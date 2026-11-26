const { getDefaultConfig } = require("expo/metro-config");
const { createDevProxyMiddleware } = require("./web-host/dev-proxy.cjs");
const { createResolveRequest } = require("./web-host/resolve.cjs");

const config = getDefaultConfig(__dirname);
// Shared NodeNext packages and the shared web UI use .js specifiers for TypeScript sources, and
// the web UI imports through its `@/` alias. Teach Metro the same resolution as Vite, and keep
// a single React copy in the bundle. See web-host/resolve.cjs.
config.resolver.resolveRequest = createResolveRequest();
// The web target serves the shared web UI, which calls the API on its own origin.
const enhanceMiddleware = config.server.enhanceMiddleware;
config.server.enhanceMiddleware = (middleware, server) => {
  const base = enhanceMiddleware ? enhanceMiddleware(middleware, server) : middleware;
  const proxy = createDevProxyMiddleware();
  return (request, response, next) => proxy(request, response, () => base(request, response, next));
};
module.exports = config;
