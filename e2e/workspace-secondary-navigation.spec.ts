import { expect, test } from "@playwright/test";

for (const width of [320, 390, 1100]) {
  test(`shared Tasks workspace remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await page.getByLabel("Email").fill("demo+full@ilo.test");
    await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
    await page.goto("/tasks");
    const bar = page.getByRole("navigation", { name: "Tasks page controls" });
    await expect(bar.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open Compare renters insurance renewals" }),
    ).toBeVisible();
    const primary = await page.getByRole("navigation", { name: "Top navigation" }).boundingBox();
    expect((await bar.boundingBox())?.y).toBe((primary?.y ?? 0) + (primary?.height ?? 0));
    if (width < 768) await page.getByRole("button", { name: "Workspace actions" }).click();
    const sidebar =
      width < 768
        ? page.getByRole("dialog")
        : page.getByRole("complementary", { name: "Tasks Sidebar" });
    for (const name of [
      "Inbox",
      "Today",
      "Upcoming",
      "All",
      "History",
      "Trash",
      "Launch follow-through",
    ])
      await expect(sidebar.getByRole("link", { name, exact: true })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: /More views|Expand|Collapse/ })).toHaveCount(
      0,
    );
    await sidebar.getByRole("link", { name: "All", exact: true }).click();
    await expect(bar.getByRole("heading", { name: "All", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Call Mom" })).toBeVisible();
    await bar.getByRole("button", { name: "Filters", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Task filters" });
    await expect(dialog).toHaveAttribute("data-presentation", width < 768 ? "drawer" : "dialog");
    await dialog.getByLabel("Type", { exact: true }).selectOption("reminder");
    await expect(dialog.getByLabel("Reserved time", { exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/kind=reminder/);
    await expect(page.getByRole("button", { name: "Open Call Mom" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open Compare renters insurance renewals" }),
    ).toHaveCount(0);
    await bar.getByRole("button", { name: /Filters/ }).click();
    await dialog.getByRole("button", { name: "Clear", exact: true }).click();
    await bar.getByRole("button", { name: "Sort", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Priority", exact: true }).click();
    await expect(page).toHaveURL(/sort=priority/);
    await bar.getByRole("button", { name: "Display", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Date", exact: true }).click();
    await expect(page).toHaveURL(/group=date/);
    await expect(page.getByRole("heading", { name: "No date" })).toBeVisible();
    await page.getByRole("button", { name: "Select items", exact: true }).click();
    await page.getByRole("checkbox", { name: "Select Call Mom", exact: true }).click();
    await expect(
      page
        .getByRole("group", { name: "Selected item actions" })
        .getByRole("button", { name: "Complete", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Done selecting", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.goto("/tasks?view=scheduled");
    await expect(page).toHaveURL(/view=all&reserved=scheduled/);
    await expect(
      page.getByRole("button", { name: "Open Review monthly subscriptions" }),
    ).toBeVisible();
    await page.goto("/tasks?view=history");
    await expect(page.getByRole("button", { name: "Open Book dentist appointment" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Archived lists & projects" })).toBeVisible();
    await page.goto("/reminders");
    await expect(page).toHaveURL(/\/tasks\?view=all&kind=reminder/);
    await expect(page.getByRole("button", { name: "Open Call Mom" })).toBeVisible();
    await page.goto("/calendar?view=week");
    await expect(page.getByRole("navigation", { name: "Calendar week navigation" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Tasks page controls" })).toHaveCount(0);
  });
}
