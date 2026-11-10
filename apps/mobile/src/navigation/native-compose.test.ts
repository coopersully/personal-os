import { expect, it } from "vitest";
import { supportsProminentCompose } from "./native-compose";

it("uses the real prominent tab only on supported iOS versions", () => {
  expect(supportsProminentCompose("ios", "27.0")).toBe(true);
  expect(supportsProminentCompose("ios", 26)).toBe(false);
  expect(supportsProminentCompose("android", 36)).toBe(false);
  expect(supportsProminentCompose("web", "27")).toBe(false);
});
