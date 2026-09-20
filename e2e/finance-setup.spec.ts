import { expect, test } from "@playwright/test";
import { qaFixtureAccounts } from "../apps/api/src/qa-fixtures.js";

const demoAccount = qaFixtureAccounts.find((account) => account.key === "demo-full");
if (!demoAccount) throw new Error("The demo-full QA fixture is required.");

test("an incomplete first plan survives reload and leaves bookkeeping available", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(demoAccount.email);
  await page.getByLabel("Password", { exact: true }).fill(demoAccount.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await page.goto("/finances/setup");
  const setupResponse = () =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/finances/setup") && response.request().method() === "POST",
    );
  const start = setupResponse();
  await page.getByRole("button", { name: "Start or resume setup" }).click();
  let result = await (await start).json();
  for (let count = 0; result.data.question && count < 20; count++) {
    const saved = setupResponse();
    await page.getByRole("button", { name: "Skip for now — keep unknown" }).click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    result = await response.json();
  }
  expect(result.data.stage).toBe("budget_proposal");
  expect(result.data.position).toMatchObject({
    state: "unavailable",
    reasonCode: "producer_not_registered",
  });
  await expect(page.getByText("First plan saved; evidence remains incomplete")).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Setup budget" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("finance-first-plan.png"), fullPage: true });
  await page.reload();
  const resumed = setupResponse();
  await page.getByRole("button", { name: "Start or resume setup" }).click();
  expect((await (await resumed).json()).data.budgetVersionId).toBe(result.data.budgetVersionId);
  await page.getByRole("link", { name: "Continue bookkeeping" }).click();
  await expect(page).toHaveURL(/\/finances\/transactions$/);
  await expect(page.getByRole("row", { name: /Sq Unknown Popup Uncategorized/ })).toBeVisible();
});
