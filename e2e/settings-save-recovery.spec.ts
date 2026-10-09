import { expect, test } from "@playwright/test";

test("two editors retain attempted workspace values and explicitly recover repeated conflicts", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  const path = "/v1/workspaces/calendar/settings";
  const original = await (await page.request.get(path)).json();
  const origin = new URL(page.url()).origin;
  const seed = await page.request.patch(path, {
    headers: { origin },
    data: {
      expectedRevision: original.revision,
      preferences: { calendarView: "auto", weekStartsOn: "sunday" },
    },
  });
  expect(seed.ok()).toBeTruthy();
  const secondContext = await browser.newContext({
    storageState: await page.context().storageState(),
    baseURL: origin,
    ...(info.project.use.viewport ? { viewport: info.project.use.viewport } : {}),
    isMobile: info.project.use.isMobile ?? false,
    hasTouch: info.project.use.hasTouch ?? false,
  });
  const second = await secondContext.newPage();
  let secondWrites = 0;
  second.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().endsWith(path)) secondWrites++;
  });
  try {
    await page.goto("/settings?section=calendar");
    await second.goto("/settings?section=calendar");
    await expect(page.getByLabel("Preferred view")).toBeEnabled();
    await expect(second.getByLabel("Preferred view")).toBeEnabled();
    const firstSave = page.waitForResponse(
      (response) => response.request().method() === "PATCH" && response.url().endsWith(path),
    );
    await page.getByLabel("Preferred view").selectOption("month");
    expect((await firstSave).ok()).toBeTruthy();
    await second.getByLabel("Preferred view").selectOption("day");
    await expect(second.getByText("Your change: day")).toBeVisible();
    await expect(
      second.getByText(
        "Another editor changed these settings. Your attempted change was rejected.",
      ),
    ).toBeVisible();
    await expect(second.getByRole("button", { name: "Reapply reviewed change" })).toBeDisabled();
    await second.route(`**${path}`, async (route) => {
      if (route.request().method() === "GET") {
        await route.abort();
      } else await route.continue();
    });
    await second.getByRole("button", { name: "Refresh latest settings" }).click();
    await expect(second.getByText("Couldn’t load preferences.")).toBeVisible();
    await expect(second.getByRole("button", { name: "Reapply reviewed change" })).toBeDisabled();
    expect(secondWrites).toBe(1);
    await second.unroute(`**${path}`);
    await second.getByRole("button", { name: "Refresh latest settings" }).click();
    await expect(second.getByText("Latest: month")).toBeVisible();
    await second.screenshot({ path: info.outputPath("reviewed-conflict.png"), fullPage: true });
    const firstAgain = page.waitForResponse(
      (response) => response.request().method() === "PATCH" && response.url().endsWith(path),
    );
    await page.getByLabel("Week starts on").selectOption("monday");
    expect((await firstAgain).ok()).toBeTruthy();
    await second.getByRole("button", { name: "Reapply reviewed change" }).click();
    await expect(second.getByRole("button", { name: "Reapply reviewed change" })).toBeDisabled();
    expect(secondWrites).toBe(2);
    await expect(second.getByText("Your change: day")).toBeVisible();
    await second.getByRole("button", { name: "Refresh latest settings" }).click();
    await expect(second.getByRole("button", { name: "Reapply reviewed change" })).toBeEnabled();
    await second.getByRole("button", { name: "Reapply reviewed change" }).click();
    await expect(second.getByLabel("Preferred view")).toHaveValue("day");
    await expect(second.getByLabel("Preferred view")).toBeEnabled();
    expect(secondWrites).toBe(3);
    const current = await (await page.request.get(path)).json();
    expect(current.preferences.weekStartsOn).toBe("monday");
    await second.screenshot({ path: info.outputPath("recovered-settings.png"), fullPage: true });
    expect(
      await second.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
  } finally {
    await secondContext.close();
    const latest = await (await page.request.get(path)).json();
    const restored = await page.request.patch(path, {
      headers: { origin },
      data: { expectedRevision: latest.revision, preferences: original.preferences },
    });
    expect(restored.ok()).toBeTruthy();
  }
});

for (const workspace of ["calendar", "mail"] as const) {
  test(`${workspace} contextual failure remains reviewable after SPA navigation to Settings`, async ({
    page,
  }, info) => {
    const mobile = !!info.project.use.isMobile;
    await page.goto("/");
    await page.getByLabel("Email").fill("demo+full@nohmi.test");
    await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
    const path = `/v1/workspaces/${workspace}/settings`;
    const origin = new URL(page.url()).origin;
    const original = await (await page.request.get(path)).json();
    const preferences =
      workspace === "calendar" ? { calendarView: "week" } : { mailConversationLayout: "split" };
    expect(
      (
        await page.request.patch(path, {
          headers: { origin },
          data: { expectedRevision: original.revision, preferences },
        })
      ).ok(),
    ).toBeTruthy();
    let writes = 0;
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().endsWith(path)) writes++;
    });
    try {
      await page.goto(`/${workspace}`);
      await page.route(`**${path}`, async (route) => {
        if (route.request().method() === "PATCH")
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "conflict",
                message: "These preferences changed. Reload and try again.",
                requestId: "e2e-contextual-save",
              },
            }),
          });
        else await route.continue();
      });
      if (workspace === "calendar") {
        await page.getByRole("button", { name: /^Calendar view:/ }).click();
        await page.getByRole("menuitemradio", { name: "Month", exact: true }).click();
      } else {
        await page.getByRole("button", { name: "Message list layout" }).click();
        await page.getByRole("menuitemradio", { name: "Full-width view", exact: true }).click();
      }
      const attempted =
        workspace === "calendar" ? "Your change: month" : "Your change: Full-width view";
      await expect(page.getByText(attempted)).toBeVisible();
      await expect(page.getByRole("button", { name: "Reapply reviewed change" })).toBeDisabled();
      if (mobile) {
        await page.getByRole("button", { name: "Switch workspace" }).click();
        await page
          .getByRole("menu", { name: "Switch workspace" })
          .getByRole("menuitem", { name: "Settings", exact: true })
          .click();
        await page.getByRole("button", { name: "Workspace actions" }).click();
        await page
          .getByRole("dialog", { name: "Settings" })
          .getByRole("link", { name: workspace === "calendar" ? "Calendar" : "Mail", exact: true })
          .click();
      } else {
        await page
          .getByRole("navigation", { name: "Workspace navigation" })
          .getByRole("link", { name: "Settings", exact: true })
          .click();
        await page
          .getByRole("complementary", { name: "Account utility navigation" })
          .getByRole("link", { name: workspace === "calendar" ? "Calendar" : "Mail", exact: true })
          .click();
      }
      await expect(page.getByText(attempted)).toBeVisible();
      await page.getByRole("button", { name: "Refresh latest settings" }).click();
      await expect(page.getByRole("button", { name: "Use latest settings" })).toBeEnabled();
      expect(writes).toBe(1);
      await page.screenshot({
        path: info.outputPath(`${workspace}-contextual-recovery-in-settings.png`),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Use latest settings" }).click();
      await expect(page.getByText(attempted)).toHaveCount(0);
      expect(writes).toBe(1);
    } finally {
      await page.unroute(`**${path}`);
      const latest = await (await page.request.get(path)).json();
      expect(
        (
          await page.request.patch(path, {
            headers: { origin },
            data: { expectedRevision: latest.revision, preferences: original.preferences },
          })
        ).ok(),
      ).toBeTruthy();
    }
  });
}
