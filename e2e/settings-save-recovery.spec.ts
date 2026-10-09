import type {
  FinanceConfiguration,
  TaskList,
  TaskProject,
  WorkspaceSettings,
} from "../packages/domain/src/index.js";
import { type APIRequestContext, expect, type Page, request, test } from "@playwright/test";

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
  const restoreContext = await request.newContext({
    baseURL: origin,
    storageState: await page.context().storageState(),
  });
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
    try {
      await secondContext.close();
    } finally {
      await restoreSettings(restoreContext, path, origin, original.preferences);
    }
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
    const restoreContext = await request.newContext({
      baseURL: origin,
      storageState: await page.context().storageState(),
    });
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
      await openSettingsSection(page, mobile, workspace === "calendar" ? "Calendar" : "Mail");
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
      await restoreSettings(restoreContext, path, origin, original.preferences);
    }
  });
}

async function openSettingsSection(page: Page, mobile: boolean, label: string) {
  if (mobile) {
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page
      .getByRole("menu", { name: "Switch workspace" })
      .getByRole("menuitem", { name: "Settings", exact: true })
      .click();
    await page.getByRole("button", { name: "Workspace actions" }).click();
    const link = page
      .getByRole("dialog", { name: "Settings" })
      .locator(`a[href="/settings?section=${label.toLowerCase()}"]`);
    await expect(link).toHaveAccessibleName(new RegExp(`^${label}(?:: Action required)?$`));
    await expect(link).toHaveAttribute("href", `/settings?section=${label.toLowerCase()}`);
    await link.click();
  } else {
    await page
      .getByRole("navigation", { name: "Workspace navigation" })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
    const link = page
      .getByRole("complementary", { name: "Account utility navigation" })
      .locator(`a[href="/settings?section=${label.toLowerCase()}"]`);
    await expect(link).toHaveAccessibleName(new RegExp(`^${label}(?:: Action required)?$`));
    await expect(link).toHaveAttribute("href", `/settings?section=${label.toLowerCase()}`);
    await link.click();
  }
}

