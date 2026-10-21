import { expect, test } from "@playwright/test";

test("settings support field search, ritual history, and resumable setup replay", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await page.goto("/settings?section=rituals");
  await expect(page.getByRole("heading", { name: "Rituals", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Top navigation" })).toHaveCount(
    test.info().project.use.isMobile ? 1 : 0,
  );
  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search all settings" }).fill("time zone");
  const results = page.getByRole("navigation", { name: "Settings search results" });
  await expect(results.getByRole("link", { name: /^Time zone Profile/ })).toBeVisible();
  await expect(results.getByRole("link", { name: /Appearance/ })).toHaveCount(0);
  // Exercise real result focus in both themes; a text-only unit test cannot catch
  // foreground/background collisions from the shared CSS cascade.
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (mode) => document.documentElement.classList.toggle("dark", mode === "dark"),
      theme,
    );
    await page.getByRole("searchbox", { name: "Search all settings" }).press("Tab");
    const result = results.getByRole("link").first();
    await expect(result).toBeFocused();
    const colors = await result.evaluate((element) => {
      const style = getComputedStyle(element);
      const probe = document.createElement("span");
      document.body.append(probe);
      const token = (name: string) => {
        probe.style.backgroundColor = `var(--${name})`;
        return getComputedStyle(probe).backgroundColor;
      };
      const values = {
        foreground: style.color,
        selected: style.backgroundColor,
        canvas: token("background"),
        card: token("card"),
        overlay: token("popover"),
        sidebar: token("sidebar"),
        muted: getComputedStyle(element.querySelector(".text-muted-foreground") ?? element).color,
      };
      probe.remove();
      return values;
    });
    const contrast = (a: string, b: string) => {
      const luminance = (color: string) => {
        const channels = (color.match(/[\d.]+/g) ?? [])
          .slice(0, 3)
          .map(Number)
          .map((n) => n / 255)
          .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
        return (
          (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722
        );
      };
      const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
      return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
    };
    expect(contrast(colors.foreground, colors.selected)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.muted, colors.selected)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.card, colors.canvas)).toBeGreaterThanOrEqual(1.16);
    for (const behind of [colors.card, colors.canvas, colors.sidebar]) {
      expect(contrast(colors.overlay, behind)).toBeGreaterThanOrEqual(1.1);
    }
    const shape = await page
      .getByRole("searchbox", { name: "Search all settings" })
      .evaluate((element) => {
        const input = element.closest('[data-slot="input-group"]') ?? element;
        const dialog = element.closest('[role="dialog"]');
        if (!dialog) throw new Error("Missing search dialog");
        return {
          control: parseFloat(getComputedStyle(input).borderTopLeftRadius),
          panel: parseFloat(getComputedStyle(dialog).borderTopLeftRadius),
          height: input.getBoundingClientRect().height,
        };
      });
    expect(shape.control).toBeLessThan(shape.height / 3);
    expect(shape.panel).toBeGreaterThan(shape.control);
    await page.getByRole("searchbox", { name: "Search all settings" }).focus();
  }
  await page.evaluate(() => document.documentElement.classList.remove("dark"));

  await results.getByRole("link", { name: /^Time zone Profile/ }).click();
  await expect(page.locator("#profile-timezone")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Daily defaults" })).toBeVisible();
  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search all settings" }).fill("rituals");
  await page
    .getByRole("navigation", { name: "Settings search results" })
    .getByRole("link", { name: /^Rituals Shape/ })
    .click();
  await expect(page.getByRole("radio", { name: "Morning", exact: true })).toBeVisible();
  await expect(page.getByLabel("Available from").first()).toHaveValue("06:00");
  await page.getByRole("radio", { name: "Evening", exact: true }).click();
  await expect(page.getByLabel("Available from").nth(1)).toHaveValue("21:00");
  await page.getByRole("radio", { name: "Morning", exact: true }).click();
  await page.getByLabel("Prompt", { exact: true }).first().fill("Morning water");
  await page.getByLabel("Requirement", { exact: true }).first().selectOption("optional");
  await page.getByLabel("Requirement", { exact: true }).nth(1).selectOption("optional");
  await page.getByLabel("Include on", { exact: true }).nth(1).selectOption("weekdays");
  await page.getByLabel("Morning reminder time").fill("13:30");
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/v1/rituals/morning") &&
      r.request().method() === "PUT" &&
      r.request().postDataJSON().enabled === true,
  );
  await page.getByRole("checkbox", { name: "Enable morning ritual" }).check();
  expect((await saved).status()).toBe(200);
  await page.reload();
  const liveState = await (await page.request.get("/v1/rituals/current")).json();
  if (
    liveState.current?.status === "pending" &&
    Date.parse(liveState.current.dueAt) <= Date.parse(liveState.serverNow)
  ) {
    const live = page.getByRole("dialog", { name: "Morning ritual", exact: true });
    await expect(live).toBeVisible({ timeout: 15000 });
    await live.getByRole("button", { name: "Complete Morning Ritual" }).click();
    await live.getByRole("button", { name: "Finish ritual" }).click();
    await expect(live).toHaveCount(0);
  }
  await expect(page.getByLabel("Prompt", { exact: true }).first()).toHaveValue("Morning water");
  await expect(page.getByRole("checkbox", { name: "Enable morning ritual" })).toBeChecked();
  await expect(page.getByLabel("Morning reminder time")).toHaveValue("13:30");
  await expect(page.getByLabel("Requirement", { exact: true }).first()).toHaveValue("optional");
  await expect(page.getByLabel("Include on", { exact: true }).nth(1)).toHaveValue("weekdays");
  await page.getByRole("button", { name: "Show morning ritual" }).click();
  const preview = page.getByRole("dialog", { name: "Ritual preview" });
  expect(
    await preview.evaluate((element) => ({
      image: getComputedStyle(element).backgroundImage,
      color: getComputedStyle(element).backgroundColor,
    })),
  ).toEqual({ image: "none", color: "rgb(203, 220, 229)" });
  await expect(preview.getByRole("button", { name: "Complete Morning Ritual" })).toBeEnabled();
  await preview.getByRole("button", { name: "Complete Morning Ritual" }).click();
  await preview.getByRole("checkbox", { name: "Remind me about these later" }).check();
  await expect(preview.getByLabel("Reminder time")).toHaveValue("13:30");
  await preview.getByLabel("Reminder time").fill("14:00");
  expect(await preview.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await preview.getByRole("button", { name: "Finish ritual" }).click();
  await expect(preview).toHaveCount(0);
  await page.getByRole("radio", { name: "History and data", exact: true }).click();
  await expect(page.getByRole("region", { name: "Ritual history" })).toBeVisible();
  expect(await page.locator("html").evaluate((e) => e.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "Delete morning data" }).click();
  const deleted = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/rituals/morning/data") &&
      response.request().method() === "DELETE",
  );
  await page.getByRole("button", { name: "Delete permanently" }).click();
  expect((await deleted).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "Enable morning ritual" })).not.toBeChecked();
  await page.goto("/settings?section=setup");
  await expect(page.getByRole("heading", { name: "Setup", level: 1 })).toBeVisible();
  const setupSaved = page.waitForResponse(
    (response) => response.url().endsWith("/v1/setup") && response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save setup preferences" }).click();
  expect((await setupSaved).ok()).toBe(true);
  await page.getByRole("link", { name: "View setup experience" }).click();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: /What should nohmi help with/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /What should nohmi help with/ })).toBeVisible();
  await page.getByRole("button", { name: "Exit Setup" }).click();
  await expect(page.getByRole("heading", { name: "Setup", level: 1 })).toBeVisible();
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
});

