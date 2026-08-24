import { expect, test } from "@playwright/test";

test("the repository QA fixture login exposes representative workspace data", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@ilo.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Open ilo" }).click();
  await expect(page.getByRole("heading", { name: "Your commitments" })).toBeVisible();

  await page.goto("/calendar");
  await expect(page.getByText("Product strategy review", { exact: true })).toBeVisible();
  await page.goto("/tasks");
  if (test.info().project.name === "mobile-chromium") {
    await page.getByRole("button", { name: "Workspace actions" }).click();
  }
  await page
    .getByRole("navigation", { name: "Task Lists" })
    .getByRole("link", { name: "Work", exact: true })
    .click();
  await expect(page.getByText("Draft weekly product update", { exact: true })).toBeVisible();
  await page.goto("/mail");
  await expect(page.getByText("Board packet for Friday", { exact: true })).toBeVisible();
  await page.goto("/finances/transactions");
  await expect(page.getByRole("row", { name: /Sq Unknown Popup Uncategorized/ })).toBeVisible();
});

test("Reviews and agent controls separate decisions from configuration", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@ilo.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Open ilo" }).click();
  await expect(page.getByRole("heading", { name: "Your commitments" })).toBeVisible();
  await page.goto("/reviews");
  await expect(page.getByRole("heading", { level: 2, name: "Reviews", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Review" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Attention" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Setup" })).toHaveCount(0);
  await page.getByRole("radio", { name: "Attention" }).click();
  await expect(page).toHaveURL(/kind=attention/);
  await page.getByRole("radio", { name: "All work" }).click();
  const mailReview = page.getByRole("listitem").filter({ hasText: "Review Fixture newsletters" });
  await mailReview.getByRole("link", { name: "Review rule" }).click();
  await expect(page.getByRole("dialog", { name: "Review Fixture newsletters" })).toBeVisible();
  await expect(page).toHaveURL(/settings\?section=mail&reviewRule=/);
  await expect(page.getByRole("dialog").getByText(/Rule scope:/)).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Activate reviewed rule" }),
  ).toBeEnabled();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();
  await expect(page).toHaveURL(/settings\?section=mail$/);
  await expect(page.getByRole("heading", { name: "Mail settings" })).toBeVisible();

  await page.goto("/settings?section=workspace-access&workspace=mail");
  await expect(page.getByRole("heading", { name: "Workspace access" })).toBeVisible();
  await expect(page.getByText("Allowed", { exact: true })).toBeVisible();
  await expect(page.getByText("Needs your approval", { exact: true })).toBeVisible();
  await expect(page.getByText("Not allowed", { exact: true })).toBeVisible();
  await expect(page.getByText("Mail readiness")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Setup protocol details" })).toHaveCount(0);

  await page.getByRole("radio", { name: "Calendar" }).click();
  await expect(page).toHaveURL(/workspace=calendar/);
  await expect(page.getByText("Calendar readiness")).toHaveCount(0);
  await page.getByRole("radio", { name: "Mail" }).click();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth <= innerWidth + 1),
  ).toBe(true);

  await page.route("**/v1/assistant/work-items*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        filteredTotal: 0,
        items: [],
        nextCursor: null,
        snapshotAt: new Date().toISOString(),
        summary: {
          byDomain: { calendar: 0, finances: 0, mail: 0, tasks: 0 },
          byKind: { attention: 0, review: 0 },
          total: 0,
        },
        unavailableDomains: [],
      },
    });
  });
  await page.goto("/reviews");
  await expect(page.getByText("You’re caught up")).toBeVisible();
});