test("Finance account selection recovery stays readable after reopening and navigating to Settings", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  const path = "/v1/workspaces/finances/settings";
  const origin = new URL(page.url()).origin;
  const original = (await (await page.request.get(path)).json()) as WorkspaceSettings<"finances">;
  const configurationResponse = await page.request.get("/v1/finances/configuration");
  expect(configurationResponse.ok()).toBeTruthy();
  const configuration = (await configurationResponse.json()) as FinanceConfiguration;
  if (configuration.accounts.state !== "loaded")
    throw new Error("Fixture Finance accounts unavailable");
  const checking = configuration.accounts.value.accounts.find(
    (account) => account.name === "Everyday checking",
  );
  if (!checking) throw new Error("Fixture checking account unavailable");
  const restoreContext = await request.newContext({
    baseURL: origin,
    storageState: await page.context().storageState(),
  });
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().endsWith(path)) writes++;
  });
  try {
    const seed = await page.request.patch(path, {
      headers: { origin },
      data: {
        expectedRevision: original.revision,
        preferences: { spendAccountIds: [checking.id], financeTransactionGroup: "category" },
      },
    });
    expect(seed.ok()).toBeTruthy();
    const seeded = (await seed.json()) as WorkspaceSettings<"finances">;
    await page.goto("/finances");
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() === "PATCH")
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "conflict",
              message: "These preferences changed. Reload and try again.",
              requestId: "e2e-finance-selection",
            },
          }),
        });
      else await route.continue();
    });
    await page.getByRole("button", { name: "Workspace view settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Spending account view selections", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Spending account view selections" });
    const choice = dialog.getByLabel(/Everyday checking/);
    await expect(choice).toBeEnabled();
    await expect(choice).toBeChecked();
    await choice.click();
    await expect(dialog.getByText("Your change: None selected")).toBeVisible();
    await expect(choice).toBeDisabled();
    await dialog.getByRole("button", { name: "Refresh latest settings" }).click();
    await expect(dialog.getByText("Latest: Everyday checking", { exact: true })).toBeVisible();
    expect(writes).toBe(1);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Review unsaved account selections", exact: true })
      .click();
    await expect(dialog.getByText("Your change: None selected")).toBeVisible();
    await expect(dialog.getByText("Latest: Everyday checking", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await openSettingsSection(page, !!info.project.use.isMobile, "Finances");
    await expect(page.getByText("Your change: None selected")).toBeVisible();
    await expect(page.getByText("Latest: Everyday checking", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Refresh latest settings" }).click();
    await expect(page.getByRole("button", { name: "Use latest settings" })).toBeEnabled();
    expect(writes).toBe(1);
    await page.screenshot({
      path: info.outputPath("finance-contextual-recovery.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Use latest settings" }).click();
    await expect(page.getByText("Your change: None selected")).toHaveCount(0);
    expect(writes).toBe(1);
    const latest = (await (await page.request.get(path)).json()) as WorkspaceSettings<"finances">;
    expect(latest.preferences).toEqual(seeded.preferences);
  } finally {
    await restoreSettings(restoreContext, path, origin, original.preferences);
  }
});

test("Tasks failed project pin reaches Settings and reapplies only its reviewed revision without losing other pins", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  const path = "/v1/workspaces/tasks/settings";
  const origin = new URL(page.url()).origin;
  const restoreContext = await request.newContext({
    baseURL: origin,
    storageState: await page.context().storageState(),
  });
  const original = (await (await page.request.get(path)).json()) as WorkspaceSettings<"tasks">;
  const listsResponse = await page.request.get("/v1/task-lists?limit=100");
  const projectsResponse = await page.request.get("/v1/task-projects?limit=100");
  expect(listsResponse.ok()).toBeTruthy();
  expect(projectsResponse.ok()).toBeTruthy();
  const lists = (await listsResponse.json()) as { items: TaskList[] };
  const projects = (await projectsResponse.json()) as { items: TaskProject[] };
  const work = lists.items.find((list) => list.name === "Work");
  const project = projects.items.find((item) => item.name === "Autumn program opening");
  if (!work || !project) throw new Error("Fixture task containers unavailable");
  const attempts: Array<{ expectedRevision: number; preferences: unknown }> = [];
  try {
    const seed = await page.request.patch(path, {
      headers: { origin },
      data: {
        expectedRevision: original.revision,
        preferences: { pinnedListIds: [work.id], pinnedProjectIds: [] },
      },
    });
    expect(seed.ok()).toBeTruthy();
    const seeded = (await seed.json()) as WorkspaceSettings<"tasks">;
    await page.goto("/tasks?view=projects");
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() !== "PATCH") {
        await route.continue();
        return;
      }
      attempts.push(route.request().postDataJSON());
      if (attempts.length === 1)
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "conflict",
              message: "These preferences changed. Reload and try again.",
              requestId: "e2e-task-pin",
            },
          }),
        });
      else await route.continue();
    });
    const pin = page.getByRole("button", { name: "Pin Autumn program opening", exact: true });
    await expect(pin).toBeEnabled();
    await pin.click();
    await expect(pin).toBeDisabled();
    await page
      .getByRole("link", { name: "Review unsaved pin preferences", exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/settings\?section=tasks/);
    await expect(
      page.getByText("Your change: Autumn program opening", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Refresh latest settings" }).click();
    await expect(page.getByText("Latest: None pinned", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reapply reviewed change" })).toBeEnabled();
    expect(attempts).toHaveLength(1);
    const reviewed = (await (await page.request.get(path)).json()) as WorkspaceSettings<"tasks">;
    await page.screenshot({
      path: info.outputPath("tasks-contextual-recovery.png"),
      fullPage: true,
    });
    const replay = page.waitForResponse(
      (response) => response.request().method() === "PATCH" && response.url().endsWith(path),
    );
    await page.getByRole("button", { name: "Reapply reviewed change" }).click();
    expect((await replay).ok()).toBeTruthy();
    await expect(
      page.getByText("Your change: Autumn program opening", { exact: true }),
    ).toHaveCount(0);
    expect(attempts).toEqual([
      { expectedRevision: seeded.revision, preferences: { pinnedProjectIds: [project.id] } },
      { expectedRevision: reviewed.revision, preferences: { pinnedProjectIds: [project.id] } },
    ]);
    const saved = (await (await page.request.get(path)).json()) as WorkspaceSettings<"tasks">;
    expect(saved.preferences).toEqual({ ...seeded.preferences, pinnedProjectIds: [project.id] });
  } finally {
    await restoreSettings(restoreContext, path, origin, original.preferences);
  }
});

async function restoreSettings(
  context: APIRequestContext,
  path: string,
  origin: string,
  preferences: unknown,
) {
  try {
    const latestResponse = await context.get(path);
    expect(latestResponse.ok()).toBeTruthy();
    const latest = await latestResponse.json();
    const restored = await context.patch(path, {
      headers: { origin },
      data: { expectedRevision: latest.revision, preferences },
    });
    expect(restored.ok()).toBeTruthy();
  } finally {
    await context.dispose();
  }
}
