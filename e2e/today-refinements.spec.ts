import { expect, request, test } from "@playwright/test";

test("Today uses standard settings, collapsible commitments and shared record surfaces", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "Your commitments" })).toBeVisible();
  const path = "/v1/today/settings";
  const origin = new URL(page.url()).origin;
  // Cleanup must survive a page/test timeout so a retry starts from the same preferences.
  const restoreContext = await request.newContext({
    baseURL: origin,
    storageState: await page.context().storageState(),
  });
  const original = await (await restoreContext.get(path)).json();
  try {
    await expect(page.getByRole("link", { name: "Personalize Today" })).toHaveCount(0);
    await page.goto("/settings?section=today");
    await expect(
      page.getByRole("heading", { name: "Today at a Glance", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Search settings" }).first()).toBeVisible();
    const previewWidths = await page
      .getByRole("radiogroup", { name: "Background", exact: true })
      .locator(".choice-card__preview")
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().width));
    expect(previewWidths).toHaveLength(3);
    expect(previewWidths.every((width) => width >= 80)).toBeTruthy();
    const save = page.waitForResponse(
      (response) => response.url().endsWith(path) && response.request().method() === "PATCH",
    );
    await page.getByRole("radio", { name: "Weather", exact: true }).click();
    expect((await save).ok()).toBeTruthy();
    await page.getByRole("switch", { name: "Spending", exact: true }).click();
    await expect
      .poll(async () => (await (await page.request.get(path)).json()).preferences.showSpending)
      .toBe(true);
    await page.reload();
    await expect(page.getByRole("radio", { name: "Weather", exact: true })).toBeChecked();
    await page.goto("/today");
    await expect(page.getByRole("region", { name: "Today's calendar" })).toBeVisible();
    const timeline = page.getByRole("region", { name: "Today's calendar" });
    await expect(timeline.locator(".material-liquid__layer")).toHaveCount(1);
    await expect(timeline.locator(".material-liquid__layer")).toBeVisible();
    const frontRecord = timeline.locator(".timeline-record").first();
    await frontRecord.hover();
    await expect
      .poll(() => frontRecord.evaluate((element) => getComputedStyle(element).zIndex))
      .toBe("1000");
    await frontRecord.getByRole("button").first().focus();
    await expect
      .poll(() => frontRecord.evaluate((element) => getComputedStyle(element).zIndex))
      .toBe("1000");
    await page.emulateMedia({ contrast: "more" });
    await expect(timeline.locator(".material-liquid__layer")).toBeHidden();
    await page.emulateMedia({ contrast: "no-preference", forcedColors: "active" });
    await expect(timeline.locator(".material-liquid__layer")).toBeHidden();
    await page.emulateMedia({ forcedColors: "none" });
    await expect(timeline.locator(".material-liquid__layer")).toBeVisible();
    const queue = page.getByRole("complementary", { name: "Your commitments" });
    await expect(queue.getByText("This week · Tasks and reminders")).toBeVisible();
    await expect(queue.getByRole("radiogroup", { name: "Commitment filters" })).toHaveCount(0);
    const group = queue.locator('[data-slot="collapsible"]').first();
    const trigger = group.locator('[data-slot="collapsible-trigger"]');
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(group.getByRole("list")).toBeHidden();
    await trigger.click();
    await expect(group.getByRole("list")).toBeVisible();
    await expect(queue.getByText(/Page 1 of/)).toBeVisible();
    await queue.getByRole("link", { name: "Page 2", exact: true }).click();
    await expect(queue.getByRole("link", { name: "Page 2", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await queue.getByRole("combobox", { name: "Commitments per page" }).selectOption("24");
    await expect(queue.getByText("Page 1 of 1")).toBeVisible();
    await expect(queue.locator('[data-slot="card-content"]')).toHaveAttribute("aria-busy", "false");
    await expect(page.getByRole("radiogroup", { name: "Spending period" })).toBeVisible();
    await expect(page.getByText("Your desktop pet", { exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    const layout = await page.locator(".today-layout").boundingBox();
    const background = await page.locator(".today-background").boundingBox();
    expect(background?.width).toBeCloseTo(layout?.width ?? 0, 0);
    expect(background?.height).toBeCloseTo(layout?.height ?? 0, 0);
    for (const column of [".day-column", ".today-supporting-column"]) {
      const bounds = await page.locator(column).boundingBox();
      expect((layout?.y ?? 0) + (layout?.height ?? 0)).toBeGreaterThanOrEqual(
        (bounds?.y ?? 0) + (bounds?.height ?? 0),
      );
    }
    const headers = await page
      .locator('.today-layout [data-slot="card-header"] > [data-slot="card-title"]')
      .evaluateAll((elements) => elements.map((element) => getComputedStyle(element).fontSize));
    expect(new Set(headers).size).toBe(1);
    await page.screenshot({ path: info.outputPath("today-personalized.png"), fullPage: true });
    // Timeline and weather outages must not hide the independent weekly queue or location control.
    await page.route("**/v1/daily-brief**", (route) => route.abort());
    await page.route("**/v1/weather**", (route) => route.abort());
    await page.reload();
    await expect(queue.getByRole("heading", { name: "Your commitments" })).toBeVisible();
    await expect(page.locator(".workspace-app-bar__weather-location")).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Top navigation" }).locator(".review-navigation"),
    ).toBeVisible();
    await page.goto("/calendar?view=day");
    const calendarRecord = page.locator(".calendar-timeline-event").first();
    await calendarRecord.hover();
    await expect
      .poll(() => calendarRecord.evaluate((element) => getComputedStyle(element).zIndex))
      .toBe("1000");
    await calendarRecord.focus();
    await expect
      .poll(() => calendarRecord.evaluate((element) => getComputedStyle(element).zIndex))
      .toBe("1000");
  } finally {
    try {
      const current = await (await restoreContext.get(path)).json();
      const restored = await restoreContext.patch(path, {
        headers: { origin },
        data: { expectedRevision: current.revision, preferences: original.preferences },
      });
      expect(restored.ok()).toBeTruthy();
    } finally {
      await restoreContext.dispose();
    }
  }
});
