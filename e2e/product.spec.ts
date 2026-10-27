import { expect, type Page, test } from "@playwright/test";
import { setSettingTime } from "./settings-controls.js";
import { fixtureWeather } from "./weather-fixtures.js";

import { revealWorkspaceOptions } from "./workspace-header-controls.js";

async function selectCalendarView(page: Page, view: string) {
  const picker = page.getByRole("button", { name: /^Calendar view:/ });
  const changed =
    (await picker.getAttribute("aria-label")) !== `Calendar view: ${view.toLowerCase()}`;
  await picker.click();
  const saved = changed
    ? page.waitForResponse(
        (response) =>
          response.url().includes("/workspaces/calendar/settings") &&
          response.request().method() === "PATCH",
      )
    : null;
  await page.getByRole("menuitemradio", { name: view, exact: true }).click();
  if (saved) expect((await saved).ok()).toBeTruthy();
  await expect(
    page.getByRole("button", { name: `Calendar view: ${view.toLowerCase()}`, exact: true }),
  ).toBeVisible();
}

test("the repository QA fixture login exposes representative workspace data", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();

  await page.goto(`/calendar?follow=0&view=${test.info().project.use.isMobile ? "day" : "week"}`);
  await expect(page.getByText("Product strategy review", { exact: true })).toBeVisible();
  // Overlaps retain separate, directly accessible lanes in both Calendar layouts.
  const overlappingCards = page.locator(".calendar-timeline-event").filter({
    hasText:
      /^(Design critique|Customer research debrief|Roadmap check-in|Partner launch sync|Hiring calibration)/,
  });
  await expect(overlappingCards).toHaveCount(5);
  const lanes = await overlappingCards.evaluateAll((cards) =>
    cards
      .map((card) => {
        const bounds = card.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, width: bounds.width };
      })
      .sort((left, right) => left.left - right.left),
  );
  for (let index = 0; index < lanes.length; index += 1) {
    const lane = lanes[index];
    const firstLane = lanes[0];
    if (!lane || !firstLane) throw new Error("Missing Calendar overlap lane geometry.");
    expect(lane.width).toBeGreaterThan(0);
    expect(Math.abs(lane.width - firstLane.width)).toBeLessThan(1);
    if (index > 0) {
      const previousLane = lanes[index - 1];
      if (!previousLane) throw new Error("Missing previous Calendar overlap lane geometry.");
      expect(lane.left).toBeGreaterThanOrEqual(previousLane.right);
    }
    await expect(overlappingCards.nth(index)).toBeEnabled();
  }
  await expect(
    page.getByRole("button", { name: /^(Spread|Collapse) 5 overlapping events$/ }),
  ).toHaveCount(0);
  const eventAction = overlappingCards.filter({ hasText: "Design critique" });
  await eventAction.scrollIntoViewIfNeeded();
  await eventAction.focus();
  await expect(eventAction).toBeFocused();
  await eventAction.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goto("/tasks");
  await page.getByRole("button", { name: /^Tasks view:/ }).click();
  await page.getByRole("menuitemradio", { name: "All Lists", exact: true }).click();
  await page
    .getByRole("list", { name: "Lists", exact: true })
    .getByText("Work", { exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Tasks view: Work", exact: true })).toBeVisible();
  await expect(page.getByText("Draft weekly program update", { exact: true })).toBeVisible();
  await page.goto("/mail");
  await expect(page.getByText("Board packet for Friday", { exact: true })).toBeVisible();
  await page.goto("/finances/transactions?view=table");
  const unknownTransaction = page.getByRole(test.info().project.use.isMobile ? "button" : "row", {
    name: "Open SQ *UNKNOWN POPUP 8821 transaction",
    exact: true,
  });
  await expect(unknownTransaction).toBeVisible();
  const transactionDetails = test.info().project.use.isMobile
    ? page.locator("dl").filter({ has: unknownTransaction })
    : unknownTransaction;
  await expect(transactionDetails.getByText("Uncategorized", { exact: true })).toBeVisible();
});

