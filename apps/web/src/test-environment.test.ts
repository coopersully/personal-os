// @vitest-environment jsdom
import type {} from "vitest/jsdom";

it.each([
  "localStorage",
  "sessionStorage",
] as const)("uses the current jsdom document's %s instead of Node's host storage", (name) => {
  const storage = globalThis[name];
  expect(storage).toBe(jsdom.window[name]);
  const key = `test-environment-${crypto.randomUUID()}`;
  try {
    storage.setItem(key, "document scoped");
    expect(jsdom.window[name].getItem(key)).toBe("document scoped");
  } finally {
    storage.removeItem(key);
  }
});
