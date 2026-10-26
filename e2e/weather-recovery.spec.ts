import { expect, test } from "@playwright/test";
import { weatherSnapshot, weatherSnapshotRoute } from "./weather-fixtures.js";

test("unavailable weather retains the recovery gate until a successful retry", async ({ page }) => {
  let available = false;
  let requests = 0;
  await page.route(weatherSnapshotRoute, (route) => {
    if (route.request().method() !== "GET") return route.continue();
    requests++;
    return available
      ? route.fulfill({ json: { weather: weatherSnapshot } })
      : route.fulfill({
          status: 503,
          json: {
            error: {
              code: "internal_error",
              message: "Weather unavailable",
              requestId: "qa-weather-unavailable",
            },
          },
        });
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  const recovery = page.getByRole("dialog", { name: "Let’s reconnect" });
  await expect(recovery).toBeVisible();
  await expect(page.getByRole("heading", { name: "To take care of" })).toHaveCount(0);
  const initialRequests = requests;
  const failedRetry = page.waitForResponse(
    (response) => weatherSnapshotRoute.test(response.url()) && response.status() === 503,
  );
  await recovery.getByRole("button", { name: "Try again", exact: true }).click();
  await failedRetry;
  await expect(recovery).toBeVisible();
  await expect(recovery.getByRole("button", { name: "Try again", exact: true })).toBeEnabled();
  expect(requests).toBeGreaterThan(initialRequests);

  available = true;
  const recovered = page.waitForResponse(
    (response) => weatherSnapshotRoute.test(response.url()) && response.ok(),
  );
  await recovery.getByRole("button", { name: "Try again", exact: true }).click();
  await recovered;
  await expect(recovery).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear, 72°F", exact: true })).toBeVisible();
  await page.goto("/calendar");
  await expect(page.getByRole("button", { name: /^Calendar view:/ })).toBeVisible();
});
