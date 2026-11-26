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

async function dismissToast(page: Page, message: string) {
  await page
    .locator("[data-sonner-toast]")
    .filter({ hasText: message })
    .getByRole("button", { name: "Close toast" })
    .click();
  await expect(toast(page, message)).toHaveCount(0);
}

async function addFact(page: Page, title: string, value: string, tag = "e2e") {
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add memory" });
  await editor.getByLabel("Fact", { exact: true }).fill(title);
  await editor.getByLabel("Value", { exact: true }).fill(value);
  await editor.getByLabel("Tags", { exact: true }).fill(tag);
  await editor.getByRole("button", { name: "Save memory" }).click();
  await expect(toast(page, "Memory saved.")).toBeVisible();
  const row = page.getByRole("button", { name: new RegExp(title, "i") });
  await expect(row).toBeVisible();
  await dismissToast(page, "Memory saved.");
  return row;
}

test("add, filter by tag, edit, trash and restore a memory", async ({ page }) => {
  await login(page);
  await openMemory(page);
  const id = randomUUID().replaceAll("-", "");
  const marker = `lifecycle${id}`;
  const tag = `e2e-${id.slice(0, 12)}`;
  const row = await addFact(page, marker, "Window seat", tag);
  await expect(row.getByText("Stated", { exact: true })).toBeVisible();
  await expect(row.getByText(tag, { exact: true })).toBeVisible();

  const filtered = page.waitForRequest(
    (request) =>
      request.url().endsWith("/v1/knowledge/search") &&
      JSON.stringify(request.postDataJSON()?.tags) === JSON.stringify([tag]),
  );
  const chip = page.getByRole("group", { name: "Filter by tag" }).getByRole("button", {
    name: tag,
    exact: true,
  });
  await chip.click();
  await filtered;
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(row).toBeVisible();

  await row.click();
  const detail = page.getByRole("dialog", { name: new RegExp(marker, "i") });
  await detail.getByRole("button", { name: "Edit memory" }).click();
  const editor = page.getByRole("dialog", { name: "Edit memory" });
  await editor.getByLabel("Value", { exact: true }).fill("Aisle seat");
  await editor.getByRole("button", { name: "Save memory" }).click();
  await expect(toast(page, "Memory saved.")).toBeVisible();
  await expect(detail.getByText("Aisle seat", { exact: true })).toBeVisible();

  await detail.getByRole("button", { name: "Move to Trash" }).click();
  const confirmation = page.getByRole("dialog", { name: "Move to Trash?" });
  await expect(
    confirmation.getByText("Older backups may still contain this until they're deleted."),
  ).toBeVisible();
  await expect(
    confirmation.getByText("Agents that already read it may remember it."),
  ).toBeVisible();
  await expect(confirmation.getByText("This memory doesn't link to other memories.")).toBeVisible();
  await confirmation.getByRole("button", { name: "Move to Trash" }).click();
  await expect(toast(page, "Memory moved to Trash.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row).toHaveCount(0);
  await dismissToast(page, "Memory moved to Trash.");

  await page.getByRole("tab", { name: "Trash" }).click();
  const trashed = page.getByRole("listitem").filter({ hasText: new RegExp(marker, "i") });
  await expect(trashed.getByText(/Deleted for good in 30 days/)).toBeVisible();
  await trashed.getByRole("button", { name: new RegExp(`^Restore ${marker}`, "i") }).click();
  await expect(toast(page, "Memory restored.")).toBeVisible();
  await expect(trashed).toHaveCount(0);
  await page.getByRole("tab", { name: "All" }).click();
  await expect(row).toBeVisible();
  await expect(row.getByText(/Aisle seat/)).toBeVisible();
});

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
  await expect(detail.getByText("Written or confirmed by you", { exact: true })).toBeVisible();
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

  await dismissToast(page, "Memory download started.");
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
});
