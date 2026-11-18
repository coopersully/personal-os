import { expect } from "@playwright/test";
import { cleanupRitual, test } from "./recovery-fixtures.js";

test.describe("ritual cleanup isolation", () => {
  test.describe.configure({ mode: "serial" });

  test("cleans a created ritual after the test body exhausts its budget", async ({
    page,
    cleanup,
  }, info) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("demo+full@nohmi.test");
    await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/today/);
    const cleared = await page.request.delete("/v1/rituals/night/data");
    expect([204, 404]).toContain(cleared.status());
    const profile = await (await page.request.get("/v1/me")).json();
    await cleanupRitual(page, cleanup, "night");
    {
      const saved = await page.request.put("/v1/rituals/night", {
        data: {
          requestId: crypto.randomUUID(),
          deviceId: "cleanup-regression",
          expectedRevision: 0,
          kind: "night",
          title: "Cleanup regression",
          enabled: true,
          time: "00:01",
          timeZone: profile.user.planningTimezone,
          steps: [{ id: "reflect", label: "Reflect", kind: "checkbox", optional: true }],
        },
      });
      expect(saved.ok()).toBe(true);
      // Only this fault-injection test intentionally expires its body. Teardown must still run.
      info.expectedStatus = "timedOut";
      test.setTimeout(1);
      await new Promise(() => {});
    }
  });

  test("a fresh settings login sees no ritual left by the timed-out body", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("demo+full@nohmi.test");
    await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/today/);
    const response = await page.request.get("/v1/rituals/current");
    expect(response.ok()).toBe(true);
    const state = await response.json();
    expect(
      state.definitions.some((definition: { kind: string }) => definition.kind === "night"),
    ).toBe(false);
    await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
    await page.goto("/settings?page=calendar");
    await expect(page.getByRole("heading", { name: "Calendar", exact: true })).toBeVisible();
  });
});
