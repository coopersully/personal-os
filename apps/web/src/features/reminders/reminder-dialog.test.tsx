// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { Reminder, User } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../../api.js";
import { ReminderDialog } from "./reminder-dialog.js";

vi.mock("../../api.js", () => ({
  api: { getActiveReminderPreferences: vi.fn(), createReminder: vi.fn(), updateReminder: vi.fn() },
}));
const mocked = vi.mocked(api);
function setup(reminder?: Reminder) {
  const close = vi.fn();
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const owner = { id: "owner", planningTimezone: "UTC" } as User;
  cache.setQueryData(["me"], owner);
  render(
    <QueryClientProvider client={cache}>
      <ReminderDialog close={close} reminder={reminder} user={owner} />
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), close };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocked.getActiveReminderPreferences.mockResolvedValue({
    defaultActiveReminder: true,
    revision: 1,
  });
  mocked.createReminder.mockResolvedValue({ id: "created" } as Reminder);
  mocked.updateReminder.mockResolvedValue({ id: "edited" } as Reminder);
});
it("creates with an explicit false override and retains text on a failed save", async () => {
  mocked.createReminder.mockRejectedValueOnce(new Error("offline"));
  const { user, close } = setup();
  await user.type(screen.getByLabelText("What needs attention?"), "Call the studio");
  await user.selectOptions(screen.getByRole("combobox", { name: "Active reminder" }), "false");
  await user.click(screen.getByRole("button", { name: "Create reminder" }));
  await waitFor(() =>
    expect(mocked.createReminder).toHaveBeenCalledWith(
      expect.objectContaining({ activeReminder: false, title: "Call the studio" }),
    ),
  );
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText("What needs attention?")).toHaveValue("Call the studio");
});
it("edits the item flag using the loaded reminder revision", async () => {
  const reminder = {
    id: "r",
    title: "Call",
    notes: null,
    dueAt: null,
    priority: "medium",
    activeReminder: true,
    updatedAt: "2026-10-22T12:00:00Z",
  } as Reminder;
  const { user, close } = setup(reminder);
  expect(screen.getByRole("combobox", { name: "Active reminder" })).toHaveValue("true");
  await user.selectOptions(screen.getByRole("combobox", { name: "Active reminder" }), "false");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(mocked.updateReminder).toHaveBeenCalledWith(
      "r",
      expect.objectContaining({ activeReminder: false, expectedUpdatedAt: reminder.updatedAt }),
    ),
  );
  await waitFor(() => expect(close).toHaveBeenCalled());
});
