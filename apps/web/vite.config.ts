import { cp, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const agentSkillRelease = JSON.parse(
  await readFile(
    fileURLToPath(
      new URL("../../packages/domain/src/personal-os-setup-release.json", import.meta.url),
    ),
    "utf8",
  ),
) as { sourcePath: string };
const agentSkillSourceDirectory = fileURLToPath(new URL("../../skills/ilo-setup", import.meta.url));
const agentSkillPublicDirectory = dirname(agentSkillRelease.sourcePath).replace(/^\/+/, "");

function agentSkillSitePlugin(): Plugin {
  return {
    name: "publish-personal-os-agent-skill",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://personal-os.local").pathname;
        const prefix = `/${agentSkillPublicDirectory}/`;
        if (!pathname.startsWith(prefix)) {
          next();
          return;
        }
        const requestedPath = decodeURIComponent(pathname.slice(prefix.length));
        const sourcePath = resolve(agentSkillSourceDirectory, requestedPath);
        if (
          requestedPath.length === 0 ||
          relative(agentSkillSourceDirectory, sourcePath).startsWith("..")
        ) {
          response.statusCode = 404;
          response.end();
          return;
        }
        try {
          const body = await readFile(sourcePath);
          const contentType =
            extname(sourcePath) === ".md"
              ? "text/markdown; charset=utf-8"
              : extname(sourcePath) === ".yaml"
                ? "application/yaml; charset=utf-8"
                : "application/octet-stream";
          response.setHeader("Cache-Control", "no-store");
          response.setHeader("Content-Type", contentType);
          response.end(body);
        } catch {
          response.statusCode = 404;
          response.end();
        }
      });
    },
    async closeBundle() {
      await cp(
        agentSkillSourceDirectory,
        resolve(process.cwd(), "dist", agentSkillPublicDirectory),
        { recursive: true },
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "clear-stale-development-service-worker",
        apply: "serve",
        configureServer(server) {
          server.middlewares.use("/sw.js", (_request, response) => {
            response.setHeader("Cache-Control", "no-store");
            response.setHeader("Content-Type", "application/javascript; charset=utf-8");
            response.end(`
              self.addEventListener("install", () => self.skipWaiting());
              self.addEventListener("activate", (event) => {
                event.waitUntil(self.registration.unregister().then(() =>
                  self.clients.matchAll().then((clients) =>
                    Promise.all(clients.map((client) => client.navigate(client.url))),
                  ),
                ));
              });
            `);
          });
        },
      },
      VitePWA({
        // Avoid a development service worker: it can retain stale source modules between local
        // refreshes. The production build still registers the worker from main.tsx.
        devOptions: { enabled: false },
        includeAssets: ["apple-touch-icon.png", "favicon-32.png", "icon.svg"],
        manifest: {
          background_color: "#18181b",
          description: "A shared daily surface for people and their agents.",
          display: "standalone",
          icons: [
            { sizes: "any", src: "/icon.svg", type: "image/svg+xml" },
            { sizes: "192x192", src: "/icon-192.png", type: "image/png" },
            { purpose: "any", sizes: "512x512", src: "/icon-512.png", type: "image/png" },
            // Android crops maskable icons to a circle, so this variant keeps the framed mark
            // inside the safe zone instead of losing its corners. It is a separate entry because
            // one full-bleed asset cannot satisfy both `any` and `maskable` correctly.
            {
              purpose: "maskable",
              sizes: "512x512",
              src: "/icon-512-maskable.png",
              type: "image/png",
            },
          ],
          name: "nohmi",
          orientation: "any",
          short_name: "nohmi",
          start_url: "/today",
          theme_color: "#18181b",
        },
        registerType: "autoUpdate",
        workbox: {
          navigateFallback: "/index.html",
          // Public policies must remain real HTML pages, including for installed PWAs.
          navigateFallbackDenylist: [/^\/(about|docs|privacy|terms|data-use|sms|support)(?:\/|$)/],
          runtimeCaching: [
            {
              handler: "NetworkOnly",
              urlPattern: ({ url }) => url.pathname.startsWith("/v1/"),
            },
          ],
        },
      }),
      agentSkillSitePlugin(),
      {
        name: "public-documentation-directory-indexes",
        enforce: "post",
        transformIndexHtml: {
          order: "pre",
          async handler(html, context) {
            const request = new URL(context.originalUrl ?? context.path, "http://localhost");
            if (
              context.server &&
              (!["/", "/index.html"].includes(request.pathname) ||
                request.searchParams.get("verifyEmail") ||
                request.searchParams.get("resetPassword"))
            ) {
              return html;
            }
            const landing = await readFile(resolve(".public-site", "landing.fragment"), "utf8");
            return html.replace('<div id="root"></div>', `<div id="root">${landing}</div>`);
          },
        },
        async generateBundle(_options, bundle) {
          const index = bundle["index.html"];
          if (index?.type !== "asset") throw new Error("Missing web HTML for public styles.");
          const stylesheet = String(index.source).match(/<link[^>]+href="([^"]+\.css)"/);
          if (!stylesheet?.[1]) throw new Error("Missing compiled public stylesheet.");
          for (const slug of ["about", "docs", "privacy", "terms", "data-use", "sms", "support"]) {
            const document = await readFile(resolve("public", slug, "index.html"), "utf8");
            this.emitFile({
              type: "asset",
              fileName: `${slug}/index.html`,
              source: document.replace("/src/styles.css?direct", stylesheet[1]),
            });
          }
        },
        configureServer(server) {
          // nginx resolves directory indexes in production; Vite's public middleware does not.
          server.middlewares.use(async (request, response, next) => {
            const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
            if (!/^\/(about|docs|privacy|terms|data-use|sms|support)\/?$/.test(pathname)) {
              next();
              return;
            }
            try {
              const body = await readFile(
                resolve(server.config.publicDir, pathname.slice(1), "index.html"),
              );
              response.setHeader("Content-Type", "text/html; charset=utf-8");
              response.setHeader("Cache-Control", "no-cache");
              response.end(body);
            } catch (error) {
              next(error);
            }
          });
        },
      },
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/health": {
          changeOrigin: true,
          target: environment.VITE_PROXY_API_TARGET || "http://127.0.0.1:8788",
        },
        "/v1": {
          changeOrigin: true,
          target: environment.VITE_PROXY_API_TARGET || "http://127.0.0.1:8788",
        },
        "/mcp": {
          changeOrigin: false,
          target: environment.VITE_PROXY_MCP_TARGET || "http://127.0.0.1:8789",
        },
      },
    },
  };
});
