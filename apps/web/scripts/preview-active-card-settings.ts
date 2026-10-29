/** Build the real settings components into an isolated, API-free browser review. */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const outDir = resolve(root, "node_modules/.cache/active-card-settings");
await build({
  configFile: false,
  root,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(root, "src") } },
  build: {
    outDir,
    emptyOutDir: true,
    copyPublicDir: false,
    rollupOptions: { input: resolve(root, "active-cards-settings.html") },
  },
});
const server = spawn(
  "python3",
  [resolve(root, "scripts/preview-active-cards.py"), "--settings-root", outDir],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