test("desktop navigation fills the viewport while long content scrolls independently", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Desktop shell geometry");
  // This flow checks three workspaces and nine Calendar view/viewport combinations, then restores settings.
  test.setTimeout(90_000);
  await fixtureWeather(page);
  await page.setViewportSize({ width: 1280, height: 480 });
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
  const settingsPath = "/v1/workspaces/calendar/settings";
  const originalResponse = await page.request.get(settingsPath);
  expect(originalResponse.ok()).toBeTruthy();
  const original = await originalResponse.json();
  try {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(page.locator(".app-shell")).toHaveCSS("transition-duration", "0.14s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .locator(".app-shell")
        .evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration)),
    ).toBeLessThanOrEqual(0.00001);
    await page.emulateMedia({ reducedMotion: "no-preference" });

    for (const workspace of ["Tasks", "Mail", "Finances"]) {
      await page
        .getByRole("navigation", { name: "Workspace navigation" })
        .getByRole("link", { name: workspace, exact: true })
        .click();
      const sidebar = page.getByRole("complementary", { name: `${workspace} Sidebar` });
      await expect(sidebar).toHaveAttribute("data-slot", "sidebar");
      await expect(sidebar.locator('[data-slot="sidebar-header"]')).toHaveText(workspace);
      const header = page.getByRole("navigation", { name: "Top navigation", exact: true });
      const breadcrumbs = header.getByRole("navigation", { name: "Page breadcrumbs" });
      const owner = breadcrumbs.getByRole("link", { name: workspace, exact: true });
      await expect(owner).toBeVisible();
      await expect(owner).toHaveAttribute("href", `/${workspace.toLowerCase()}`);
      const title = header.locator(".workspace-app-bar__page-title .workspace-app-bar__title");
      await expect(title).toBeVisible();
      await expect(title).toContainText(/\S/);
      await expect(page.locator(".workspace-rail .workspace-icon")).toHaveCount(0);
      const handle = page.getByRole("separator", { name: "Collapse or show sidebar" });
      const edge = await handle.boundingBox();
      if (!edge) throw new Error("Missing sidebar drag handle");
      await page.mouse.move(edge.x, edge.y + 100);
      await page.mouse.down();
      await page.mouse.move(edge.x - 220, edge.y + 100);
      await page.mouse.up();
      await expect(sidebar).toHaveAttribute("data-state", "collapsed");
      const iconLabel =
        workspace === "Mail" ? "Starred" : workspace === "Tasks" ? "All" : "Overview";
      await sidebar.getByRole("link", { name: iconLabel, exact: true }).hover();
      await expect(page.getByRole("tooltip", { name: iconLabel, exact: true })).toBeVisible();
      await page.keyboard.press("Control+b");
      await expect(sidebar).toHaveAttribute("data-state", "expanded");
      await page.keyboard.press("Control+b");
      await expect(sidebar).toHaveAttribute("data-state", "collapsed");
      await handle.press("ArrowRight");
      await expect(sidebar).toHaveAttribute("data-state", "expanded");
      if (workspace === "Tasks") {
        await sidebar.getByRole("link", { name: "All Lists", exact: true }).focus();
        await page.keyboard.press("Control+b");
        await expect(handle).toBeFocused();
      }
      await handle.press("End");
      await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(256);
      const colors = await page
        .locator("body, .workspace-app-bar, .workspace-secondary-app-bar")
        .evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).backgroundColor),
        );
      expect(new Set(colors).size).toBe(1);
    }
    const railHandle = page.getByRole("separator", { name: "Minimize workspace rail" });
    await railHandle.press("Enter");
    const compactPicker = page.getByRole("button", { name: "Switch workspace", exact: true });
    await expect(compactPicker).toBeFocused();
    await compactPicker.press("Enter");
    await page.getByRole("menuitem", { name: "Show workspace rail" }).press("Enter");
    await expect(
      page
        .getByRole("navigation", { name: "Workspace navigation" })
        .getByRole("link", { name: "Finances", exact: true }),
    ).toBeFocused();
    const railEdge = await page
      .getByRole("separator", { name: "Minimize workspace rail" })
      .boundingBox();
    if (!railEdge) throw new Error("Missing rail drag handle");
    await page.mouse.move(railEdge.x, railEdge.y + 100);
    await page.mouse.down();
    await page.mouse.move(railEdge.x - 60, railEdge.y + 100);
    await page.mouse.up();
    await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toHaveCount(0);
    const switcher = page.getByRole("button", { name: "Switch workspace", exact: true });
    await expect(switcher).toBeVisible();
    await switcher.click();
    await page.getByRole("menuitem", { name: "Calendar", exact: true }).click();
    const headerPadding = await page.locator(".workspace-app-bar").evaluate((header) => {
      const style = getComputedStyle(header);
      return { left: style.paddingLeft, right: style.paddingRight };
    });
    expect(headerPadding.left).toBe(headerPadding.right);
    expect(Number.parseFloat(headerPadding.left)).toBeGreaterThan(0);
    const storedSidebar = await page.evaluate(() => localStorage.getItem("nohmi.sidebar-width.v1"));
    await page.keyboard.press("Control+b");
    expect(await page.evaluate(() => localStorage.getItem("nohmi.sidebar-width.v1"))).toBe(
      storedSidebar,
    );
    for (const view of ["Day", "Week", "Month"]) {
      await selectCalendarView(page, view);
      const axes = page.locator("[data-calendar-axis]:not(.is-today)");
      await expect(axes.first()).toBeVisible();
      const canvasColor = await page
        .locator("body")
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      await expect(axes.first()).toHaveCSS("background-color", canvasColor);
      const baseCell = page
        .locator(
          view === "Month"
            ? ".month-day:not(.is-today):not(.is-outside)"
            : view === "Week"
              ? ".week-day-timeline:nth-of-type(odd):not(.is-today)"
              : ".calendar-timeline",
        )
        .first();
      await expect(baseCell).toHaveCSS("background-color", canvasColor);
      await expect
        .poll(
          async () =>
            new Set(
              await axes.evaluateAll((elements) =>
                elements.map((element) => getComputedStyle(element).backgroundColor),
              ),
            ).size,
        )
        .toBe(1);
      await expect(page.locator('[data-calendar-axis="left"]')).toHaveCount(
        view === "Month" ? 0 : 1,
      );
      if (view === "Day") {
        await expect(page.locator(".calendar-day-view .week-all-day-day.is-today")).toHaveCount(0);
      }
      if (view === "Month") {
        const todayColor = await page
          .locator(".month-day.is-today")
          .evaluate((element) => getComputedStyle(element).backgroundColor);
        const otherColor = await page
          .locator(".month-day:not(.is-today):not(.is-outside)")
          .first()
          .evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(todayColor).not.toBe(otherColor);
      }
      if (view === "Week") {
        const columnColor = await page
          .locator(".week-day-timeline.is-today")
          .evaluate((element) => getComputedStyle(element).backgroundColor);
        await expect(page.locator(".week-day-header.is-today")).toHaveCSS(
          "background-color",
          columnColor,
        );

        await expect(page.locator(".week-all-day-corner")).toHaveCSS("background-image", "none");
      }
    }

    for (const size of [
      { width: 1280, height: 1100 },
      { width: 900, height: 700 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      for (const view of ["Day", "Week", "Month"]) {
        await selectCalendarView(page, view);
        await expect(
          page.getByRole("navigation", {
            name: `Calendar ${view.toLowerCase()} navigation`,
            exact: true,
          }),
        ).toBeVisible();
        const bounds = await page.locator(".calendar-page").boundingBox();
        expect(
          Math.abs((bounds?.y ?? 0) + (bounds?.height ?? 0) - size.height),
        ).toBeLessThanOrEqual(1);
        if (view === "Month") {
          const grid = await page.locator(".month-grid").boundingBox();
          expect((grid?.y ?? 0) + (grid?.height ?? 0)).toBeGreaterThanOrEqual(size.height - 1);
        }
      }
    }
    await page.setViewportSize({ width: 1280, height: 480 });
    await page.reload();
    await expect(switcher).toBeVisible();
    await switcher.click();
    await page.getByRole("menuitem", { name: "Show workspace rail", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Workspace navigation" })
      .getByRole("link", { name: "Settings" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Profile", exact: true, level: 2 }),
    ).toBeVisible();
    for (const selector of [".workspace-rail", ".sidebar"]) {
      const bounds = await page.locator(selector).boundingBox();
      expect(bounds?.y).toBe(0);
      expect(bounds?.height).toBe(480);
    }
    const layout = await page.locator("main").evaluate((main) => ({
      documentHeight: document.documentElement.scrollHeight,
      viewport: innerHeight,
      overflow: getComputedStyle(main).overflowY,
      scrolls: main.scrollHeight > main.clientHeight,
    }));
    expect(layout.documentHeight).toBe(layout.viewport);
    expect(layout.overflow).toBe("auto");
    expect(layout.scrolls).toBe(true);
  } finally {
    const latestResponse = await page.request.get(settingsPath);
    expect(latestResponse.ok()).toBeTruthy();
    const latest = await latestResponse.json();
    const restored = await page.request.patch(settingsPath, {
      headers: { origin: new URL(page.url()).origin },
      data: {
        expectedRevision: latest.revision,
        preferences: { calendarView: original.preferences.calendarView },
      },
    });
    expect(restored.ok()).toBeTruthy();
  }
});

test("Reviews and agent controls separate decisions from configuration", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
  const rulesResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/mail/rules") && response.request().method() === "GET",
  );
  await page.goto("/settings?page=mail");
  await expect(page.getByRole("heading", { name: "Mail", exact: true, level: 1 })).toBeVisible();
  const { rules } = (await (await rulesResponse).json()) as {
    rules: { id: string; name: string }[];
  };
  const rule = rules.find((candidate) => candidate.name === "Fixture newsletters");
  if (!rule) throw new Error("Missing fixture review rule");
  await page.getByRole("button", { name: /\d+ items? needs? review/ }).click();
  const dialog = page.getByRole("dialog", { name: "Mail reviews" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Later", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.goto(`/settings?page=mail&review=${encodeURIComponent(`mail-rule:${rule.id}`)}`);
  const activate = dialog.getByRole("button", { name: "Activate reviewed rule" });
  await expect(activate).toBeEnabled();
  await expect(dialog.getByText(/Rule scope:/)).toBeVisible();
  await expect(dialog.getByText("Future actions", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/settings\?page=mail&review=mail-rule/);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page).toHaveURL(/settings\?page=mail$/);
  await expect(page.getByRole("heading", { name: "Mail", exact: true, level: 1 })).toBeVisible();

  await page.goto("/settings?page=security&subpage=workspace-access&workspace=mail");
  await expect(page.getByRole("heading", { name: "Workspace Access", level: 1 })).toBeVisible();
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
  await page.goto("/mail?review=open");
  await expect(page.getByText("You’re caught up")).toBeVisible();
});

test("a person and an agent share one reminder and calendar surface", async ({
  page,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const email = `e2e+${suffix}@example.com`;
  const reminderTitle = `Material reminder ${suffix}`;
  const eventTitle = `Material event ${suffix}`;
  const allDayTitle = `All-day ${eventTitle} with a long descriptive occasion title`;
  const mobile = testInfo.project.name === "mobile-chromium";
  // Desktop links and the narrow dock share destination names.
  const openWorkspace = async (name: string) => {
    if (!mobile) {
      await page
        .getByRole("navigation", { name: "Workspace navigation" })
        .getByRole("link", { name, exact: true })
        .click();
      return;
    }
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page
      .getByRole("menu", { name: "Switch workspace" })
      .getByRole("menuitem", { name, exact: true })
      .click();
  };
  const returnToApp = () => openWorkspace("Today at a Glance");
  // A workspace's own pages live in its sidebar on desktop and in the dock
  // section pages when narrow.
  const openWorkspacePage = async (workspace: string, name: string) => {
    if (mobile) {
      await page
        .getByRole("navigation", { name: "Workspace sections" })
        .getByRole("link", { name: workspace === "Tasks" ? "views" : "mailboxes", exact: true })
        .click();
      await page.getByRole("main").getByRole("link", { name, exact: true }).click();
      return;
    }
    await page
      .getByRole("complementary", { name: `${workspace} Sidebar` })
      .getByRole("link", { name, exact: true })
      .click();
  };

  await page.goto("/login");
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
  await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
  const applicationSidebar = page.getByRole("complementary", {
    name: "Today Sidebar",
  });
  await expect(applicationSidebar).toHaveCount(0);
  if (!mobile) {
    const rail = page.getByRole("navigation", { name: "Workspace navigation" });
    await expect(rail.getByRole("link")).toHaveCount(6);
    const calendarWorkspace = rail.getByRole("link", { name: "Calendar" });
    await calendarWorkspace.hover();
    await expect(page.locator(".workspace-preview")).toHaveCount(0);
    await expect(page).toHaveURL(/\/today$/);
    await page.keyboard.press("Escape");
    await expect(page.locator(".workspace-preview")).toHaveCount(0);
    await expect(page).toHaveURL(/\/today$/);
  }

  await page.keyboard.press("ControlOrMeta+k");
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
  await openWorkspace("Calendar");
  await page.getByRole("combobox", { name: "Search Calendar" }).fill("new event");
  await page.getByRole("option", { name: /New event/ }).click();
  await page.getByLabel("Event", { exact: true }).fill(eventTitle);
  await page.getByLabel("Starts").fill(`${planningDate}T00:01`);
  await page.getByLabel("Ends").fill(`${planningDate}T23:59`);
  await page.getByLabel("Location").fill("Desktop overlay");
  await page.getByRole("dialog").getByRole("button", { name: "Create event" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await returnToApp();
  await expect(page.getByText(eventTitle)).toBeVisible();
  if (mobile) await page.getByRole("button", { name: "Expand schedule" }).click();
  const todayEvent = page
    .locator(".today-schedule .calendar-timeline-event")
    .filter({ hasText: eventTitle });
  await expect(todayEvent).toBeVisible();
  await expect(todayEvent).toContainText("Desktop overlay");
  const todayEventLayout = await todayEvent.evaluate((action) => {
    const actionStyle = getComputedStyle(action);
    const bounds = action.getBoundingClientRect();
    const timeline = action.closest(".calendar-timeline")?.getBoundingClientRect();
    if (!timeline) throw new Error("Today event is missing its shared Calendar timeline.");
    return {
      flexDirection: actionStyle.flexDirection,
      paddingBottom: actionStyle.paddingBottom,
      paddingLeft: actionStyle.paddingLeft,
      paddingRight: actionStyle.paddingRight,
      paddingTop: actionStyle.paddingTop,
      textAlign: actionStyle.textAlign,
      withinTimeline: bounds.left >= timeline.left && bounds.right <= timeline.right,
    };
  });
  expect(todayEventLayout.paddingLeft).toBe(todayEventLayout.paddingRight);
  expect(todayEventLayout.paddingTop).toBe(todayEventLayout.paddingBottom);
  expect(Number.parseFloat(todayEventLayout.paddingTop)).toBeGreaterThan(0);
  expect(todayEventLayout.flexDirection).toBe("column");
  expect(todayEventLayout.textAlign).toBe("left");
  expect(todayEventLayout.withinTimeline).toBe(true);
  await openWorkspace("Calendar");
  await page.getByRole("combobox", { name: "Search Calendar" }).fill("new event");
  await page.getByRole("option", { name: /New event/ }).click();
  await page.getByLabel("Event", { exact: true }).fill(allDayTitle);
  await page.getByLabel("Starts").fill(`${planningDate}T00:00`);
  await page.getByLabel("Ends").fill(`${planningDate}T23:59`);
  await page.getByLabel("All day").check();
  await page.getByRole("dialog").getByRole("button", { name: "Create event" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await returnToApp();
  if (mobile) await page.getByRole("button", { name: "Expand schedule" }).click();
  await expect(page.getByText(allDayTitle)).toBeVisible();
  await expect(page.getByRole("button", { name: `All day ${allDayTitle}.` })).toBeVisible();
  const todayLayout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(todayLayout.documentWidth).toBeLessThanOrEqual(todayLayout.viewportWidth + 1);
  // Compare with the configured device width: mobile overflow can enlarge
  // innerWidth too, making documentWidth <= innerWidth a false positive.
  const viewportWidth = page.viewportSize()?.width;
  if (!viewportWidth) throw new Error("The acceptance viewport is missing.");
  expect(todayLayout.documentWidth).toBeLessThanOrEqual(viewportWidth + 1);
  expect(todayLayout.viewportWidth).toBeLessThanOrEqual(viewportWidth + 1);

  if (mobile) {
    const eventAction = todayEvent;
    await eventAction.tap();
    await expect(page.getByRole("menuitem", { name: "View Event in Calendar" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(eventAction).toBeFocused();
    const switcher = page.getByRole("button", { name: "Switch workspace" });
    const target = await switcher.boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(24);
    expect(target?.height).toBeGreaterThanOrEqual(24);
    await switcher.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu", { name: "Switch workspace" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(switcher).toBeFocused();
    await switcher.tap();
    await expect(page.getByRole("menu", { name: "Switch workspace" })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await openWorkspace("Calendar");
  if (mobile) {
    await expect(
      page.getByRole("button", { name: "Calendar view: day", exact: true }),
    ).toBeVisible();
    await selectCalendarView(page, "Week");
  }
  await expect(
    page.getByRole("button", { name: "Calendar view: week", exact: true }),
  ).toBeVisible();
  if (mobile) {
    await page.getByRole("button", { name: "Calendar view: week", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Today", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  } else {
    await expect(page.getByRole("button", { name: "Today", exact: true })).toBeVisible();
  }
  const navigateCalendarPeriod = async (name: string) => {
    if (mobile) {
      await page.getByRole("button", { name: /^Calendar view:/ }).click();
      await page.getByRole("menuitem", { name, exact: true }).click();
    } else {
      await page.getByRole("button", { name, exact: true }).click();
    }
  };
  await expect(page.getByText("12 AM", { exact: true })).toBeVisible();
  const floatingPillColors = await page.locator(".calendar-floating-nav__pill").evaluate((pill) => {
    const swatch = document.createElement("span");
    swatch.style.backgroundColor = "var(--navigation-surface)";
    swatch.style.color = "var(--workspace-calendar-accent)";
    pill.append(swatch);
    const style = getComputedStyle(pill);
    const material = getComputedStyle(swatch);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not inspect navigation contrast");
    const pixel = (background: string, foreground?: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = background;
      context.fillRect(0, 0, 1, 1);
      if (foreground) {
        context.fillStyle = foreground;
        context.fillRect(0, 0, 1, 1);
      }
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const luminance = (rgb: number[]) =>
      rgb.slice(0, 3).reduce((sum, channel, index) => {
        const value = channel / 255;
        return (
          sum +
          (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][index]!
        );
      }, 0);
    const background = pixel(
      getComputedStyle(document.body).backgroundColor,
      style.backgroundColor,
    );
    const foreground = pixel(style.color);
    const light = Math.max(luminance(background), luminance(foreground));
    const dark = Math.min(luminance(background), luminance(foreground));
    const colors = {
      background: style.backgroundColor,
      foreground: style.color,
      navigationBackground: material.backgroundColor,
      workspaceForeground: material.color,
      alpha: pixel(style.backgroundColor)[3]! / 255,
      backdropFilter: style.backdropFilter,
      borderWidth: style.borderWidth,
      contrast: (light + 0.05) / (dark + 0.05),
    };
    swatch.remove();
    return colors;
  });
  expect(floatingPillColors.background).toBe(floatingPillColors.navigationBackground);
  expect(floatingPillColors.foreground).toBe(floatingPillColors.workspaceForeground);
  expect(floatingPillColors.alpha).toBeCloseTo(0.84, 2);
  expect(floatingPillColors.backdropFilter).toBe("blur(20px)");
  expect(floatingPillColors.borderWidth).toBe("0px");
  expect(floatingPillColors.contrast).toBeGreaterThanOrEqual(3);
  const calendarActions = page.getByRole("navigation", { name: "Calendar actions" });
  await expect(calendarActions.getByRole("button")).toHaveCount(2);
  await expect(
    calendarActions.getByRole("button", { name: "Choose date", exact: true }),
  ).toBeVisible();
  await expect(
    calendarActions.getByRole("button", { name: "Create event", exact: true }),
  ).toBeVisible();
  await expect(
    calendarActions.getByRole("button", { name: "Search calendar", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Search Calendar", exact: true })).toBeVisible();
  for (const action of await page
    .getByRole("navigation", { name: "Calendar actions" })
    .getByRole("button")
    .all()) {
    const bounds = await action.boundingBox();
    expect(bounds?.width).toBeCloseTo(44, 3);
    expect(bounds?.height).toBeCloseTo(44, 3);
  }
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
      !allDayEvent ||
      !todayTimeline ||
      otherHeaders.length < 2 ||
      otherTimelines.length < 2
    ) {
      throw new Error("Week calendar did not render comparable days.");
    }
    const fadeStyle = getComputedStyle(todayFadeSurface, "::after");
    const allDayEventStyle = getComputedStyle(allDayEvent);
    const allDayEventBounds = allDayEvent.getBoundingClientRect();
    const allDaySurfaceBounds = todayFadeSurface.getBoundingClientRect();
    const navigationStyle = getComputedStyle(navigation);
    const weekHeaderGrid = navigation.querySelector<HTMLElement>(
      ".calendar-secondary-app-bar__week-grid",
    );
    const allDayCorner = navigation.querySelector<HTMLElement>(".week-all-day-corner");
    return {
      allDayEventLeftInset: allDayEventBounds.left - allDaySurfaceBounds.left,
      allDayEventRightInset: allDaySurfaceBounds.right - allDayEventBounds.right,
      allDayEventZIndex: allDayEventStyle.zIndex,
      allDayBorderRadius: allDayEventStyle.borderRadius,
      allDayMask: allDayEventStyle.maskImage,
      calendarLine: getComputedStyle(todayTimeline).getPropertyValue("--line").trim(),
      columnGap: getComputedStyle(grid).columnGap,
      fadeBackdropFilter: fadeStyle.backdropFilter,
      fadeBackgroundImage: fadeStyle.backgroundImage,
      fadeBottom: Number.parseFloat(fadeStyle.bottom),
      fadeSurfaceBackground: getComputedStyle(todayFadeSurface).backgroundColor,
      fadeSurfaceTop: todayFadeSurface.getBoundingClientRect().top,
      fadeZIndex: fadeStyle.zIndex,
      foregroundEventOpacity: allDayEventStyle.opacity,
      headerBottom: todayHeader.getBoundingClientRect().bottom,
      headerOpacity: getComputedStyle(todayHeader).opacity,
      hourRule: getComputedStyle(todayTimeline).getPropertyValue("--calendar-hour-rule").trim(),
      gutterFadeContent: allDayCorner ? getComputedStyle(allDayCorner, "::after").content : null,
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
  expect(weekGridLayout.navigationBackground).toBe(
    await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor),
  );
  expect(weekGridLayout.weekHeaderGridBackground).toBe("rgba(0, 0, 0, 0)");
  expect(weekGridLayout.fadeSurfaceBackground).toBe("rgba(0, 0, 0, 0)");
  expect(weekGridLayout.fadeSurfaceTop).toBeGreaterThanOrEqual(weekGridLayout.headerBottom - 1);
  expect(weekGridLayout.fadeSurfaceTop).toBeLessThan(weekGridLayout.navigationBottom);
  expect(weekGridLayout.fadeBottom).toBeLessThanOrEqual(-32);
  expect(weekGridLayout.gutterFadeContent).toBe("none");
  expect(weekGridLayout.fadeZIndex).toBe("0");
  expect(weekGridLayout.headerOpacity).toBe("1");
  expect(weekGridLayout.foregroundEventOpacity).toBe("1");
  expect(weekGridLayout.allDayEventZIndex).toBe("2");
  expect(weekGridLayout.allDayBorderRadius).toBe("6px");
  expect(weekGridLayout.allDayMask).toBe("none");
  expect(weekGridLayout.allDayEventLeftInset).toBeCloseTo(weekGridLayout.allDayEventRightInset, 0);
  expect(weekGridLayout.allDayEventLeftInset).toBeGreaterThanOrEqual(3);
  expect(weekGridLayout.allDayEventLeftInset).toBeLessThanOrEqual(5);
  expect(weekGridLayout.hourRule).not.toBe(weekGridLayout.calendarLine);
  expect(weekGridLayout.midnightLabelTop + 0.01).toBeGreaterThanOrEqual(
    weekGridLayout.navigationBottom,
  );
  // Functional day-grid separators stay visible independently of the tinted surfaces.
  expect(weekGridLayout.timelineBorderLeft).toBe("1px");
  expect(new Set(weekGridLayout.otherHeaderBackgrounds).size).toBe(1);
  expect(new Set(weekGridLayout.otherTimelineBackgrounds).size).toBeGreaterThan(1);
  expect(weekGridLayout.todayHeaderBackground).not.toBe(weekGridLayout.otherHeaderBackgrounds[0]);
  expect(weekGridLayout.todayTimelineBackground).not.toBe(
    weekGridLayout.otherTimelineBackgrounds[0],
  );
  expect(weekGridLayout.todayHeaderBackground).toBe(weekGridLayout.todayTimelineBackground);
  const calendarHeading = page.locator('[data-slot="workspace-app-bar-title"] h2');
  const initialCalendarHeading = await calendarHeading.innerText();
  await navigateCalendarPeriod("Next week");
  await expect.poll(() => calendarHeading.innerText()).not.toBe(initialCalendarHeading);
  await navigateCalendarPeriod("Previous week");
  await expect.poll(() => calendarHeading.innerText()).toBe(initialCalendarHeading);
  await selectCalendarView(page, "Month");
  const monthDayBackgrounds = await page.locator(".month-grid").evaluate((grid) => {
    const today = grid.querySelector<HTMLElement>(".month-day.is-today");
    const other = grid.querySelector<HTMLElement>(".month-day:not(.is-today):not(.is-outside)");
    if (!today || !other) throw new Error("Month calendar did not render comparable days.");
    return {
      other: getComputedStyle(other).backgroundColor,
      today: getComputedStyle(today).backgroundColor,
    };
  });
  expect(monthDayBackgrounds.today).not.toBe(monthDayBackgrounds.other);
  const calendarLayout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(calendarLayout.documentWidth).toBeLessThanOrEqual(calendarLayout.viewportWidth + 1);
  await selectCalendarView(page, "Day");
  await expect(
    page.getByRole("region", { name: "24-hour schedule with 15-minute marks" }),
  ).toBeVisible();
  await navigateCalendarPeriod("Today");

  await returnToApp();
  await openWorkspace("Settings");
  // The account utility is a tenant of the shell: same app bar, its own
  // navigation in the sidebar on desktop and in section pages when narrow.
  const settingsSidebar = page.getByRole("complementary", {
    name: "Account utility navigation",
  });
  const openSettingsSection = async (name: string | RegExp) => {
    const parent =
      name === "Connected Agents"
        ? "Connections"
        : name === "Workspace Access"
          ? "Security & Access"
          : name;
    if (mobile) {
      const section =
        parent === "Appearance" ? "app" : parent === "Mail" ? "workspaces" : "account";
      await page
        .getByRole("navigation", { name: "Workspace sections" })
        .getByRole("link", { name: section, exact: true })
        .click();
      await page.getByRole("main").getByRole("link", { name: parent }).click();
    } else {
      await settingsSidebar.getByRole("link", { name: parent }).click();
    }
    if (parent !== name) {
      await page
        .locator("main")
        .getByRole("link", { name: new RegExp(`^Open ${name}$`, "i") })
        .click();
    }
  };
  await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible();
  if (mobile) {
    await expect(settingsSidebar).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Workspace sections" })).toBeVisible();
  } else {
    await expect(settingsSidebar).toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Workspace navigation" })
        .getByRole("link", { name: "Settings" }),
    ).toHaveAttribute("aria-current", "page");
  }
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toHaveCount(0);
  const profileSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/me") && response.request().method() === "PATCH" && response.ok(),
  );
  await setSettingTime(page, "Day start", "10:00 AM");
  await setSettingTime(page, "Day end", "6:00 PM");
  await page.getByLabel("Day end").blur();
  await expect(page.getByLabel("Day start")).toHaveValue("10:00 AM");
  await expect(page.getByLabel("Day end")).toHaveValue("6:00 PM");
  await profileSaved;
  await openSettingsSection("Activity");
  await expect(page.getByText("Reminder · created").first()).toBeVisible();
  await expect(page.getByText("Calendar event · created").first()).toBeVisible();
  await openSettingsSection("Appearance");
  await expect(page.getByRole("heading", { name: "Appearance", level: 1 })).toBeVisible();
  const darkAppearance = page.getByRole("radio", { name: "Dark" });
  await darkAppearance.click();
  await expect(darkAppearance).toBeChecked();
  await expect
    .poll(() => page.locator("html").evaluate((element) => element.classList.contains("dark")))
    .toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Appearance", level: 1 })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await openSettingsSection("Connected Agents");
  await expect(
    page.getByRole("heading", { name: "Connected Agents", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "nohmi MCP URL" })).toHaveValue(/\/mcp$/);
  await openSettingsSection("Workspace Access");
  await expect(page.getByText("Allowed", { exact: true })).toBeVisible();
  await expect(page.getByText("Mail readiness")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Setup protocol details" })).toHaveCount(0);
  await openSettingsSection("Mail");
  await expect(page.getByRole("heading", { name: "Mail", exact: true, level: 1 })).toBeVisible();
  const mailAction = page
    .locator("main")
    .getByRole("status")
    .filter({ hasText: "Action required" });
  await expect(mailAction).toContainText("Connect an MCP-compatible agent host to nohmi.");
  await expect(mailAction.getByRole("link", { name: "Connect agent" })).toBeVisible();
  await expect(page.getByText("Operational review")).toHaveCount(0);
  await expect(page.getByText("Connect an agent", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Setup details", exact: true }).click();
  await page.getByRole("button", { name: "Setup protocol details" }).click();
  await expect(page.getByRole("link", { name: "View skill source" })).toBeVisible();
  await openSettingsSection("Connected Agents");
  await page.getByRole("button", { name: "Set up a local token" }).click();
  await expect(
    page.getByRole("radio", {
      name: "Mail setup: Learn your inbox preferences, preview rules, and run approved Mail rules.",
      checked: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create local token" }).click();
  expect(
    await page.locator("html").evaluate((element) => element.scrollWidth <= innerWidth + 1),
  ).toBe(true);
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
    await openWorkspace("Today at a Glance");
  }
  await expect(page).toHaveURL(/\/today$/);
});

test("feedback keeps corrections in context and action failures in toasts", async ({
  page,
}, testInfo) => {
  const email = `feedback+${testInfo.project.name}-${Date.now()}@example.com`;
  await page.goto("/login");
  await page.getByRole("button", { name: "Have an invite? Create an account" }).click();
  await page.getByLabel("Name").fill("Feedback Person");
  await page.getByLabel("Invite code").fill("E2E12345");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("LocalTestOnly123!");
  await page.getByLabel("Confirm password").fill("LocalTestOnly123!");
  await expect(page.getByText("Invitation accepted.")).toBeVisible();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByRole("button", { name: "Exit setup" }).click();
  await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
  await page.goto("/settings?page=profile");
  const end = page.getByLabel("Day end");
  await setSettingTime(page, "Day start", "9:00 AM");
  await setSettingTime(page, "Day end", "8:00 AM");
  await page.getByLabel("Day end").blur();
  await expect(end).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Day end must be after day start.")).toBeVisible();
  const validation = page.locator("[data-sonner-toast]").filter({
    hasText: "Check the highlighted settings fields.",
  });
  await expect(validation).toBeVisible();
  await expect(
    page.getByText("Check the highlighted settings fields.", { exact: true }),
  ).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("feedback-validation.png") });
  const profileSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/me") && response.request().method() === "PATCH" && response.ok(),
  );
  await setSettingTime(page, "Day end", "6:00 PM");
  await expect(end).not.toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Day end").blur();
  await profileSaved;
  await expect(validation).toHaveCount(0);
  await expect(page.getByText("All changes saved", { exact: true })).toHaveCount(0);

  await page.goto("/settings?page=appearance");
  await page.route("**/v1/me", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "unavailable", message: "internal provider exception" },
      }),
    });
  });
  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  const failure = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Couldn’t save your appearance. Try again." });
  await expect(failure).toBeVisible();
  await expect(failure).toHaveAttribute("data-mounted", "true");
  await expect(failure).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("feedback-toast.png"),
    animations: "disabled",
  });
  await expect(page.getByText("internal provider exception")).toHaveCount(0);
  const dismiss = failure.getByRole("button", { name: "Close toast" });
  await dismiss.focus();
  await page.keyboard.press("Enter");
  await expect(failure).toHaveCount(0);
  await page.unroute("**/v1/me");
  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
});

test("Mail sync recovery remains reachable in constrained headers", async ({ page }, testInfo) => {
  if (testInfo.project.name === "desktop-chromium") {
    await page.setViewportSize({ width: 950, height: 640 });
  }
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
  const failedId = "22222222-2222-4222-8222-222222222222";
  await page.route("**/v1/connectors", async (route) => {
    const response = await route.fetch();
    const { accounts } = await response.json();
    const account = accounts.find((item: { mailEnabled: boolean }) => item.mailEnabled);
    if (!account) throw new Error("Missing fixture mail account");
    await route.fulfill({ json: { accounts: [account, { ...account, id: failedId }] } });
  });
  let retry = false;
  const synced: string[] = [];
  await page.route("**/v1/connectors/*/sync", async (route) => {
    const id = route.request().url().split("/").at(-2) ?? "";
    synced.push(id);
    await route.fulfill(
      id === failedId && !retry
        ? { status: 503, json: { error: { code: "unavailable", message: "Sync unavailable" } } }
        : { json: { result: { changed: 0 } } },
    );
  });
  await page.goto("/mail");
  const composeAction = page.getByRole("button", { name: "Compose a message" });
  await expect(composeAction).toBeVisible();
  const composeBounds = await composeAction.boundingBox();
  expect(composeBounds?.width).toBe(44);
  expect(composeBounds?.height).toBe(44);
  await revealWorkspaceOptions(page);
  await page.getByRole("button", { name: "Sync all mail accounts" }).click();
  await expect(
    page.getByText("1 of 2 mail accounts synced. 1 account needs another attempt."),
  ).toBeVisible();
  const details = page
    .locator('[data-slot="popover-content"]')
    .filter({ hasText: "Mail sync needs attention" });
  const bounds = await details.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.x).toBeGreaterThanOrEqual(0);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  );
  await page.keyboard.press("Escape");
  const action = page.getByRole("button", { name: "Retry failed mail accounts" });
  await expect(action).toBeInViewport();
  retry = true;
  await action.click();
  await expect(page.getByRole("button", { name: "Sync all mail accounts" })).toBeEnabled();
  expect(synced).toHaveLength(3);
  expect(synced.at(-1)).toBe(failedId);
});
