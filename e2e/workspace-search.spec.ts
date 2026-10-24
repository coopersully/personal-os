import { expect, type Page, test } from "@playwright/test";
import type {
  WorkspacePreferences,
  WorkspaceSettings,
} from "../packages/domain/src/workspace-settings.js";
import { selectSetting } from "./settings-controls.js";

async function preserveWorkspacePreferences(
  page: Page,
  workspace: "calendar" | "tasks" | "mail",
  defaults: Partial<WorkspacePreferences>,
) {
  const path = `/v1/workspaces/${workspace}/settings`;
  const response = await page.request.get(path);
  expect(response.ok()).toBeTruthy();
  const original = (await response.json()) as WorkspaceSettings;
  // Optional preferences cannot be deleted by PATCH; restore their effective default when absent.
  const preferences = Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      original.preferences[key as keyof WorkspacePreferences] ?? fallback,
    ]),
  );
  const baseline = await page.request.patch(path, {
    headers: { origin: new URL(page.url()).origin },
    data: { expectedRevision: original.revision, preferences: defaults },
  });
  expect(baseline.ok()).toBeTruthy();
  return async () => {
    const latest = await page.request.get(path);
    expect(latest.ok()).toBeTruthy();
    const current = (await latest.json()) as WorkspaceSettings;
    const restored = await page.request.patch(path, {
      headers: { origin: new URL(page.url()).origin },
      data: { expectedRevision: current.revision, preferences },
    });
    expect(restored.ok()).toBeTruthy();
  };
}

test("each workspace discovers records and Calendar settings without changing list filters", async ({
  page,
  isMobile,
}) => {
  test.setTimeout(90_000);
  await page.goto("/login");
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
      expect((await header.boundingBox())?.height).toBeLessThanOrEqual(96);
    }
    await header.getByRole("combobox", { name: `Search ${workspace}`, exact: true }).click();
    const before = page.url();
    const input = page.getByRole("combobox", { name: `Search ${workspace}`, exact: true });
    await input.fill(query ?? "");
    await expect(page.getByRole("option", { name: new RegExp(`^${title}`) })).toBeVisible();
    expect(page.url()).toBe(before);
    await expect(input).toHaveAttribute("placeholder", "");
    await expect(page.getByRole("listbox")).toBeVisible();
    await input.press("Escape");
  }

  await page.goto("/calendar");
  await page.getByRole("combobox", { name: "Search Calendar", exact: true }).click();
  await page.getByRole("combobox", { name: "Search Calendar", exact: true }).fill("weekends");
  await page.getByRole("option", { name: "Show weekends Calendar settings Settings" }).click();
  await expect(page).toHaveURL(/page=calendar.*field=calendar%3Ashow-weekends/);
  await expect(page.getByRole("switch", { name: "Show weekends" })).toBeFocused();
});

test("Calendar remembers its view and opening and snap preferences", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  const restore = await preserveWorkspacePreferences(page, "calendar", {
    calendarView: "auto",
    autoFollowToday: true,
    snapToFollow: true,
    followSnapSensitivity: "balanced",
    weekStartsOn: "sunday",
    defaultEventDurationMinutes: 60,
  });
  try {
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
    await page.goto("/settings?page=calendar");
    await expect(page.getByLabel("Preferred view", { exact: true })).toHaveText("Month");
    await selectSetting(page, "Preferred view", "Day");
    const weekStart = page.getByLabel("Week starts on", { exact: true });
    await expect(weekStart).toBeEnabled();
    await selectSetting(page, "Week starts on", "Monday");
    const duration = page.getByLabel("Default event duration (minutes)", { exact: true });
    await expect(duration).toBeEnabled();
    await duration.fill("90");
    const durationSaved = page.waitForResponse(
      (response) =>
        response.url().includes("/workspaces/calendar/settings") &&
        response.request().method() === "PATCH",
    );
    await duration.blur();
    expect((await durationSaved).ok()).toBeTruthy();
    const autoFollow = page.getByRole("switch", { name: "Automatically follow today" });
    await expect(autoFollow).toBeEnabled();
    await autoFollow.click();
    await expect(autoFollow).not.toBeChecked();
    const snap = page.getByRole("switch", { name: "Snap back to Follow" });
    await expect(snap).toBeEnabled();
    await selectSetting(page, "Follow snap sensitivity", "Generous — anywhere nearby");
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
    await page.goto("/settings?page=calendar");
    await expect(autoFollow).not.toBeChecked();
    await expect(weekStart).toHaveText("Monday");
    await expect(duration).toHaveValue("90");
    await expect(snap).not.toBeChecked();
    await expect(page.getByLabel("Follow snap sensitivity", { exact: true })).toHaveText(
      "Generous — anywhere nearby",
    );
  } finally {
    await restore();
  }
});