test("ritual skipping requires a continuous hold and shows streak impact", async ({ page }) => {
  await page.addInitScript(() => {
    const state = {
      definitions: [],
      serverNow: new Date().toISOString(),
      snoozeCount: 0,
      skipCount: 1,
      streakCount: 1,
      completionWeek: [
        { date: "2026-10-14", status: "completed" },
        { date: "2026-10-15", status: "not_recorded" },
        { date: "2026-10-16", status: "completed" },
        { date: "2026-10-17", status: "not_scheduled" },
        { date: "2026-10-18", status: "skipped" },
        { date: "2026-10-19", status: "completed" },
        { date: "2026-10-20", status: "pending" },
      ],
      syncStatus: "saved",
      current: {
        id: "hold-test",
        revision: 1,
        status: "pending",
        responses: [],
        actions: [],
        definition: {
          kind: "morning",
          title: "Morning ritual",
          steps: [{ id: "brush", label: "Brush teeth", kind: "checkbox" }],
        },
      },
    };
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args?: { body?: { kind?: string } }) => {
          if (command === "ritual_state") return structuredClone(state);
          if (command === "ritual_mutate" && args?.body?.kind === "skip") {
            state.current.status = "skipped";
            localStorage.setItem("ritual-test-skipped", "true");
            return { outcome: "applied", state: structuredClone(state) };
          }
          return null;
        },
      },
    });
  });
  await page.goto("/#ritual");
  await expect(page.getByRole("button", { name: "1-day morning streak" })).toBeVisible();
  const week = page.getByRole("region", { name: "Past 7 ritual days" });
  await expect(week).toBeVisible();
  await expect(week.getByRole("listitem")).toHaveCount(7);
  await expect(week.locator(".ritual-day-dot-complete")).toHaveCount(3);
  await expect(week.getByRole("listitem", { name: /October 20, 2026: Pending/ })).toBeVisible();
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 320, height: 844 });
  const fits = await week.evaluate((element) => element.scrollWidth <= element.clientWidth);
  expect(fits).toBe(true);
  expect(
    await page
      .getByRole("region", { name: "Ritual progress" })
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("ritual-progress.png"),
    animations: "disabled",
  });
  if (viewport) await page.setViewportSize(viewport);
  await page.getByRole("button", { name: "Skip for Today" }).click();
  await expect(page.getByText(/1 time in the last 3 days/)).toBeVisible();
  await expect(page.getByText(/end your 1-day streak/)).toBeVisible();
  await page.clock.install();
  const button = page.getByRole("button", { name: "Hold to skip today" });
  await button.focus();
  await page.keyboard.down("Space");
  await page.clock.runFor(29000);
  await expect(button).toHaveText("Hold to skip · 1s");
  await page.keyboard.up("Space");
  await expect(button).toHaveText("Hold to skip · 30s");
  expect(await page.evaluate(() => localStorage.getItem("ritual-test-skipped"))).toBeNull();
  const box = await button.boundingBox();
  if (!box) throw new Error("Missing hold button");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.clock.runFor(30000);
  await page.mouse.up();
  await expect(page.getByText("You’re up to date.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("ritual-test-skipped"))).toBe("true");
});

