// @vitest-environment jsdom

import { workspacePreferenceSchemas } from "@personal-os/domain";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CalendarSettingsScreen,
  FinanceSettingsScreen,
  GuidanceSettingsScreen,
  MailSettingsScreen,
  TaskSettingsScreen,
} from "./workspaces";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  confirm: vi.fn(),
  error: vi.fn(),
  write: vi.fn(),
  reload: vi.fn(),
  saveGuidance: vi.fn(),
  api: {},
  guidance: null as unknown,
  blocked: false,
  domain: "mail",
  resources: {} as Record<string, unknown>,
  errors: new Set<string>(),
  pending: new Set<string>(),
  refetch: vi.fn(),
  recover: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  success: vi.fn(),
  dismiss: undefined as undefined | (() => void),
  allowDismiss: vi.fn(),
}));
vi.mock("react-native", () => ({
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("expo-router", () => ({
  router: { push: h.push, back: h.back },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ domain: h.domain }),
}));
vi.mock("../../components/editor-header", () => ({
  editorDismissOptions: ({ onPress }: { onPress: () => void }) => {
    h.dismiss = onPress;
    return {};
  },
}));
vi.mock("../../components/forms/use-dirty-dismiss", () => ({
  useDirtyDismiss: () => h.allowDismiss,
}));
vi.mock("../../components/forms/form-save", () => ({
  FormSave: ({ disabled, onPress }: { disabled: boolean; onPress: () => void }) => (
    <button
      type="button"
      aria-label="Save changes"
      data-floating-save
      disabled={disabled}
      onClick={onPress}
    />
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../../theme", () => ({ useTheme: () => ({}) }));
vi.mock("./finance-settings", () => ({ FinanceConfigurationSettings: () => null }));
vi.mock("./preferences-hook", () => ({
  useWorkspacePreferenceQueue: (initial: { preferences: object }) => ({
    blocked: h.blocked,
    current: initial,
    save: h.write,
    recover: h.recover,
  }),
}));
vi.mock("../auth/context", () => ({
  useAuth: () => ({
    state: { user: { id: "fixture", planningTimezone: "America/New_York" } },
    session: { epoch: () => 1 },
  }),
}));
vi.mock("./data", () => ({
  useSettingsResource: (key: string) => ({
    data: key.startsWith("guidance-") ? h.guidance : h.resources[key],
    isPending: h.pending.has(key),
    isError: h.errors.has(key),
    refetch: () => h.refetch(key),
  }),
  useSettingsAction: () => ({
    pending: false,
    run: async (action: (api: unknown) => Promise<unknown>, success?: string) => {
      try {
        const value = await action(h.api);
        if (success) h.success(success);
        return { ok: true, value };
      } catch (error) {
        h.error(error);
        return { ok: false };
      }
    },
  }),
}));
vi.mock("../tasks/ui", () => ({
  Section: ({ children, title }: PropsWithChildren<{ title?: string }>) => (
    <section aria-label={title}>{children}</section>
  ),
  FormBody: ({ children }: PropsWithChildren) => <div data-scroll>{children}</div>,
  State: ({ loading, retry, empty }: { loading?: boolean; retry?: () => void; empty?: string }) =>
    loading ? (
      <span role="progressbar" />
    ) : retry ? (
      <button type="button" onClick={retry}>
        Retry loading
      </button>
    ) : (
      <span>{empty}</span>
    ),
  Choice: ({
    label,
    value,
    options,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    options: { label: string; value: string }[];
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  ToggleRow: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
  }) => (
    <input
      type="checkbox"
      aria-label={label}
      checked={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  ),
  confirm: h.confirm,
  Field: ({
    label,
    value,
    onChangeText,
    onEndEditing,
    editable,
    multiline,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    onEndEditing?: () => void;
    editable: boolean;
    multiline?: boolean;
  }) =>
    multiline ? (
      <textarea
        aria-label={label}
        value={value}
        onChange={(event) => onChangeText(event.target.value)}
        disabled={!editable}
      />
    ) : (
      <input
        aria-label={label}
        value={value}
        onChange={(event) => onChangeText(event.target.value)}
        onBlur={onEndEditing}
        disabled={!editable}
      />
    ),
  Action: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onPress} disabled={disabled}>
      {label}
    </button>
  ),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.guidance = null;
  h.blocked = false;
  h.domain = "mail";
  h.errors.clear();
  h.pending.clear();
  h.dismiss = undefined;
  h.resources = {
    "workspace-mail": {
      workspace: "mail",
      revision: 1,
      preferences: workspacePreferenceSchemas.mail.parse({}),
    },
    "workspace-calendar": {
      workspace: "calendar",
      revision: 1,
      preferences: workspacePreferenceSchemas.calendar.parse({}),
    },
    "workspace-finances": {
      workspace: "finances",
      revision: 1,
      preferences: workspacePreferenceSchemas.finances.parse({}),
    },
    "mail-rules": [],
    "calendar-sources": [],
  };
  h.write.mockReset().mockResolvedValue({ revision: 2 });
  h.refetch.mockReset().mockImplementation(async (key) => ({ data: h.resources[key] }));
  h.api = { getWorkspaceSettings: h.reload, upsertDomainProfile: h.saveGuidance };
});
it("resets rejected numeric text only after reviewed reload and does not replay it on blur", async () => {
  h.reload.mockResolvedValue({
    workspace: "mail",
    revision: 2,
    preferences: {
      includeArchivedInSearch: true,
      mailConversationLayout: "split",
      mailListDensity: "comfortable",
      mailListWidth: 34,
    },
  });
  render(<MailSettingsScreen />);
  fireEvent.change(screen.getByLabelText("List width (%)"), { target: { value: "150" } });
  await act(async () => fireEvent.blur(screen.getByLabelText("List width (%)")));
  expect(screen.getByLabelText("List width (%)")).toHaveValue("150");
  expect(h.error).toHaveBeenCalledOnce();
  expect(h.write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reload and review preferences" }));
  await act(async () => h.confirm.mock.calls.at(-1)?.[2]());
  expect(screen.getByLabelText("List width (%)")).toHaveValue("34");
  expect(screen.getByLabelText("List width (%)")).toBeEnabled();
  await act(async () => fireEvent.blur(screen.getByLabelText("List width (%)")));
  expect(h.error).toHaveBeenCalledOnce();
  expect(h.write).not.toHaveBeenCalled();
});
it("keeps guidance Save floating outside the scroll body and retains a rejected draft", async () => {
  h.guidance = {
    id: "11111111-1111-4111-8111-111111111111",
    domain: "mail",
    version: 4,
    categories: [],
    instructions: [],
    objective: "Existing",
    preferences: {},
    sourceContexts: [],
    status: "draft",
    summary: "Existing",
  };
  h.saveGuidance.mockRejectedValue(new Error("Conflict"));
  render(<GuidanceSettingsScreen />);
  const save = screen.getByRole("button", { name: "Save changes" });
  expect(save.closest("[data-scroll]")).toBeNull();
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Objective"), { target: { value: "Updated objective" } });
  expect(save).toBeEnabled();
  fireEvent.click(save);
  await act(async () => h.confirm.mock.calls.at(-1)?.[2]());
  expect(h.saveGuidance).toHaveBeenCalledWith(
    expect.objectContaining({ expectedVersion: 4, objective: "Updated objective" }),
  );
  expect(screen.getByLabelText("Objective")).toHaveValue("Updated objective");
  expect(h.error).toHaveBeenCalledOnce();
  expect(screen.queryByText("Conflict")).not.toBeInTheDocument();
});

it("surfaces a reopened blocked queue before allowing another edit", () => {
  h.blocked = true;
  render(<MailSettingsScreen />);
  expect(screen.getByLabelText("List width (%)")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reload and review preferences" })).toBeEnabled();
  expect(h.write).not.toHaveBeenCalled();
});

const identifier = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
function mailGuidance() {
  return {
    id: identifier(1),
    domain: "mail",
    version: 5,
    categories: [{ key: "important", label: "Important", description: "Keep", examples: [] }],
    instructions: ["Keep existing"],
    objective: "Protect attention",
    preferences: {
      hiddenPolicy: "preserve",
      inboxStyle: "conservative",
      importantEmailHandling: "inbox_and_attention",
      noiseDisposition: "review_only",
      noiseRetentionDays: null,
    },
    sourceContexts: [],
    status: "active",
    summary: "Existing summary",
  };
}
const edit = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const approve = async () => {
  await act(async () => h.confirm.mock.calls.at(-1)?.[2]());
};
it("autosaves independent workspace choices as partial writes and retains a rejected toggle until reviewed reload", async () => {
  render(<MailSettingsScreen />);
  await act(async () => edit("List density", "compact"));
  expect(h.write).toHaveBeenLastCalledWith({ mailListDensity: "compact" });
  h.write.mockRejectedValueOnce(new Error("Denied"));
  await act(async () => fireEvent.click(screen.getByLabelText("Include archived in search")));
  expect(screen.getByLabelText("Include archived in search")).not.toBeChecked();
  expect(screen.getByLabelText("List density")).toBeDisabled();
  expect(h.error).toHaveBeenCalledWith(expect.objectContaining({ message: "Denied" }));
  h.reload.mockResolvedValue({
    revision: 3,
    preferences: workspacePreferenceSchemas.mail.parse({ mailListDensity: "expanded" }),
  });
  fireEvent.click(screen.getByRole("button", { name: "Reload and review preferences" }));
  await approve();
  expect(screen.getByLabelText("List density")).toHaveValue("expanded");
  expect(screen.getByLabelText("Include archived in search")).toBeChecked();
  expect(h.recover).toHaveBeenCalledWith(expect.objectContaining({ revision: 3 }));
});
it("saves Mail policy with explicit destructive consequences and preserves hidden guidance", async () => {
  h.guidance = mailGuidance();
  h.saveGuidance.mockImplementation(async (input) => ({ ...input, id: identifier(1), version: 6 }));
  render(<GuidanceSettingsScreen />);
  edit("Inbox style", "balanced");
  edit("Important email", "inbox_only");
  edit("Noise handling", "archive_after_days");
  edit("Noise retention (days)", "14");
  edit("Objective", "New objective");
  edit("Instructions (one per line)", "One\nTwo");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Save workspace guidance?",
    expect.stringContaining("archive after 14 days"),
    expect.any(Function),
  );
  await approve();
  expect(h.saveGuidance).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedVersion: 5,
      categories: mailGuidance().categories,
      summary: "Existing summary",
      instructions: ["One", "Two"],
      preferences: expect.objectContaining({
        hiddenPolicy: "preserve",
        noiseDisposition: "archive_after_days",
        noiseRetentionDays: 14,
        inboxStyle: "balanced",
        importantEmailHandling: "inbox_only",
      }),
    }),
  );
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(h.success).toHaveBeenCalledWith("Guidance saved");
});
it("reloads conflicting guidance explicitly, retains failed reload drafts and guards both clean and dirty Back", async () => {
  h.guidance = mailGuidance();
  render(<GuidanceSettingsScreen />);
  act(() => h.dismiss?.());
  expect(h.back).toHaveBeenCalledOnce();
  edit("Objective", "Local objective");
  act(() => h.dismiss?.());
  expect(h.back).toHaveBeenCalledOnce();
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Discard guidance changes?",
    expect.any(String),
    expect.any(Function),
    true,
  );
  await approve();
  expect(h.allowDismiss).toHaveBeenCalledOnce();
  expect(h.back).toHaveBeenCalledTimes(2);
  const read = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({
      ...mailGuidance(),
      version: 9,
      objective: "Remote objective",
      preferences: { ...mailGuidance().preferences, hiddenPolicy: "remote" },
    });
  h.api = { getDomainProfile: read };
  fireEvent.click(screen.getByRole("button", { name: "Reload guidance" }));
  await approve();
  expect(screen.getByLabelText("Objective")).toHaveValue("Local objective");
  expect(h.error).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Reload guidance" }));
  await approve();
  expect(screen.getByLabelText("Objective")).toHaveValue("Remote objective");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
});
function calendarGuidance() {
  return {
    ...mailGuidance(),
    domain: "calendar",
    preferences: {
      hiddenPolicy: "keep",
      defaultCalendarId: identifier(99),
      defaultTimezone: "America/New_York",
      beforeBufferMinutes: 0,
      afterBufferMinutes: 0,
      busyBlockPrivacy: "busy",
      automaticEventCreation: false,
      automaticEventEvidence: [],
    },
    sourceContexts: [
      { sourceId: identifier(2), sourceLabel: "Work", purpose: "Meetings", notes: null },
    ],
  };
}
it("restricts Calendar default selection to writable configured sources and persists reviewed automation evidence", async () => {
  h.domain = "calendar";
  h.guidance = calendarGuidance();
  h.resources["calendar-sources"] = [
    { id: identifier(2), name: "Work", isWritable: true },
    { id: identifier(3), name: "Read-only source", isWritable: false },
    { id: identifier(4), name: "Unconfigured source", isWritable: true },
  ];
  h.saveGuidance.mockImplementation(async (input) => ({ ...input, id: identifier(1), version: 6 }));
  render(<GuidanceSettingsScreen />);
  expect(
    within(screen.getByLabelText("Default calendar")).queryByRole("option", {
      name: "Read-only source",
    }),
  ).not.toBeInTheDocument();
  expect(
    within(screen.getByLabelText("Default calendar")).queryByRole("option", {
      name: "Unconfigured source",
    }),
  ).not.toBeInTheDocument();
  edit("Default calendar", identifier(2));
  fireEvent.click(screen.getByLabelText("Create events automatically"));
  fireEvent.click(screen.getByLabelText("Allow evidence: Booking"));
  edit("Before-event buffer (minutes)", "10");
  edit("After-event buffer (minutes)", "20");
  edit("Busy-block privacy", "details");
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Save workspace guidance?",
    expect.stringContaining("Automatic event creation will be enabled"),
    expect.any(Function),
  );
  await approve();
  expect(h.saveGuidance).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedVersion: 5,
      sourceContexts: calendarGuidance().sourceContexts,
      preferences: expect.objectContaining({
        defaultCalendarId: identifier(2),
        hiddenPolicy: "keep",
        automaticEventEvidence: ["booking"],
        automaticEventCreation: true,
        beforeBufferMinutes: 10,
        afterBufferMinutes: 20,
        busyBlockPrivacy: "details",
      }),
    }),
  );
});
it("rejects a chosen Calendar source that disappears before Save and exposes a retry when source reads fail", async () => {
  h.domain = "calendar";
  h.guidance = calendarGuidance();
  h.resources["calendar-sources"] = [{ id: identifier(2), name: "Work", isWritable: true }];
  const { rerender } = render(<GuidanceSettingsScreen />);
  edit("Default calendar", identifier(2));
  h.resources["calendar-sources"] = [];
  rerender(<GuidanceSettingsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await approve();
  expect(h.saveGuidance).not.toHaveBeenCalled();
  expect(h.error).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringContaining("Choose a writable calendar") }),
  );
  h.resources["calendar-sources"] = undefined;
  h.errors.add("calendar-sources");
  rerender(<GuidanceSettingsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
  expect(h.refetch).toHaveBeenCalledWith("calendar-sources");
});
it("configures Calendar visibility and local source lifecycle without provider deletion or fake success", async () => {
  h.domain = "calendar";
  h.resources["calendar-sources"] = [
    { id: identifier(2), name: "Work", isWritable: true, isSelected: true, provider: "local" },
    {
      id: identifier(3),
      name: "Subscribed",
      isWritable: false,
      isSelected: false,
      provider: "google",
      source: { accountLabel: "Fixture account" },
    },
  ];
  const create = vi
    .fn()
    .mockRejectedValueOnce(new Error("Rejected"))
    .mockResolvedValueOnce({ id: identifier(5) });
  const remove = vi.fn().mockResolvedValue(undefined);
  const select = vi.fn().mockResolvedValue({});
  h.api = { createCalendar: create, deleteCalendar: remove, setCalendarSelected: select };
  render(<CalendarSettingsScreen />);
  expect(screen.queryByRole("button", { name: "Delete Subscribed" })).not.toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByLabelText("Show Work")));
  expect(select).toHaveBeenCalledWith(identifier(2), false);
  edit("Calendar name", "Personal projects");
  edit("Color (optional)", "#7928ff");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create calendar" })));
  expect(screen.getByLabelText("Calendar name")).toHaveValue("Personal projects");
  expect(h.success).not.toHaveBeenCalledWith("Calendar created");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create calendar" })));
  expect(create).toHaveBeenCalledWith({
    name: "Personal projects",
    color: "#7928ff",
    timezone: "America/New_York",
  });
  expect(screen.getByLabelText("Calendar name")).toHaveValue("");
  expect(h.success).toHaveBeenCalledWith("Calendar created");
  fireEvent.click(screen.getByRole("button", { name: "Delete Work" }));
  expect(remove).not.toHaveBeenCalled();
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Delete Work?",
    expect.stringContaining("permanently deletes"),
    expect.any(Function),
    true,
  );
  await approve();
  expect(remove).toHaveBeenCalledWith(identifier(2));
  expect(h.refetch).toHaveBeenCalledWith("calendar-sources");
});
it("opens actual related native settings and disables a named Mail rule only after confirmation", async () => {
  h.guidance = mailGuidance();
  h.resources["mail-rules"] = [
    { id: identifier(6), name: "Old rule", version: 8, enabled: true, policy: "approved_rule" },
  ];
  const disable = vi.fn().mockResolvedValue({});
  h.api = { updateMailRule: disable };
  render(<MailSettingsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Workspace guidance" }));
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/settings/guidance",
    params: { domain: "mail" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
  expect(h.push).toHaveBeenCalledWith("/settings/notifications");
  fireEvent.click(screen.getByRole("button", { name: "Connections" }));
  expect(h.push).toHaveBeenCalledWith("/settings/connections");
  fireEvent.click(screen.getByRole("button", { name: "Disable Old rule" }));
  expect(disable).not.toHaveBeenCalled();
  await approve();
  expect(disable).toHaveBeenCalledWith(identifier(6), { enabled: false, expectedVersion: 8 });
  expect(h.refetch).toHaveBeenCalledWith("mail-rules");
});
it("preserves honest unavailable reads and exposes retry/setup paths across workspace entry points", () => {
  h.resources["workspace-mail"] = undefined;
  h.errors.add("workspace-mail");
  const { rerender } = render(<MailSettingsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
  expect(h.refetch).toHaveBeenCalledWith("workspace-mail");
  fireEvent.click(screen.getByRole("button", { name: "Open agent setup" }));
  expect(h.push).toHaveBeenCalledWith("/settings/agents");
  h.domain = "tasks";
  h.guidance = mailGuidance();
  rerender(<TaskSettingsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Task preferences" }));
  expect(h.push).toHaveBeenCalledWith("/task-preferences");
  fireEvent.click(screen.getByRole("button", { name: "Workspace guidance" }));
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/settings/guidance",
    params: { domain: "tasks" },
  });
  h.domain = "finances";
  rerender(<FinanceSettingsScreen />);
  expect(screen.getByRole("button", { name: "Notifications" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Connections" })).not.toBeInTheDocument();
});
