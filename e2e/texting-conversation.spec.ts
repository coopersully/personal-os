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
    workspaces: direction === "inbound" ? ["calendar", "tasks"] : ["tasks"],
    senderKind: direction === "inbound" ? "human" : "agent",
    replyToMessageIds: direction === "outbound" ? ["one"] : [],
    classifiedAt: "2026-11-05T14:00:00Z",
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
  await page.route("**/v1/texting", (route) =>
    route.fulfill({
      json: {
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
      },
    }),
  );
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
    enabled: true,
    scheduleId: "fixture-routine",
    readiness: "ready",
    chatReady: true,
    verifiedAt: "2026-11-05T14:00:00Z",
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
  await page.getByRole("button", { name: "Message views", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Texting settings" })).toHaveAttribute(
    "href",
    "/settings?page=texting",
  );
  await page.keyboard.press("Escape");
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

test("Messages gates every workspace and provides clearly labeled conversation previews", async ({
  page,
}, info) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
  let historyRequests = 0;
  await page.route("**/v1/texting/conversation?*", (route) => {
    historyRequests++;
    return route.fulfill({ json: { messages: [] } });
  });
  await page.route(/\/v1\/texting\/agent(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        enabled: true,
        scheduleId: "fixture",
        readiness: "ready",
        chatReady: false,
        verifiedAt: null,
        pendingCount: 0,
        routines: [],
        runs: [],
        nextRunCursor: null,
        instructions: "Fixture",
      },
    }),
  );
  await page.goto("/messages");
  await expect(page.getByText("Connect your agent to unlock Messages")).toBeVisible();
  await expect(page.getByRole("list", { name: "Conversation history" })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("messages-locked.png"), fullPage: true });
  for (const workspace of ["calendar", "tasks", "mail", "finances"]) {
    await page.goto(`/${workspace}/messages`);
    await expect(page.getByText("Connect your agent to unlock Messages")).toBeVisible();
    await expect(page.getByRole("list", { name: "Conversation history" })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  expect(historyRequests).toBe(0);
  await page.goto("/messages?preview=messages");
  await expect(page.getByText(/Design preview · fictional messages/)).toBeVisible();
  await expect(
    page.getByText("Your reminder is set for 2 PM today: finish the proposal."),
  ).toBeVisible();
  await expect(page.getByLabel("System event")).toBeVisible();
  await expect(
    page.locator("#message-demo-five").getByRole("link", { name: "Reply to previous message" }),
  ).toBeVisible();
  await expect(page.locator("#message-demo-five")).not.toContainText(
    "Yes, remind me about the proposal at 2.",
  );
  await page.screenshot({ path: info.outputPath("messages-global.png"), fullPage: true });
  await page.getByRole("button", { name: "Message views", exact: true }).click();
  await page.getByRole("menuitem", { name: "Tasks", exact: true }).click();
  await expect(page).toHaveURL(/\/messages\?workspace=tasks&preview=messages/);
  await expect(page.getByRole("navigation", { name: "Workspace sections" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Message views", exact: true })).toHaveText(
    /Tasks/,
  );
  await expect(page.locator("#message-demo-one p")).toHaveText(
    "What’s on my calendar this afternoon, and what should I tackle first?",
  );
  await expect(
    page.getByText("Your reminder is set for 2 PM today: finish the proposal."),
  ).toBeVisible();
  await expect(
    page.getByText(
      "You’re free after your 1:30 project check-in. There’s a clear window from 2 to 4.",
    ),
  ).toHaveCount(0);
  await expect(page.getByText("Can you check my recent spending too?")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Full conversation" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: info.outputPath("messages-tasks.png"), fullPage: true });
});