test("browser rituals preserve the current page and save real answers and optional reminders", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/today/);
  await page.request.delete("/v1/rituals/morning/data");
  await page.request.delete("/v1/rituals/night/data");
  await page.reload();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  await page.goto("/settings?section=rituals");
  await page.getByRole("button", { name: "Search settings", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search all settings" });
  await search.fill("calendar");
  const before = page.url();
  try {
    const saved = await page.request.put("/v1/rituals/morning", {
      data: {
        requestId: crypto.randomUUID(),
        deviceId: "browser-acceptance",
        expectedRevision: 0,
        kind: "morning",
        title: "Browser morning",
        enabled: true,
        time: "00:00",
        timeZone: "UTC",
        steps: [
          { id: "water", label: "Drink browser water", kind: "checkbox" },
          { id: "stretch", label: "Browser optional stretch", kind: "checkbox", optional: true },
        ],
      },
    });
    expect(saved.ok()).toBe(true);
    const ritual = page.getByRole("dialog", { name: "Morning ritual", exact: true });
    await expect(ritual).toBeVisible({ timeout: 15000 });
    await expect(ritual.getByRole("button", { name: "0-day morning streak" })).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(ritual).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(ritual).toBeVisible();
    await ritual.getByRole("button", { name: "Skip for Today" }).click();
    await expect(ritual.getByRole("region", { name: "Confirm skip" })).toBeVisible();
    await expect(ritual.getByRole("region", { name: "Ritual progress" })).toHaveCount(0);
    await expect(ritual.getByText("Saved to your account", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(ritual.getByRole("region", { name: "Confirm skip" })).toHaveCount(0);
    await expect(ritual.getByRole("region", { name: "Past 7 ritual days" })).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("browser-ritual.png"),
      animations: "disabled",
    });
    await ritual.getByRole("checkbox", { name: "Drink browser water" }).click();
    await expect(ritual.getByRole("checkbox", { name: "Drink browser water" })).toBeChecked();
    await expect(ritual.getByLabel("Reminder time")).toHaveCount(0);
    await ritual.getByRole("button", { name: "Complete Morning Ritual" }).click();
    await expect(ritual.getByRole("region", { name: "Ritual progress" })).toHaveCount(0);
    await expect(ritual.getByText("Saved to your account", { exact: true })).toHaveCount(0);
    await ritual.getByRole("checkbox", { name: "Remind me about these later" }).check();
    await ritual.getByLabel("Reminder time").fill("23:59");
    await ritual.getByRole("button", { name: "Finish ritual" }).click();
    await expect(ritual).toHaveCount(0);
    await expect(search).toBeVisible();
    await expect(search).toHaveValue("calendar");
    expect(page.url()).toBe(before);
    const current = await (await page.request.get("/v1/rituals/current")).json();
    expect(current.current.status).toBe("completed");
    expect(
      current.current.responses.some(
        (answer: { stepId: string; value: unknown }) =>
          answer.stepId === "water" && answer.value === true,
      ),
    ).toBe(true);
    expect(current.current.optionalFollowUp.reminderIds).toHaveLength(1);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Rituals", exact: true })).toBeVisible();
    await expect(ritual).toHaveCount(0);
  } finally {
    const response = await page.request.get("/v1/rituals/current");
    if (response.ok()) {
      const current = (await response.json()).current;
      if (current?.definition?.title === "Browser morning") {
        for (const id of current.optionalFollowUp?.reminderIds ?? []) {
          await page.request.delete(`/v1/reminders/${id}`);
        }
      }
    }
    await page.request.delete("/v1/rituals/morning/data");
  }
});

