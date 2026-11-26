// Focused tests for the Expo web host's build tooling: `node --test apps/mobile/web-host/`.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { rewriteGeistFontUrls } from "./font-urls.mjs";

const require = createRequire(import.meta.url);
// Babel ships with Expo; resolve it the way Metro does instead of declaring a second copy.
const { transformSync } = require(
  require.resolve("@babel/core", { paths: [require.resolve("expo/package.json")] }),
);
const importMetaEnv = require("./import-meta-env.cjs");
const { createResolveRequest, isSingleton, rewriteSpecifier } = require("./resolve.cjs");
const { createDevProxyMiddleware, proxyTargets, upstreamFor } = require("./dev-proxy.cjs");

const workspace = resolve(import.meta.dirname, "../../..");
const web = (path) => join(workspace, "apps/web", path);

function compile(code) {
  return transformSync(code, {
    babelrc: false,
    configFile: false,
    filename: web("src/example.ts"),
    plugins: [importMetaEnv],
  }).code;
}

test("import.meta.env maps onto Expo environment values", () => {
  assert.match(compile("a(import.meta.env.DEV)"), /process\.env\.NODE_ENV !== "production"/);
  assert.match(compile("a(import.meta.env.PROD)"), /process\.env\.NODE_ENV === "production"/);
  assert.match(compile("a(import.meta.env.MODE)"), /a\(process\.env\.NODE_ENV\)/);
  assert.match(compile("a(import.meta.env.SSR)"), /a\(false\)/);
  assert.match(compile("a(import.meta.env.BASE_URL)"), /a\("\/"\)/);
  assert.match(
    compile("a(import.meta.env.VITE_API_BASE_URL)"),
    /a\(process\.env\.EXPO_PUBLIC_API_BASE_URL\)/,
  );
  assert.equal(compile("a(import.meta.url)"), "a(import.meta.url);");
});

test("import.meta.env without an Expo mapping fails the build", () => {
  assert.throws(() => compile("a(import.meta.env.SECRET)"), /has no Expo mapping/);
  assert.throws(() => compile("a(import.meta.env)"), /Only import\.meta\.env\.<KEY>/);
  assert.throws(() => compile('a(import.meta.env["DEV"])'), /Only import\.meta\.env\.<KEY>/);
});

test("the web alias and .js specifiers resolve to TypeScript sources", () => {
  const origin = web("src/features/settings/settings-layout.tsx");
  assert.equal(rewriteSpecifier(origin, "@/components/icons"), web("src/components/icons"));
  assert.equal(rewriteSpecifier(origin, "@/web-root.js"), web("src/web-root.tsx"));
  assert.equal(rewriteSpecifier(web("src/main.tsx"), "./api.js"), web("src/api.ts"));
  assert.equal(rewriteSpecifier(web("src/main.tsx"), "./missing.js"), null);
  assert.equal(rewriteSpecifier(web("src/main.tsx"), "react"), null);
  const shared = join(workspace, "packages/domain/src/index.ts");
  assert.equal(
    rewriteSpecifier(shared, "./agent-account.js"),
    join(workspace, "packages/domain/src/agent-account.ts"),
  );
  assert.equal(rewriteSpecifier(shared, "@/x"), null);
  const mobile = join(workspace, "apps/mobile/src/theme.ts");
  assert.equal(rewriteSpecifier(mobile, "@/components/icons"), null);
  assert.equal(rewriteSpecifier(mobile, "./theme.js"), null);
});

