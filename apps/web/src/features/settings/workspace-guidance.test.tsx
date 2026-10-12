// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceGuidance } from "./workspace-guidance";

const mocks = vi.hoisted(() => ({
  getDomainProfile: vi.fn(),
  upsertDomainProfile: vi.fn(),
  listCalendars: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api: mocks, errorMessage: (error: Error) => error.message }));
const profile = {
  domain: "tasks",
  version: 3,
  objective: "Keep commitments manageable",
  instructions: ["Protect focus"],
  categories: [{ name: "Work" }],
  preferences: { preserve: true },
  sourceContexts: [{ source: "manual" }],
  status: "active",
  summary: "Existing approved guidance",
};
function mount(domain: "calendar" | "mail" | "tasks" = "tasks") {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cache}>
      <WorkspaceGuidance domain={domain} />
    </QueryClientProvider>,
  );
  return cache;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDomainProfile.mockResolvedValue(profile);
  mocks.upsertDomainProfile.mockImplementation(async (input) => ({ ...input, version: 4 }));
});
it("saves a versioned edit without dropping unrelated preferences and normalizes the saved draft", async () => {
  const user = userEvent.setup();
  mount();
  const objective = await screen.findByRole("textbox", { name: "Objective" });
  expect(screen.getByRole("button", { name: "Save guidance" })).toBeDisabled();
  await user.clear(objective);
  await user.type(objective, "  Fewer commitments  ");
  await user.click(screen.getByRole("button", { name: "Save guidance" }));
  await waitFor(() =>
    expect(mocks.upsertDomainProfile).toHaveBeenCalledWith({
      domain: "tasks",
      expectedVersion: 3,
      objective: "Fewer commitments",
      instructions: profile.instructions,
      categories: profile.categories,
      preferences: profile.preferences,
      sourceContexts: profile.sourceContexts,
      status: profile.status,
      summary: profile.summary,
    }),
  );
  await waitFor(() => expect(objective).toHaveValue("Fewer commitments"));
  expect(screen.getByRole("button", { name: "Save guidance" })).toBeDisabled();
});
it("keeps drafts on failed writes and explicitly reloads the latest version", async () => {
  mocks.upsertDomainProfile.mockRejectedValue(new Error("Version conflict"));
  const user = userEvent.setup();
  mount();
  const objective = await screen.findByRole("textbox", { name: "Objective" });
  await user.clear(objective);
  await user.type(objective, "My unsaved draft");
  await user.click(screen.getByRole("button", { name: "Save guidance" }));
  const reload = await screen.findByRole("button", { name: "Discard draft and reload" });
  expect(objective).toHaveValue("My unsaved draft");
  mocks.getDomainProfile.mockResolvedValue({
    ...profile,
    version: 9,
    objective: "Updated elsewhere",
  });
  await user.click(reload);
  await waitFor(() => expect(objective).toHaveValue("Updated elsewhere"));
  await user.type(objective, " again");
  await user.click(screen.getByRole("button", { name: "Save guidance" }));
  await waitFor(() =>
    expect(mocks.upsertDomainProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedVersion: 9 }),
    ),
  );
});
it("distinguishes missing configuration from unavailable data", async () => {
  mocks.getDomainProfile.mockResolvedValue(null);
  mount();
  expect(await screen.findByText(/No guidance has been configured yet/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save guidance" })).not.toBeInTheDocument();
});

it("edits typed Mail preferences with the profile version and preserves hidden fields", async () => {
  mocks.getDomainProfile.mockResolvedValue({ ...profile, domain: "mail" });
  const user = userEvent.setup();
  mount("mail");
  await user.selectOptions(await screen.findByLabelText("Inbox style"), "signal_only");
  await user.selectOptions(screen.getByLabelText("Important email handling"), "inbox_only");
  await user.selectOptions(
    screen.getByLabelText("Low-priority email handling"),
    "archive_after_days",
  );
  const days = screen.getByLabelText("Low-priority email waiting period (days)");
  await user.clear(days);
  await user.type(days, "7");
  await user.click(screen.getByRole("button", { name: "Save guidance" }));
  await waitFor(() =>
    expect(mocks.upsertDomainProfile).toHaveBeenCalledWith({
      domain: "mail",
      expectedVersion: 3,
      objective: profile.objective,
      instructions: profile.instructions,
      categories: profile.categories,
      sourceContexts: profile.sourceContexts,
      status: profile.status,
      summary: profile.summary,
      preferences: {
        preserve: true,
        inboxStyle: "signal_only",
        importantEmailHandling: "inbox_only",
        noiseDisposition: "archive_after_days",
        noiseRetentionDays: 7,
      },
    }),
  );
  expect(screen.getByText(/still require approved rules/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Save guidance" })).toBeDisabled());
});
it("preserves Mail preference drafts on conflicts and resets them only on explicit reload", async () => {
  mocks.getDomainProfile.mockResolvedValue({ ...profile, domain: "mail" });
  mocks.upsertDomainProfile.mockRejectedValue(new Error("Version conflict"));
  const user = userEvent.setup();
  const cache = mount("mail");
  const style = await screen.findByLabelText("Inbox style");
  await user.selectOptions(style, "balanced");
  mocks.getDomainProfile.mockResolvedValue({
    ...profile,
    domain: "mail",
    version: 9,
    preferences: {
      preserve: true,
      inboxStyle: "custom",
      noiseDisposition: "trash_after_days",
      noiseRetentionDays: 14,
    },
  });
  await cache.invalidateQueries({ queryKey: ["domain-profile", "mail"] });
  expect(style).toHaveValue("balanced");
  await user.click(screen.getByRole("button", { name: "Save guidance" }));
  const reload = await screen.findByRole("button", { name: "Discard draft and reload" });
  expect(style).toHaveValue("balanced");
  expect(mocks.upsertDomainProfile).toHaveBeenCalledWith(
    expect.objectContaining({ expectedVersion: 3 }),
  );
  await user.click(reload);
  await waitFor(() => expect(style).toHaveValue("custom"));
  expect(screen.getByLabelText("Low-priority email waiting period (days)")).toHaveValue(14);
  await user.selectOptions(screen.getByLabelText("Low-priority email handling"), "review_only");
  expect(
    screen.queryByLabelText("Low-priority email waiting period (days)"),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save guidance" }));
  await waitFor(() =>
    expect(mocks.upsertDomainProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expectedVersion: 9,
        preferences: expect.objectContaining({
          noiseDisposition: "review_only",
          noiseRetentionDays: null,
          preserve: true,
        }),
      }),
    ),
  );
});
it("requires a valid waiting period before saving Mail retention preferences", async () => {
  mocks.getDomainProfile.mockResolvedValue({ ...profile, domain: "mail" });
  const user = userEvent.setup();
  mount("mail");
  await user.selectOptions(
    await screen.findByLabelText("Low-priority email handling"),
    "trash_after_days",
  );
  const days = screen.getByLabelText("Low-priority email waiting period (days)");
  for (const invalid of ["", "0", "366", "1.5"]) {
    await user.clear(days);
    if (invalid) await user.type(days, invalid);
    await user.click(screen.getByRole("button", { name: "Save guidance" }));
    expect(days).toBeInvalid();
    expect(mocks.upsertDomainProfile).not.toHaveBeenCalled();
  }
});

it("edits Calendar profile defaults while preserving its version, approval and unrelated fields", async () => {
  const preferences = {
    afterBufferMinutes: 10,
    beforeBufferMinutes: 5,
    busyBlockPrivacy: "busy",
    defaultCalendarId: "11111111-1111-4111-8111-111111111111",
    defaultTimezone: "UTC",
    automaticEventCreation: false,
    automaticEventEvidence: [],
    preserve: true,
  };
  const sourceContexts = [
    {
      sourceId: preferences.defaultCalendarId,
      sourceLabel: "Personal",
      purpose: "Personal commitments",
      notes: null,
    },
  ];
  mocks.getDomainProfile.mockResolvedValue({
    ...profile,
    domain: "calendar",
    preferences,
    sourceContexts,
  });
  mocks.listCalendars.mockResolvedValue([
    { id: "11111111-1111-4111-8111-111111111111", name: "Personal", isWritable: true },
    { id: "22222222-2222-4222-8222-222222222222", name: "Unconfigured", isWritable: true },
  ]);
  const user = userEvent.setup();
  mount("calendar");
  const before = await screen.findByRole("spinbutton", { name: "Buffer before events (minutes)" });
  await user.clear(before);
  await user.type(before, "15");
  expect(screen.queryByRole("option", { name: "Unconfigured" })).not.toBeInTheDocument();
  await user.selectOptions(
    screen.getByLabelText("Default calendar"),
    preferences.defaultCalendarId,
  );
  expect(
    screen.getByRole("link", { name: "Open Calendar setup to add a source." }),
  ).toHaveAttribute("href", "/settings?section=calendar#calendar-setup");
  await user.selectOptions(screen.getByLabelText("Busy block privacy"), "details");
  await user.click(screen.getByRole("button", { name: "Save guidance" }));
  await waitFor(() =>
    expect(mocks.upsertDomainProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 3,
        status: "active",
        categories: profile.categories,
        sourceContexts,
        preferences: { ...preferences, beforeBufferMinutes: 15, busyBlockPrivacy: "details" },
      }),
    ),
  );
});

it("saves visible preferences on partial Calendar drafts without adding automation authority", async () => {
  const preferences = { defaultCalendarId: "11111111-1111-4111-8111-111111111111" };
  const sourceContexts = [
    {
      sourceId: preferences.defaultCalendarId,
      sourceLabel: "Personal",
      purpose: "Personal commitments",
      notes: null,
    },
  ];
  mocks.getDomainProfile.mockResolvedValue({
    ...profile,
    domain: "calendar",
    status: "draft",
    preferences,
    sourceContexts,
  });
  mocks.listCalendars.mockResolvedValue([
    { id: preferences.defaultCalendarId, name: "Personal", isWritable: true },
  ]);
  const user = userEvent.setup();
  mount("calendar");
  await user.type(
    await screen.findByRole("spinbutton", { name: "Buffer before events (minutes)" }),
    "15",
  );
  await user.click(screen.getByRole("button", { name: "Save guidance" }));
  await waitFor(() =>
    expect(mocks.upsertDomainProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: 3,
        status: "draft",
        sourceContexts,
        preferences: { ...preferences, beforeBufferMinutes: 15 },
      }),
    ),
  );
});
