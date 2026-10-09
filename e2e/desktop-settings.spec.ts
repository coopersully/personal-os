import { expect, test } from "@playwright/test";

for (const width of [390, 1100, 1440]) {
  test(`desktop preferences remain discoverable and contained at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    // Keep the real application/API flow; stub only the native process boundary.
    await page.addInitScript(() => {
      const settings = {
        serverUrl: "https://nohmi-api.coopersully.me",
        launchAtLogin: false,
        petEnabled: false,
        petColor: "#c7d23c",
        petWorkspaces: ["tasks"],
        widgetWorkspaces: ["tasks"],
        notifications: {
          enabled: false,
          tasks: true,
          reminders: true,
          calendar: true,
          mail: false,
          advanceMinutes: 10,
          sound: true,
          preview: false,
          quietStart: null,
          quietEnd: null,
          mailAccountIds: [],
          calendarIds: [],
        },
      };
      const savedSettings = localStorage.getItem("desktop-test-settings");
      if (savedSettings) Object.assign(settings, JSON.parse(savedSettings));
      Object.assign(window, {
        isTauri: true,
        __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
        __TAURI_INTERNALS__: {
          metadata: { currentWindow: { label: "main" } },
          transformCallback: () => 1,
          invoke: async (
            command: string,
            args: {
              settings?: typeof settings;
              request?: { path: string; method: string; body: string | null };
            },
          ) => {
            if (command === "desktop_save_settings" && args.settings) {
              Object.assign(settings, args.settings);
              localStorage.setItem("desktop-test-settings", JSON.stringify(settings));
              return {
                settings,
                native: { loginStatus: "notRegistered", notificationPermission: "denied" },
              };
            }
            if (command === "desktop_update_status")
              return { phase: "unavailable", startupBlocking: false, installedVersion: "0.1.0" };
            if (command === "desktop_settings")
              return {
                settings,
                native: {
                  loginStatus: "notRegistered",
                  notificationPermission: "denied",
                  widgetsAvailable: false,
                },
              };
            if (command === "ritual_local") return { enabled: false, queue: [], localHistory: [] };
            if (command === "desktop_request" && args.request) {
              const response = await fetch(args.request.path, {
                method: args.request.method,
                body: args.request.body,
                headers: { "content-type": "application/json" },
              });
              return { status: response.status, body: await response.text() };
            }
            return null;
          },
        },
      });
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Server settings" })).toBeVisible();
    await expect(page.getByText("Hosted nohmi", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Server settings" }).click();
    const server = page.getByRole("dialog", { name: "Server connection" });
    await expect(server).toBeVisible();
    await server.getByRole("button", { name: "Advanced server settings" }).click();
    await expect(server.getByLabel("Custom API server")).toBeVisible();
    await expectContained();
    await page.screenshot({ path: `/tmp/nohmi-server-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Server settings" })).toBeFocused();
    await expect(server).toHaveCount(0);
    await page.screenshot({ path: `/tmp/nohmi-login-${width}.png` });
    await page.getByLabel("Email").fill("demo+full@nohmi.test");
    await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
    for (const section of ["desktop", "pet", "rituals"]) {
      await page.goto(`/settings?section=${section}`);
      await expect(
        page.getByRole("heading", {
          name:
            section === "desktop" ? "Desktop app" : section === "pet" ? "Desktop pet" : "Rituals",
          level: 1,
        }),
      ).toBeVisible();
      await expect(page.getByText("Make room for your morning and evening")).toHaveCount(0);
      if (section === "desktop")
        await expect(page.getByRole("switch", { name: "Open at login" })).toBeVisible();
      if (section === "pet")
        await expect(page.getByRole("switch", { name: "Show desktop pet" })).toBeVisible();
      if (section === "rituals") {
        await expect(page.getByRole("link", { name: "Background settings" })).toBeVisible();
        await page.getByRole("link", { name: "Background settings" }).scrollIntoViewIfNeeded();
      } else {
        await expect(page.getByText("Checking", { exact: true })).toHaveCount(0);
      }
      if (section === "pet" && width >= 1100) {
        await expect(
          page
            .locator('[data-slot="sidebar"]')
            .getByRole("link", { name: "Desktop pet", exact: true }),
        ).toBeVisible();
      }
      await expectContained();
      await page.screenshot({ path: `/tmp/nohmi-${section}-${width}.png`, fullPage: true });
    }
    await page.goto("/settings?section=appearance");
    const themeCards = page.locator(".appearance-picker .choice-card");
    for (const card of await themeCards.all()) {
      const label = await card.locator(".choice-card__label").boundingBox();
      const preview = await card.locator(".choice-card__preview").boundingBox();
      expect(label!.y + label!.height).toBeLessThanOrEqual(preview!.y);
    }
    await page.goto("/settings?section=wallpaper");
    await expect(page.getByRole("heading", { name: "Wallpaper", exact: true })).toBeVisible();
    for (const title of ["Layout", "Appearance", "Framing"]) {
      await expect(
        page
          .locator('[data-slot="card"]')
          .filter({ has: page.getByRole("heading", { name: title, exact: true }) }),
      ).toHaveCount(1);
    }
    if (width >= 1100) {
      const settingsBounds = await page.locator(".wallpaper-editor__settings").boundingBox();
      const previewBounds = await page.locator(".wallpaper-editor__preview").boundingBox();
      expect(previewBounds!.x).toBeGreaterThanOrEqual(settingsBounds!.x + settingsBounds!.width);
      expect(Math.abs(previewBounds!.y - settingsBounds!.y)).toBeLessThan(2);
    }
    const preview = page.getByRole("region", { name: "Wallpaper preview" });
    const save = page.getByRole("button", { name: "Save board" });
    await expect(page.locator('[data-slot="input-group"]').filter({ has: save })).toHaveCount(1);
    for (const slider of await page.getByRole("slider").all()) {
      await slider.focus();
      await slider.press("End");
      await expectContained();
      await slider.press("Home");
      await expectContained();
    }
    await page.getByText(/^Link edge padding/).scrollIntoViewIfNeeded();
    const bounds = await preview.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    const tracks = await page
      .locator('[data-slot="slider-track"]')
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    expect(tracks.every((height) => height > 0)).toBe(true);
    await page.screenshot({ path: `/tmp/nohmi-wallpaper-page-${width}.png` });
    const refresh = page.getByRole("button", { name: "Refresh wallpaper" });
    await expect(
      page.locator(".wallpaper-editor__preview").getByRole("button", { name: "Refresh wallpaper" }),
    ).toBeVisible();
    // This fixture board is deliberately fictional; failures must not permit applying it.
    await expect(refresh).toBeDisabled();
    await page.goto("/settings?section=notifications");
    await expect(page.getByRole("switch", { name: "Enable notifications" })).toBeVisible();
    const fromBounds = await page.getByLabel("From", { exact: true }).boundingBox();
    const untilBounds = await page.getByLabel("Until", { exact: true }).boundingBox();
    if (width >= 640) {
      expect(Math.abs(fromBounds!.y - untilBounds!.y)).toBeLessThan(2);
      expect(untilBounds!.x).toBeGreaterThan(fromBounds!.x + fromBounds!.width);
    } else {
      expect(untilBounds!.y).toBeGreaterThan(fromBounds!.y + fromBounds!.height);
    }
    await expect(page.getByRole("switch", { name: "Tasks due" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save preferences" })).toHaveCount(0);
    await page.getByRole("switch", { name: "Enable notifications" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("desktop-test-settings") ?? "{}").notifications
              ?.enabled,
        ),
      )
      .toBe(true);
    for (const workspace of ["Calendar", "Tasks", "Mail", "Finances"]) {
      await page.goto("/settings?section=notifications");
      await expect(page.getByRole("switch", { name: "Enable notifications" })).toBeChecked();
      await page.getByRole("link", { name: `${workspace} Notification settings` }).click();
      await expect(page).toHaveURL(new RegExp(`section=${workspace.toLowerCase()}&field=`));
      const heading = page.getByRole("heading", { name: "Notifications", exact: true });
      await expect(heading).toBeFocused();
      const box = await heading.boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeLessThan(844);
      await expect(page.getByRole("button", { name: "Save preferences" })).toHaveCount(0);
    }
    async function expectContained() {
      const overflow = await page.evaluate(() => {
        const clipped = [...document.querySelectorAll("button,input,a[role=button]")]
          .filter((element) => {
            const bounds = element.getBoundingClientRect();
            if (!bounds.width || !bounds.height || getComputedStyle(element).opacity === "0")
              return false;
            const owner = element.closest('[data-slot="card"], [role="dialog"]');
            if (!owner) return false;
            const box = owner.getBoundingClientRect();
            return bounds.left < box.left - 1 || bounds.right > box.right + 1;
          })
          .map((element) => ({
            tag: element.tagName,
            id: element.id,
            text: element.textContent,
            type: element.getAttribute("type"),
          }));
        return { page: document.documentElement.scrollWidth > innerWidth, clipped };
      });
      expect(overflow).toEqual({ page: false, clipped: [] });
    }
  });
}
