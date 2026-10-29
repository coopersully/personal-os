import type { FinanceAccountList } from "@personal-os/domain";
import { expect, test } from "@playwright/test";

test("duplicate confirmation keeps counts and consequences inside the scrolling body", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
  const response = await page.request.get("/v1/finances/accounts");
  expect(response.ok()).toBeTruthy();
  const material: FinanceAccountList = await response.json();
  const fixture = material.accounts[0];
  if (!fixture) throw new Error("Missing representative Finance fixture");
  const redundant = {
    ...fixture,
    id: "duplicate-review-old",
    provider: "plaid" as const,
    status: "connected" as const,
    name: "Duplicate checking with a long account name",
    accountMask: "1234",
    institution: "Synthetic test bank",
    lastSyncedAt: "2026-10-29T12:00:00Z",
    synchronization: { ...fixture.synchronization, state: "current" as const },
  };
  const keeper = { ...redundant, id: "duplicate-review-keep", name: "Current checking" };
  await page.route(/\/v1\/finances\/accounts(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        ...material,
        accounts: [redundant, keeper],
        accountSemantics: {
          ...material.accountSemantics,
          possibleDuplicateGroups: [{ accountIds: [redundant.id, keeper.id] }],
        },
      },
    }),
  );
  await page.route("**/duplicate-preview?*", (route) =>
    route.fulfill({
      json: {
        outcome: "completed",
        data: {
          keptAccount: keeper,
          redundantAccount: redundant,
          keptTransactionCount: 10,
          redundantTransactionCount: 7,
          overlappingTransactionCount: 5,
          uniqueRedundantTransactionCount: 2,
          match: "provider_identity",
          revision: "a".repeat(64),
        },
        communication: { headline: "Ready", optionalDetails: [], requiredDisclosures: [] },
      },
    }),
  );
  await page.goto("/finances/accounts");
  await page.getByRole("button", { name: `Compare duplicates for ${redundant.name}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Account to keep tracking").selectOption(keeper.id);
  await dialog.getByRole("button", { name: "Preview comparison" }).click();
  const body = dialog.locator('[data-responsive-slot="body"]');
  for (const [label, count] of [
    ["Overlapping transactions", "5"],
    ["Unique transactions on the redundant account", "2"],
  ] as const) {
    const value = body
      .locator("dt")
      .filter({ hasText: label })
      .locator("xpath=following-sibling::dd[1]");
    await value.scrollIntoViewIfNeeded();
    await expect(value).toHaveText(count);
    await expect(value).toBeInViewport();
  }
  await dialog.screenshot({ path: test.info().outputPath("duplicate-counts.png") });
  await body.getByText(/All transaction history stays/).scrollIntoViewIfNeeded();
  expect(
    await body.evaluate((element) => {
      const frame = element.getBoundingClientRect();
      return [...element.querySelectorAll("p,dt,dd,section")]
        .filter((child) => {
          const bounds = child.getBoundingClientRect();
          return (
            bounds.left < frame.left - 1 ||
            bounds.right > frame.right + 1 ||
            child.scrollWidth > child.clientWidth + 1
          );
        })
        .map((child) => child.textContent);
    }),
  ).toEqual([]);
  await body.getByText(/This does not revoke provider access/).scrollIntoViewIfNeeded();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Account comparison ready." }),
  ).toBeHidden({ timeout: 10_000 });
  await expect(dialog.getByRole("button", { name: "Stop tracking duplicate" })).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport();
  await dialog.screenshot({ path: test.info().outputPath("duplicate-comparison.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});
