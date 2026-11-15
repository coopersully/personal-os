import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";

const memoryRoute = "/settings?section=memory";
const toast = (page: Page, message: string) =>
  page.locator("[data-sonner-toast]").getByText(message, { exact: true });

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
}

async function openMemory(page: Page) {
  await page.goto(memoryRoute);
  await expect(page.getByRole("heading", { name: "Memory", exact: true })).toBeVisible();
}

async function addFact(page: Page, title: string, value: string) {
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add memory" });
  await editor.getByLabel("Fact", { exact: true }).fill(title);
  await editor.getByLabel("Value", { exact: true }).fill(value);
  await editor.getByRole("button", { name: "Save memory" }).click();
  await expect(toast(page, "Memory saved.")).toBeVisible();
  const row = page.getByRole("button", { name: new RegExp(title, "i") });
  await expect(row).toBeVisible();
  return row;
}

test("search and revision history use the real API, with bounded private download", async ({
  page,
}, info) => {
  await login(page);
  await openMemory(page);
  const marker = `memory${randomUUID().replaceAll("-", "")}`;
  const row = await addFact(page, marker, "Please allow a quiet morning");
  const search = page.waitForRequest(
    (request) =>
      request.url().endsWith("/v1/knowledge/search") &&
      request.method() === "POST" &&
      request.postDataJSON()?.text === marker,
  );
  await page.getByLabel("Search memory", { exact: true }).fill(marker);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  expect((await search).url()).not.toContain(marker);
  await expect(page).toHaveURL(/\/settings\?section=memory$/);
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press("Enter");
  const detail = page.getByRole("dialog", { name: new RegExp(marker, "i") });
  await expect(detail.getByText("Please allow a quiet morning", { exact: true })).toBeVisible();
  await expect(detail.getByText("Accepted by you", { exact: true })).toBeVisible();
  const historyRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/history")) historyRequests.push(request.url());
  });
  expect(historyRequests).toHaveLength(0);
  await detail.getByRole("button", { name: "Show history" }).click();
  await expect(
    detail
      .getByRole("region", { name: "Revision history" })
      .getByText("Revision 1", { exact: true }),
  ).toBeVisible();
  const revisions = detail.getByRole("region", { name: "Revision history" });
  await expect(revisions.getByText(marker, { exact: true })).toBeVisible();
  await revisions.getByText("Sources for revision 1", { exact: true }).click();
  await expect(revisions.getByText(/Please allow a quiet morning/i).last()).toBeVisible();
  expect(historyRequests.length).toBeGreaterThan(0);
  expect(historyRequests.every((url) => !new URL(url).searchParams.has("cursor"))).toBeTruthy();
  await detail.getByRole("button", { name: "Close", exact: true }).click();
  await expect(row).toBeFocused();

  await page.getByRole("button", { name: "Download memory" }).click();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("dialog", { name: "Download memory?" })
    .getByRole("button", { name: "Download", exact: true })
    .click();
  expect((await downloadEvent).suggestedFilename()).toBe("nohmi-memory-1.json");
  await expect(toast(page, "Memory download started.")).toBeVisible();

  await page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Memory download started." })
    .getByRole("button", { name: "Close toast" })
    .click();
  await page.screenshot({ path: info.outputPath("memory-settings.png"), animations: "disabled" });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const tabsFit = await page.getByRole("tablist", { name: "Memory views" }).evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll("[role=tab]")].every((tab) => {
      const rect = tab.getBoundingClientRect();
      return rect.bottom <= bounds.bottom + 1 && rect.right <= bounds.right + 1;
    });
  });
  expect(tabsFit).toBeTruthy();
  await row.click();
  await expect(detail.getByText("Please allow a quiet morning", { exact: true })).toBeVisible();
  const metrics = await detail.evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    viewport: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width + 1);
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport + 1);
  const titleFits = await detail
    .getByRole("heading", { name: new RegExp(marker, "i") })
    .evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
  expect(titleFits).toBeTruthy();
  await page.screenshot({ path: info.outputPath("memory-large-text.png"), animations: "disabled" });

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  await detail.getByRole("button", { name: "Preview forgetting" }).click();
  const preview = page.getByRole("dialog", { name: "Forget memory?" });
  await preview.getByRole("button", { name: "Forget permanently" }).click();
  await expect(toast(page, "Forgetting is temporarily unavailable.")).toBeVisible();
  await expect(preview.getByText("Forgetting is temporarily unavailable.")).toHaveCount(0);
  await preview.getByRole("button", { name: "Cancel" }).click();
  await expect(detail.getByText("Please allow a quiet morning", { exact: true })).toBeVisible();
});

