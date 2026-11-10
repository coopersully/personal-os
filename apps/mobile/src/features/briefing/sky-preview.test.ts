import { expect, it } from "vitest";
import { skyPreview, skyPreviewNames } from "./sky-preview";

it("never substitutes preview weather in production or for unknown values", () => {
  for (const name of skyPreviewNames) expect(skyPreview(name, false)).toBeUndefined();
  expect(skyPreview("invalid", true)).toBeUndefined();
  expect(skyPreview(undefined, true)).toBeUndefined();
});
it("renders distinct labeled time and weather states through the real sky model", () => {
  const previews = skyPreviewNames.map((name) => skyPreview(name, true));
  expect(previews.map((preview) => preview?.sky.phase)).toEqual([
    "dawn",
    "day",
    "night",
    "day",
    "day",
  ]);
  expect(new Set(previews.map((preview) => preview?.sky.topColor)).size).toBe(5);
  for (const preview of previews) expect(preview?.label).toMatch(/^Preview · /);
  expect(skyPreview("rainy", true)?.sky.condition).toBe("rain");
});