test("React resolves once from the Expo project", () => {
  assert.ok(isSingleton("react") && isSingleton("react/jsx-runtime"));
  assert.ok(isSingleton("react-dom") && isSingleton("react-dom/client"));
  assert.ok(!isSingleton("react-router-dom") && !isSingleton("react-native"));

  const calls = [];
  const resolveRequest = createResolveRequest();
  const context = (originModulePath) => ({
    originModulePath,
    resolveRequest: (next, name) => {
      calls.push([next.originModulePath, name]);
      return { type: "sourceFile", filePath: name };
    },
  });
  resolveRequest(context(web("src/app.tsx")), "react", "web");
  resolveRequest(context(join(workspace, "apps/mobile/src/theme.ts")), "react", "web");
  resolveRequest(context(web("src/main.tsx")), "./api.js", "web");
  const route = join(workspace, "apps/mobile/src/app/_layout.web.tsx");
  assert.deepEqual(resolveRequest(context(route), "@personal-os/web/expo-host", "ios"), {
    type: "empty",
  });
  resolveRequest(context(route), "@personal-os/web/expo-host", "web");
  assert.deepEqual(calls, [
    [join(workspace, "apps/mobile/package.json"), "react"],
    [join(workspace, "apps/mobile/src/theme.ts"), "react"],
    [web("src/main.tsx"), web("src/api.ts")],
    [route, "@personal-os/web/expo-host"],
  ]);
});

test("Geist font URLs point at the synced public fonts", () => {
  assert.equal(
    rewriteGeistFontUrls(
      'url("../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2") format("woff2")',
    ),
    'url("/fonts/geist/geist-latin-wght-normal.woff2") format("woff2")',
  );
  assert.equal(rewriteGeistFontUrls('url("/brand/x.svg")'), 'url("/brand/x.svg")');
});

test("the dev proxy selects the API and MCP upstreams like Vite", () => {
  const targets = proxyTargets({});
  assert.deepEqual(targets, { api: "http://127.0.0.1:8788", mcp: "http://127.0.0.1:8789" });
  assert.deepEqual(
    proxyTargets({
      VITE_PROXY_API_TARGET: "http://api",
      PERSONAL_OS_WEB_MCP_PROXY_TARGET: "http://mcp",
    }),
    {
      api: "http://api",
      mcp: "http://mcp",
    },
  );
  assert.equal(upstreamFor("/v1/tasks", targets)?.target, targets.api);
  assert.equal(upstreamFor("/health/ready", targets)?.changeOrigin, true);
  assert.deepEqual(upstreamFor("/mcp", targets), { target: targets.mcp, changeOrigin: false });
  assert.equal(upstreamFor("/v10", targets), null);
  assert.equal(upstreamFor("/today", targets), null);
});

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test("the dev proxy forwards API requests and passes others to Metro", async () => {
  const api = await listen((request, response) => {
    response.writeHead(201, { "content-type": "application/json", "x-host": request.headers.host });
    response.end(JSON.stringify({ method: request.method, path: request.url }));
  });
  const proxy = createDevProxyMiddleware({ api: api.url, mcp: api.url });
  const metro = await listen((request, response) =>
    proxy(request, response, () => {
      response.writeHead(200);
      response.end("metro");
    }),
  );
  try {
    const proxied = await fetch(`${metro.url}/v1/tasks?view=today`, { method: "POST", body: "{}" });
    assert.equal(proxied.status, 201);
    assert.equal(proxied.headers.get("x-host"), new URL(api.url).host);
    assert.deepEqual(await proxied.json(), { method: "POST", path: "/v1/tasks?view=today" });
    const page = await fetch(`${metro.url}/today`);
    assert.equal(await page.text(), "metro");
  } finally {
    metro.server.close();
    api.server.close();
  }
});

test("the dev proxy reports an unreachable API", async () => {
  const proxy = createDevProxyMiddleware({ api: "http://127.0.0.1:1", mcp: "http://127.0.0.1:1" });
  const metro = await listen((request, response) => proxy(request, response, () => response.end()));
  try {
    const response = await fetch(`${metro.url}/v1/session`);
    assert.equal(response.status, 502);
    assert.match(await response.text(), /not reachable/);
  } finally {
    metro.server.close();
  }
});

test("the public sync copies UI assets and skips web-only build output", async () => {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { webPublicEntries } = await import("../scripts/sync-web-public.mjs");
  const directory = await mkdtemp(join(tmpdir(), "web-public-"));
  for (const file of ["icon.svg", "sw.js", "workbox-1234.js", "favicon-32.png"])
    await writeFile(join(directory, file), "");
  for (const folder of ["brand", "about", "privacy"]) await mkdir(join(directory, folder));
  assert.deepEqual(await webPublicEntries(directory), ["brand", "favicon-32.png", "icon.svg"]);
});
