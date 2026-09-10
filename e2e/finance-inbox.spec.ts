import { expect, test } from "@playwright/test";

test("Finance outstanding items open with context and retain notes for maintenance", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@ilo.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();

  const transactionId = "33333333-3333-4333-8333-333333333333";
  const caseId = "44444444-4444-4444-8444-444444444444";
  let resolution: Record<string, string> | null = null;
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
    await route.fulfill({ json: inbox() });
  });

  await page.goto("/finances");
  const outstanding = page.getByRole("region", { name: "Outstanding finance items" });
  await expect(outstanding.getByRole("heading", { name: "Outstanding (1)" })).toBeVisible();
  await outstanding.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("finance-outstanding.png") });
  await outstanding.getByRole("button", { name: "Review Example transfer" }).click();
  const dialog = page.getByRole("dialog", { name: "Review financial activity" });
  await expect(
    dialog.getByText("2026-09-08 · Example Bank Savings · Money out · Posted"),
  ).toBeVisible();
  await dialog.getByLabel("Your answer").fill("Weekly transfer to my investment account");
  await page.screenshot({ path: testInfo.outputPath("finance-note-editor.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await dialog.getByRole("button", { name: "Save answer" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(outstanding.getByText("Note saved · awaiting maintenance")).toBeVisible();
  await page.reload();
  await expect(outstanding.getByText("Note saved · awaiting maintenance")).toBeVisible();
});
