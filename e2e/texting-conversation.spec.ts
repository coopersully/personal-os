import { expect, test } from "@playwright/test";

test("Messages preserves SMS history and remains readable on desktop and mobile", async ({
  page,
}, info) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
  const message = (
    id: string,
    direction: "inbound" | "outbound",
    text: string,
    status = "delivered",
  ) => ({
    id,
    direction,
    text,
    status,
    occurredAt: "2026-11-05T14:00:00Z",
    localDateTime: "Nov 5, 9:00 AM",
    occurredAtSource: "provider",
    deliveredAt: null,
    sentAt: null,
    actualSegments: 1,
    predictedSegments: 1,
    contentKind: null,
    seriesId: null,
    seriesPart: null,
    seriesTotal: null,
  });
  await page.route("**/v1/texting/conversation?*", (route) =>
    route.fulfill({
      json: {
        asOf: "2026-11-05T14:00:00Z",
        timeZone: "America/New_York",
        currentLocalDateTime: "Nov 5, 9:00 AM",
        connection: {
          id: "fixture",
          state: "active",
          senderPhoneNumber: "+1 888 555 0100",
          maskedPhoneNumber: "••• ••• 0123",
          providerReady: true,
          consentEpoch: 1,
          country: "US",
          verifiedAt: "2026-11-01T12:00:00Z",
        },
        messages: [
          message(
            "one",
            "inbound",
            "What is on my calendar today, and which tasks should I focus on?",
          ),
          message(
            "two",
            "outbound",
            "Your afternoon is free after 2. Finish the proposal first, then review your budget. Calendar access needs to be renewed before I can check for changes.",
            "unknown",
          ),
          message("three", "inbound", "Thanks. Remind me to renew it after lunch."),
        ],
        hasEarlierMessages: false,
        earlierCursor: null,
        newerCursor: null,
        conversationReceipt: null,
      },
    }),
  );
  const latest = {
    id: "11111111-1111-4111-8111-111111111111",
    state: "completed",
    reason: null,
    createdAt: "2026-11-05T14:00:00Z",
    updatedAt: "2026-11-05T14:00:00Z",
    work: [],
    hostSessionId: null,
    replyMessageId: null,
  };
  const rejected = {
    ...latest,
    id: "22222222-2222-4222-8222-222222222222",
    state: "blocked",
    reason: "host_rejected",
    createdAt: "2026-11-04T14:00:00Z",
  };
  const agentStatus = {
    enabled: false,
    scheduleId: null,
    readiness: "disabled",
    pendingCount: 0,
    routines: [],
    runs: [latest],
    nextRunCursor: latest.id,
    instructions: "Fixture",
  };
  let closed = false;
  await page.route(/\/v1\/texting\/agent(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: new URL(route.request().url()).searchParams.has("beforeRun")
        ? {
            ...agentStatus,
            runs: [{ ...rejected, reason: closed ? "human_closed" : "host_rejected" }],
            nextRunCursor: null,
          }
        : agentStatus,
    }),
  );
  await page.route("**/v1/texting/agent/runs/*/recover", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ action: "close", hostStopped: true });
    closed = true;
    await route.fulfill({ json: agentStatus });
  });
  await page.goto("/messages");
  await expect(page.getByRole("list", { name: "Conversation history" })).toBeVisible();
  await expect(page.getByText("Thanks. Remind me to renew it after lunch.")).toBeVisible();
  await expect(page.getByText(/Delivery unconfirmed/)).toBeVisible();
  await expect(page.getByText(/Automatic replies are off/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Texting settings" })).toHaveAttribute(
    "href",
    "/settings?page=texting",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath("messages.png"), fullPage: true });
  await page.locator("summary").filter({ hasText: "Agent runs" }).click();
  await page.getByRole("button", { name: "Load older runs" }).click();
  await page.getByRole("button", { name: "Review this run" }).click();
  const recovery = page.getByRole("dialog");
  await expect(recovery.getByRole("button", { name: "Retry saved request" })).toBeEnabled();
  await recovery.getByRole("button", { name: "Close saved request" }).click();
  await expect(page.getByText(/Closed without retrying/)).toBeVisible();
  expect(closed).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
