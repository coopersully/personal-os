import { afterEach, expect, it, vi } from "vitest";
import appConfig from "../../app.config";
import base from "../../app.json";

const config = () => appConfig({ config: base.expo } as never);
afterEach(() => {
  vi.unstubAllEnvs();
});

it("claims record links only on an HTTPS web origin baked into the build", () => {
  vi.stubEnv("EXPO_PUBLIC_APP_URL", "https://nohmi.example");
  expect(config().ios?.associatedDomains).toEqual(["applinks:nohmi.example"]);
  expect(config().ios?.bundleIdentifier).toBe("app.personal-os.mobile");
  vi.stubEnv("EXPO_PUBLIC_APP_URL", "http://localhost:8081");
  expect(config().ios?.associatedDomains).toBeUndefined();
  vi.stubEnv("EXPO_PUBLIC_APP_URL", undefined);
  expect(config().ios?.associatedDomains).toBeUndefined();
});