test("browser snooze survives reload and another client can settle the same ritual", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/today/);
  await page.request.delete("/v1/rituals/morning/data");
  await page.request.delete("/v1/rituals/night/data");
  await page.reload();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  try {
    const saved = await page.request.put("/v1/rituals/night", {
      data: {
        requestId: crypto.randomUUID(),
        deviceId: "browser-acceptance",
        expectedRevision: 0,
        kind: "night",
        title: "Browser evening",
        enabled: true,
        time: "00:01",
        timeZone: "UTC",
        steps: [{ id: "reflect", label: "Evening reflection", kind: "checkbox", optional: true }],
      },
    });
    expect(saved.ok()).toBe(true);
    const ritual = page.getByRole("dialog", { name: "Evening ritual", exact: true });
    await expect(ritual).toBeVisible({ timeout: 15000 });
    await ritual.getByRole("button", { name: "Snooze", exact: true }).click();
    await expect(ritual).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
    await expect(ritual).toHaveCount(0);
    const current = await (await page.request.get("/v1/rituals/current")).json();
    expect(Date.parse(current.current.snoozedUntil)).toBeGreaterThan(Date.parse(current.serverNow));
    const complete = await page.request.post(
      `/v1/rituals/occurrences/${current.current.id}/actions`,
      {
        data: {
          requestId: crypto.randomUUID(),
          deviceId: "other-client",
          expectedRevision: current.current.revision,
          observedAt: new Date().toISOString(),
          kind: "complete",
        },
      },
    );
    expect(complete.ok()).toBe(true);
    expect((await complete.json()).state.current.status).toBe("completed");
    await page.reload();
    await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
    await expect(ritual).toHaveCount(0);
  } finally {
    await page.request.delete("/v1/rituals/night/data");
  }
});
