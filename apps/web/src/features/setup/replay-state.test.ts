// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { readSetupReplay, writeSetupReplay } from "./replay-state.js";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});
it("keeps validated replay cursors scoped to one account and clears them on exit", () => {
  expect(readSetupReplay("one")).toBeNull();
  writeSetupReplay("one", "workspaces");
  expect(readSetupReplay("one")).toBe("workspaces");
  expect(readSetupReplay("two")).toBeNull();
  sessionStorage.setItem("nohmi.setup-replay.two", "arbitrary");
  expect(readSetupReplay("two")).toBeNull();
  writeSetupReplay("one", null);
  expect(readSetupReplay("one")).toBeNull();
});
it("tolerates unavailable browser storage", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readSetupReplay("one")).toBeNull();
  expect(() => writeSetupReplay("one", "welcome")).not.toThrow();
});