test("Tasks keeps view switching and utilities in one responsive header", async ({
  page,
  isMobile,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  const restore = await preserveWorkspacePreferences(page, "tasks", {
    taskSort: "default",
    taskRowDetails: ["estimate"],
  });
  try {
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
    await expect(header.getByRole("combobox", { name: "Search Tasks", exact: true })).toBeVisible();
    for (const name of ["Filters", "Sort", "Display"]) {
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
    const sortSaved = page.waitForResponse(
      (response) =>
        response.url().includes("/workspaces/tasks/settings") &&
        response.request().method() === "PATCH" &&
        response.request().postDataJSON()?.preferences?.taskSort === "title",
    );
    await uncheckedRadio.click();
    expect((await sortSaved).ok()).toBeTruthy();
    await expect(page).toHaveURL(/sort=title/);
    await header.getByRole("button", { name: "Display", exact: true }).click();
    const notes = page.getByRole("menuitemcheckbox", { name: "Notes", exact: true });
    await expect(notes).toHaveAttribute("aria-checked", "false");
    const checkbox = notes.locator('[data-slot="dropdown-menu-checkbox-item-indicator"]');
    await expect(checkbox).toBeVisible();
    expect(
      await checkbox.evaluate((el) => parseFloat(getComputedStyle(el).borderRadius)),
    ).toBeLessThan(8);
    const detailsSaved = page.waitForResponse(
      (response) =>
        response.url().includes("/workspaces/tasks/settings") &&
        response.request().method() === "PATCH" &&
        JSON.stringify(response.request().postDataJSON()?.preferences?.taskRowDetails) ===
          JSON.stringify(["estimate", "notes"]),
    );
    await notes.press("Space");
    expect((await detailsSaved).ok()).toBeTruthy();
    await expect(notes).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("menuitemcheckbox", { name: "Estimates", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await notes.press("Escape");
    await expect(header.getByRole("button", { name: "Display", exact: true })).toBeFocused();
    await expect
      .poll(() => header.evaluate((el) => el.getBoundingClientRect().height))
      .toBeLessThanOrEqual(isMobile ? 84 : 64);
    if (isMobile) {
      // The accepted mobile header has one utility row, then the full-width scope selector.
      const utilities = [
        header.getByRole("button", { name: "Switch workspace", exact: true }),
        header.getByRole("combobox", { name: "Search Tasks", exact: true }),
        ...["Filters", "Sort: Title A–Z", "Display"].map((name) =>
          header.getByRole("button", { name, exact: true }),
        ),
      ];
      const view = header.getByRole("button", { name: "Tasks view: Inbox", exact: true });
      const headerBox = await header.boundingBox();
      const viewBox = await view.boundingBox();
      if (!headerBox || !viewBox) throw new Error("Missing mobile Tasks header or scope selector");
      const boxes = await Promise.all(utilities.map((control) => control.boundingBox()));
      let previousRight = headerBox.x;
      const centers: number[] = [];
      for (const box of boxes) {
        if (!box) throw new Error("Missing mobile Tasks utility");
        expect(box.width).toBeGreaterThan(0);
        expect(box.x).toBeGreaterThanOrEqual(previousRight - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 1);
        expect(box.y).toBeGreaterThanOrEqual(headerBox.y);
        expect(box.y + box.height).toBeLessThanOrEqual(viewBox.y + 1);
        centers.push(box.y + box.height / 2);
        previousRight = box.x + box.width;
      }
      expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(2);
      const switcherBox = boxes[0];
      if (!switcherBox) throw new Error("Missing mobile workspace switcher");
      expect(viewBox.x).toBeCloseTo(switcherBox.x, 0);
      expect(viewBox.width).toBeGreaterThanOrEqual(headerBox.width - 32);
      expect(viewBox.y + viewBox.height).toBeLessThanOrEqual(headerBox.y + headerBox.height + 1);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
  } finally {
    await restore();
  }
});

test("Tasks plus guides creation into the existing responsive editors", async ({
  page,
  isMobile,
}) => {
  await page.goto("/login");
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
    if (choice?.startsWith("Project"))
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
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  const restore = await preserveWorkspacePreferences(page, "tasks", {
    pinnedListIds: [],
    taskContainerSort: "updated",
  });
  try {
    await page.goto("/tasks?view=lists");
    await expect(page.getByRole("button", { name: "Tasks view: All Lists" })).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Lists", exact: true }).getByText("Work", { exact: true }),
    ).toBeVisible();
    const pinSaved = page.waitForResponse(
      (response) =>
        response.url().includes("/workspaces/tasks/settings") &&
        response.request().method() === "PATCH" &&
        response.request().postDataJSON()?.preferences?.pinnedListIds?.length === 1,
    );
    await page.getByRole("button", { name: "Pin Work", exact: true }).click();
    expect((await pinSaved).ok()).toBeTruthy();
    await expect(page.getByRole("button", { name: "Unpin Work", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.reload();
    await expect(page.getByRole("button", { name: "Unpin Work", exact: true })).toBeVisible();
    const unpinSaved = page.waitForResponse(
      (response) =>
        response.url().includes("/workspaces/tasks/settings") &&
        response.request().method() === "PATCH" &&
        response.request().postDataJSON()?.preferences?.pinnedListIds?.length === 0,
    );
    await page.getByRole("button", { name: "Unpin Work", exact: true }).click();
    expect((await unpinSaved).ok()).toBeTruthy();
    await expect(page.getByRole("button", { name: "Pin Work", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Filter lists" }).click();
    await page.getByRole("searchbox", { name: "Search lists" }).fill("Work");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("list", { name: "Lists", exact: true }).getByRole("listitem"),
    ).toHaveCount(1);
    // Fail at the blocked action with time left to restore the shared account preferences.
    await page.getByRole("button", { name: "Clear filters" }).click({ timeout: 10_000 });
    await page.getByRole("button", { name: "Tasks view: All Lists" }).click();
    await page.getByRole("menuitemradio", { name: "Projects", exact: true }).click();
    await expect(
      page
        .getByRole("list", { name: "Projects", exact: true })
        .getByText("Autumn program opening", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sort projects" }).click();
    const sortSaved = page.waitForResponse(
      (response) =>
        response.url().includes("/workspaces/tasks/settings") &&
        response.request().method() === "PATCH" &&
        response.request().postDataJSON()?.preferences?.taskContainerSort === "target",
    );
    await page.getByRole("menuitemradio", { name: "Target date", exact: true }).click();
    expect((await sortSaved).ok()).toBeTruthy();
    await expect(page).toHaveURL(/containerSort=target/);
    await page
      .getByRole("list", { name: "Projects", exact: true })
      .getByText("Autumn program opening", { exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Tasks view: Autumn program opening" }),
    ).toBeVisible();
  } finally {
    await restore();
  }
});

test("Tasks restores saved display preferences on a fresh workspace entry", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  const restore = await preserveWorkspacePreferences(page, "tasks", {
    taskSort: "default",
    taskGroup: "none",
    taskRowDetails: ["estimate"],
  });
  try {
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
    await expect(
      header.getByRole("button", { name: "Sort: Title A–Z", exact: true }),
    ).toBeVisible();
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
    await expect(
      header.getByRole("button", { name: "Sort: Title A–Z", exact: true }),
    ).toBeVisible();
  } finally {
    await restore();
  }
});

test("workspace settings edit Tasks display and Mail layout preferences", async ({
  page,
  isMobile,
}) => {
  test.setTimeout(90_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  const restoreTasks = await preserveWorkspacePreferences(page, "tasks", {
    taskSort: "default",
    taskGroup: "none",
  });
  const restoreMail = await preserveWorkspacePreferences(page, "mail", {
    mailListDensity: "comfortable",
    mailListWidth: 34,
  });
  try {
    const saved = (workspace: string) =>
      page.waitForResponse(
        (r) =>
          r.url().includes(`/workspaces/${workspace}/settings`) &&
          r.request().method() === "PATCH" &&
          r.ok(),
      );
    await page.goto("/settings?page=tasks");
    await expect(page.getByLabel("Sort by", { exact: true })).toBeEnabled();
    let writing = saved("tasks");
    await selectSetting(page, "Sort by", "Title A–Z");
    await writing;
    await expect(page.getByLabel("Group by", { exact: true })).toBeEnabled();
    writing = saved("tasks");
    await selectSetting(page, "Group by", "Project");
    await writing;
    await expect(page.getByLabel("List and project sorting", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Notes", { exact: true })).toBeVisible();
    await page.goto("/tasks");
    await expect(page.getByRole("button", { name: "Sort: Title A–Z", exact: true })).toBeVisible();
    await page.goto("/settings?page=mail");
    await expect(page.getByLabel("Conversation density", { exact: true })).toBeEnabled();
    writing = saved("mail");
    await selectSetting(page, "Conversation density", "Compact");
    await writing;
    await expect(page.getByLabel("Conversation list width (%)", { exact: true })).toBeEnabled();
    writing = saved("mail");
    await page.getByLabel("Conversation list width (%)", { exact: true }).fill("42");
    await page.getByLabel("Conversation list width (%)", { exact: true }).press("Tab");
    await writing;
    await page.goto("/mail");
    const row = page.locator(".mail-thread-row").first();
    await expect(row).toHaveAttribute("data-density", "compact");
    expect(
      await page.locator(".mail-thread-list").evaluate((el) => {
        const probe = document.createElement("div");
        probe.style.backgroundColor = "var(--background)";
        el.append(probe);
        const matches =
          getComputedStyle(el).backgroundColor === getComputedStyle(probe).backgroundColor;
        probe.remove();
        return matches;
      }),
    ).toBeTruthy();
    if (!isMobile) {
      await row.click();
      await expect(page.locator(".mail-thread-row.is-active")).toBeVisible();
      expect(
        await page.locator(".mail-thread-row.is-active").evaluate((el) => {
          const probe = document.createElement("div");
          probe.style.backgroundColor = "var(--card)";
          el.append(probe);
          const matches =
            getComputedStyle(el).backgroundColor === getComputedStyle(probe).backgroundColor;
          probe.remove();
          return matches;
        }),
      ).toBeTruthy();
    }
    await page.getByRole("button", { name: "Message list layout", exact: true }).click();
    writing = saved("mail");
    await page.getByRole("menuitemradio", { name: "Expanded", exact: true }).click();
    await writing;
    await page.goto("/settings?page=mail");
    await expect(page.getByLabel("Conversation density", { exact: true })).toHaveText("Expanded");
    await expect(page.getByLabel("Conversation list width (%)", { exact: true })).toHaveValue("42");
  } finally {
    try {
      await restoreTasks();
    } finally {
      await restoreMail();
    }
  }
});

test("Mail opens at its latest message and retains scrollable conversation history", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await page.goto("/mail");
  await page.locator(".mail-thread-row").filter({ hasText: "Board packet for Friday" }).click();
  const messages = page.locator(".mail-reader__message");
  await expect(messages).toHaveCount(2);
  const reader = page.getByRole("region", { name: "Message reader", exact: true });
  await expect
    .poll(() =>
      reader.evaluate((el) => {
        const latest = el.querySelector(".mail-reader__message:last-of-type");
        return latest
          ? Math.abs(latest.getBoundingClientRect().top - el.getBoundingClientRect().top - 64)
          : 1000;
      }),
    )
    .toBeLessThan(4);
  expect(await reader.evaluate((el) => getComputedStyle(el).scrollSnapType)).toMatch(
    /^y(?: proximity)?$/,
  );
  expect(await reader.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const previousMessage = reader.getByRole("button", {
    name: "1 more message above. Go to previous message",
  });
  await expect(previousMessage).toBeVisible();
  await previousMessage.click();
  await expect(previousMessage).toHaveCount(0);
  await expect(messages.first()).toBeInViewport();
  await expect
    .poll(() =>
      messages.first().evaluate((el) => {
        const viewport = el.closest(".mail-reader");
        if (!viewport) return 1000;
        return Math.abs(el.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 64);
      }),
    )
    .toBeLessThan(4);
});

test("Mail single-message reader keeps the title at the top and uses the full card width", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await page.goto("/mail");
  await page
    .locator(".mail-thread-row")
    .filter({ hasText: "Your July statement is ready" })
    .click();
  const reader = page.getByRole("region", { name: "Message reader", exact: true });
  await expect(reader.locator(".mail-reader__message")).toHaveCount(1);
  await expect
    .poll(() =>
      reader.evaluate((el) => {
        const nav = el.querySelector(".mail-reader__history-nav");
        return nav
          ? Math.abs(nav.getBoundingClientRect().top - el.getBoundingClientRect().top)
          : 1000;
      }),
    )
    .toBeLessThan(2);
  await expect(reader.getByRole("heading", { name: "Your July statement is ready" })).toBeVisible();
  const dimensions = await reader.locator(".mail-reader__message").evaluate((el) => {
    const body = el.querySelector("pre");
    const style = getComputedStyle(el);
    const available =
      el.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
    return { available, body: body?.getBoundingClientRect().width ?? 0 };
  });
  expect(Math.abs(dimensions.available - dimensions.body)).toBeLessThan(2);
});

test("Mail saves full-width conversation layout and supports returning to the list", async ({
  page,
  isMobile,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  const restore = await preserveWorkspacePreferences(page, "mail", {
    mailConversationLayout: "split",
  });
  try {
    await page.goto("/mail");
    await page.getByRole("button", { name: "Message list layout", exact: true }).click();
    const saved = page.waitForResponse(
      (r) => r.url().includes("/settings") && r.request().method() === "PATCH" && r.ok(),
    );
    await page.getByRole("menuitemradio", { name: "Full-width view", exact: true }).click();
    await saved;
    await page.reload();
    const list = page.getByRole("region", { name: "Conversations", exact: true });
    const reader = page.getByRole("region", { name: "Message reader", exact: true });
    await expect(list).toBeVisible();
    await expect(reader).toBeHidden();
    const expectFullWidth = async (region: typeof list) => {
      await expect
        .poll(() =>
          region.evaluate((el) => {
            const workspace = el.closest(".mail-workspace");
            return workspace
              ? Math.abs(el.getBoundingClientRect().width - workspace.getBoundingClientRect().width)
              : 1000;
          }),
        )
        .toBeLessThan(2);
    };
    await expectFullWidth(list);
    if (!isMobile) {
      const row = page.locator(".mail-thread-row").filter({ hasText: "Board packet for Friday" });
      const subject = await row.locator("strong").boundingBox();
      const preview = await row.locator(".mail-thread-row__snippet").boundingBox();
      expect(subject).not.toBeNull();
      expect(preview).not.toBeNull();
      if (subject && preview) {
        expect(Math.abs(subject.y - preview.y)).toBeLessThan(3);
        expect(preview.x).toBeGreaterThan(subject.x);
      }
      expect(await row.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(65);
    }
    await page.locator(".mail-thread-row").filter({ hasText: "Board packet for Friday" }).click();
    await expect(reader).toBeVisible();
    await expectFullWidth(reader);
    await expect(list).toBeHidden();
    await page.getByRole("button", { name: "Back to conversations", exact: true }).click();
    await expect(list).toBeVisible();
    await expect(reader).toBeHidden();
    await page.getByRole("button", { name: "Message list layout", exact: true }).click();
    const restored = page.waitForResponse(
      (r) => r.url().includes("/settings") && r.request().method() === "PATCH" && r.ok(),
    );
    await page.getByRole("menuitemradio", { name: "Split view", exact: true }).click();
    await restored;
    await page.locator(".mail-thread-row").filter({ hasText: "Board packet for Friday" }).click();
    await expect(reader).toBeVisible();
    if (isMobile) await expect(list).toBeHidden();
    else await expect(list).toBeVisible();
  } finally {
    await restore();
  }
});

test("Collapsed workspace sidebar keeps reviews centered and exposes the count in a tooltip", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Mobile uses the header review control.");
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await page.goto("/mail");
  const review = page.locator('[data-sidebar="menu-button"].review-navigation');
  await expect(review).toBeVisible();
  await page.keyboard.press("Control+b");
  await expect(review.locator(".review-navigation__label")).toBeHidden();
  await expect(review.locator(".review-navigation__count")).toBeHidden();
  await expect
    .poll(() =>
      review.evaluate((el) => {
        const icon = el.querySelector("svg");
        if (!icon) return 1000;
        const button = el.getBoundingClientRect();
        const glyph = icon.getBoundingClientRect();
        return Math.abs(button.x + button.width / 2 - glyph.x - glyph.width / 2);
      }),
    )
    .toBeLessThan(2);
  await review.hover();
  await expect(page.getByRole("tooltip")).toContainText("need review");
});

test("Mail attachments download, retry failures, and preview safely", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await page.route("**/v1/mail/threads/*/messages", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    for (const message of payload.messages) {
      for (const file of message.attachments) {
        file.filename = "notes.txt";
        file.contentType = "text/plain";
      }
    }
    await route.fulfill({ response, json: payload });
  });
  let fail = true;
  await page.route("**/v1/mail/messages/*/attachments/*", async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        json: {
          error: { code: "service_unavailable", message: "Attachment unavailable. Try again." },
        },
      });
    } else {
      await route.fulfill({
        json: {
          attachment: {
            filename: "notes.txt",
            contentType: "text/plain",
            size: 5,
            data: "aGVsbG8=",
          },
        },
      });
    }
  });
  await page.goto("/mail");
  await page.locator(".mail-thread-row").filter({ hasText: "Board packet for Friday" }).click();
  await page.getByRole("button", { name: "Download notes.txt", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("notes.txt");
  expect(await download.failure()).toBeNull();
  await page.getByRole("button", { name: "Preview notes.txt", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("hello");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Finance consolidates contextual controls and preserves responsive creation", async ({
  page,
  isMobile,
}) => {
  test.setTimeout(90_000);
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  const header = page.getByRole("navigation", { name: "Top navigation", exact: true });
  for (const [path, group, action] of [
    ["/finances/transactions", "Transaction controls", "Add in Transactions"],
    ["/finances/accounts", "Account controls", "Add account"],
    ["/finances/wealth", "Wealth controls", "Create goal"],
    ["/finances/plan", "Budget controls", "Budget buckets"],
    ["/finances/cashflow", "Cash flow views", "Cash flow view"],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: action, exact: true })).toBeVisible();
    if (group) await expect(header.getByRole("group", { name: group, exact: true })).toBeVisible();
    if (path === "/finances/plan") {
      const budgetResponse = await page.request.get("/v1/finances/budget-plans");
      expect(budgetResponse.ok()).toBe(true);
      const budget = await budgetResponse.json();
      expect(budget.outcome).toBe("completed");
      const revise = header.getByRole("button", { name: "Revise plan", exact: true });
      if (budget.data === null) {
        await expect(
          page.getByRole("link", { name: "Set up your budget", exact: true }),
        ).toHaveAttribute("href", "/finances/setup?section=budget&returnTo=%2Ffinances%2Fplan");
        await expect(revise).toHaveCount(0);
        await expect(
          header.getByRole("button", { name: "Budget buckets", exact: true }),
        ).toBeVisible();
      } else {
        expect(budget.data).toEqual(
          expect.objectContaining({ id: expect.any(String), version: expect.any(Number) }),
        );
        await expect(
          header.getByRole("group", { name: "Plan controls", exact: true }),
        ).toBeVisible();
        await expect(revise).toBeEnabled();
        await revise.click();
        const revision = page.getByRole("dialog", {
          name: "Edit budget",
          exact: true,
        });
        await expect(revision).toBeVisible();
        await expect(
          revision.getByText(`Current version ${budget.data.version}`, { exact: true }),
        ).toBeVisible();
        await revision.getByRole("button", { name: "Close", exact: true }).click();
        await expect(revision).not.toBeVisible();
      }
    }
    await expect(page.locator('[data-slot="workspace-secondary-app-bar"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New transaction", exact: true })).toHaveCount(0);
    await expect(
      header.getByRole("button", { name: "Add in Transactions", exact: true }),
    ).toHaveCount(path === "/finances/transactions" ? 1 : 0);
    if (path === "/finances/transactions") {
      await expect(
        header.getByRole("group", { name: "Transaction view", exact: true }),
      ).toBeVisible();
      // Table exports share the record toolbar's overflow, not the workspace header.
      await expect(header.getByRole("button", { name: "Export", exact: true })).toHaveCount(0);
      const tableActions = page
        .getByRole("region", { name: "Transactions view", exact: true })
        .getByRole("button", { name: "Table actions", exact: true });
      await expect(tableActions).toBeVisible();
      await tableActions.click();
      await expect(
        page.getByRole("menuitem", { name: "Table Options", exact: true }),
      ).toBeVisible();
      const exportPage = page.getByRole("menuitem", { name: "Export Page", exact: true });
      await expect(exportPage).toBeVisible();
      await expect(exportPage).toBeEnabled();
      await exportPage.press("Escape");
      await expect(tableActions).toBeFocused();
    } else if (path === "/finances/accounts") {
      await expect(header.getByRole("link", { name: "Import records", exact: true })).toBeVisible();
      await expect(header.getByRole("button", { name: "Add account", exact: true })).toBeVisible();
    } else if (path === "/finances/wealth" || path === "/finances/plan") {
      await expect(header.getByRole("button", { name: action, exact: true })).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    const bounds = await header.boundingBox();
    // Cash flow now includes timeline controls in the header: identity plus two control rows.
    const mobileHeaderLimit = path === "/finances/cashflow" ? 144 : 112;
    expect(bounds?.height).toBeLessThanOrEqual(isMobile ? mobileHeaderLimit : 64);
    for (const control of await header
      .locator(".workspace-header-controls")
      .locator("button, a")
      .all()) {
      const box = await control.boundingBox();
      if (box) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1);
      }
    }
  }
  await header.getByRole("button", { name: "Cash flow view" }).click();
  await page.getByRole("menuitemradio", { name: "Income", exact: true }).click();
  await expect(page).toHaveURL(/view=income/);
  await expect(header.getByRole("button", { name: "Cash flow view" })).toHaveText("Income");
  await page.reload();
  await expect(header.getByRole("button", { name: "Cash flow view" })).toHaveText("Income");

  await page.goto("/finances/plan");
  await page.getByRole("button", { name: "Budget buckets", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Organize budget categories" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.goto("/finances/imports");
  const importDialog = page.getByRole("dialog", { name: "Import transactions", exact: true });
  await expect(importDialog).toBeVisible();
  await expect(page).toHaveURL(/\/finances\/transactions\?import=1/);
  await expect(importDialog).toHaveAttribute("data-presentation", isMobile ? "drawer" : "dialog");
  await importDialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page).not.toHaveURL(/import=1/);

  await page.goto("/finances/health");
  await expect(page).toHaveURL(/\/finances\/transactions\?checks=1/);
  await expect(
    header.getByRole("group", { name: "Transaction controls", exact: true }),
  ).toBeVisible();

  await page.goto("/finances/transactions?view=table&search=coffee");
  const add = header.getByRole("button", { name: "Add in Transactions", exact: true });
  await add.click();
  for (const name of ["Add transaction", "Add category", "Import transactions"]) {
    await expect(page.getByRole("menuitem", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("menuitem", { name: "Add category", exact: true }).click();
  const categoryDialog = page.getByRole("dialog", { name: "Add category", exact: true });
  await expect(categoryDialog).toBeVisible();
  await expect(categoryDialog).toHaveAttribute("data-presentation", isMobile ? "drawer" : "dialog");
  await categoryDialog.getByRole("button", { name: "Close", exact: true }).click();
  await add.click();
  await page.getByRole("menuitem", { name: "Import transactions", exact: true }).click();
  await expect(importDialog).toBeVisible();
  await importDialog.getByRole("button", { name: "Close", exact: true }).click();
  await add.click();
  await page.getByRole("menuitem", { name: "Add transaction", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add a transaction" });
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute("data-presentation", isMobile ? "drawer" : "dialog");
  await editor.getByLabel("Merchant").fill("Draft transaction");
  await editor.getByLabel("Merchant").press("Tab");
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page).not.toHaveURL(/finance-add-transaction/);
  expect(new URL(page.url()).searchParams.get("search")).toBe("coffee");
  expect(new URL(page.url()).searchParams.get("view")).toBe("table");
  await add.click();
  await page.getByRole("menuitem", { name: "Add transaction", exact: true }).click();
  await expect(editor.getByLabel("Merchant")).toHaveValue("Draft transaction");
  await editor.getByLabel("Merchant").press("Tab");
  await editor.getByRole("button", { name: "Close", exact: true }).click();

  await page.goto("/finances");
  await expect(page.getByRole("region", { name: "Complete plan", exact: true })).toBeVisible();
  await expect(header.getByRole("group")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add in Transactions", exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: `/tmp/finance-overview-${isMobile ? "mobile" : "desktop"}.png`,
    fullPage: true,
  });
});

test("Financial profile opens shared fields and preserves edits across sections and reload", async ({
  page,
  isMobile,
}) => {
  let setupRequests = 0;
  await page.route("**/v1/finances/setup", async (route) => {
    setupRequests++;
    await route.continue();
  });
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await page.goto("/finances/setup");
  const steps = page.getByRole("navigation", { name: "Financial profile sections" });
  await expect(steps.getByRole("button")).toHaveCount(3);
  await expect(page.getByLabel("Household size")).toBeVisible();
  const original = await page.getByLabel("Household size").inputValue();
  try {
    await page.getByLabel("Household size").fill("3");
    const save =
      original !== "3"
        ? page.waitForResponse(
            (r) => r.url().endsWith("/v1/finances/profile") && r.request().method() !== "GET",
          )
        : null;
    await page.getByLabel("Household size").press("Tab");
    if (save) expect((await save).ok()).toBe(true);
    await steps.getByRole("button", { name: /Accounts and records/ }).click();
    await expect(page.getByRole("link", { name: "Manage accounts" })).toBeVisible();
    await steps.getByRole("button", { name: /Budget/ }).click();
    expect(setupRequests).toBe(0);
    await steps.getByRole("button", { name: /Profile/ }).click();
    await page.reload();
    await expect(page.getByLabel("Household size")).toHaveValue("3");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({
      path: `/tmp/finance-configuration-${isMobile ? "mobile" : "desktop"}.png`,
    });
    await page.goto("/settings?page=finances&field=finances:household-size");
    await expect(page.getByLabel("Household size")).toHaveValue("3");
  } finally {
    await page.goto("/settings?page=finances&field=finances:household-size");
    const household = page.getByLabel("Household size");
    await expect(household).toBeEnabled();
    if ((await household.inputValue()) !== original) {
      const restored = page.waitForResponse(
        (response) =>
          response.url().endsWith("/v1/finances/profile") && response.request().method() !== "GET",
      );
      await household.fill(original);
      await household.press("Tab");
      expect((await restored).ok()).toBeTruthy();
    }
  }
});
