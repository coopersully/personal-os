import { expect, test } from "@playwright/test";

test("a person and an agent share one reminder and calendar surface", async ({
  page,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const email = `e2e+${suffix}@example.com`;
  const reminderTitle = `Material reminder ${suffix}`;
  const eventTitle = `Material event ${suffix}`;
  const mobile = testInfo.project.name === "mobile-chromium";
  const primaryNavigation = page.getByRole("navigation", {
    name: mobile ? "Primary" : "Plan",
  });
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
  await page.getByRole("button", { name: "Have an invite? Create an account" }).click();
  await page.getByLabel("Name").fill("E2E Person");
  await page.getByLabel("Invite code").fill("invite_local_e2e_12345");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("LocalTestOnly123!");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Your commitments" })).toBeVisible();
  const applicationSidebar = page.getByRole("complementary", {
    name: "Application Sidebar",
  });
  if (mobile) {
    await expect(applicationSidebar).toBeHidden();
  } else {
    await expect(applicationSidebar).toBeVisible();
  }

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("menuitem", { name: "Reminder" }).click();
  await page.getByLabel("What needs attention?").fill(reminderTitle);
  await page.getByLabel("Notes").fill("Created from the direct manipulation surface.");
  await page.getByRole("button", { name: "Create reminder" }).click();
  await primaryNavigation.getByRole("link", { name: "Reminders" }).click();
  await expect(page.getByText(reminderTitle)).toBeVisible();

  await returnToApp();
  await primaryNavigation.getByRole("link", { name: "Today" }).click();
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

  await primaryNavigation.getByRole("link", { name: "Calendar" }).click();
  if (mobile) {
    await expect(
      page.getByRole("radio", { name: "Day", exact: true, checked: true }),
    ).toBeVisible();
    await page.getByRole("radio", { name: "Week", exact: true }).click();
  }
  await expect(page.getByRole("radio", { name: "Week", exact: true, checked: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Weekends", pressed: true })).toBeVisible();
  await expect(page.getByText("12 AM")).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Agent access" })).toBeVisible();
  await page.getByRole("button", { name: "Agent token" }).click();
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
