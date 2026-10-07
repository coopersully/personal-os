import { expect, test } from "@playwright/test";
import { qaFixtureAccounts } from "../apps/api/src/qa-fixtures.js";

const demoAccount = qaFixtureAccounts.find((account) => account.key === "demo-full");
if (!demoAccount) throw new Error("The demo-full QA fixture is required.");

test("Finance outstanding items open with context and retain notes for maintenance", async ({
  page,
  isMobile,
}, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(demoAccount.email);
  await page.getByLabel("Password", { exact: true }).fill(demoAccount.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();

  const transactionId = "33333333-3333-4333-8333-333333333333";
  const caseId = "44444444-4444-4444-8444-444444444444";
  let resolution: Record<string, string> | null = null;
  let answersSaved = 0;
  let maintenanceStarts = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/v1/finances/maintenance" &&
      request.method() === "POST"
    )
      maintenanceStarts++;
  });
  const transaction = {
    id: transactionId,
    accountId: transactionId,
    merchant: "Example transfer",
    date: "2026-09-08",
    amount: 99,
    currencyCode: "USD",
    direction: "expense",
    pending: false,
  };
  const envelope = (data: unknown) => ({
    data,
    changes: [],
    communication: {
      headline: "One item needs review",
      optionalDetails: [],
      requiredDisclosures: [],
      nextQuestion: { id: caseId, answerType: "text", prompt: "Where did this money go?" },
    },
    outcome: "user_input_required",
    remainingWork: { count: 1, categories: ["finance_inbox"] },
    schemaVersion: 1,
  });
  const inbox = () =>
    envelope([
      {
        id: caseId,
        transactionId,
        economicEventId: transactionId,
        evidence: {},
        firstSeenAt: "2026-09-09T12:00:00Z",
        lastSeenAt: "2026-09-09T12:00:00Z",
        impactAmount: 99,
        reason: "possible_transfer",
        status: "open",
        stableKey: caseId,
        resolvedAt: null,
        reopenedFromId: null,
        proposedResolution: null,
        resolution,
        prompt: "Where did this money go?",
        context: { ...transaction, accountName: "Savings", institution: "Example Bank" },
      },
    ]);
  await page.route("**/v1/assistant/work-items?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("domain") !== "finances") {
      await route.continue();
      return;
    }
    await route.fulfill({
      json: {
        filteredTotal: 1,
        items: [
          {
            id: `finance-review:${caseId}`,
            domain: "finances",
            kind: "review",
            priority: "normal",
            title: "Review Example transfer",
            summary: resolution
              ? "Context supplied; financial classification still requires review."
              : "Where did this money go?",
            action: { label: "Review transaction", to: `/finances/review?item=${caseId}` },
            actionAt: null,
            source: null,
            updatedAt: "2026-09-09T12:00:00Z",
          },
        ],
        nextCursor: null,
        snapshotAt: "2026-09-09T12:00:00Z",
        summary: {
          byDomain: { calendar: 0, finances: 1, mail: 0, tasks: 0 },
          byKind: { attention: 0, review: 1 },
          total: 1,
        },
        unavailableDomains: [],
      },
    });
  });
  await page.route("**/v1/finances/inbox", (route) => route.fulfill({ json: inbox() }));
  await page.route(`**/v1/finances/transactions/${transactionId}`, (route) =>
    route.fulfill({ json: envelope(transaction) }),
  );
  await page.route(`**/v1/finances/inbox/${caseId}/answer`, async (route) => {
    const input = route.request().postDataJSON();
    expect(input.resolution.type).toBe("clarify");
    expect(input.answer).toBe("Weekly transfer to my investment account");
    expect(input.idempotencyKey).toBeTruthy();
    resolution = input.resolution;
    answersSaved++;
    await route.fulfill({ json: inbox() });
  });

  await page.goto("/finances");
  await expect(page.getByRole("region", { name: "Outstanding finance items" })).toHaveCount(0);
  const openReview = page.getByRole("button", { name: "1 item needs review", exact: true });
  await expect(openReview).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("finance-review-entry.png") });
  await openReview.click();
  const dialog = page.getByRole("dialog", { name: "Finances reviews", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("data-presentation", isMobile ? "drawer" : "dialog");
  await expect(dialog.getByText(/Sep 8, 2026 · Money out · Posted/)).toBeVisible();
  await expect(dialog.getByText("Example Bank · Savings", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Example transfer", exact: true })).toHaveAttribute(
    "href",
    `/finances/transactions?transactionId=${transactionId}`,
  );
  await dialog.getByLabel("Your answer").fill("Weekly transfer to my investment account");
  await page.screenshot({ path: testInfo.outputPath("finance-note-editor.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await dialog.getByRole("button", { name: "Save answer" }).click();
  await expect(
    dialog.getByText("Note saved · awaiting maintenance", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Your update was checked. This item still needs review."),
  ).toBeVisible();
  await expect(dialog.getByText("0 completed · 1 left · 1 total")).toBeVisible();
  await expect(dialog.getByRole("progressbar", { name: "Review progress" })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  expect(answersSaved).toBe(1);
  expect(maintenanceStarts).toBe(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(openReview).toBeVisible();
  await expect(page).not.toHaveURL(/review=/);
  await page.reload();
  await openReview.click();
  await expect(
    dialog.getByText("Note saved · awaiting maintenance", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Weekly transfer to my investment account", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("0 completed · 1 left · 1 total")).toBeVisible();
  expect(answersSaved).toBe(1);
  expect(maintenanceStarts).toBe(0);
});
