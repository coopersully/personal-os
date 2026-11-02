// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

vi.spyOn(toast, "error");

import { api } from "../../api.js";
import { ActiveReminderField, activeReminderInput } from "./active-reminder-settings.js";

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
    defaultTaskActiveReminder: true,
    defaultReminderActiveReminder: true,
    revision: 1,
  });
  mocked.saveActiveReminderPreferences.mockResolvedValue({
    defaultActiveReminder: false,
    defaultTaskActiveReminder: false,
    defaultReminderActiveReminder: false,
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
it("retains an existing explicit false without looking up or changing defaults", () => {
  setup(<ActiveReminderField ownerId="owner" kind="task" value={false} />);
  expect(screen.getByRole("combobox", { name: "Active reminder" })).toHaveValue("false");
  expect(mocked.getActiveReminderPreferences).not.toHaveBeenCalled();
  expect(mocked.saveActiveReminderPreferences).not.toHaveBeenCalled();
});
it("lets a failed default lookup recover without converting inheritance to false", async () => {
  mocked.getActiveReminderPreferences.mockRejectedValueOnce(new Error("offline"));
  const user = setup(<ActiveReminderField ownerId="owner" />);
  const retry = await screen.findByRole("button", { name: "Retry active reminder default" });
  expect(screen.getByRole("combobox", { name: "Active reminder" })).toHaveValue("inherit");
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn’t load the active reminder default.",
      expect.any(Object),
    ),
  );
  expect(screen.queryByText("Couldn’t load the active reminder default.")).not.toBeInTheDocument();
  expect(screen.queryByText("offline")).not.toBeInTheDocument();
  await user.click(retry);
  await screen.findByRole("option", { name: "Use account default (on)" });
});

it.each([
  ["task", "on"],
  ["reminder", "off"],
] as const)("shows the independent %s default while retaining inheritance", async (kind, state) => {
  mocked.getActiveReminderPreferences.mockResolvedValue({
    defaultActiveReminder: false,
    defaultTaskActiveReminder: true,
    defaultReminderActiveReminder: false,
    revision: 1,
  });
  setup(<ActiveReminderField ownerId="owner" kind={kind} />);
  await screen.findByRole("option", { name: `Use account default (${state})` });
  expect(screen.getByRole("combobox", { name: "Active reminder" })).toHaveValue("inherit");
  expect(mocked.getActiveReminderPreferences).toHaveBeenCalledWith("owner");
});
