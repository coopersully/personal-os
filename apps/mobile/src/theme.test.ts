// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useTheme } from "./theme";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({ theme: "system", system: "dark" }));
vi.mock("react-native", () => ({ useColorScheme: () => h.system }));
vi.mock("./features/auth/context", () => ({
  useOptionalAuth: () => ({ state: { user: { theme: h.theme } } }),
}));
it("uses the persisted account theme and follows device appearance only for system", () => {
  const { result, rerender } = renderHook(useTheme);
  expect(result.current.dark).toBe(true);
  h.theme = "light";
  rerender();
  expect(result.current.dark).toBe(false);
  h.system = "light";
  h.theme = "dark";
  rerender();
  expect(result.current.dark).toBe(true);
  h.theme = "system";
  rerender();
  expect(result.current.dark).toBe(false);
});
