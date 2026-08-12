import { cp, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const agentSkillRelease = JSON.parse(
  await readFile(
    fileURLToPath(new URL("../../packages/domain/src/ilo-setup-release.json", import.meta.url)),
    "utf8",
  ),
) as { sourcePath: string };
const agentSkillSourceDirectory = fileURLToPath(new URL("../../skills/ilo-setup", import.meta.url));
const agentSkillPublicDirectory = dirname(agentSkillRelease.sourcePath).replace(/^\/+/, "");

function agentSkillSitePlugin(): Plugin {
  return {
    name: "publish-ilo-agent-skill",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://ilo.local").pathname;
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
          background_color: "#12110f",
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
          name: "ilo",
          orientation: "any",
          short_name: "ilo",
          start_url: "/",
          theme_color: "#12110f",
        },
        registerType: "autoUpdate",
        workbox: {
          navigateFallback: "/index.html",
          runtimeCaching: [
            {
              handler: "NetworkOnly",
              urlPattern: ({ url }) => url.pathname.startsWith("/v1/"),
            },
          ],
        },
      }),
      agentSkillSitePlugin(),
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/v1": {
          changeOrigin: true,
          target: environment.VITE_PROXY_API_TARGET || "http://127.0.0.1:8788",
        },
      },
    },
  };
});
