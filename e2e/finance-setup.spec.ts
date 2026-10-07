import { expect, test } from "@playwright/test";
import { qaFixtureAccounts } from "../apps/api/src/qa-fixtures.js";
import type { FinanceConfiguration } from "../packages/domain/src/index.js";

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
  const configurationResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/finances/configuration") &&
      response.request().method() === "GET",
  );
  await page.goto("/finances/setup?section=budget");
  const configuration = (await (await configurationResponse).json()) as FinanceConfiguration;
  expect(configuration.budget.state).toBe("loaded");
  let budgetVersionId =
    configuration.budget.state === "loaded" ? configuration.budget.value?.id : undefined;
  // Desktop and mobile share the fixture database. A previously prepared draft must
  // remain inspectable without restarting the removed sequential setup wizard.
  if (!budgetVersionId) {
    const prepared = page.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/finances/setup") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Prepare budget", exact: true }).click();
    const response = await prepared;
    expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON()).toEqual({ operation: "prepare_budget" });
    const result = await response.json();
    expect(result.data.stage).toBe("budget_proposal");
    expect(result.data.position).toMatchObject({
      state: "unavailable",
      reasonCode: "producer_not_registered",
    });
    budgetVersionId = result.data.budgetVersionId;
  }
  expect(budgetVersionId).toBeTruthy();
  const budgetResponse = () =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/v1/finances/budget-plans") &&
        response.request().method() === "GET",
    );
  const opened = budgetResponse();
  await page.getByRole("link", { name: "Open budget", exact: true }).click();
  expect((await (await opened).json()).data).toMatchObject({
    id: budgetVersionId,
    status: "incomplete",
  });
  await expect(page.getByText("Incomplete", { exact: true })).toBeVisible();
  await expect(
    page.getByText("This budget is incomplete. Missing information is not a confirmed zero."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("finance-first-plan.png"), fullPage: true });
  const resumed = budgetResponse();
  await page.reload();
  expect((await (await resumed).json()).data).toMatchObject({
    id: budgetVersionId,
    status: "incomplete",
  });
  await expect(page.getByText("Incomplete", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0);
  await page.goto("/finances/transactions?view=table");
  await expect(page).toHaveURL(/\/finances\/transactions\?view=table$/);
  await expect(
    page.getByRole("row", { name: "Open Sq Unknown Popup transaction", exact: true }),
  ).toBeVisible();
});
