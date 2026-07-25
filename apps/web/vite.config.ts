import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

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
        includeAssets: ["icon.svg"],
        manifest: {
          background_color: "#12110f",
          description: "A shared daily surface for people and their agents.",
          display: "standalone",
          icons: [{ sizes: "any", src: "/icon.svg", type: "image/svg+xml" }],
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
          target: environment.VITE_PROXY_API_TARGET || "http://127.0.0.1:8787",
        },
      },
    },
  };
});
