import { expect, test } from "@playwright/test";

test("Today keeps independent cards, saves personalization and uses weekly filters", async ({
  page,
}, info) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  const path = "/v1/today/settings";
  const origin = new URL(page.url()).origin;
  const original = await (await page.request.get(path)).json();
  try {
    await page.getByRole("link", { name: "Personalize Today" }).click();
    await expect(page.getByRole("heading", { name: "Today at a Glance settings" })).toBeVisible();
    const save = page.waitForResponse(
      (response) => response.url().endsWith(path) && response.request().method() === "PATCH",
    );
    await page.getByRole("radio", { name: "Weather", exact: true }).click();
    expect((await save).ok()).toBeTruthy();
    await page.getByRole("switch", { name: "Spending", exact: true }).click();
    await expect
      .poll(async () => (await (await page.request.get(path)).json()).preferences.showSpending)
      .toBe(true);
    await page.reload();
    await expect(page.getByRole("radio", { name: "Weather", exact: true })).toBeChecked();
    await page.getByRole("link", { name: "Back to Today" }).click();
    await expect(page.getByRole("region", { name: "Today's calendar" })).toBeVisible();
    const queue = page.getByRole("complementary", { name: "To take care of" });
    await expect(queue.getByText("This week · Tasks and reminders")).toBeVisible();
    await queue.getByRole("radio", { name: /^Tasks / }).click();
    await expect
      .poll(async () => (await (await page.request.get(path)).json()).preferences.commitmentFilter)
      .toBe("tasks");
    await expect(queue.getByRole("radio", { name: /^Tasks / })).toBeChecked();
    await expect(page.getByRole("radiogroup", { name: "Spending period" })).toBeVisible();
    await expect(page.getByText("Your desktop pet", { exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    await page.screenshot({ path: info.outputPath("today-personalized.png"), fullPage: true });
    // Timeline and weather outages must not hide the independent weekly queue or location control.
    await page.route("**/v1/daily-brief**", (route) => route.abort());
    await page.route("**/v1/weather**", (route) => route.abort());
    await page.reload();
    await expect(queue.getByRole("heading", { name: "To take care of" })).toBeVisible();
    await expect(page.locator(".workspace-app-bar__weather-location")).toBeVisible();
    await expect(page.locator(".today-attention")).toBeVisible();
  } finally {
    const current = await (await page.request.get(path)).json();
    const restored = await page.request.patch(path, {
      headers: { origin },
      data: { expectedRevision: current.revision, preferences: original.preferences },
    });
    expect(restored.ok()).toBeTruthy();
  }
});
