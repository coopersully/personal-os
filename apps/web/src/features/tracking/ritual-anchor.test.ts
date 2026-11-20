// @vitest-environment jsdom
import {
  moveRitualAnchor,
  nearestRitualAnchor,
  readRitualAnchor,
  saveRitualAnchor,
} from "./ritual-anchor.js";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
it("remembers a placement and falls back to bottom-right for missing or invalid values", () => {
  expect(readRitualAnchor()).toBe(4);
  saveRitualAnchor(1);
  expect(readRitualAnchor()).toBe(1);
  for (const value of ["9", "-1", "2.5", "left"]) {
    localStorage.setItem("nohmi:ritual-card:anchor", value);
    expect(readRitualAnchor()).toBe(4);
  }
});
it("keeps working when storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(() => saveRitualAnchor(2)).not.toThrow();
  expect(readRitualAnchor()).toBe(4);
});
it.each([
  [10, 10, 0],
  [500, 10, 1],
  [990, 10, 2],
  [990, 500, 3],
  [990, 990, 4],
  [500, 990, 5],
  [10, 990, 6],
  [10, 500, 7],
  // The empty middle resolves toward the closer edge.
  [400, 500, 7],
  [600, 500, 3],
  [500, 400, 1],
  [500, 600, 5],
  // Releases beyond the viewport clamp to an edge.
  [-50, 2000, 6],
])("snaps a release at %i,%i to anchor %i", (x, y, anchor) =>
  expect(nearestRitualAnchor(x, y, 1000, 1000)).toBe(anchor));
it("steps between anchors with arrow keys, passing over the middle and stopping at edges", () => {
  expect(moveRitualAnchor(4, "ArrowLeft")).toBe(5);
  expect(moveRitualAnchor(5, "ArrowLeft")).toBe(6);
  expect(moveRitualAnchor(6, "ArrowLeft")).toBe(6);
  expect(moveRitualAnchor(4, "ArrowUp")).toBe(3);
  expect(moveRitualAnchor(3, "ArrowLeft")).toBe(7);
  expect(moveRitualAnchor(7, "ArrowRight")).toBe(3);
  expect(moveRitualAnchor(1, "ArrowDown")).toBe(5);
  expect(moveRitualAnchor(5, "ArrowUp")).toBe(1);
  expect(moveRitualAnchor(0, "ArrowRight")).toBe(1);
  expect(moveRitualAnchor(2, "Enter")).toBe(2);
});
