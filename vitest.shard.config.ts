import { defineConfig } from "vitest/config";
import config from "./vitest.config";

// Partial suites cannot satisfy global thresholds. Only the hosted shard jobs use
// this config; Node quality merges every blob using the unchanged root config.
export default defineConfig({
  ...config,
  test: {
    ...config.test,
    coverage: { ...config.test?.coverage, thresholds: undefined },
  },
});
