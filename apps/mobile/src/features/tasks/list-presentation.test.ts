import { expect, it } from "vitest";
import { listTint, normalizedListColor } from "./list-presentation";

it("resolves stored named colors and safely ignores unsupported colors", () => {
  expect(normalizedListColor("blue")).toBe("#3b82f6");
  expect(normalizedListColor("#123456")).toBe("#123456");
  expect(listTint("not-a-color", true, "#ffffff")).toBe("#ffffff");
  expect(listTint(null, false, "#202024")).toBe("#202024");
});
it("adapts illegible extremes while retaining already legible identity colors", () => {
  expect(listTint("#000000", true, "#ffffff")).not.toBe("#000000");
  expect(listTint("#ffffff", false, "#202024")).not.toBe("#ffffff");
  expect(listTint("#ffffff", true, "#ffffff")).toBe("#ffffff");
  expect(listTint("#000000", false, "#202024")).toBe("#000000");
});
