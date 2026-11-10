import assert from "node:assert/strict";
import { test } from "node:test";
import { productionApiOrigin, releaseEnvironment } from "./release-environment.mjs";

test("archives explicitly bind to production and disable dotenv overrides", () => {
  assert.deepEqual(releaseEnvironment({ PATH: "/usr/bin" }), {
    PATH: "/usr/bin",
    NODE_ENV: "production",
    PERSONAL_OS_APNS_ENVIRONMENT: "production",
    EXPO_NO_DOTENV: "1",
    EXPO_PUBLIC_API_URL: productionApiOrigin,
  });
  assert.equal(
    releaseEnvironment({ EXPO_PUBLIC_API_URL: productionApiOrigin }).EXPO_PUBLIC_API_URL,
    productionApiOrigin,
  );
});
test("archives reject development or unrecognized API origins", () => {
  for (const origin of ["http://127.0.0.1:50653", "https://preview.example.com"]) {
    assert.throws(
      () => releaseEnvironment({ EXPO_PUBLIC_API_URL: origin }),
      /production nohmi API/,
    );
  }
});
