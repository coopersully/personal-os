import { expect, test } from "@playwright/test";

test("active reminder defaults and per-item overrides survive creation and reload", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/today(?:[?#]|$)/);
  const origin = new URL(page.url()).origin;
  const preferencesPath = "/v1/active-reminders/preferences";
  const original = await (await page.request.get(preferencesPath)).json();
  const created: Array<{ kind: "task" | "reminder"; id: string }> = [];
  try {
    await page.goto("/settings?page=active-cards");
    const toggle = page.getByRole("switch", { name: "New tasks", exact: true });
    const reminderToggle = page.getByRole("switch", { name: "New reminders", exact: true });
    await expect(toggle).toBeEnabled();
    if (!(await toggle.isChecked())) {
      const save = page.waitForResponse(
        (r) => r.url().includes(preferencesPath) && r.request().method() === "PATCH",
      );
      await toggle.click();
      expect((await save).ok()).toBeTruthy();
    }
    await expect(reminderToggle).toBeEnabled();
    if (!(await reminderToggle.isChecked())) {
      const save = page.waitForResponse(
        (r) => r.url().includes(preferencesPath) && r.request().method() === "PATCH",
      );
      await reminderToggle.click();
      expect((await save).ok()).toBeTruthy();
    }
    await page.reload();
    await expect(toggle).toBeChecked();
    await expect(reminderToggle).toBeChecked();
    await expect(page.getByRole("button", { name: "Gather", exact: true })).toBeEnabled();
    const preview = page.frameLocator(
      'iframe[title="Interactive active task and reminder preview"]',
    );
    await expect(preview.locator(".item").first()).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.locator('[data-settings-control-width="compact"]').evaluateAll((rows) =>
          rows.every((row) => {
            const label = row.querySelector('[data-slot="field-content"]')?.getBoundingClientRect();
            const control = row.querySelector('[role="switch"]')?.getBoundingClientRect();
            return (
              label &&
              control &&
              label.right < control.left &&
              control.right <= row.getBoundingClientRect().right
            );
          }),
        ),
      )
      .toBe(true);
    // A different default persists independently and changes only subsequent creation.
    const separateSave = page.waitForResponse(
      (r) => r.url().includes(preferencesPath) && r.request().method() === "PATCH",
    );
    await reminderToggle.click();
    expect((await separateSave).ok()).toBeTruthy();
    await page.reload();
    await expect(toggle).toBeChecked();
    await expect(reminderToggle).not.toBeChecked();
    const reminderResponse = await page.request.post("/v1/reminders", {
      headers: { origin },
      data: { title: "Active reminder inherited default" },
    });
    expect(reminderResponse.ok()).toBeTruthy();
    const { reminder } = await reminderResponse.json();
    created.push({ kind: "reminder", id: reminder.id });
    expect(reminder.activeReminder).toBe(false);
    const taskResponse = await page.request.post("/v1/tasks", {
      headers: { origin },
      data: { title: "Active task inherited default" },
    });
    expect(taskResponse.ok()).toBeTruthy();
    const { task } = await taskResponse.json();
    created.push({ kind: "task", id: task.id });
    expect(task.activeReminder).toBe(true);
    await page.goto(`/tasks?view=all&task=${task.id}`);
    const flag = page.getByRole("combobox", { name: "Active reminder" });
    await expect(flag).toHaveValue("true");
    await flag.selectOption("false");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(flag).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Active reminder" })).toHaveValue("false");
    expect(
      (await (await page.request.get(`/v1/tasks/${task.id}`)).json()).task.activeReminder,
    ).toBe(false);
    expect(
      (await (await page.request.get(`/v1/reminders/${reminder.id}`)).json()).reminder
        .activeReminder,
    ).toBe(false);
  } finally {
    const latest = await (await page.request.get(preferencesPath)).json();
    await page.request.patch(preferencesPath, {
      headers: { origin },
      data: {
        defaultTaskActiveReminder: original.defaultTaskActiveReminder,
        defaultReminderActiveReminder: original.defaultReminderActiveReminder,
        expectedRevision: latest.revision,
      },
    });
    for (const item of created) {
      if (item.kind === "reminder")
        await page.request.delete(`/v1/reminders/${item.id}`, { headers: { origin } });
      else {
        const { task } = await (await page.request.get(`/v1/tasks/${item.id}`)).json();
        await page.request.post(`/v1/tasks/${item.id}/trash`, {
          headers: { origin },
          data: { expectedRevision: task.revision },
        });
      }
    }
  }
});
