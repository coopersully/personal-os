import { expect, test } from "@playwright/test";

test("active reminder defaults and per-item overrides survive creation and reload", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("demo+full@nohmi.test");
  await page.getByLabel("Password", { exact: true }).fill("#%YxqD2Kz%8S#3");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("heading", { name: "To take care of" })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const preferencesPath = "/v1/active-reminders/preferences";
  const original = await (await page.request.get(preferencesPath)).json();
  const created: Array<{ kind: "task" | "reminder"; id: string }> = [];
  try {
    await page.goto("/settings?section=tasks");
    const toggle = page.getByRole("switch", { name: "Use active reminders for new items" });
    await expect(toggle).toBeEnabled();
    if (!(await toggle.isChecked())) {
      const save = page.waitForResponse(
        (r) => r.url().includes(preferencesPath) && r.request().method() === "PATCH",
      );
      await toggle.click();
      expect((await save).ok()).toBeTruthy();
    }
    await page.reload();
    await expect(toggle).toBeChecked();
    const reminderResponse = await page.request.post("/v1/reminders", {
      headers: { origin },
      data: { title: "Active reminder inherited default" },
    });
    expect(reminderResponse.ok()).toBeTruthy();
    const { reminder } = await reminderResponse.json();
    created.push({ kind: "reminder", id: reminder.id });
    expect(reminder.activeReminder).toBe(true);
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
    ).toBe(true);
  } finally {
    const latest = await (await page.request.get(preferencesPath)).json();
    await page.request.patch(preferencesPath, {
      headers: { origin },
      data: {
        defaultActiveReminder: original.defaultActiveReminder,
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
