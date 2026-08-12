import { expect, test } from "@playwright/test";

test("the repository QA fixture login exposes representative workspace data", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@ilo.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Open ilo" }).click();
  await expect(page.getByRole("heading", { name: "Your commitments" })).toBeVisible();

  await page.goto("/calendar");
  await expect(page.getByText("Product strategy review", { exact: true })).toBeVisible();
  await page.goto("/tasks?view=next");
  await expect(page.getByText("Draft weekly product update", { exact: true })).toBeVisible();
  await page.goto("/mail");
  await expect(page.getByText("Board packet for Friday", { exact: true })).toBeVisible();
  await page.goto("/finances/transactions");
  await expect(page.getByRole("row", { name: /Sq Unknown Popup Uncategorized/ })).toBeVisible();
});

test("agent setup is server-owned, collapsible, and served by ilo", async ({ baseURL, page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@ilo.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Open ilo" }).click();
  await expect(page.getByRole("heading", { name: "Your commitments" })).toBeVisible();
  await page.goto("/settings?section=agents");
  await expect(page.getByRole("heading", { name: "Connect an agent", exact: true })).toBeVisible();

  const connectTrigger = page.getByRole("button", {
    name: /Connect an agent/,
  });
  const setupTrigger = page.getByRole("button", {
    name: /Let the agent set up Ilo/,
  });
  const stepTriggers = [connectTrigger, setupTrigger];
  for (const trigger of stepTriggers) {
    const initialState = await trigger.getAttribute("aria-expanded");
    await trigger.click();
    await expect(trigger).toHaveAttribute(
      "aria-expanded",
      initialState === "true" ? "false" : "true",
    );
  }

  if ((await setupTrigger.getAttribute("aria-expanded")) !== "true") await setupTrigger.click();
  await page.getByRole("button", { name: "Setup protocol details" }).click();
  const source = page.getByRole("link", { name: "View skill source" });
  await expect(source).toHaveAttribute("href", `${baseURL}/skills/ilo-setup/v0.2.0/SKILL.md`);
  const sourceHref = await source.getAttribute("href");
  if (!sourceHref) throw new Error("The Ilo setup skill did not expose a source URL.");
  const sourceResponse = await page.request.get(sourceHref);
  expect(sourceResponse.ok()).toBe(true);
  expect(await sourceResponse.text()).toContain("name: ilo-setup");
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth <= innerWidth + 1),
  ).toBe(true);
});

test("a person and an agent share one reminder and calendar surface", async ({
  page,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const email = `e2e+${suffix}@example.com`;
  const reminderTitle = `Material reminder ${suffix}`;
  const eventTitle = `Material event ${suffix}`;
  const mobile = testInfo.project.name === "mobile-chromium";
  const primaryNavigation = page.getByRole("navigation", {
    name: "Primary",
  });
  const openWorkspace = async (name: "Calendar" | "Tasks") => {
    if (mobile) {
      await primaryNavigation.getByRole("link", { name, exact: true }).click();
      return;
    }
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page
      .getByRole("menu", { name: "Switch workspace" })
      .getByRole("menuitem", { name, exact: true })
      .click();
  };
  const returnToApp = async () => {
    if (mobile) await page.getByRole("button", { name: "Open Navigation" }).click();
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page
      .getByRole("menu", { name: "Switch workspace" })
      .getByRole("menuitem", { name: "Today" })
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
    name: "Application Sidebar",
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
  if (mobile) {
    await primaryNavigation.getByRole("link", { name: "Reminders", exact: true }).click();
  } else {
    await openWorkspace("Tasks");
    await page
      .getByRole("complementary", { name: "Tasks Sidebar" })
      .getByRole("link", { name: "Reminders", exact: true })
      .click();
  }
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
  await expect(page.getByRole("button", { name: "Weekends", pressed: true })).toBeVisible();
  await expect(page.getByText("12 AM", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Weekends", pressed: true }).click();
  await expect(page.getByRole("button", { name: "Weekends", pressed: false })).toBeVisible();
  await page.getByRole("button", { name: "Weekends", pressed: false }).click();
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

  if (mobile) await page.getByRole("button", { name: "Open Navigation" }).click();
  await page.getByRole("button", { name: "Account menu" }).click();
  await page
    .getByRole("menu", { name: "Account menu" })
    .getByRole("menuitem", { name: "Activity" })
    .click();
  if (mobile) await expect(applicationSidebar).toBeHidden();
  await expect(page.getByText("Reminder · created").first()).toBeVisible();
  await expect(page.getByText("Calendar event · created").first()).toBeVisible();

  if (mobile) {
    await page.getByRole("button", { name: "More" }).click();
    await expect(applicationSidebar).toBeVisible();
  }
  await page.getByRole("button", { name: "Account menu" }).click();
  await page
    .getByRole("menu", { name: "Account menu" })
    .getByRole("menuitem", { name: "Settings" })
    .click();
  const settingsSidebar = page.getByRole("complementary", { name: "Settings Sidebar" });
  if (mobile) {
    await expect(settingsSidebar).toBeHidden();
    await page.getByRole("button", { name: "More" }).click();
  }
  await expect(settingsSidebar).toBeVisible();
  await expect(settingsSidebar.getByRole("link", { name: /Workspace$/ })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toHaveCount(0);
  if (mobile) await settingsSidebar.getByRole("button", { name: "Close Navigation" }).click();
  await page.getByLabel("Planning day starts").fill("10:00");
  await page.getByLabel("Planning day ends").fill("18:00");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByLabel("Planning day starts")).toHaveValue("10:00");
  await expect(page.getByLabel("Planning day ends")).toHaveValue("18:00");
  if (mobile) await page.getByRole("button", { name: "More" }).click();
  await settingsSidebar.getByRole("link", { name: "Appearance", exact: true }).click();
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
  if (mobile) await page.getByRole("button", { name: "More" }).click();
  await settingsSidebar.getByRole("link", { name: "Agent access" }).click();
  await expect(page.getByRole("heading", { name: "Connect an agent", exact: true })).toBeVisible();
  const connectionTrigger = page.getByRole("button", { name: /Connect an agent/ });
  if ((await connectionTrigger.getAttribute("aria-expanded")) !== "true") {
    await connectionTrigger.click();
  }
  const agentSetupTrigger = page.getByRole("button", {
    name: /Let the agent set up Ilo/,
  });
  if ((await agentSetupTrigger.getAttribute("aria-expanded")) !== "true") {
    await agentSetupTrigger.click();
  }
  await expect(page.getByRole("textbox", { name: "Ilo MCP URL" })).toHaveValue(/\/mcp$/);
  await page.getByRole("button", { name: "Setup protocol details" }).click();
  await expect(page.getByRole("link", { name: "View skill source" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Mail", checked: true })).toBeVisible();
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
  if (mobile) await page.getByRole("button", { name: "More" }).click();
  await settingsSidebar.getByRole("link", { name: /Workspace$/ }).click();
  await expect(page).toHaveURL(/\/today$/);
});
