import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    coverage: {
      all: true,
      exclude: [
        "**/*.config.{ts,js,mjs}",
        "**/*.d.ts",
        "**/types.ts",
        "**/dist/**",
        "**/main.{ts,tsx}",
        "apps/mcp/src/http.ts",
        "apps/mcp/src/stdio.ts",
        "**/migrations/**",
        "**/node_modules/**",
        "**/src-tauri/**",
        // Generated shadcn primitives are vendor source; coverage is enforced for product code that composes them.
        "apps/web/src/components/ui/**",
        "packages/database/src/schema.ts",
        "**/vite-env.d.ts",
      ],
      include: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      thresholds: {
        // A high global floor catches meaningful regressions without encouraging brittle
        // implementation-detail tests. New behavior still requires focused coverage.
        branches: 94,
        functions: 95,
        lines: 95,
        statements: 95,
      },
    },
    environment: "node",
    globals: true,
    include: ["apps/*/src/**/*.test.{ts,tsx}", "packages/*/src/**/*.test.{ts,tsx}"],
    // Keep the large DOM suite from contending with API integration-test containers.
    // Four local workers made otherwise-fast setup flows exceed their timeout under
    // full `pnpm verify` load; matching CI keeps the repository-wide gate deterministic.
    maxWorkers: 2,
    // A few end-to-end interaction tests intentionally cover several user actions. Their
    // deterministic work completes locally, but shared two-core runners need headroom;
    // keep the normal five-second fast-failure limit outside CI.
    testTimeout: process.env.CI ? 20_000 : 5_000,
    passWithNoTests: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
