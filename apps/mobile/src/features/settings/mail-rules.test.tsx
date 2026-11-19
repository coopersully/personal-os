// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import {
  type MailRule,
  type MailRulePreview as MailRulePreviewRecord,
  mailRulePreviewSchema,
  mailRuleSchema,
} from "@personal-os/domain";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type PropsWithChildren, useEffect, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileDataProvider } from "../tasks/data";
import { MailRuleEditorScreen } from "./mail-rule-editor";
import { MailRuleSettingsScreen, MailSettingsScreen } from "./workspaces";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
type Route = "mail" | "rule" | "new";
const h = vi.hoisted(() => ({
  params: {} as { id?: string | string[] },
  route: "rule" as Route,
  client: undefined as QueryClient | undefined,
  navigate: undefined as undefined | ((route: Route) => void),
  rules: [] as MailRule[],
  profile: null as unknown,
  accounts: [] as unknown[],
  listRules: vi.fn(),
  createRule: vi.fn(),
  updateRule: vi.fn(),
  previewRule: vi.fn(),
  activateRule: vi.fn(),
  confirm: vi.fn(),
  permitDismiss: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("../auth/context", () => {
  const api = {
    listMailRules: h.listRules,
    createMailRule: h.createRule,
    updateMailRule: h.updateRule,
    previewSavedMailRule: h.previewRule,
    activateMailRule: h.activateRule,
    getDomainProfile: async () => h.profile,
    getMailSetupContext: async () => ({ accounts: h.accounts }),
    getWorkspaceSettings: async () => ({
      workspace: "mail",
      revision: 0,
      preferences: {},
    }),
  };
  const session = { epoch: () => 1, api: () => api };
  return { useAuth: () => ({ state: { user: { id: "owner-a" } }, session }) };
});
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
vi.mock("../../theme", () => ({
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, page: 20 },
  useTheme: () => ({}),
}));
vi.mock("../../components/editor-header", () => ({ editorDismissOptions: () => ({}) }));
vi.mock("../../components/forms/use-dirty-dismiss", () => ({
  useDirtyDismiss: () => h.permitDismiss,
}));
vi.mock("../../components/forms/section-content", () => ({
  SectionNote: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));
vi.mock("../../components/forms/form-save", () => ({
  FloatingAdd: () => null,
  FormSave: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled: boolean;
    onPress: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
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
  Section: ({ children, title }: PropsWithChildren<{ title?: string }>) => (
    <section aria-label={title}>{children}</section>
  ),
  FormBody: ({ children }: PropsWithChildren) => <div>{children}</div>,
  State: ({ loading, empty, retry }: { loading?: boolean; empty?: string; retry?: () => void }) =>
    loading ? (
      <span role="progressbar" />
    ) : retry ? (
      <button type="button" onClick={retry}>
        Retry
      </button>
    ) : (
      <span>{empty}</span>
    ),
  Field: ({
    label,
    value,
    onChangeText,
    editable,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    editable?: boolean;
  }) => (
    <input
      aria-label={label}
      value={value}
      disabled={editable === false}
      onChange={(event) => onChangeText(event.target.value)}
    />
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
const createdId = "00000000-0000-4000-8000-000000000002";
const profileId = "00000000-0000-4000-8000-000000000003";
const workAccount = "00000000-0000-4000-8000-000000000004";
const homeAccount = "00000000-0000-4000-8000-000000000005";
const threadA = "00000000-0000-4000-8000-00000000000a";
const threadB = "00000000-0000-4000-8000-00000000000b";
const fingerprint = "a".repeat(64);
const rule = (overrides: Partial<MailRule> = {}) =>
  mailRuleSchema.parse({
    id: ruleId,
    name: "Newsletters",
    domain: "mail",
    description: "",
    confidenceThreshold: null,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    profileId,
    sourceIds: [workAccount],
    policy: "preview",
    version: 3,
    enabled: false,
    condition: { field: "sender", operator: "contains", value: "news@example.com" },
    actions: [{ type: "archive", afterDays: 0, mailboxId: null }],
    ...overrides,
  });
const preview = (overrides: Partial<MailRulePreviewRecord> = {}) =>
  mailRulePreviewSchema.parse({
    candidates: [
      {
        accountId: workAccount,
        actions: [{ type: "archive", afterDays: 0, mailboxId: null, due: true }],
        from: { address: "news@example.com", name: "Example News" },
        id: threadA,
        receivedAt: "2026-11-17T10:00:00Z",
        subject: "Weekly digest",
        updatedAt: "2026-11-17T10:00:00Z",
      },
      {
        accountId: workAccount,
        actions: [{ type: "archive", afterDays: 0, mailboxId: null, due: true }],
        from: { address: "news@example.com", name: null },
        id: threadB,
        receivedAt: "2026-11-16T10:00:00Z",
        subject: "",
        updatedAt: "2026-11-16T10:00:00Z",
      },
    ],
    fingerprint,
    matchedCount: 2,
    previewedAt: "2026-11-18T09:00:00Z",
    ruleId,
    ruleVersion: 3,
    scannedCount: 200,
    window: {
      limit: 200,
      newestReceivedAt: "2026-11-17T10:00:00Z",
      oldestReceivedAt: "2026-10-01T10:00:00Z",
      truncated: true,
    },
    ...overrides,
  });
const rejection = (status: number, message: string) =>
  new ApiClientError({ code: "rejected", message, status });
const key = (name: string) => ["settings", "owner-a", 1, name];
const client = () => {
  if (!h.client) throw new Error("Missing real query client");
  return h.client;
};
function Harness() {
  const query = useQueryClient();
  const [route, setRoute] = useState(h.route);
  useEffect(() => {
    h.client = query;
    h.navigate = setRoute;
  }, [query]);
  return route === "mail" ? (
    <MailSettingsScreen />
  ) : route === "rule" ? (
    <MailRuleSettingsScreen />
  ) : (
    <MailRuleEditorScreen />
  );
}
const mount = (route: Route) => {
  h.route = route;
  render(
    <MobileDataProvider>
      <Harness />
    </MobileDataProvider>,
  );
};
const approve = async () => {
  const callback = h.confirm.mock.lastCall?.[2];
  if (!callback) throw new Error("Missing native confirmation");
  await act(async () => callback());
};
/** No toast text may also be rendered on the page. */
function expectNoInlineResult() {
  const calls = [...h.error.mock.calls, ...h.success.mock.calls, ...h.loading.mock.calls];
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) expect(screen.queryByText(call[0] as string)).toBeNull();
}
const fillRule = async () => {
  fireEvent.change(await screen.findByLabelText("Rule name"), { target: { value: "Receipts" } });
  fireEvent.change(screen.getByLabelText("Look in"), { target: { value: "subject" } });
  fireEvent.change(screen.getByLabelText("Match"), { target: { value: "ends_with" } });
  fireEvent.change(screen.getByLabelText("Text"), { target: { value: " receipt " } });
  fireEvent.change(screen.getByLabelText("Action"), { target: { value: "mark_read" } });
};
const showPreview = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
  await screen.findByText("Matches: 2");
};
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.params = { id: ruleId };
  h.client = undefined;
  h.rules = [rule()];
  h.profile = { id: profileId, status: "active" };
  h.accounts = [
    { accountId: workAccount, email: "work@example.com", label: "Work" },
    { accountId: homeAccount, email: null, label: "Home" },
  ];
  h.listRules.mockReset().mockImplementation(async () => h.rules);
  h.createRule.mockReset().mockImplementation(async (input) => {
    const created = rule({ ...input, id: createdId, version: 1 });
    h.rules = [...h.rules, created];
    return created;
  });
  h.updateRule.mockReset().mockImplementation(async (_id, input) => {
    const accepted = rule({ enabled: false, version: input.expectedVersion + 1 });
    h.rules = [accepted];
    return accepted;
  });
  h.previewRule.mockReset().mockImplementation(async () => preview());
  h.activateRule.mockReset().mockImplementation(async () => {
    const accepted = rule({ enabled: true, policy: "approved_rule", version: 4 });
    h.rules = [accepted];
    return { preview: preview({ ruleVersion: 4 }), rule: accepted };
  });
  h.loading.mockReturnValue("toast-id");
  h.push.mockImplementation((target: string | { pathname: string; params: { id: string } }) => {
    if (typeof target === "string") return h.navigate?.("new");
    h.params = target.params;
    h.navigate?.("rule");
  });
});

it("describes a rule's condition and actions in plain words", async () => {
  h.rules = [
    rule({
      condition: { field: "any", operator: "ends_with", value: "@shop.example" },
      actions: [
        { type: "mark_read", afterDays: 0, mailboxId: null },
        { type: "archive", afterDays: 1, mailboxId: null },
        { type: "trash", afterDays: 30, mailboxId: null },
      ],
    }),
  ];
  mount("rule");
  expect(
    await screen.findByText("When: Sender, subject or preview ends with “@shop.example”"),
  ).toBeVisible();
  expect(
    screen.getByText(
      "Then: Mark as read right away; Archive after 1 day; Move to Trash after 30 days",
    ),
  ).toBeVisible();
  expect(screen.getByText("Status: Disabled")).toBeVisible();
});

it("opens the rule editor from Mail settings without writing", async () => {
  mount("mail");
  await screen.findByRole("button", { name: /Newsletters Off · Preview/ });
  fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
  expect(h.push).toHaveBeenLastCalledWith("/settings/mail/rule-new");
  expect(await screen.findByLabelText("Rule name")).toBeVisible();
  expect(screen.getByRole("button", { name: "Create rule" })).toBeDisabled();
  expect(h.createRule).not.toHaveBeenCalled();
});

it("creates a disabled rule from the form and lists it Off", async () => {
  mount("mail");
  await screen.findByRole("button", { name: /Newsletters Off/ });
  fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
  await fillRule();
  expect(screen.getByRole("button", { name: "Create rule" })).toBeDisabled();
  fireEvent.click(await screen.findByLabelText("work@example.com"));
  fireEvent.click(screen.getByRole("button", { name: "Create rule" }));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Mail rule created", { id: "toast-id" }),
  );
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Creating rule…");
  expect(h.createRule).toHaveBeenCalledExactlyOnceWith({
    actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
    condition: { field: "subject", operator: "ends_with", value: "receipt" },
    confidenceThreshold: null,
    description: "",
    enabled: false,
    name: "Receipts",
    policy: "preview",
    profileId,
    sourceIds: [workAccount],
  });
  expectNoInlineResult();
  expect(h.permitDismiss).toHaveBeenCalledOnce();
  expect(h.back).toHaveBeenCalledOnce();
  expect(
    client()
      .getQueryData<MailRule[]>(key("mail-rules"))
      ?.map((entry) => entry.id),
  ).toEqual([ruleId, createdId]);
  act(() => h.navigate?.("mail"));
  expect(await screen.findByRole("button", { name: /Receipts Off · Preview/ })).toBeVisible();
});

it("keeps the draft and reports a rejected create with the server's reason", async () => {
  h.accounts = [{ accountId: workAccount, email: "work@example.com", label: "Work" }];
  h.createRule.mockRejectedValue(rejection(400, "That rule is not allowed."));
  mount("new");
  await fillRule();
  await waitFor(() => expect(screen.getByLabelText("work@example.com")).toBeChecked());
  await waitFor(() => expect(h.listRules).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Create rule" }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith("That rule is not allowed.", {
      id: "toast-id",
    }),
  );
  expect(h.createRule).toHaveBeenCalledOnce();
  expect(h.listRules).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Rule name")).toHaveValue("Receipts");
  expect(h.back).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it.each([
  ["a timeout", rejection(408, "Timed out")],
  ["a server failure", rejection(503, "Unavailable")],
  ["a network failure", new TypeError("Network request failed")],
])("reports %s on create as not confirmed, never resends, and rereads the list", async (_name, failure) => {
  h.accounts = [{ accountId: workAccount, email: "work@example.com", label: "Work" }];
  // The server saved the rule even though the phone never heard back.
  h.createRule.mockImplementation(async (input) => {
    h.rules = [...h.rules, rule({ ...input, id: createdId, version: 1 })];
    throw failure;
  });
  mount("new");
  await fillRule();
  await waitFor(() => expect(screen.getByLabelText("work@example.com")).toBeChecked());
  await waitFor(() => expect(h.listRules).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Create rule" }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t confirm the rule was created. Check Mail rules before trying again.",
      { id: "toast-id" },
    ),
  );
  expect(h.createRule).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(
      client()
        .getQueryData<MailRule[]>(key("mail-rules"))
        ?.map((entry) => entry.id),
    ).toEqual([ruleId, createdId]),
  );
  expect(screen.getByLabelText("Rule name")).toHaveValue("Receipts");
  expect(h.back).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("links no profile when Mail guidance is missing and requires an account", async () => {
  h.profile = null;
  mount("new");
  await fillRule();
  expect(screen.getByRole("button", { name: "Create rule" })).toBeDisabled();
  fireEvent.click(await screen.findByLabelText("Home"));
  fireEvent.click(screen.getByRole("button", { name: "Create rule" }));
  await waitFor(() => expect(h.createRule).toHaveBeenCalledOnce());
  expect(h.createRule.mock.calls[0]?.[0]).toMatchObject({
    profileId: null,
    sourceIds: [homeAccount],
  });
});

it("previews a saved rule's scope and offers Turn on only afterwards", async () => {
  mount("rule");
  await screen.findByText("Status: Disabled");
  expect(screen.queryByRole("button", { name: /Turn on/ })).not.toBeInTheDocument();
  expect(h.previewRule).not.toHaveBeenCalled();
  await showPreview();
  expect(h.previewRule).toHaveBeenCalledExactlyOnceWith(ruleId);
  expect(screen.getByText("Checked: 200 recent conversations")).toBeVisible();
  expect(
    screen.getByText(
      "Only the 200 most recent conversations were checked. Older mail is not shown.",
    ),
  ).toBeVisible();
  expect(screen.getByText("Weekly digest: Example News")).toBeVisible();
  expect(screen.getByText("(No subject): news@example.com")).toBeVisible();
  expect(screen.getByRole("button", { name: "Turn on Newsletters" })).toBeEnabled();
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Checking matches…");
  expect(h.success).toHaveBeenCalledExactlyOnceWith("Preview ready", { id: "toast-id" });
  expect(h.activateRule).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("omits the truncated note when the whole window was checked", async () => {
  h.previewRule.mockResolvedValue(
    preview({
      scannedCount: 1,
      window: { limit: 200, newestReceivedAt: null, oldestReceivedAt: null, truncated: false },
    }),
  );
  mount("rule");
  await showPreview();
  expect(screen.getByText("Checked: 1 recent conversation")).toBeVisible();
  expect(screen.queryByText(/Only the 200 most recent/)).not.toBeInTheDocument();
});

it("turns on with the previewed fingerprint, candidates and version, and shows On only from the response", async () => {
  let accept!: (value: unknown) => void;
  h.activateRule.mockImplementation(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      }),
  );
  mount("rule");
  await showPreview();
  h.loading.mockClear();
  h.success.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Turn on Newsletters" }));
  expect(h.activateRule).not.toHaveBeenCalled();
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Turn on Mail rule?",
    "Newsletters will apply to the 2 conversations in this preview and to new matching mail.",
    expect.any(Function),
  );
  await approve();
  expect(h.activateRule).toHaveBeenCalledExactlyOnceWith(ruleId, {
    expectedCandidateIds: [threadA, threadB],
    expectedPreviewFingerprint: fingerprint,
    expectedPreviewedAt: "2026-11-18T09:00:00Z",
    expectedVersion: 3,
  });
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Turning on…");
  expect(screen.getByText("Status: Disabled")).toBeVisible();
  expect(h.success).not.toHaveBeenCalled();
  const accepted = rule({ enabled: true, policy: "approved_rule", version: 4 });
  h.rules = [accepted];
  await act(async () => accept({ preview: preview({ ruleVersion: 4 }), rule: accepted }));
  expect(await screen.findByText("Status: Enabled")).toBeVisible();
  expect(h.success).toHaveBeenCalledExactlyOnceWith("Mail rule turned on", { id: "toast-id" });
  expect(client().getQueryData(key("mail-rules"))).toEqual([accepted]);
  expect(screen.queryByRole("button", { name: /Turn on/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Disable Newsletters" })).toBeEnabled();
  expectNoInlineResult();
});

it("clears the preview and keeps the rule Off when it changed before activation", async () => {
  h.activateRule.mockRejectedValue(rejection(409, "The mail rule changed since it was reviewed."));
  mount("rule");
  await showPreview();
  h.error.mockClear();
  h.rules = [rule({ version: 5 })];
  fireEvent.click(screen.getByRole("button", { name: "Turn on Newsletters" }));
  await approve();
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith(
      "This rule or its matches changed. Preview it again.",
      { id: "toast-id" },
    ),
  );
  expect(h.activateRule).toHaveBeenCalledOnce();
  expect(screen.queryByText("Matches: 2")).not.toBeInTheDocument();
  expect(screen.queryByText("Weekly digest: Example News")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Turn on/ })).not.toBeInTheDocument();
  expect(screen.getByText("Status: Disabled")).toBeVisible();
  await waitFor(() =>
    expect(client().getQueryData<MailRule[]>(key("mail-rules"))?.[0]?.version).toBe(5),
  );
  expectNoInlineResult();
});

it.each([
  ["a server failure", rejection(503, "Unavailable")],
  ["a timeout", rejection(408, "Timed out")],
  ["a network failure", new TypeError("Network request failed")],
])("reports %s as not confirmed without retrying and rereads the rule", async (_name, failure) => {
  h.activateRule.mockRejectedValue(failure);
  mount("rule");
  await showPreview();
  h.listRules.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Turn on Newsletters" }));
  await approve();
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t confirm the rule was turned on. Check its status before trying again.",
      { id: "toast-id" },
    ),
  );
  expect(h.activateRule).toHaveBeenCalledOnce();
  await waitFor(() => expect(h.listRules).toHaveBeenCalledOnce());
  expect(screen.getByText("Status: Disabled")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Turn on/ })).not.toBeInTheDocument();
  expectNoInlineResult();
});

