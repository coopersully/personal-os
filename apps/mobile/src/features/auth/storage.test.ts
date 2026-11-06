import { beforeEach, expect, it, vi } from "vitest";
import { sessionStorage } from "./storage";

const h = vi.hoisted(() => ({
  platform: { OS: "ios" },
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: h.platform }));
vi.mock("expo-secure-store", () => ({ ...h, WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only" }));
beforeEach(() => {
  vi.clearAllMocks();
  h.platform.OS = "ios";
});
it("keeps native session tokens in origin-scoped, device-only Keychain entries", async () => {
  h.getItemAsync.mockResolvedValue("session");
  const storage = sessionStorage("https://api.example.test");
  await storage.write("session");
  const key = h.setItemAsync.mock.calls[0][0];
  expect(key).toMatch(/^personal-os\.session\.v1\./);
  expect(h.setItemAsync).toHaveBeenCalledWith(key, "session", {
    keychainAccessible: "device-only",
  });
  expect(await storage.read()).toBe("session");
  expect(h.getItemAsync).toHaveBeenCalledWith(key);
  await storage.write(null);
  expect(h.deleteItemAsync).toHaveBeenCalledWith(key);
  await sessionStorage("https://different.example.test").write("other");
  expect(h.setItemAsync.mock.calls[1][0]).not.toBe(key);
});
it("keeps browser preview tokens in memory only and discards them with the instance", async () => {
  h.platform.OS = "web";
  const storage = sessionStorage("https://api.example.test");
  expect(await storage.read()).toBeNull();
  await storage.write("session");
  expect(await storage.read()).toBe("session");
  expect(await sessionStorage("https://api.example.test").read()).toBeNull();
  await storage.write(null);
  expect(await storage.read()).toBeNull();
  expect(h.setItemAsync).not.toHaveBeenCalled();
  expect(h.getItemAsync).not.toHaveBeenCalled();
  expect(h.deleteItemAsync).not.toHaveBeenCalled();
});
