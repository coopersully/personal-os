import { type FinanceActivityEntry, financeActivityPageSchema } from "@personal-os/domain";
import { expect, test } from "@playwright/test";
import { qaFixtureAccounts } from "../apps/api/src/qa-fixtures.js";
import { useProductionStyles } from "./production-styles.js";

const demo = qaFixtureAccounts.find((account) => account.key === "demo-full");
if (!demo) throw new Error("The existing demo-full QA persona is required.");
const id = (value: number) => `91000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
const at = "2026-11-01T12:00:00.000Z";

type NotificationEntry = Extract<FinanceActivityEntry, { kind: "notification_delivery" }>;
function notification(
  state: "accepted" | "uncertain" | "delivered",
  entryId: string,
  ownedRunId: string,
): NotificationEntry {
  const partial = state === "uncertain";
  const explanations = {
    accepted: "The provider accepted this notification. Delivery is not confirmed.",
    uncertain:
      "Notification submission is uncertain. The message may already have been sent; do not resend.",
    delivered:
      "The provider reports delivery. This does not prove reading, reply consumption or financial completion.",
  };
  return {
    id: entryId,
    occurredAt: at,
    kind: "notification_delivery",
    status: state,
    actor: null,
    action: "Finance notification",
    explanation: explanations[state],
    caseId: null,
    runId: null,
    actionId: null,
    sourceOperationId: null,
    auditEventIds: [],
    sourceMessages: [],
    recordRefs: [],
    changes: [],
    targets: partial ? [] : [{ kind: "run", id: ownedRunId }],
    delivery: {
      attemptId: entryId,
      attemptState: state === "delivered" ? "accepted" : state,
      observedAt: at,
      messageId: partial ? null : id(10),
      messageStatus: partial ? null : state,
      submittedAt: partial ? null : at,
      deliveredAt: state === "delivered" ? at : null,
      evidenceState: partial ? "partial" : "complete",
      work: [
        {
          intentId: id(11),
          work: {
            domain: "finances",
            kind: "repair",
            id: id(12),
            revision: partial ? id(13) : ownedRunId,
            actionRevision: "presentation-fixture-revision",
          },
          runId: partial ? null : ownedRunId,
        },
      ],
    },
  };
}

test("Activity separates transport evidence from financial history with keyboard-safe inspection", async ({
  page,
}, testInfo) => {
  testInfo.annotations.push({
    type: "evidence-scope",
    description:
      "Real authenticated local Activity GET and no-store contract; populated notification UI is typed interception only. Real populated owner/receipt/cursor projection is covered by separate PostgreSQL tests, not these mocks.",
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill(demo.email);
  await page.getByLabel("Password", { exact: true }).fill(demo.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();

  const notificationRead = await page.request.get(
    "/v1/finances/activity?type=notification_delivery",
  );
  expect(notificationRead.ok()).toBeTruthy();
  expect(notificationRead.headers()["cache-control"]).toBe("no-store");
  const notificationHistory = financeActivityPageSchema.parse(await notificationRead.json());
  expect(notificationHistory.entries.every((entry) => entry.kind === "notification_delivery")).toBe(
    true,
  );
  // The existing QA loader seeds financial history, not fake notification attempts.
  expect(notificationHistory.entries).toEqual([]);
  const historyRead = await page.request.get("/v1/finances/activity");
  expect(historyRead.ok()).toBeTruthy();
  const history = financeActivityPageSchema.parse(await historyRead.json());
  const financial = history.entries.find((entry) => entry.kind === "financial_action");
  if (!financial || financial.kind !== "financial_action" || !financial.runId)
    throw new Error("The existing demo financial history and owned run fixture are required.");

  const accepted = notification("accepted", id(1), financial.runId);
  const uncertain = notification("uncertain", id(2), financial.runId);
  const delivered = notification("delivered", id(3), financial.runId);
  const material = financeActivityPageSchema.parse({
    ...history,
    entries: [accepted, uncertain, delivered, { ...financial, id: accepted.id }],
    nextCursor: null,
  });
  const queries: Array<string | null> = [];
  const responseModes: Array<string | null> = [];
  const mutations: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() !== "GET" &&
      (path === "/v1/finances" ||
        path.startsWith("/v1/finances/") ||
        path.startsWith("/v1/texting"))
    )
      mutations.push(`${request.method()} ${path}`);
  });
  await page.route(/\/v1\/finances\/activity(?:\?.*)?$/, async (route) => {
    const type = new URL(route.request().url()).searchParams.get("type");
    queries.push(type);
    responseModes.push(
      new URL(route.request().url()).searchParams.get("includeNotificationDeliveries"),
    );
    await route.fulfill({
      json: {
        ...material,
        entries:
          type === "notification_delivery"
            ? material.entries.filter((entry) => entry.kind === type)
            : material.entries,
      },
    });
  });
  await page.goto("/finances/activity");
  await useProductionStyles(page);
  const acceptedRow = page.getByRole("button", {
    name: `Open activity: ${accepted.explanation}`,
    exact: true,
  });
  await expect(acceptedRow).toBeVisible();
  // The shared UUID belongs to different kinds. Both rows must survive real React reconciliation.
  await expect(
    page.getByRole("button", { name: `Open activity: ${financial.explanation}`, exact: true }),
  ).toBeVisible();
  await acceptedRow.focus();
  await acceptedRow.press("Enter");
  let details = page.getByRole("dialog", { name: "Activity details" });
  await expect(details.getByText(/Initiating actor not recorded/u)).toBeVisible();
  await expect(details.getByText(accepted.explanation, { exact: true })).toBeVisible();
  const inspect = details.getByRole("button", { name: "Inspect delivery evidence" });
  await inspect.focus();
  await inspect.press("Enter");
  await expect(details.getByText(accepted.id, { exact: true })).toBeVisible();
  await expect(details.getByText(`Run: ${financial.runId}`, { exact: true })).toBeVisible();
  await expect(details.getByText(/Audit events:/u)).toHaveCount(0);
  await expect(
    details.getByRole("button", { name: /send|approve|load more evidence/iu }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(acceptedRow).toBeFocused();

  await page
    .getByRole("button", { name: `Open activity: ${uncertain.explanation}`, exact: true })
    .click();
  details = page.getByRole("dialog", { name: "Activity details" });
  await expect(details.getByText(uncertain.explanation, { exact: true })).toBeVisible();
  await details.getByRole("button", { name: "Inspect delivery evidence" }).click();
  await expect(details.getByText(/Delivery history is incomplete/u)).toBeVisible();
  await expect(details.getByText("Owned run linkage unavailable", { exact: true })).toBeVisible();
  await expect(details.getByRole("button", { name: /retry|resend|approve/iu })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page
    .getByRole("button", { name: `Open activity: ${delivered.explanation}`, exact: true })
    .click();
  details = page.getByRole("dialog", { name: "Activity details" });
  await expect(details.getByText(delivered.explanation, { exact: true })).toBeVisible();
  await expect(details.getByText(/financial change.*applied|answer consumed/iu)).toHaveCount(0);
  await expect(details.getByText(/providerMessageSid|phoneNumber|message body/iu)).toHaveCount(0);
  const width = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Activity filters" }).click();
  const filters = page.getByRole("dialog", { name: "Filter activity" });
  await filters.getByLabel("Event type").selectOption("notification_delivery");
  await filters.getByRole("button", { name: "Apply filters" }).click();
  await expect(filters).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: `Open activity: ${financial.explanation}`, exact: true }),
  ).toHaveCount(0);
  expect(queries).toContain("notification_delivery");
  expect(responseModes.length).toBeGreaterThan(0);
  expect(responseModes.every((mode) => mode === "true")).toBe(true);
  expect(mutations).toEqual([]);
});
