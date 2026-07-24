import { defineConfig } from "tsup";

export default defineConfig({
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  entry: ["src/main.ts"],
  format: ["esm"],
  noExternal: [/^@personal-os\//],
  outDir: "dist",
  platform: "node",
  sourcemap: true,
});