it("reports a confirmed rejection with the server's reason and keeps the preview", async () => {
  h.activateRule.mockRejectedValue(
    rejection(400, "Link an active Mail profile before activating this rule."),
  );
  mount("rule");
  await showPreview();
  fireEvent.click(screen.getByRole("button", { name: "Turn on Newsletters" }));
  await approve();
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith(
      "Link an active Mail profile before activating this rule.",
      { id: "toast-id" },
    ),
  );
  expect(screen.getByText("Matches: 2")).toBeVisible();
  expect(screen.getByText("Status: Disabled")).toBeVisible();
  expectNoInlineResult();
});

it("requires a new preview once the rule's version no longer matches the previewed one", async () => {
  mount("rule");
  await showPreview();
  act(() => client().setQueryData(key("mail-rules"), [rule({ version: 4 })]));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: /Turn on/ })).not.toBeInTheDocument(),
  );
  expect(screen.queryByText("Matches: 2")).not.toBeInTheDocument();
  expect(h.activateRule).not.toHaveBeenCalled();
});

it("reports a failed preview once and shows no scope", async () => {
  h.previewRule.mockRejectedValue(rejection(404, "The mail rule was not found."));
  mount("rule");
  fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith("The mail rule was not found.", {
      id: "toast-id",
    }),
  );
  expect(screen.queryByText(/^Matches:/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Turn on/ })).not.toBeInTheDocument();
  expectNoInlineResult();
});

