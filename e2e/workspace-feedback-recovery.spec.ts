import { expect, type Page, test } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
}

test("failed task batch stays outside the layout and never repeats successful writes", async ({
  page,
}, info) => {
  await login(page);
  await page.goto("/tasks");
  await page.getByRole("button", { name: "Select items", exact: true }).click();
  const choices = page.getByRole("checkbox", { name: /^Select (?!visible)/ });
  await choices.nth(0).check();
  await choices.nth(1).check();
  let writes = 0;
  await page.route(/\/v1\/(tasks|reminders)\/[^/]+\/complete$/, async (route) => {
    writes++;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "internal_error", message: "Unavailable", requestId: "qa-batch" },
      }),
    });
  });
  const main = page.locator("#main-content");
  const before = await main.boundingBox();
  await page
    .getByRole("group", { name: "Selected item actions" })
    .getByRole("button", { name: "Complete", exact: true })
    .click();
  const recovery = page.getByRole("dialog", { name: "0 updated, 2 not changed" });
  await expect(recovery).toBeVisible();
  expect(writes).toBe(2);
  const after = await main.boundingBox();
  expect(after?.y).toBe(before?.y);
  expect(after?.height).toBe(before?.height);
  await expect(main.locator('[data-slot="alert"]')).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("tasks-batch-recovery.png"),
    fullPage: true,
    animations: "disabled",
    scale: "css",
  });
  await recovery.getByRole("button", { name: "Return to tasks" }).click();
  await expect(recovery).not.toBeVisible();
  await expect(choices.nth(0)).toBeChecked();
  await expect(choices.nth(1)).toBeChecked();
  expect(writes).toBe(2);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test("finance action errors use Sonner and read recovery retains the workspace", async ({
  page,
}, info) => {
  await login(page);
  await page.goto("/finances/cashflow?view=subscriptions");
  const pause = page.getByRole("button", { name: /^Pause / }).first();
  await expect(pause).toBeVisible();
  const name = await pause.getAttribute("aria-label");
  let writes = 0;
  await page.route("**/v1/finances/recurring-items", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "internal_error", message: "Unavailable", requestId: "qa-recurring" },
      }),
    });
  });
  await pause.scrollIntoViewIfNeeded();
  const main = page.locator("#main-content");
  const before = await main.boundingBox();
  await pause.click();
  await expect(
    page
      .locator("[data-sonner-toast]")
      .filter({ hasText: /Couldn’t confirm whether we could save this recurring payment/ }),
  ).toBeVisible();
  await expect(main.locator('[data-slot="alert"]')).toHaveCount(0);
  const after = await main.boundingBox();
  expect(after?.y).toBe(before?.y);
  expect(after?.height).toBe(before?.height);
  await expect(page.getByRole("button", { name: name ?? /^Pause / }).first()).toBeEnabled();
  expect(writes).toBe(1);
  await page.screenshot({
    path: info.outputPath("finance-action-error.png"),
    fullPage: false,
    animations: "disabled",
    scale: "css",
  });
  await page.unroute("**/v1/finances/recurring-items");
  await page.route("**/v1/finances/recurring-items", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "internal_error", message: "Unavailable", requestId: "qa-read" },
      }),
    }),
  );
  await page.reload();
  const recovery = page.getByRole("dialog", { name: "Let’s reconnect" });
  await expect(recovery).toBeVisible();
  await page.screenshot({
    path: info.outputPath("finance-read-error.png"),
    fullPage: false,
    animations: "disabled",
    scale: "css",
  });
  await recovery.getByRole("button", { name: "Try again" }).click();
  await expect(recovery).toBeVisible();
  await expect(recovery.getByRole("button", { name: "Try again" })).toBeEnabled();
  await page.unroute("**/v1/finances/recurring-items");
  await recovery.getByRole("button", { name: "Try again" }).click();
  await expect(recovery).not.toBeVisible();
  await expect(page.getByRole("button", { name: name ?? /^Pause / }).first()).toBeEnabled();
  expect(writes).toBe(1);
});
