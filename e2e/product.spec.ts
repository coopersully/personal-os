import { expect, test } from "@playwright/test";

test("the repository QA fixture login exposes representative workspace data", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@ilo.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();

  await page.goto("/calendar");
  await expect(page.getByText("Product strategy review", { exact: true })).toBeVisible();
  const overlapPin = page.getByRole("button", { name: "Spread 5 overlapping events" });
  await expect(overlapPin).toBeVisible();
  await overlapPin.click();
  await expect(page.getByRole("button", { name: "Collapse 5 overlapping events" })).toBeVisible();
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
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await page.goto("/reviews");
  await expect(page.getByRole("heading", { name: "Reviews", exact: true })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Login" })).toBeVisible();
  await page.getByRole("button", { name: "Have an invite? Create an account" }).click();
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
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  const applicationSidebar = page.getByRole("complementary", {
    name: "Today Sidebar",
  });
  await expect(applicationSidebar).toHaveCount(0);
  if (!mobile) {
    await page.getByRole("button", { name: "Switch workspace" }).click();
    const workspaceMenu = page.getByRole("menu", { name: "Switch workspace" });
    const calendarWorkspace = workspaceMenu.getByRole("menuitem", { name: "Calendar" });
    await calendarWorkspace.hover();
    await expect(page.locator(".workspace-preview")).toHaveCount(0);
    await expect(page).toHaveURL(/\/today$/);
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
  await openWorkspacePage("Tasks", "All");
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByLabel("Type").selectOption("reminder");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText(reminderTitle)).toBeVisible();

  await returnToApp();
  const planningDate = await page.locator("h1 time").getAttribute("datetime");
  if (!planningDate) throw new Error("Today heading did not expose its planning date.");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("menuitem", { name: "Event" }).click();
  await page.getByLabel("Event", { exact: true }).fill(eventTitle);
  await page.getByLabel("Starts").fill(`${planningDate}T00:01`);
  await page.getByLabel("Ends").fill(`${planningDate}T23:59`);
  await page.getByLabel("Location").fill("Desktop overlay");
  await page.getByRole("button", { name: "Create event" }).click();
  await expect(page.getByText(eventTitle)).toBeVisible();
  const todayEvent = page.locator('[data-slot="event-card"]').filter({ hasText: eventTitle });
  const todayEventLayout = await todayEvent.evaluate((card) => {
    const action = card.querySelector<HTMLElement>("button");
    const body = card.querySelector<HTMLElement>('[data-slot="event-card-body"]');
    if (!action || !body) throw new Error("Today event preview is incomplete.");
    const actionStyle = getComputedStyle(action);
    const bodyStyle = getComputedStyle(body);
    return {
      alignItems: actionStyle.alignItems,
      bodyJustifyContent: bodyStyle.justifyContent,
      paddingBottom: actionStyle.paddingBottom,
      paddingLeft: actionStyle.paddingLeft,
      paddingRight: actionStyle.paddingRight,
      paddingTop: actionStyle.paddingTop,
      textAlign: actionStyle.textAlign,
    };
  });
  expect(todayEventLayout.paddingLeft).toBe(todayEventLayout.paddingTop);
  expect(todayEventLayout.paddingRight).toBe(todayEventLayout.paddingBottom);
  expect(Number.parseFloat(todayEventLayout.paddingTop)).toBeGreaterThan(0);
  expect(todayEventLayout.alignItems).toBe("flex-start");
  expect(todayEventLayout.bodyJustifyContent).toBe("flex-start");
  expect(todayEventLayout.textAlign).toBe("left");
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
  const floatingPillColors = await page.locator(".calendar-floating-nav__pill").evaluate((pill) => {
    const primarySwatch = document.createElement("span");
    primarySwatch.style.backgroundColor = "var(--primary)";
    primarySwatch.style.color = "var(--primary-foreground)";
    document.body.append(primarySwatch);
    const colors = {
      background: getComputedStyle(pill).backgroundColor,
      foreground: getComputedStyle(pill).color,
      primaryBackground: getComputedStyle(primarySwatch).backgroundColor,
      primaryForeground: getComputedStyle(primarySwatch).color,
    };
    primarySwatch.remove();
    return colors;
  });
  expect(floatingPillColors.background).toBe(floatingPillColors.primaryBackground);
  expect(floatingPillColors.foreground).toBe(floatingPillColors.primaryForeground);
  await page.locator(".week-calendar").evaluate((calendar) => {
    calendar.scrollTop = 0;
  });
  const weekGridLayout = await page.locator(".week-calendar-grid").evaluate((grid) => {
    const navigation = grid.querySelector<HTMLElement>(".calendar-secondary-app-bar--week");
    const midnightLabel = grid.querySelector<HTMLElement>(".calendar-time-axis li:first-child");
    const todayHeader = grid.querySelector<HTMLElement>(".week-day-header.is-today");
    const todayFadeSurface = grid.querySelector<HTMLElement>(".week-all-day-day.is-today");
    const allDayEvent = grid.querySelector<HTMLElement>(".week-all-day-event");
    const otherHeaders = [...grid.querySelectorAll<HTMLElement>(".week-day-header:not(.is-today)")];
    const todayTimeline = grid.querySelector<HTMLElement>(".week-day-timeline.is-today");
    const otherTimelines = [
      ...grid.querySelectorAll<HTMLElement>(".week-day-timeline:not(.is-today)"),
    ];
    if (
      !navigation ||
      !midnightLabel ||
      !todayHeader ||
      !todayFadeSurface ||
      !todayTimeline ||
      otherHeaders.length < 2 ||
      otherTimelines.length < 2
    ) {
      throw new Error("Week calendar did not render comparable days.");
    }
    const fadeStyle = getComputedStyle(todayFadeSurface, "::after");
    const allDayEventStyle = allDayEvent ? getComputedStyle(allDayEvent) : null;
    const allDayEventBounds = allDayEvent?.getBoundingClientRect();
    const allDaySurfaceBounds = todayFadeSurface.getBoundingClientRect();
    const navigationStyle = getComputedStyle(navigation);
    const weekHeaderGrid = navigation.querySelector<HTMLElement>(
      ".calendar-secondary-app-bar__week-grid",
    );
    const allDayCorner = navigation.querySelector<HTMLElement>(".week-all-day-corner");
    return {
      allDayEventLeftInset: allDayEventBounds && allDayEventBounds.left - allDaySurfaceBounds.left,
      allDayEventRightInset:
        allDayEventBounds && allDaySurfaceBounds.right - allDayEventBounds.right,
      allDayEventZIndex: allDayEvent ? getComputedStyle(allDayEvent).zIndex : null,
      allDayNotchRadius: allDayEventStyle?.getPropertyValue("--week-all-day-notch-size").trim(),
      calendarLine: getComputedStyle(todayTimeline).getPropertyValue("--line").trim(),
      columnGap: getComputedStyle(grid).columnGap,
      fadeBackdropFilter: fadeStyle.backdropFilter,
      fadeBackgroundImage: fadeStyle.backgroundImage,
      fadeBottom: Number.parseFloat(fadeStyle.bottom),
      fadeSurfaceBackground: getComputedStyle(todayFadeSurface).backgroundColor,
      fadeSurfaceTop: todayFadeSurface.getBoundingClientRect().top,
      fadeZIndex: fadeStyle.zIndex,
      foregroundEventOpacity: allDayEventStyle?.opacity ?? null,
      headerBottom: todayHeader.getBoundingClientRect().bottom,
      headerOpacity: getComputedStyle(todayHeader).opacity,
      hourRule: getComputedStyle(todayTimeline).getPropertyValue("--calendar-hour-rule").trim(),
      gutterFadeBottom: allDayCorner
        ? Number.parseFloat(getComputedStyle(allDayCorner, "::after").bottom)
        : null,
      midnightLabelTop: midnightLabel.getBoundingClientRect().top,
      navigationBottom: navigation.getBoundingClientRect().bottom,
      navigationBackground: navigationStyle.backgroundColor,
      navigationHeight: navigation.getBoundingClientRect().height,
      otherHeaderBackgrounds: otherHeaders.map(
        (header) => getComputedStyle(header).backgroundColor,
      ),
      otherTimelineBackgrounds: otherTimelines.map(
        (timeline) => getComputedStyle(timeline).backgroundColor,
      ),
      timelineBorderLeft: getComputedStyle(todayTimeline).borderLeftWidth,
      todayHeaderBackground: getComputedStyle(todayHeader).backgroundColor,
      todayTimelineBackground: getComputedStyle(todayTimeline).backgroundColor,
      weekHeaderGridBackground: weekHeaderGrid
        ? getComputedStyle(weekHeaderGrid).backgroundColor
        : null,
    };
  });
  expect(weekGridLayout.columnGap).toBe("1px");
  expect(weekGridLayout.fadeBackdropFilter).toContain("blur(");
  expect(weekGridLayout.fadeBackgroundImage).toContain("linear-gradient");
  expect(weekGridLayout.fadeBackgroundImage).toContain("rgba(");
  expect(weekGridLayout.navigationBackground).toBe("rgba(0, 0, 0, 0)");
  expect(weekGridLayout.weekHeaderGridBackground).toBe("rgba(0, 0, 0, 0)");
  expect(weekGridLayout.fadeSurfaceBackground).toBe("rgba(0, 0, 0, 0)");
  expect(weekGridLayout.fadeSurfaceTop).toBeGreaterThanOrEqual(weekGridLayout.headerBottom - 1);
  expect(weekGridLayout.fadeSurfaceTop).toBeLessThan(weekGridLayout.navigationBottom);
  expect(weekGridLayout.fadeBottom).toBeLessThanOrEqual(-32);
  expect(weekGridLayout.gutterFadeBottom).toBe(0);
  expect(weekGridLayout.fadeZIndex).toBe("0");
  expect(weekGridLayout.headerOpacity).toBe("1");
  if (weekGridLayout.foregroundEventOpacity) {
    expect(weekGridLayout.foregroundEventOpacity).toBe("1");
  }
  if (weekGridLayout.allDayEventZIndex) {
    expect(weekGridLayout.allDayEventZIndex).toBe("2");
    expect(weekGridLayout.allDayNotchRadius).toBe("8px");
    expect(weekGridLayout.allDayEventLeftInset).toBeCloseTo(
      weekGridLayout.allDayEventRightInset as number,
      0,
    );
    expect(weekGridLayout.allDayEventLeftInset).toBeGreaterThanOrEqual(3);
    expect(weekGridLayout.allDayEventLeftInset).toBeLessThanOrEqual(5);
  }
  expect(weekGridLayout.hourRule).not.toBe(weekGridLayout.calendarLine);
  expect(weekGridLayout.midnightLabelTop).toBeGreaterThanOrEqual(weekGridLayout.navigationBottom);
  expect(weekGridLayout.timelineBorderLeft).toBe("0px");
  expect(new Set(weekGridLayout.otherHeaderBackgrounds).size).toBeGreaterThan(1);
  expect(new Set(weekGridLayout.otherTimelineBackgrounds).size).toBeGreaterThan(1);
  expect(weekGridLayout.todayHeaderBackground).not.toBe(weekGridLayout.otherHeaderBackgrounds[0]);
  expect(weekGridLayout.todayTimelineBackground).not.toBe(
    weekGridLayout.otherTimelineBackgrounds[0],
  );
  expect(weekGridLayout.todayHeaderBackground).toBe(weekGridLayout.todayTimelineBackground);
  const calendarHeading = page.locator('[data-slot="workspace-app-bar-identity"] h2');
  const initialCalendarHeading = await calendarHeading.innerText();
  await page.getByRole("button", { name: "Next week" }).click();
  await expect.poll(() => calendarHeading.innerText()).not.toBe(initialCalendarHeading);
  await page.getByRole("button", { name: "Previous week" }).click();
  await expect.poll(() => calendarHeading.innerText()).toBe(initialCalendarHeading);
  await page.getByRole("radio", { name: "Month" }).click();
  await expect(page.getByRole("radio", { name: "Month", checked: true })).toBeVisible();
  const monthDayBackgrounds = await page.locator(".month-grid").evaluate((grid) => {
    const today = grid.querySelector<HTMLElement>(".month-day.is-today");
    const other = grid.querySelector<HTMLElement>(".month-day:not(.is-today):not(.is-outside)");
    if (!today || !other) throw new Error("Month calendar did not render comparable days.");
    return {
      other: getComputedStyle(other).backgroundColor,
      today: getComputedStyle(today).backgroundColor,
    };
  });
  expect(monthDayBackgrounds.today).toBe(monthDayBackgrounds.other);
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

  await returnToApp();
  await openWorkspace("Settings");
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
    page.getByRole("navigation", { name: "Top navigation" }).getByText("Account"),
  ).toBeVisible();
  if (mobile) {
    await expect(settingsSidebar).toBeHidden();
    await expect(
      page.getByRole("navigation", { name: "Workspace dock" }).getByText("Settings"),
    ).toBeVisible();
  } else {
    await expect(settingsSidebar).toBeVisible();
    await expect(settingsSidebar.getByRole("button", { name: "Switch workspace" })).toContainText(
      "Settings",
    );
  }
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toHaveCount(0);
  await page.getByLabel("Planning day starts").fill("10:00");
  await page.getByLabel("Planning day ends").fill("18:00");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByLabel("Planning day starts")).toHaveValue("10:00");
  await expect(page.getByLabel("Planning day ends")).toHaveValue("18:00");
  await openSettingsSection("Activity");
  await expect(page.getByText("Reminder · created").first()).toBeVisible();
  await expect(page.getByText("Calendar event · created").first()).toBeVisible();
  await openSettingsSection("Appearance");
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  const darkAppearance = page.getByRole("radio", { name: "Dark" });
  await darkAppearance.click();
  await expect(darkAppearance).toBeChecked();
  await expect
    .poll(() => page.locator("html").evaluate((element) => element.classList.contains("dark")))
    .toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await openSettingsSection("Connected agents");
  await expect(page.getByRole("heading", { name: "Connected agents", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "nohmi MCP URL" })).toHaveValue(/\/mcp$/);
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
  await expect(mailAction).toContainText("Connect an MCP-compatible agent host to nohmi.");
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
    await settingsSidebar.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "Today at a Glance" }).click();
  }
  await expect(page).toHaveURL(/\/today$/);
});
