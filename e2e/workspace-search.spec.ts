import { expect, test } from "@playwright/test";

test("each workspace discovers records and Calendar settings without changing list filters", async ({
  page,
  isMobile,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();

  for (const [workspace, query, title] of [
    ["Calendar", "dentist", "Dentist appointment"],
    ["Tasks", "monthly subscriptions", "Review monthly subscriptions"],
    ["Mail", "board packet", "Board packet for Friday"],
    ["Finances", "checking", "Everyday checking"],
  ]) {
    await page.goto(`/${workspace?.toLowerCase()}`);
    if (workspace === "Calendar") await expect(page).toHaveURL(/follow=[01]/);
    const header = page.getByRole("navigation", { name: "Top navigation", exact: true });
    if (isMobile) {
      const switcher = await header.getByRole("button", { name: "Switch workspace" }).boundingBox();
      expect(switcher).not.toBeNull();
      expect(Math.abs((switcher?.width ?? 0) - (switcher?.height ?? 1))).toBeLessThan(1);
      expect((await header.boundingBox())?.height).toBeLessThanOrEqual(64);
    }
    await header.getByRole("button", { name: `Search ${workspace}`, exact: true }).click();
    const before = page.url();
    const input = page.getByRole("combobox", { name: `Search ${workspace}`, exact: true });
    await input.fill(query ?? "");
    await expect(page.getByRole("option", { name: new RegExp(`^${title}`) })).toBeVisible();
    expect(page.url()).toBe(before);
    if (isMobile) {
      await expect(
        page.getByRole("dialog", { name: `Search ${workspace}` }).getByRole("listbox"),
      ).toBeVisible();
      await page.getByRole("button", { name: "Close", exact: true }).click();
    } else {
      await input.press("Escape");
    }
  }

  await page.goto("/calendar");
  await page.getByRole("button", { name: "Search Calendar", exact: true }).click();
  await page.getByRole("combobox", { name: "Search Calendar", exact: true }).fill("weekends");
  await page.getByRole("option", { name: "Show weekends Calendar settings Settings" }).click();
  await expect(page).toHaveURL(/section=calendar.*field=calendar%3Ashow-weekends/);
  await expect(page.getByRole("switch", { name: "Show weekends" })).toBeFocused();
});

test("Calendar remembers its view and opening and snap preferences", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await page.goto("/calendar");
  await page.getByRole("button", { name: /^Calendar view:/ }).click();
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("/workspaces/calendar/settings") &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("menuitemradio", { name: "Month", exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await page.goto("/calendar");
  await expect(page.getByRole("button", { name: "Calendar view: month" })).toBeVisible();
  await page.goto("/settings?section=calendar");
  await expect(page.getByLabel("Preferred view", { exact: true })).toHaveValue("month");
  await page.getByLabel("Preferred view", { exact: true }).selectOption("day");
  const autoFollow = page.getByRole("switch", { name: "Automatically follow today" });
  await expect(autoFollow).toBeEnabled();
  await autoFollow.click();
  await expect(autoFollow).not.toBeChecked();
  const snap = page.getByRole("switch", { name: "Snap back to Follow" });
  await expect(snap).toBeEnabled();
  await page.getByLabel("Follow snap sensitivity", { exact: true }).selectOption("generous");
  await expect(snap).toBeEnabled();
  await snap.click();
  await expect(snap).not.toBeChecked();
  await expect(autoFollow).toBeEnabled();
  await page.goto("/calendar");
  await expect(page.getByRole("button", { name: "Calendar view: day" })).toBeVisible();
  await expect(page).toHaveURL(/follow=0/);
  await expect
    .poll(() => page.locator(".calendar-timeline-scroll").evaluate((el) => el.scrollTop))
    .toBe(0);
  await page.goto("/settings?section=calendar");
  await expect(autoFollow).not.toBeChecked();
  await expect(snap).not.toBeChecked();
  await expect(page.getByLabel("Follow snap sensitivity", { exact: true })).toHaveValue("generous");
  await autoFollow.click();
  await expect(autoFollow).toBeChecked();
  await expect(snap).toBeEnabled();
  await snap.click();
  await expect(snap).toBeChecked();
  await expect(autoFollow).toBeEnabled();
  await page.getByLabel("Follow snap sensitivity", { exact: true }).selectOption("balanced");
  await expect(autoFollow).toBeEnabled();
  await page.getByLabel("Preferred view", { exact: true }).selectOption("auto");
  await expect(autoFollow).toBeEnabled();
});

test("Tasks keeps view switching and utilities in one responsive header", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await page.goto("/tasks");
  const header = page.getByRole("navigation", { name: "Top navigation", exact: true });
  for (const label of [
    "Upcoming",
    "Today",
    "All Lists",
    "Projects",
    "History",
    "Trash",
    "Archive",
    "Inbox",
  ]) {
    await header.getByRole("button", { name: /^Tasks view:/ }).click();
    await page.getByRole("menuitemradio", { name: label, exact: true }).click();
    await expect(header.getByRole("button", { name: `Tasks view: ${label}` })).toBeVisible();
  }
  for (const name of ["Search Tasks", "Filters", "Sort", "Display"]) {
    await expect(header.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("navigation", { name: "Tasks page controls" })).toHaveCount(0);
  await header.getByRole("button", { name: "Sort", exact: true }).click();
  const recommended = page.getByRole("menuitemradio", { name: "Recommended", exact: true });
  await expect(recommended).toBeVisible();
  expect(
    await recommended.evaluate((item) => {
      const label = item.firstElementChild?.getBoundingClientRect();
      const marker = item
        .querySelector('[data-slot="dropdown-menu-radio-item-indicator"]')
        ?.getBoundingClientRect();
      return Boolean(
        label &&
          marker &&
          label.right <= marker.left &&
          item.getBoundingClientRect().right <= window.innerWidth,
      );
    }),
  ).toBeTruthy();
  const radio = recommended.locator('[data-slot="dropdown-menu-radio-item-indicator"]');
  await expect(recommended).toHaveAttribute("aria-checked", "true");
  expect(
    await radio.evaluate((el) => parseFloat(getComputedStyle(el).borderRadius)),
  ).toBeGreaterThanOrEqual(8);
  const uncheckedRadio = page.getByRole("menuitemradio", { name: "Title A–Z", exact: true });
  await expect(uncheckedRadio).toHaveAttribute("aria-checked", "false");
  await expect(
    uncheckedRadio.locator('[data-slot="dropdown-menu-radio-item-indicator"]'),
  ).toBeVisible();
  await uncheckedRadio.click();
  await expect(page).toHaveURL(/sort=title/);
  await header.getByRole("button", { name: "Display", exact: true }).click();
  const notes = page.getByRole("menuitemcheckbox", { name: "Notes", exact: true });
  await expect(notes).toHaveAttribute("aria-checked", "false");
  const checkbox = notes.locator('[data-slot="dropdown-menu-checkbox-item-indicator"]');
  await expect(checkbox).toBeVisible();
  expect(
    await checkbox.evaluate((el) => parseFloat(getComputedStyle(el).borderRadius)),
  ).toBeLessThan(8);
  await notes.press("Space");
  await expect(notes).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Estimates", exact: true }),
  ).toHaveAttribute("aria-checked", "true");
  await notes.press("Escape");
  await expect(header.getByRole("button", { name: "Display", exact: true })).toBeFocused();
  await expect
    .poll(() => header.evaluate((el) => el.getBoundingClientRect().height))
    .toBeLessThan(65);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});

test("Tasks plus guides creation into the existing responsive editors", async ({
  page,
  isMobile,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await page.goto("/tasks");
  await page.getByRole("button", { name: "Create in Tasks" }).click();
  await page.getByRole("button", { name: "Task Something to do" }).click();
  await page.getByLabel("List", { exact: true }).selectOption({ label: "Work" });
  await page.getByLabel("Project (optional)").selectOption({ label: "Autumn program opening" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Capture a task");
  await expect(page.getByRole("progressbar", { name: "Creation progress" })).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  await expect(page.locator("[data-responsive-slot=content]")).toHaveAttribute(
    "data-presentation",
    isMobile ? "drawer" : "dialog",
  );
  await expect(page.getByLabel("List", { exact: true }).locator("option:checked")).toHaveText(
    "Work",
  );
  await expect(page.getByLabel("Project", { exact: true }).locator("option:checked")).toHaveText(
    "Autumn program opening",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  for (const [choice, heading] of [
    ["Reminder Something to remember", "Create reminder"],
    ["List A place to organize tasks and projects", "Create a List"],
    ["Project A goal with related tasks", "Create a Project"],
  ]) {
    await page.getByRole("button", { name: "Create in Tasks" }).click();
    await page.getByRole("button", { name: choice!, exact: true }).click();
    if (choice!.startsWith("Project"))
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(heading!);
    await expect(page.getByRole("progressbar", { name: "Creation progress" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    await expect(page.locator("[data-responsive-slot=content]")).toHaveAttribute(
      "data-presentation",
      isMobile ? "drawer" : "dialog",
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
  }
});

test("Tasks collections support browsing, searching, and sorting lists and projects", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await page.goto("/tasks?view=lists");
  await expect(page.getByRole("button", { name: "Tasks view: All Lists" })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Lists", exact: true }).getByText("Work", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pin Work", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unpin Work", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Unpin Work", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Unpin Work", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pin Work", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Filter lists" }).click();
  await page.getByRole("searchbox", { name: "Search lists" }).fill("Work");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("list", { name: "Lists", exact: true }).getByRole("listitem"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: "Tasks view: All Lists" }).click();
  await page.getByRole("menuitemradio", { name: "Projects", exact: true }).click();
  await expect(
    page
      .getByRole("list", { name: "Projects", exact: true })
      .getByText("Autumn program opening", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sort projects" }).click();
  await page.getByRole("menuitemradio", { name: "Target date", exact: true }).click();
  await expect(page).toHaveURL(/containerSort=target/);
  await page
    .getByRole("list", { name: "Projects", exact: true })
    .getByText("Autumn program opening", { exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Tasks view: Autumn program opening" }),
  ).toBeVisible();
});

test("Tasks restores saved display preferences on a fresh workspace entry", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await page.goto("/tasks?sort=default&group=none&details=estimate");
  const header = page.getByRole("navigation", { name: "Top navigation", exact: true });
  const saved = () =>
    page.waitForResponse(
      (response) =>
        response.url().includes("/workspaces/tasks/settings") &&
        response.request().method() === "PATCH" &&
        response.ok(),
    );
  await header.getByRole("button", { name: "Sort", exact: true }).click();
  const sortSaved = saved();
  await page.getByRole("menuitemradio", { name: "Title A–Z", exact: true }).click();
  await sortSaved;
  await header.getByRole("button", { name: "Display", exact: true }).click();
  const groupSaved = saved();
  await page.getByRole("menuitemradio", { name: "Project", exact: true }).click();
  await groupSaved;
  await header.getByRole("button", { name: "Display", exact: true }).click();
  const detailsSaved = saved();
  await page.getByRole("menuitemcheckbox", { name: "Estimates", exact: true }).click();
  await detailsSaved;
  await page.goto("/tasks");
  await expect(header.getByRole("button", { name: "Sort: Title A–Z", exact: true })).toBeVisible();
  await header.getByRole("button", { name: "Display", exact: true }).click();
  await expect(page.getByRole("menuitemradio", { name: "Project", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  for (const name of ["Estimates", "Tags", "Notes"]) {
    await expect(page.getByRole("menuitemcheckbox", { name, exact: true })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  }
  // An explicit link may differ from account defaults without saving over them.
  await page.goto("/tasks?sort=date");
  await expect(
    header.getByRole("button", { name: "Sort: Relevant date", exact: true }),
  ).toBeVisible();
  await page.goto("/tasks");
  await expect(header.getByRole("button", { name: "Sort: Title A–Z", exact: true })).toBeVisible();
  // Restore fixture defaults for other acceptance tests.
  await header.getByRole("button", { name: "Sort: Title A–Z", exact: true }).click();
  const resetSort = saved();
  await page.getByRole("menuitemradio", { name: "Recommended", exact: true }).click();
  await resetSort;
  await header.getByRole("button", { name: "Display", exact: true }).click();
  const resetGroup = saved();
  await page.getByRole("menuitemradio", { name: "No grouping", exact: true }).click();
  await resetGroup;
  await header.getByRole("button", { name: "Display", exact: true }).click();
  const resetDetails = saved();
  await page.getByRole("menuitemcheckbox", { name: "Estimates", exact: true }).click();
  await resetDetails;
});
