import { expect, test } from "@playwright/test";

test("settings support field search, ritual history, and resumable setup replay", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@ilo.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await page.goto("/settings?section=rituals");
  await expect(page.getByRole("heading", { name: "Rituals", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Top navigation" })).toHaveCount(0);
  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search all settings" }).fill("time zone");
  const results = page.getByRole("navigation", { name: "Settings search results" });
  await expect(results.getByRole("link", { name: /^Planning time zone Account/ })).toBeVisible();
  await expect(results.getByRole("link", { name: /Appearance/ })).toHaveCount(0);
  await results.getByRole("link", { name: /^Planning time zone Account/ }).click();
  await expect(page.locator("#profile-timezone")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Planning defaults" })).toBeVisible();
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
