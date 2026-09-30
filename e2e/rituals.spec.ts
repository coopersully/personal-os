import { expect, test } from "@playwright/test";

test("ritual settings persist ordered steps and expose account history", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@ilo.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await page.goto("/settings?section=rituals");
  await expect(page.getByRole("navigation", { name: "Top navigation" })).toHaveText("Rituals");
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
});