test("a person and an agent share one reminder and calendar surface", async ({
  page,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const email = `e2e+${suffix}@example.com`;
  const reminderTitle = `Material reminder ${suffix}`;
  const eventTitle = `Material event ${suffix}`;
  const mobile = testInfo.project.name === "mobile-chromium";
  // The desktop switcher and the narrow dock expose the same five destinations
  // under the same accessible names, so workspace movement is one path.
  const openWorkspace = async (name: string) => {
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page
      .getByRole("menu", { name: "Switch workspace" })
      .getByRole("menuitem", { name, exact: true })
      .click();
  };
  const returnToApp = () => openWorkspace("Today at a Glance");
  // A workspace's own pages live in its sidebar on desktop and in the dock
  // sheet when narrow.
  const openWorkspacePage = async (workspace: string, name: string) => {
    if (mobile) {
      await page.getByRole("button", { name: "Workspace actions" }).click();
      await page
        .getByRole("dialog", { name: workspace })
        .getByRole("link", { name, exact: true })
        .click();
      return;
    }
    await page
      .getByRole("complementary", { name: `${workspace} Sidebar` })
      .getByRole("link", { name, exact: true })
      .click();
  };

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByRole("button", { name: "I have an invite code" }).click();
  await page.getByLabel("Invite code").fill("E2E12345");
  await page.getByLabel("Name").fill("E2E Person");
  await expect(page.getByText("Invitation accepted.")).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("LocalTestOnly123!");
  await page.getByLabel("Confirm password").fill("LocalTestOnly123!");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: "Hi, E2E." })).toBeVisible();
  await page.getByRole("button", { name: "Exit setup" }).click();
  await expect(page.getByRole("heading", { name: "Your commitments" })).toBeVisible();
  const applicationSidebar = page.getByRole("complementary", {
    name: "Today Sidebar",
  });
  if (mobile) {
    await expect(applicationSidebar).toBeHidden();
  } else {
    await expect(applicationSidebar).toBeVisible();
    await page.getByRole("button", { name: "Switch workspace" }).click();
    const workspaceMenu = page.getByRole("menu", { name: "Switch workspace" });
    const calendarWorkspace = workspaceMenu.getByRole("menuitem", { name: "Calendar" });
    await expect(calendarWorkspace.locator("small")).not.toHaveText("Loading calendar…");
    await calendarWorkspace.hover();
    const calendarPreview = page.locator('.workspace-preview[data-workspace="calendar"]');
    await expect(calendarPreview).toBeVisible();
    await expect(calendarPreview.locator(".week-calendar")).toBeVisible();
    await expect(calendarPreview).toHaveAttribute("data-direction", "down");
    await page.keyboard.press("Escape");
    await expect(page.locator(".workspace-preview")).toHaveCount(0);
    await expect(page).toHaveURL(/\/today$/);
  }

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("menuitem", { name: "Reminder" }).click();
  await page.getByLabel("What needs attention?").fill(reminderTitle);
  await page.getByLabel("Notes").fill("Created from the direct manipulation surface.");
  await page.getByRole("button", { name: "Create reminder" }).click();
  await openWorkspace("Tasks");
  await openWorkspacePage("Tasks", "Reminders");
  await expect(page.getByText(reminderTitle)).toBeVisible();

  await returnToApp();
  const planningDate = await page.locator("h1 time").getAttribute("datetime");
  if (!planningDate) throw new Error("Today heading did not expose its planning date.");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("menuitem", { name: "Event" }).click();
  await page.getByLabel("Event", { exact: true }).fill(eventTitle);
  await page.getByLabel("Starts").fill(`${planningDate}T12:00`);
  await page.getByLabel("Ends").fill(`${planningDate}T13:00`);
  await page.getByLabel("Location").fill("Desktop overlay");
  await page.getByRole("checkbox", { name: "All day" }).check();
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page.getByText(eventTitle)).toBeVisible();
  const todayLayout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(todayLayout.documentWidth).toBeLessThanOrEqual(todayLayout.viewportWidth + 1);

  await openWorkspace("Calendar");
  if (mobile) {
    await expect(
      page.getByRole("radio", { name: "Day", exact: true, checked: true }),
    ).toBeVisible();
    await page.getByRole("radio", { name: "Week", exact: true }).click();
  }
  await expect(page.getByRole("radio", { name: "Week", exact: true, checked: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByText("12 AM", { exact: true })).toBeVisible();
  const calendarHeading = page.locator('[data-slot="workspace-app-bar-identity"] h2');
  const initialCalendarHeading = await calendarHeading.innerText();
  await page.getByRole("button", { name: "Next week" }).click();
  await expect.poll(() => calendarHeading.innerText()).not.toBe(initialCalendarHeading);
  await page.getByRole("button", { name: "Previous week" }).click();
  await expect.poll(() => calendarHeading.innerText()).toBe(initialCalendarHeading);
  await page.getByRole("radio", { name: "Month" }).click();
  await expect(page.getByRole("radio", { name: "Month", checked: true })).toBeVisible();
  const calendarLayout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(calendarLayout.documentWidth).toBeLessThanOrEqual(calendarLayout.viewportWidth + 1);
  await page.getByRole("radio", { name: "Day", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Day", checked: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "24-hour schedule with 15-minute marks" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Today", exact: true }).click();

  // Activity belongs to Today, so reach it from that workspace rather than the
  // account menu it used to live in.
  await returnToApp();
  await openWorkspacePage("Today", "Activity");
  await expect(page.getByText("Reminder · created").first()).toBeVisible();
  await expect(page.getByText("Calendar event · created").first()).toBeVisible();

  if (mobile) {
    await page.getByRole("button", { name: "Workspace actions" }).click();
    await page.getByRole("button", { name: /account$/ }).click();
  } else {
    await page.getByRole("button", { name: "Account menu" }).click();
  }
  await page.getByRole("menuitem", { name: "Settings" }).click();
  // The account utility is a tenant of the shell: same app bar, its own
  // navigation in the sidebar on desktop and in the dock sheet when narrow.
  const settingsSidebar = page.getByRole("complementary", {
    name: "Account utility navigation",
  });
  const openSettingsSection = async (name: string | RegExp) => {
    if (mobile) {
      await page.getByRole("button", { name: "Workspace actions" }).click();
      await page.getByRole("dialog", { name: "Settings" }).getByRole("link", { name }).click();
      return;
    }
    await settingsSidebar.getByRole("link", { name }).click();
  };
  await expect(
    page.getByRole("navigation", { name: "Top navigation" }).getByText("Settings"),
  ).toBeVisible();
  if (mobile) {
    await expect(settingsSidebar).toBeHidden();
    await expect(
      page.getByRole("navigation", { name: "Workspace dock" }).getByText("Settings"),
    ).toBeVisible();
  } else {
    await expect(settingsSidebar).toBeVisible();
    await expect(settingsSidebar.getByRole("link", { name: "Back to Today" })).toBeVisible();
  }
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toHaveCount(0);
  await page.getByLabel("Planning day starts").fill("10:00");
  await page.getByLabel("Planning day ends").fill("18:00");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByLabel("Planning day starts")).toHaveValue("10:00");
  await expect(page.getByLabel("Planning day ends")).toHaveValue("18:00");
  await openSettingsSection("Appearance");
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  const darkAppearance = page.getByRole("radio", { name: "Dark" });
  await darkAppearance.click();
  await expect(darkAppearance).toBeChecked();
  await expect
    .poll(() => page.locator("html").evaluate((element) => element.classList.contains("dark")))
    .toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await openSettingsSection("Connected agents");
  await expect(page.getByRole("heading", { name: "Connected agents", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ilo MCP URL" })).toHaveValue(/\/mcp$/);
  await openSettingsSection("Workspace access");
  await expect(page.getByText("Allowed", { exact: true })).toBeVisible();
  await expect(page.getByText("Mail readiness")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Setup protocol details" })).toHaveCount(0);
  await openSettingsSection("Mail");
  await expect(page.getByRole("heading", { name: "Mail settings" })).toBeVisible();
  const mailAction = page
    .locator("main")
    .getByRole("status")
    .filter({ hasText: "Action required" });
  await expect(mailAction).toContainText("Connect an MCP-compatible agent host to Ilo.");
  await expect(mailAction.getByRole("link", { name: "Connect agent" })).toBeVisible();
  await expect(page.getByText("Operational review")).toHaveCount(0);
  await expect(page.getByText("Connect an agent", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Setup protocol details" }).click();
  await expect(page.getByRole("link", { name: "View skill source" })).toBeVisible();
  await openSettingsSection("Connected agents");
  await page.getByRole("button", { name: "Set up a local token" }).click();
  await expect(
    page.getByRole("radio", {
      name: "Mail setup: Learn your inbox preferences, preview rules, and run approved Mail rules.",
      checked: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create local token" }).click();
  await expect(page.getByText(/^pos_/)).toBeVisible();

  const layout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  if (mobile) {
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "Today at a Glance" }).click();
  } else {
    await settingsSidebar.getByRole("link", { name: "Back to Today" }).click();
  }
  await expect(page).toHaveURL(/\/today$/);
});
