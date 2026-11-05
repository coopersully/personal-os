import { saveActiveReminderPreferencesSchema } from "@personal-os/domain";
import { createActiveReminderApiClient } from "./active-reminders.js";

it("normalizes legacy responses and sends independent defaults with revision and account guards", async () => {
  const request = vi.fn(
    async (): Promise<Record<string, unknown>> => ({ defaultActiveReminder: true, revision: 3 }),
  );
  const api = createActiveReminderApiClient(
    request as unknown as Parameters<typeof createActiveReminderApiClient>[0],
    () => "",
  );
  expect(await api.getActiveReminderPreferences("owner")).toEqual({
    defaultActiveReminder: true,
    defaultTaskActiveReminder: true,
    defaultReminderActiveReminder: true,
    revision: 3,
  });
  expect(request).toHaveBeenLastCalledWith("/v1/active-reminders/preferences", {
    headers: { "x-nohmi-account": "owner" },
  });
  const input = {
    defaultTaskActiveReminder: true,
    defaultReminderActiveReminder: false,
    expectedRevision: 3,
  };
  request.mockResolvedValueOnce({
    defaultActiveReminder: false,
    defaultTaskActiveReminder: true,
    defaultReminderActiveReminder: false,
    revision: 4,
  });
  expect(await api.saveActiveReminderPreferences(input, "owner")).toMatchObject({
    defaultTaskActiveReminder: true,
    defaultReminderActiveReminder: false,
    revision: 4,
  });
  expect(request).toHaveBeenLastCalledWith("/v1/active-reminders/preferences", {
    method: "PATCH",
    headers: { "x-nohmi-account": "owner" },
    body: JSON.stringify(input),
  });
  expect(
    saveActiveReminderPreferencesSchema.safeParse({ ...input, defaultActiveReminder: true })
      .success,
  ).toBe(false);
  expect(
    saveActiveReminderPreferencesSchema.safeParse({
      defaultTaskActiveReminder: true,
      expectedRevision: 3,
    }).success,
  ).toBe(false);
  expect(
    saveActiveReminderPreferencesSchema.safeParse({
      defaultActiveReminder: true,
      expectedRevision: 3,
    }).success,
  ).toBe(true);
});