it.each([
  ["a timeout", rejection(408, "Timed out")],
  ["a server failure", rejection(503, "Unavailable")],
  ["a network failure", new TypeError("Network request failed")],
])("reports %s on preview as not loaded rather than rejected", async (_name, failure) => {
  h.previewRule.mockRejectedValue(failure);
  mount("rule");
  fireEvent.click(await screen.findByRole("button", { name: "Preview" }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith("Couldn’t load the preview. Try again.", {
      id: "toast-id",
    }),
  );
  expect(h.previewRule).toHaveBeenCalledOnce();
  expect(h.success).not.toHaveBeenCalled();
  expect(screen.queryByText(/^Matches:/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Turn on/ })).not.toBeInTheDocument();
  expectNoInlineResult();
});

it.each([
  ["a changed rule", rejection(409, "The mail rule changed since it was reviewed.")],
  ["an unknown outcome", new TypeError("Network request failed")],
])("raises no second toast when the reread after %s also fails", async (_name, failure) => {
  h.activateRule.mockRejectedValue(failure);
  mount("rule");
  await showPreview();
  h.listRules.mockClear().mockRejectedValue(new TypeError("Network request failed"));
  fireEvent.click(screen.getByRole("button", { name: "Turn on Newsletters" }));
  await approve();
  await waitFor(() => expect(h.listRules).toHaveBeenCalledOnce());
  await waitFor(() => expect(client().getQueryState(key("mail-rules"))?.status).toBe("error"));
  expect(h.error).toHaveBeenCalledOnce();
  expect(screen.getByText("Status: Disabled")).toBeVisible();
});

