import { expect, test } from "@playwright/test";

for (const width of [320, 390, 1100]) {
  test(`Today and Settings navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/login");
    await page.getByLabel("Email").fill("demo+full@nohmi.test");
    await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
    const header = page.getByRole("navigation", { name: "Top navigation", exact: true });
    await expect(header.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
    await expect(page.getByText("Done today", { exact: true })).toHaveCount(0);
    if (width < 768) {
      await expect(page.getByRole("button", { name: "Expand schedule" })).toBeVisible();
      const schedule = page.getByRole("region", { name: "Today's calendar", exact: true });
      await expect(schedule.locator(".today-calendar-grid")).toBeVisible();
      await expect(schedule.locator(".calendar-timeline-event")).toHaveCount(1);
      await page.getByRole("button", { name: "Expand schedule" }).click();
      await expect(page.getByRole("button", { name: "Collapse schedule" })).toBeVisible();
      await page.getByRole("button", { name: "Collapse schedule" }).click();
    } else await expect(page.getByRole("button", { name: "Collapse schedule" })).toBeVisible();
    await page.screenshot({ path: `.context/today-refresh-${width}.png` });
    await page.goto("/settings?page=appearance");
    await expect(header.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
    const search = header.getByRole("searchbox", { name: "Search settings", exact: true });
    await expect(page.getByRole("searchbox", { name: "Search settings", exact: true })).toHaveCount(
      1,
    );
    await search.fill("appearance");
    const searchResults = page.getByRole("navigation", { name: "Settings search results" });
    await expect(searchResults).toBeVisible();
    await expect(searchResults.getByRole("link", { name: /^Appearance/ }).first()).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Settings search", exact: true }),
    ).toHaveAttribute("data-slot", "popover-content");
    await expect(page.locator('[data-responsive-slot="content"]')).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(searchResults).toHaveCount(0);
    await expect(search).toBeFocused();
    if (width < 768) {
      const dock = page.getByRole("navigation", { name: "Workspace sections" });
      await expect(dock.getByRole("link")).toHaveCount(4);
      await dock.getByRole("link", { name: "app", exact: true }).click();
      await expect(page.getByRole("heading", { name: "app", exact: true })).toBeVisible();
      await page.getByRole("link", { name: "Appearance", exact: true }).click();
      await expect(header.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      .toBe(false);
    expect(await header.evaluate((element) => getComputedStyle(element).textTransform)).toBe(
      "lowercase",
    );
    await page.screenshot({ path: `.context/settings-refresh-${width}.png` });
  });
}
