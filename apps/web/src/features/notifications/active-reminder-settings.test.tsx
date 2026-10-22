// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../../api.js";
import {
  ActiveReminderField,
  ActiveReminderSettings,
  activeReminderInput,
} from "./active-reminder-settings.js";

vi.mock("../../api.js", () => ({
  api: { getActiveReminderPreferences: vi.fn(), saveActiveReminderPreferences: vi.fn() },
}));
const mocked = vi.mocked(api);
function setup(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["me"], { id: "owner" });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return userEvent.setup();
}
beforeEach(() => {
  vi.clearAllMocks();
  mocked.getActiveReminderPreferences.mockResolvedValue({
    defaultActiveReminder: true,
    revision: 1,
  });
  mocked.saveActiveReminderPreferences.mockResolvedValue({
    defaultActiveReminder: false,
    revision: 2,
  });
});
it("displays the creation default while preserving explicit false as a different intent", async () => {
  const user = setup(<ActiveReminderField ownerId="owner" />);
  const field = await screen.findByRole("combobox", { name: "Active reminder" });
  await screen.findByRole("option", { name: "Use account default (on)" });
  expect(field).toHaveValue("inherit");
  const form = new FormData();
  form.set("activeReminder", "inherit");
  expect(activeReminderInput(form)).toEqual({});
  await user.selectOptions(field, "false");
  form.set("activeReminder", "false");
  expect(activeReminderInput(form)).toEqual({ activeReminder: false });
  form.set("activeReminder", "true");
  expect(activeReminderInput(form)).toEqual({ activeReminder: true });
});
it("keeps edits explicit and saves defaults with revision and owner binding", async () => {
  const user = setup(
    <>
      <ActiveReminderField ownerId="owner" value={false} />
      <ActiveReminderSettings ownerId="owner" />
    </>,
  );
  expect(screen.getByRole("combobox", { name: "Active reminder" })).toHaveValue("false");
  const control = await screen.findByRole("switch", { name: "Use active reminders for new items" });
  await waitFor(() => expect(control).toBeChecked());
  await user.click(control);
  await waitFor(() =>
    expect(mocked.saveActiveReminderPreferences).toHaveBeenCalledWith(
      { defaultActiveReminder: false, expectedRevision: 1 },
      "owner",
    ),
  );
});
it("lets a failed default lookup recover without converting inheritance to false", async () => {
  mocked.getActiveReminderPreferences.mockRejectedValueOnce(new Error("offline"));
  const user = setup(<ActiveReminderField ownerId="owner" />);
  const retry = await screen.findByRole("button", { name: "Retry active reminder default" });
  expect(screen.getByRole("combobox", { name: "Active reminder" })).toHaveValue("inherit");
  await user.click(retry);
  await screen.findByRole("option", { name: "Use account default (on)" });
});
