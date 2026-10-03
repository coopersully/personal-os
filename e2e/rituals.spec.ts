import { expect, test } from "@playwright/test";

test("settings support field search, ritual history, and resumable setup replay", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await page.goto("/settings?section=rituals");
  await expect(page.getByRole("heading", { name: "Rituals", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Top navigation" })).toHaveCount(0);
  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search all settings" }).fill("time zone");
  const results = page.getByRole("navigation", { name: "Settings search results" });
  await expect(results.getByRole("link", { name: /^Time zone Account/ })).toBeVisible();
  await expect(results.getByRole("link", { name: /Appearance/ })).toHaveCount(0);
  // Exercise real result focus in both themes; a text-only unit test cannot catch
  // foreground/background collisions from the shared CSS cascade.
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (mode) => document.documentElement.classList.toggle("dark", mode === "dark"),
      theme,
    );
    await page.getByRole("searchbox", { name: "Search all settings" }).press("Tab");
    const result = results.getByRole("link").first();
    await expect(result).toBeFocused();
    const colors = await result.evaluate((element) => {
      const style = getComputedStyle(element);
      const probe = document.createElement("span");
      document.body.append(probe);
      const token = (name: string) => {
        probe.style.backgroundColor = `var(--${name})`;
        return getComputedStyle(probe).backgroundColor;
      };
      const values = {
        foreground: style.color,
        selected: style.backgroundColor,
        canvas: token("background"),
        card: token("card"),
        overlay: token("popover"),
        sidebar: token("sidebar"),
        muted: getComputedStyle(element.querySelector(".text-muted-foreground") ?? element).color,
      };
      probe.remove();
      return values;
    });
    const contrast = (a: string, b: string) => {
      const luminance = (color: string) => {
        const channels = (color.match(/[\d.]+/g) ?? [])
          .slice(0, 3)
          .map(Number)
          .map((n) => n / 255)
          .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
        return (
          (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722
        );
      };
      const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
      return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
    };
    expect(contrast(colors.foreground, colors.selected)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.muted, colors.selected)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.card, colors.canvas)).toBeGreaterThanOrEqual(1.16);
    for (const behind of [colors.card, colors.canvas, colors.sidebar]) {
      expect(contrast(colors.overlay, behind)).toBeGreaterThanOrEqual(1.1);
    }
    const shape = await page
      .getByRole("searchbox", { name: "Search all settings" })
      .evaluate((element) => {
        const input = element.closest('[data-slot="input-group"]') ?? element;
        const dialog = element.closest('[role="dialog"]');
        if (!dialog) throw new Error("Missing search dialog");
        return {
          control: parseFloat(getComputedStyle(input).borderTopLeftRadius),
          panel: parseFloat(getComputedStyle(dialog).borderTopLeftRadius),
          height: input.getBoundingClientRect().height,
        };
      });
    expect(shape.control).toBeLessThan(shape.height / 3);
    expect(shape.panel).toBeGreaterThan(shape.control);
    await page.getByRole("searchbox", { name: "Search all settings" }).focus();
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));

  await results.getByRole("link", { name: /^Time zone Account/ }).click();
  await expect(page.locator("#profile-timezone")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Daily defaults" })).toBeVisible();
  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search all settings" }).fill("rituals");
  await page
    .getByRole("navigation", { name: "Settings search results" })
    .getByRole("link", { name: /^Rituals Shape/ })
    .click();
  await expect(page.getByRole("radio", { name: "Morning", exact: true })).toBeVisible();
  await expect(page.getByLabel("Available from").first()).toHaveValue("06:00");
  await page.getByRole("radio", { name: "Evening", exact: true }).click();
  await expect(page.getByLabel("Available from").nth(1)).toHaveValue("21:00");
  await page.getByRole("radio", { name: "Morning", exact: true }).click();
  await page.getByLabel("Prompt", { exact: true }).first().fill("Morning water");
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/v1/rituals/morning") &&
      r.request().method() === "PUT" &&
      r.request().postDataJSON().enabled === true,
  );
  await page.getByRole("checkbox", { name: "Enable morning ritual" }).check();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(page.getByLabel("Prompt", { exact: true }).first()).toHaveValue("Morning water");
  await expect(page.getByRole("checkbox", { name: "Enable morning ritual" })).toBeChecked();
  await page.getByRole("radio", { name: "History and data", exact: true }).click();
  await expect(page.getByRole("region", { name: "Ritual history" })).toBeVisible();
  expect(await page.locator("html").evaluate((e) => e.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "Delete morning data" }).click();
  const deleted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/rituals/morning/data") &&
      response.request().method() === "DELETE",
  );
  await page.getByRole("button", { name: "Delete permanently" }).click();
  expect((await deleted).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Enable morning ritual" })).not.toBeChecked();
  await page.goto("/settings?section=setup");
  await expect(page.getByRole("heading", { name: "Setup", level: 1 })).toBeVisible();
  const setupSaved = page.waitForResponse(
    (response) => response.url().endsWith("/v1/setup") && response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save setup preferences" }).click();
  expect((await setupSaved).ok()).toBe(true);
  await page.getByRole("link", { name: "View setup experience" }).click();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: /What should nohmi help with/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /What should nohmi help with/ })).toBeVisible();
  await page.getByRole("button", { name: "Exit Setup" }).click();
  await expect(page.getByRole("heading", { name: "Setup", level: 1 })).toBeVisible();
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
});