it("still disables an enabled rule only after confirmation and never offers Turn on for it", async () => {
  h.rules = [rule({ enabled: true, policy: "approved_rule" })];
  mount("rule");
  await showPreview();
  expect(screen.queryByRole("button", { name: /Turn on/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Disable Newsletters" }));
  expect(h.updateRule).not.toHaveBeenCalled();
  await approve();
  await waitFor(() =>
    expect(h.success).toHaveBeenLastCalledWith("Mail rule disabled", { id: "toast-id" }),
  );
  expect(h.updateRule).toHaveBeenCalledExactlyOnceWith(ruleId, {
    enabled: false,
    expectedVersion: 3,
  });
  expect(await screen.findByText("Status: Disabled")).toBeVisible();
  expect(client().getQueryData<MailRule[]>(key("mail-rules"))?.[0]?.version).toBe(4);
});

it.each([
  ["a timeout", rejection(408, "Timed out")],
  ["a server failure", rejection(503, "Unavailable")],
  ["a network failure", new TypeError("Network request failed")],
])("reports %s on Disable as not confirmed without retrying and rereads the rule", async (_name, failure) => {
  h.rules = [rule({ enabled: true, policy: "approved_rule" })];
  h.updateRule.mockRejectedValue(failure);
  mount("rule");
  fireEvent.click(await screen.findByRole("button", { name: "Disable Newsletters" }));
  h.listRules.mockClear();
  await approve();
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t confirm the rule was disabled. Check its status before trying again.",
      { id: "toast-id" },
    ),
  );
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Disabling rule…");
  expect(h.updateRule).toHaveBeenCalledOnce();
  expect(h.success).not.toHaveBeenCalled();
  // The rule may be off already, so its real state is read again.
  await waitFor(() => expect(h.listRules).toHaveBeenCalledOnce());
  expectNoInlineResult();
});

it("reports a refused Disable with the server's reason and leaves the rule on", async () => {
  h.rules = [rule({ enabled: true, policy: "approved_rule" })];
  h.updateRule.mockRejectedValue(rejection(403, "This token cannot change Mail rules."));
  mount("rule");
  fireEvent.click(await screen.findByRole("button", { name: "Disable Newsletters" }));
  h.listRules.mockClear();
  await approve();
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith("This token cannot change Mail rules.", {
      id: "toast-id",
    }),
  );
  expect(h.listRules).not.toHaveBeenCalled();
  expect(screen.getByText("Status: Enabled")).toBeVisible();
  expectNoInlineResult();
});

it("says a rule changed elsewhere when Disable conflicts, and reads it again", async () => {
  h.rules = [rule({ enabled: true, policy: "approved_rule" })];
  h.updateRule.mockRejectedValue(rejection(409, "The mail rule changed."));
  mount("rule");
  fireEvent.click(await screen.findByRole("button", { name: "Disable Newsletters" }));
  h.listRules.mockClear();
  await approve();
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith(
      "This rule changed elsewhere. Check it before trying again.",
      { id: "toast-id" },
    ),
  );
  await waitFor(() => expect(h.listRules).toHaveBeenCalledOnce());
  expect(h.updateRule).toHaveBeenCalledOnce();
  expectNoInlineResult();
});
