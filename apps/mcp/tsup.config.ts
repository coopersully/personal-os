import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/stdio.ts", "src/http.ts"],
  format: ["esm"],
  noExternal: [/^@personal-os\//],
  outDir: "dist",
  platform: "node",
  sourcemap: true,
});
