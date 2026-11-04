import { expect, test } from "@playwright/test";

for (const width of [320, 390, 1100]) {
  test(`workspace header geometry and scope controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/login");
    await page.getByLabel("Email").fill("demo+full@nohmi.test");
    await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: "up next" })).toBeVisible();
    for (const route of ["/tasks", "/calendar", "/mail", "/finances/spending"]) {
      await page.goto(route);
      const header = page.getByRole("navigation", { name: "Top navigation", exact: true });
      const title = header.locator('[data-slot="workspace-title-sentence"]');
      await expect(title).toBeVisible();
      const search = header.getByRole(width < 768 ? "button" : "combobox", {
        name: /^Search /,
      });
      await expect(search).toBeVisible();
      if (width < 768) {
        // The first header control follows the visible workspace identity row.
        await header.locator("a[href], button, input").first().focus();
        await expect(header.getByRole("button", { name: "Switch workspace" })).toBeFocused();
        const switcher = await header
          .getByRole("button", { name: "Switch workspace" })
          .boundingBox();
        const searchBounds = await search.boundingBox();
        expect(switcher).not.toBeNull();
        expect(searchBounds).not.toBeNull();
        expect(searchBounds!.x, route).toBeGreaterThanOrEqual(switcher!.x + switcher!.width);
      }
      if (route === "/calendar") await expect(title.getByRole("heading")).toBeVisible();
      if (route === "/tasks")
        await expect(
          page.getByRole("button", { name: "Open Compare renters insurance renewals" }),
        ).toBeVisible();
      if (route === "/finances/spending")
        await expect(title.getByRole("button", { name: /^Date range:/ })).toBeVisible();
      const geometry = await header.evaluate((element) => {
        const titleElement = element.querySelector(
          '[data-slot="workspace-title-sentence"]',
        ) as HTMLElement;
        const context = element.querySelector(".workspace-app-bar__context") as HTMLElement;
        const controls = [
          ...element.querySelectorAll<HTMLElement>(
            '.workspace-app-bar__context button[data-size^="icon"], .workspace-app-bar__page-actions button[data-size^="icon"], .workspace-app-bar__actions button[data-size^="icon"]',
          ),
        ].filter(
          (button) =>
            button.getBoundingClientRect().width > 0 &&
            !button.closest(".workspace-primary-actions"),
        );
        return {
          height: element.getBoundingClientRect().height,
          titleY: titleElement.getBoundingClientRect().y,
          titleBottom: titleElement.getBoundingClientRect().bottom,
          contextY: context.getBoundingClientRect().y,
          contextBottom: context.getBoundingClientRect().bottom,
          fontSize: getComputedStyle(titleElement).fontSize,
          overflow: document.documentElement.scrollWidth > innerWidth,
          controls: controls.map((button) => ({
            width: button.getBoundingClientRect().width,
            height: button.getBoundingClientRect().height,
            right: button.getBoundingClientRect().right,
          })),
        };
      });
      expect(geometry.overflow, route).toBe(false);
      expect(geometry.height, route).toBe(104);
      if (width > 900)
        expect(geometry.contextY, route).toBeGreaterThanOrEqual(geometry.titleBottom);
      else expect(geometry.titleY, route).toBeGreaterThanOrEqual(geometry.contextBottom);
      if (width < 768) {
        expect(geometry.titleY, route).toBeGreaterThanOrEqual(geometry.contextBottom);
        expect(geometry.fontSize, route).toBe("17px");
        for (const control of geometry.controls) {
          expect(control.width, route).toBe(44);
          expect(control.height, route).toBe(44);
          expect(control.right, route).toBeLessThanOrEqual(width);
        }
      }
      await page.screenshot({ path: `.context/header-${width}-${route.split("/").at(-1)}.png` });
      if (route === "/tasks") {
        await title.getByRole("button", { name: /^Tasks view:/ }).click();
        await page.getByRole("menuitemradio", { name: "Today", exact: true }).click();
        await expect(page).toHaveURL(/view=today/);
      }
      if (route === "/calendar") {
        await title.getByRole("button", { name: /^Calendar view:/ }).click();
        await page.getByRole("menuitemradio", { name: "Week", exact: true }).click();
        await expect(page).toHaveURL(/view=week/);
      }
      if (route === "/mail") {
        await expect(
          page.getByRole("navigation", { name: "Mail controls", exact: true }),
        ).toHaveCount(0);
        await title.getByRole("button", { name: "Mail view: Inbox" }).click();
        await page.getByRole("menuitemradio", { name: "Unread", exact: true }).click();
        await expect(page).toHaveURL(/unread=1/);
        await expect(header.getByRole("button", { name: "View options", exact: true })).toHaveCount(
          0,
        );
        await page.getByRole("button", { name: "Message list layout", exact: true }).click();
        await expect(
          page.getByRole("menuitemradio", { name: "Full-width view", exact: true }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
      }
    }
  });
}
