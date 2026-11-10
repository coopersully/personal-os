// @vitest-environment jsdom
import {
  type Calendar,
  calendarSchema,
  type MailRule,
  mailRuleSchema,
  workspacePreferenceSchemas,
} from "@personal-os/domain";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type PropsWithChildren, useEffect, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileDataProvider } from "../tasks/data";
import {
  CalendarSettingsScreen,
  CalendarSourceSettingsScreen,
  MailRuleSettingsScreen,
  MailSettingsScreen,
} from "./workspaces";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
type Route = "mail" | "calendar" | "rule" | "source";
const h = vi.hoisted(() => ({
  owner: "owner-a",
  epoch: 1,
  params: {} as { id?: string | string[] },
  route: "rule" as Route,
  client: undefined as QueryClient | undefined,
  navigate: undefined as undefined | ((route: Route) => void),
  session: {} as { epoch: () => number; api: () => unknown },
  apis: {} as Record<string, unknown>,
  rules: [] as MailRule[],
  calendars: [] as Calendar[],
  listRules: vi.fn(),
  listCalendars: vi.fn(),
  updateRule: vi.fn(),
  selectCalendar: vi.fn(),
  deleteCalendar: vi.fn(),
  confirm: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("../auth/context", () => ({
  useAuth: () => ({ state: { user: { id: h.owner } }, session: h.session }),
}));
vi.mock("sonner-native", () => ({
  toast: { error: h.error, success: h.success, loading: h.loading, dismiss: h.dismiss },
}));
vi.mock("react-native", () => ({
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => h.push(...args), back: h.back },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => h.params,
}));
vi.mock("../../theme", () => ({ useTheme: () => ({}) }));
vi.mock("../../components/editor-header", () => ({ editorDismissOptions: () => ({}) }));
vi.mock("../../components/forms/use-dirty-dismiss", () => ({ useDirtyDismiss: () => () => {} }));
vi.mock("../../components/forms/form-save", () => ({
  FormSave: () => null,
  FloatingAdd: () => null,
}));
vi.mock("./finance-settings", () => ({ FinanceConfigurationSettings: () => null }));
vi.mock("../tasks/preferences", () => ({ TaskPreferencesScreen: () => null }));
type Row = { label: string; value?: string; disabled?: boolean; onPress?: () => void };
vi.mock("./settings-row", () => ({
  SettingsRow: ({ label, value, onPress }: Row) => (
    <button type="button" onClick={onPress}>
      {label} {value}
    </button>
  ),
  SettingsActionRow: ({ label, disabled, onPress }: Row) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
  SettingsDetailRow: ({ label, value }: Row) => (
    <div>
      {label}: {value}
    </div>
  ),
}));
vi.mock("../tasks/ui", () => ({
  Section: ({ children }: PropsWithChildren) => <section>{children}</section>,
  FormBody: ({ children }: PropsWithChildren) => <div>{children}</div>,
  State: ({ loading, empty }: { loading?: boolean; empty?: string }) =>
    loading ? <span role="progressbar" /> : <span>{empty}</span>,
  Field: () => null,
  Choice: () => null,
  confirm: (...args: unknown[]) => h.confirm(...args),
  ToggleRow: ({
    label,
    value,
    disabled,
    onChange,
  }: {
    label: string;
    value: boolean;
    disabled?: boolean;
    onChange: (value: boolean) => void;
  }) => (
    <input
      type="checkbox"
      aria-label={label}
      checked={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  ),
  Action: ({ label, disabled, onPress }: Row) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
const ruleId = "00000000-0000-4000-8000-000000000001";
const localId = "00000000-0000-4000-8000-000000000002";
const providerId = "00000000-0000-4000-8000-000000000003";
const rule = (version = 3, enabled = true) =>
  mailRuleSchema.parse({
    id: ruleId,
    name: "Receipts",
    domain: "mail",
    description: "Receipt routing",
    confidenceThreshold: null,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    profileId: null,
    sourceIds: [],
    policy: "approved_rule",
    version,
    enabled,
    condition: { field: "any", operator: "contains", value: "receipt" },
    actions: [{ type: "archive", afterDays: 0, mailboxId: null }],
  });
const calendar = (id: string, provider: "local" | "google", isSelected = true) =>
  calendarSchema.parse({
    id,
    accountId: ruleId,
    provider,
    name: provider === "local" ? "Personal" : "Work",
    color: null,
    timezone: "America/New_York",
    isPrimary: false,
    isSelected,
    isWritable: true,
    lastSyncedAt: null,
  });
const key = (name: string, owner = "owner-a", epoch = 1) => ["settings", owner, epoch, name];
const client = () => {
  if (!h.client) throw new Error("Missing real query client");
  return h.client;
};
function Harness() {
  const query = useQueryClient();
  const [route, setRoute] = useState(h.route);
  const [shown, setShown] = useState(true);
  useEffect(() => {
    h.client = query;
    h.navigate = setRoute;
  }, [query]);
  return (
    <>
      <button type="button" onClick={() => setShown((value) => !value)}>
        {shown ? "Leave" : "Reopen"}
      </button>
      {shown &&
        (route === "mail" ? (
          <MailSettingsScreen />
        ) : route === "calendar" ? (
          <CalendarSettingsScreen />
        ) : route === "rule" ? (
          <MailRuleSettingsScreen />
        ) : (
          <CalendarSourceSettingsScreen />
        ))}
    </>
  );
}
const app = () => (
  <MobileDataProvider>
    <Harness />
  </MobileDataProvider>
);
const confirmAction = async () => {
  const callback = h.confirm.mock.lastCall?.[2];
  if (!callback) throw new Error("Missing native confirmation");
  await act(async () => callback());
};
const reopen = () => {
  fireEvent.click(screen.getByRole("button", { name: "Leave" }));
  fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
};
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.owner = "owner-a";
  h.epoch = 1;
  h.route = "rule";
  h.params = { id: ruleId };
  h.client = undefined;
  h.rules = [rule()];
  h.calendars = [calendar(localId, "local"), calendar(providerId, "google")];
  h.listRules.mockReset().mockImplementation(async () => h.rules);
  h.listCalendars.mockReset().mockImplementation(async () => h.calendars);
  h.updateRule.mockReset().mockImplementation(async (_id, input) => {
    const accepted = rule(input.expectedVersion + 1, input.enabled);
    h.rules = [accepted];
    return accepted;
  });
  h.selectCalendar.mockReset().mockImplementation(async (id, selected) => {
    const accepted = { ...h.calendars.find((record) => record.id === id), isSelected: selected };
    h.calendars = h.calendars.map((record) => (record.id === id ? (accepted as Calendar) : record));
    return accepted;
  });
  h.deleteCalendar.mockReset().mockImplementation(async (id) => {
    h.calendars = h.calendars.filter((record) => record.id !== id);
  });
  const api = {
    listMailRules: h.listRules,
    listCalendars: h.listCalendars,
    updateMailRule: h.updateRule,
    setCalendarSelected: h.selectCalendar,
    deleteCalendar: h.deleteCalendar,
    getDomainProfile: async () => null,
    getWorkspaceSettings: async (workspace: "mail" | "calendar") => ({
      workspace,
      revision: 0,
      preferences: workspacePreferenceSchemas[workspace].parse({}),
    }),
  };
  h.apis = { "owner-a": api, "owner-b": api };
  h.session = { epoch: () => h.epoch, api: () => h.apis[h.owner] };
  h.loading.mockReturnValue("toast-id");
  h.push.mockImplementation((target: { pathname: string; params: { id: string } }) => {
    h.params = target.params;
    h.navigate?.(target.pathname.includes("/mail/") ? "rule" : "source");
  });
});
it.each([
  "mail",
  "calendar",
] as const)("%s root offers navigation without protected actions", async (route) => {
  h.route = route;
  render(app());
  const label = route === "mail" ? /Receipts On/ : /Personal Shown/;
  await screen.findByRole("button", { name: label });
  expect(
    screen.queryByRole("button", { name: /Disable Receipts|Delete Personal/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Show Personal")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: label }));
  expect(h.push).toHaveBeenCalledWith({
    pathname: route === "mail" ? "/settings/mail/rule" : "/settings/calendar/source",
    params: { id: route === "mail" ? ruleId : localId },
  });
  expect(h.updateRule).not.toHaveBeenCalled();
  expect(h.deleteCalendar).not.toHaveBeenCalled();
  expect(h.selectCalendar).not.toHaveBeenCalled();
});
it("confirms the exact Mail rule version then reopens the accepted disabled record", async () => {
  render(app());
  fireEvent.click(await screen.findByRole("button", { name: "Disable Receipts" }));
  expect(h.updateRule).not.toHaveBeenCalled();
  expect(h.confirm).toHaveBeenCalledWith(
    "Disable Mail rule?",
    "Receipts will stop applying to new mail.",
    expect.any(Function),
  );
  await confirmAction();
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Mail rule disabled", { id: "toast-id" }),
  );
  expect(h.updateRule).toHaveBeenCalledWith(ruleId, { enabled: false, expectedVersion: 3 });
  reopen();
  expect(await screen.findByText("Status: Disabled")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Disable Receipts" })).not.toBeInTheDocument();
  expect(client().getQueryData(key("mail-rules"))).toEqual([rule(4, false)]);
  expect(screen.queryByText("Mail rule disabled")).not.toBeInTheDocument();
});
it("publishes an accepted calendar selection so reopening reflects the server state", async () => {
  h.route = "source";
  h.params = { id: providerId };
  render(app());
  fireEvent.click(await screen.findByLabelText("Show Work"));
  await waitFor(() => expect(h.selectCalendar).toHaveBeenCalledWith(providerId, false));
  await waitFor(() => expect(screen.getByLabelText("Show Work")).not.toBeChecked());
  reopen();
  expect(await screen.findByLabelText("Show Work")).not.toBeChecked();
  expect(
    client()
      .getQueryData<Calendar[]>(key("calendar-sources"))
      ?.find((record) => record.id === providerId)?.isSelected,
  ).toBe(false);
  expect(screen.queryByRole("button", { name: "Delete Work" })).not.toBeInTheDocument();
  expect(h.success).not.toHaveBeenCalled();
});
it.each([
  "rule",
  "source",
] as const)("rejected %s write retains truthful current state with exactly one Sonner error", async (route) => {
  h.route = route;
  h.params = { id: route === "rule" ? ruleId : localId };
  (route === "rule" ? h.updateRule : h.selectCalendar).mockRejectedValueOnce(
    new Error("Rejected by server"),
  );
  render(app());
  if (route === "rule") {
    fireEvent.click(await screen.findByRole("button", { name: "Disable Receipts" }));
    await confirmAction();
  } else fireEvent.click(await screen.findByLabelText("Show Personal"));
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
  expect(h.error).toHaveBeenCalledWith(
    "Couldn’t confirm the result. Check your connection and refresh before retrying.",
    {
      id: route === "rule" ? "toast-id" : undefined,
    },
  );
  expect(screen.queryByText("Rejected by server")).not.toBeInTheDocument();
  expect(
    screen.queryByText(
      "Couldn’t confirm the result. Check your connection and refresh before retrying.",
    ),
  ).not.toBeInTheDocument();
  expect(h.success).not.toHaveBeenCalled();
  if (route === "rule") expect(screen.getByText("Status: Enabled")).toBeInTheDocument();
  else expect(screen.getByLabelText("Show Personal")).toBeChecked();
});
it("cancels a stale Mail list read before publishing the accepted rule", async () => {
  render(app());
  await screen.findByRole("button", { name: "Disable Receipts" });
  let finish!: (records: MailRule[]) => void;
  h.listRules.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let reading!: Promise<void>;
  act(() => {
    reading = client().refetchQueries({ queryKey: key("mail-rules"), exact: true });
  });
  await waitFor(() => expect(h.listRules).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Disable Receipts" }));
  await confirmAction();
  await waitFor(() => expect(client().getQueryData(key("mail-rules"))).toEqual([rule(4, false)]));
  await act(async () => {
    finish([rule()]);
    await reading;
  });
  expect(client().getQueryData(key("mail-rules"))).toEqual([rule(4, false)]);
});
it("keeps a newer sibling Mail rule version when an older accepted reply arrives", async () => {
  render(app());
  await screen.findByRole("button", { name: "Disable Receipts" });
  let release!: () => void;
  const cancel = vi.spyOn(client(), "cancelQueries").mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Disable Receipts" }));
  await confirmAction();
  await waitFor(() => expect(cancel).toHaveBeenCalled());
  act(() => client().setQueryData(key("mail-rules"), [rule(9)]));
  await act(async () => release());
  expect(client().getQueryData(key("mail-rules"))).toEqual([rule(9)]);
});
it("deletes only the confirmed local calendar and navigates back after current-epoch cache publication", async () => {
  h.route = "source";
  h.params = { id: localId };
  render(app());
  fireEvent.click(await screen.findByRole("button", { name: "Delete Personal" }));
  const otherEpoch = key("calendar-sources", "owner-a", 0);
  const otherOwner = key("calendar-sources", "owner-b", 2);
  const unrelated = [...h.calendars];
  client().setQueryData(otherEpoch, unrelated);
  client().setQueryData(otherOwner, unrelated);
  expect(h.deleteCalendar).not.toHaveBeenCalled();
  expect(h.confirm).toHaveBeenCalledWith(
    "Delete Personal?",
    expect.stringContaining("permanently deletes"),
    expect.any(Function),
    true,
  );
  await confirmAction();
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  expect(h.deleteCalendar).toHaveBeenCalledWith(localId);
  expect(client().getQueryData(otherEpoch)).toEqual(unrelated);
  expect(client().getQueryData(otherOwner)).toEqual(unrelated);
  expect(
    client()
      .getQueryData<Calendar[]>(key("calendar-sources"))
      ?.map((record) => record.id),
  ).toEqual([providerId]);
  expect(h.success).toHaveBeenCalledWith("Calendar deleted", { id: "toast-id" });
  expect(screen.queryByText("Calendar deleted")).not.toBeInTheDocument();
});
it.each([
  "rule",
  "source",
] as const)("old-owner %s reply cannot publish or navigate after epoch changes during cancellation", async (route) => {
  h.route = route;
  h.params = { id: route === "rule" ? ruleId : localId };
  const view = render(app());
  const button = await screen.findByRole("button", {
    name: route === "rule" ? "Disable Receipts" : "Delete Personal",
  });
  let release!: () => void;
  const cancel = vi.spyOn(client(), "cancelQueries").mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  fireEvent.click(button);
  await confirmAction();
  await waitFor(() => expect(cancel).toHaveBeenCalled());
  const untouched = client().getQueryData(
    key(route === "rule" ? "mail-rules" : "calendar-sources"),
  );
  h.owner = "owner-b";
  h.epoch = 2;
  view.rerender(app());
  await act(async () => release());
  expect(client().getQueryData(key(route === "rule" ? "mail-rules" : "calendar-sources"))).toEqual(
    untouched,
  );
  expect(h.back).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
});
it.each([
  "rule",
  "source",
] as const)("%s invalid and array route ids never expose protected writes", async (route) => {
  h.route = route;
  h.params = { id: "missing" };
  const view = render(app());
  await screen.findByText(
    route === "rule"
      ? "This Mail rule is no longer available."
      : "This calendar is no longer available.",
  );
  h.params = { id: [route === "rule" ? ruleId : localId] };
  view.rerender(app());
  expect(screen.queryByRole("button", { name: /Disable|Delete/ })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Show/)).not.toBeInTheDocument();
  expect(h.updateRule).not.toHaveBeenCalled();
  expect(h.selectCalendar).not.toHaveBeenCalled();
  expect(h.deleteCalendar).not.toHaveBeenCalled();
});

it("cancels a stale Calendar source read before publishing an accepted selection", async () => {
  h.route = "source";
  h.params = { id: providerId };
  render(app());
  await screen.findByLabelText("Show Work");
  const stale = [...h.calendars];
  let finish!: (records: Calendar[]) => void;
  h.listCalendars.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let reading!: Promise<void>;
  act(() => {
    reading = client().refetchQueries({ queryKey: key("calendar-sources"), exact: true });
  });
  await waitFor(() => expect(h.listCalendars).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByLabelText("Show Work"));
  await waitFor(() => expect(screen.getByLabelText("Show Work")).not.toBeChecked());
  await act(async () => {
    finish(stale);
    await reading;
  });
  expect(
    client()
      .getQueryData<Calendar[]>(key("calendar-sources"))
      ?.find((record) => record.id === providerId)?.isSelected,
  ).toBe(false);
  reopen();
  expect(await screen.findByLabelText("Show Work")).not.toBeChecked();
});
it("a rejected local deletion leaves the named calendar available and never navigates or reports success", async () => {
  h.route = "source";
  h.params = { id: localId };
  h.deleteCalendar.mockRejectedValueOnce(new Error("transport detail"));
  render(app());
  fireEvent.click(await screen.findByRole("button", { name: "Delete Personal" }));
  await confirmAction();
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  expect(h.back).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  expect(
    client()
      .getQueryData<Calendar[]>(key("calendar-sources"))
      ?.map((record) => record.id),
  ).toEqual([localId, providerId]);
  expect(screen.getByRole("button", { name: "Delete Personal" })).toBeEnabled();
  expect(screen.queryByText("transport detail")).not.toBeInTheDocument();
  expect(screen.queryByText("Calendar deleted")).not.toBeInTheDocument();
});
