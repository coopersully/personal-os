import { expect, test } from "@playwright/test";

test("account recovery overlays rather than displaces settings and requires a successful retry", async ({
  page,
}, info) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
  await page.goto("/settings?page=rituals");
  await expect(page.getByRole("heading", { name: "Morning Ritual", exact: true })).toBeVisible();
  const card = page.getByRole("region", {
    name: "Morning Ritual",
    exact: true,
    includeHidden: true,
  });
  const completedDays = card.getByRole("button", {
    name: /^\d+ of the past 7 days completed$/,
  });
  await expect(completedDays).toBeVisible();
  const before = await card.boundingBox();
  let fail = true;
  await page.route("**/v1/me", async (route) => {
    if (fail)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "unavailable", message: "private diagnostic" } }),
      });
    else await route.continue();
  });
  // A hard navigation exercises the initial account failure too; the component tests cover a retained cache.
  await page.reload();
  const recovery = page.getByRole("dialog", { name: "Reconnect to your account" });
  await expect(recovery).toBeVisible();
  await expect(recovery.getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.mouse.click(2, 2);
  await expect(recovery).toBeVisible();
  await recovery.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByText("Couldn’t reconnect to your account.", { exact: true }),
  ).toBeVisible();
  await expect(recovery).toBeVisible();
  await expect(page.getByText("private diagnostic")).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]")).toHaveAttribute("data-mounted", "true");
  await expect(recovery).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: `/tmp/nohmi-settings-audit/account-recovery-${info.project.name}.png`,
  });
  fail = false;
  await recovery.getByRole("button", { name: "Try again" }).click();
  await expect(recovery).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Morning Ritual", exact: true })).toBeVisible();
  await expect(completedDays).toBeVisible();
  const after = await card.boundingBox();
  expect(after?.y).toBe(before?.y);
  expect(after?.height).toBe(before?.height);
  await expect(page.getByText("Last available results", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Trigger the real window-focus policy after cached data has become stale.
  await page.clock.install();
  await page.clock.fastForward(16_000);
  fail = true;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    window.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    window.dispatchEvent(new Event("visibilitychange"));
    Reflect.deleteProperty(document, "visibilityState");
  });
  await expect(recovery).toBeVisible();
  const during = await card.boundingBox();
  expect(during?.y).toBe(after?.y);
  expect(during?.height).toBe(after?.height);
  await expect(page.locator("#root > [role=status]")).toHaveCount(0);
  await expect(recovery).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: `/tmp/nohmi-settings-audit/account-recovery-cached-${info.project.name}.png`,
  });
  fail = false;
  await recovery.getByRole("button", { name: "Try again" }).click();
  await expect(recovery).toHaveCount(0);
});
