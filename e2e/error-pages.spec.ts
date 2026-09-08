import { expect, test } from "@playwright/test";

for (const width of [390, 1100]) {
  test(`development error preview is usable without a backend at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    let apiRequests = 0;
    await page.route("**/v1/**", (route) => {
      apiRequests += 1;
      return route.abort();
    });
    await page.goto("/dev/errors?state=404");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
    await expect(page.getByRole("img", { name: "nohmi" })).toHaveCount(0);
    await expect(page.locator(".brand-pattern--page")).toHaveCSS("opacity", "0.2");
    await expect(page.locator(".auth-header")).toHaveCount(0);
    const contentBox = await page.locator(".error-page__content").boundingBox();
    if (!contentBox) throw new Error("Missing error page content");
    expect(Math.abs(contentBox.x + contentBox.width / 2 - width / 2)).toBeLessThan(2);
    expect(Math.abs(contentBox.y + contentBox.height / 2 - 844 / 2)).toBeLessThan(2);
    await expect(page.locator(".error-page__content")).toHaveCSS("border-top-width", "0px");
    for (const value of ["403", "500", "503", "offline"]) {
      await page.getByRole("combobox", { name: "Error preview" }).selectOption(value);
      await expect(page).toHaveURL(new RegExp(`state=${value}$`));
      await expect(page.getByRole("alert")).toBeVisible();
    }
    expect(apiRequests).toBe(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".brand-pattern__tile").first()).toHaveCSS("animation-name", "none");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
