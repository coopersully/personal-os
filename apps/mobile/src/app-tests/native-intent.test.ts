import { afterEach, expect, it, vi } from "vitest";
import { redirectSystemPath } from "../app/+native-intent";
import { takeLink } from "../features/links/pending";

vi.mock("../features/auth/context", () => ({ mobileAppOrigin: "https://nohmi.example" }));
afterEach(() => {
  takeLink();
});

it("queues a link on the configured web origin and leaves other paths to the router", () => {
  expect(redirectSystemPath({ path: "https://nohmi.example/tasks?task=t1", initial: true })).toBe(
    "/",
  );
  expect(takeLink()).toEqual({
    kind: "screen",
    href: { pathname: "/task-editor", params: { id: "t1", kind: "task" } },
  });
  expect(redirectSystemPath({ path: "personal-os://settings", initial: false })).toBe(
    "personal-os://settings",
  );
  expect(takeLink()).toBeNull();
});