test("erasure preview pages and a blocked operation survive reload", async ({ page }) => {
  await login(page);
  await openMemory(page);
  const marker = `forget${randomUUID().replaceAll("-", "")}`;
  const row = await addFact(page, marker, "An example that can be erased");
  const opening = page.waitForRequest(
    (request) =>
      request.method() === "GET" &&
      /^\/v1\/knowledge\/[0-9a-f-]{36}$/.test(new URL(request.url()).pathname),
  );
  await row.click();
  const detail = page.getByRole("dialog", { name: new RegExp(marker, "i") });
  const record = new URL((await opening).url()).pathname.split("/").at(-1);

  const operationId = randomUUID();
  const previewId = randomUUID();
  const affected = Array.from({ length: 51 }, (_, index) => ({
    recordId: index === 0 ? record : randomUUID(),
    revision: 1,
  }));
  let phase: "idle" | "blocked" | "pending" | "completed" = "idle";
  let retries = 0;
  await page.route("**/v1/knowledge/operations", (route) =>
    route.fulfill({
      json: phase === "idle" || phase === "completed" ? [] : [{ operationId, status: phase }],
    }),
  );
  await page.route(`**/v1/knowledge/operations/${operationId}`, (route) =>
    route.fulfill({
      json: { operationId, status: phase },
    }),
  );
  await page.route(`**/v1/knowledge/operations/${operationId}/retry`, (route) => {
    retries++;
    phase = "pending";
    return route.fulfill({ json: { operationId, status: phase } });
  });
  await page.route("**/v1/knowledge/*/forget-preview", (route) => {
    const next = Boolean(route.request().postDataJSON()?.cursor);
    return route.fulfill({
      json: {
        previewId,
        recordId: record,
        ownerEpoch: 5,
        affected: next ? affected.slice(50) : affected.slice(0, 50),
        dependentCopyCount: 50,
        historyCount: 51,
        nextCursor: next ? null : { ...affected[49], previewId, ownerEpoch: 5 },
      },
    });
  });
  await page.route("**/v1/knowledge/forget", (route) => {
    phase = "pending";
    return route.fulfill({
      status: 202,
      json: { operationId, receiptId: operationId, recordId: record, outcome: "pending_erasure" },
    });
  });

  await detail.getByRole("button", { name: "Preview forgetting" }).click();
  const preview = page.getByRole("dialog", { name: "Forget memory?" });
  await expect(preview.getByText("50 dependent copies")).toBeVisible();
  await expect(preview.getByRole("button", { name: "Cancel" })).toBeFocused();
  await preview.getByRole("button", { name: "More affected memories" }).click();
  await expect(preview.getByText("Affected memories 51–51")).toBeVisible();
  const initialStatus = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/v1/knowledge/operations/${operationId}`) &&
      response.request().method() === "GET",
  );
  await preview.getByRole("button", { name: "Forget permanently" }).click();
  await initialStatus;
  await expect(toast(page, "Forgetting in progress.")).toHaveCount(1);
  const check = page.getByRole("button", { name: "Check erasure status" });
  await expect(check).toBeEnabled();
  phase = "blocked";
  await check.click();
  await expect(page.getByRole("button", { name: "Retry erasure" })).toBeVisible();
  await expect(page.getByText("Memory access is paused during erasure.")).toBeVisible();
  await expect(toast(page, "Erasure needs attention.")).toHaveCount(1);
  await expect(page.getByText("Erasure needs attention.", { exact: true })).toHaveCount(1);
  expect(retries).toBe(0);
  await expect(toast(page, "Memory forgotten.")).toHaveCount(0);
  await expect(row).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: "Retry erasure" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add memory" })).toHaveCount(0);
  await page.getByRole("button", { name: "Retry erasure" }).click();
  await expect(toast(page, "Erasure retry requested.")).toBeVisible();
  expect(retries).toBe(1);
  await expect(toast(page, "Memory forgotten.")).toHaveCount(0);
  phase = "completed";
  await page.getByRole("button", { name: "Check erasure status" }).click();
  await expect(toast(page, "Memory forgotten.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add memory" })).toBeVisible();
  await expect(page.getByText("Memory forgotten.", { exact: true })).toHaveCount(1);
});

test("All memory reopens a superseded predecessor for forgetting", async ({ page }) => {
  await login(page);
  await openMemory(page);
  const predecessorTitle = `previous${randomUUID().replaceAll("-", "")}`;
  const predecessor = await addFact(page, predecessorTitle, "Previous preference");
  await page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Memory saved." })
    .getByRole("button", { name: "Close toast" })
    .click();
  await expect(toast(page, "Memory saved.")).toHaveCount(0);
  const successorTitle = `replacement${randomUUID().replaceAll("-", "")}`;
  const successor = await addFact(page, successorTitle, "Replacement preference");
  const opening = page.waitForRequest(
    (request) =>
      request.method() === "GET" &&
      /^\/v1\/knowledge\/[0-9a-f-]{36}$/.test(new URL(request.url()).pathname),
  );
  await successor.click();
  const successorId = new URL((await opening).url()).pathname.split("/").at(-1);
  if (!successorId) throw new Error("Expected a replacement memory ID.");
  await page
    .getByRole("dialog", { name: new RegExp(successorTitle, "i") })
    .getByRole("button", { name: "Close", exact: true })
    .click();

  await predecessor.click();
  const detail = page.getByRole("dialog", { name: new RegExp(predecessorTitle, "i") });
  await detail.getByRole("button", { name: "Supersede", exact: true }).click();
  const supersede = page.getByRole("dialog", { name: "Supersede memory" });
  await supersede.getByLabel("Replacement memory ID").fill(successorId);
  await supersede.getByRole("button", { name: "Supersede memory" }).click();
  await expect(toast(page, "Memory superseded.")).toBeVisible();
  await detail.getByRole("button", { name: "Close", exact: true }).click();
  await expect(predecessor).toHaveCount(0);

  await page.getByRole("tab", { name: "All memory" }).click();
  await expect(predecessor).toBeVisible();
  await predecessor.click();
  await expect(detail.getByText("Superseded", { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Preview forgetting" }).click();
  const preview = page.getByRole("dialog", { name: "Forget memory?" });
  await expect(preview.getByText("0 dependent copies")).toBeVisible();
  await expect(preview.getByText("2 saved revisions")).toBeVisible();
  await preview.getByText("Affected memories 1–2").click();
  await expect(preview.getByText("This memory · revision 1")).toBeVisible();
  await expect(preview.getByText("This memory · revision 2")).toBeVisible();
});
