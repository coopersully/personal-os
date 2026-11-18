import { afterEach, expect, it, vi } from "vitest";
import { workspaceCatalog } from "./catalog";

const platform = vi.hoisted(() => ({ desktop: false }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => platform.desktop }));
afterEach(() => {
  platform.desktop = false;
});
it("limits desktop notification settings to native workspace search", () => {
  expect(workspaceCatalog("calendar", "Upcoming events")).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ title: "Upcoming events" })]),
  );
  expect(workspaceCatalog("calendar", "Time zone")).toEqual(
    expect.arrayContaining([expect.objectContaining({ title: "Time zone" })]),
  );
  platform.desktop = true;
  expect(workspaceCatalog("calendar", "Upcoming events")).toEqual(
    expect.arrayContaining([expect.objectContaining({ title: "Upcoming events" })]),
  );
});
