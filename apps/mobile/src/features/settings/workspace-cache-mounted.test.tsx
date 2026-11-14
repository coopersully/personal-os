// @vitest-environment jsdom
import { type WorkspaceSettings, workspacePreferenceSchemas } from "@personal-os/domain";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type PropsWithChildren, useEffect, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileDataProvider } from "../tasks/data";
import { MailSettingsScreen } from "./workspaces";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  owner: "owner-a",
  epoch: 1,
  client: undefined as QueryClient | undefined,
  session: {} as { epoch: () => number; api: () => unknown },
  apis: {} as Record<string, unknown>,
  serverA: undefined as WorkspaceSettings<"mail"> | undefined,
  serverB: undefined as WorkspaceSettings<"mail"> | undefined,
  getA: vi.fn(),
  getB: vi.fn(),
  writeA: vi.fn(),
  writeB: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("../auth/context", () => ({
  useAuth: () => ({
    state: { user: { id: h.owner, planningTimezone: "America/New_York" } },
    session: h.session,
  }),
}));
vi.mock("sonner-native", () => ({
  toast: { error: h.error, success: h.success, loading: h.loading, dismiss: h.dismiss },
}));
vi.mock("react-native", () => ({
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
}));
vi.mock("../../theme", () => ({
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, page: 20 },
  useTheme: () => ({}),
}));
vi.mock("../../components/editor-header", () => ({ editorDismissOptions: () => ({}) }));
vi.mock("../../components/forms/use-dirty-dismiss", () => ({ useDirtyDismiss: () => () => {} }));
vi.mock("../../components/forms/form-save", () => ({
  FormSave: () => null,
  FloatingAdd: () => null,
}));
vi.mock("./finance-settings", () => ({ FinanceConfigurationSettings: () => null }));
vi.mock("../tasks/preferences", () => ({ TaskPreferencesScreen: () => null }));
vi.mock("./settings-row", () => ({
  SettingsRow: () => null,
  SettingsActionRow: () => null,
  SettingsDetailRow: () => null,
}));
vi.mock("../tasks/ui", () => ({
  Section: ({ children }: PropsWithChildren) => <section>{children}</section>,
  FormBody: ({ children }: PropsWithChildren) => <div>{children}</div>,
  State: ({ retry, loading }: { retry?: () => void; loading?: boolean }) =>
    loading ? (
      <span role="progressbar" />
    ) : retry ? (
      <button type="button" onClick={retry}>
        Retry loading
      </button>
    ) : null,
  Field: () => null,
  confirm: vi.fn(),
  Choice: ({
    label,
    value,
    options,
    disabled,
    onChange,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    disabled?: boolean;
    onChange: (value: string) => void;
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
  Action: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
function Probe() {
  const client = useQueryClient();
  useEffect(() => {
    h.client = client;
  }, [client]);
  return null;
}
function Harness() {
  const [shown, setShown] = useState(true);
  return (
    <>
      <Probe />
      <button type="button" onClick={() => setShown((value) => !value)}>
        {shown ? "Leave settings" : "Open Mail settings"}
      </button>
      {shown && <MailSettingsScreen />}
    </>
  );
}
const app = () => (
  <MobileDataProvider>
    <Harness />
  </MobileDataProvider>
);
const key = (owner = "owner-a", epoch = 1) => ["settings", owner, epoch, "workspace-mail"];
const settings = (
  revision: number,
  density: "comfortable" | "compact" | "expanded",
): WorkspaceSettings<"mail"> => ({
  workspace: "mail",
  revision,
  preferences: workspacePreferenceSchemas.mail.parse({ mailListDensity: density }),
});
const client = () => {
  if (!h.client) throw new Error("Missing provider client");
  return h.client;
};
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.owner = "owner-a";
  h.epoch = 1;
  h.client = undefined;
  h.serverA = settings(0, "comfortable");
  h.serverB = settings(4, "expanded");
  h.getA.mockReset().mockImplementation(async () => h.serverA);
  h.getB.mockReset().mockImplementation(async () => h.serverB);
  h.writeA.mockReset().mockImplementation(async (_workspace, input) => {
    h.serverA = {
      ...settings(input.expectedRevision + 1, "comfortable"),
      preferences: { ...h.serverA?.preferences, ...input.preferences },
    };
    return h.serverA;
  });
  h.writeB.mockReset();
  const shared = { getDomainProfile: async () => null, listMailRules: async () => [] };
  h.apis = {
    "owner-a": { ...shared, getWorkspaceSettings: h.getA, updateWorkspaceSettings: h.writeA },
    "owner-b": { ...shared, getWorkspaceSettings: h.getB, updateWorkspaceSettings: h.writeB },
  };
  h.session = { epoch: () => h.epoch, api: () => h.apis[h.owner] };
});
it("publishes the accepted Mail record to its real Settings cache so leaving and reopening reads the saved choice", async () => {
  render(app());
  await screen.findByLabelText("List density");
  expect(screen.getByLabelText("List density")).toHaveValue("comfortable");
  fireEvent.change(screen.getByLabelText("List density"), { target: { value: "compact" } });
  await waitFor(() =>
    expect(h.writeA).toHaveBeenCalledWith("mail", {
      expectedRevision: 0,
      preferences: { mailListDensity: "compact" },
    }),
  );
  await waitFor(() => expect(screen.getByLabelText("List density")).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Leave settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Mail settings" }));
  expect(await screen.findByLabelText("List density")).toHaveValue("compact");
  expect(client().getQueryData(key())).toMatchObject({
    revision: 1,
    preferences: { mailListDensity: "compact" },
  });
  expect(h.getA).toHaveBeenCalledOnce();
  expect(h.success).not.toHaveBeenCalled();
});
it("keeps a rejected draft local without falsely publishing it as accepted server state", async () => {
  h.writeA.mockRejectedValue(new Error("Conflict"));
  render(app());
  await screen.findByLabelText("List density");
  fireEvent.change(screen.getByLabelText("List density"), { target: { value: "compact" } });
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("List density")).toHaveValue("compact");
  expect(screen.getByLabelText("List density")).toBeDisabled();
  expect(client().getQueryData(key())).toMatchObject({
    revision: 0,
    preferences: { mailListDensity: "comfortable" },
  });
  expect(h.success).not.toHaveBeenCalled();
});
it("rejects an already queued native choice before optimism and lets the human retry after the accepted write", async () => {
  let finish!: (value: WorkspaceSettings<"mail">) => void;
  h.writeA.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(app());
  await screen.findByLabelText("List density");
  fireEvent.change(screen.getByLabelText("List density"), { target: { value: "compact" } });
  await waitFor(() => expect(h.writeA).toHaveBeenCalledOnce());
  // Model an already queued native selection event delivered after pending disables the control.
  fireEvent.change(screen.getByLabelText("List density"), { target: { value: "expanded" } });
  const feedback = "Your previous choice is still saving. Choose again when it finishes.";
  expect(h.error).toHaveBeenCalledWith(feedback);
  expect(screen.queryByText(feedback)).not.toBeInTheDocument();
  expect(screen.getByLabelText("List density")).toHaveValue("compact");
  h.serverA = settings(1, "compact");
  await act(async () => finish(h.serverA as WorkspaceSettings<"mail">));
  await waitFor(() => expect(screen.getByLabelText("List density")).toBeEnabled());
  expect(client().getQueryData(key())).toMatchObject({
    revision: 1,
    preferences: { mailListDensity: "compact" },
  });
  fireEvent.change(screen.getByLabelText("List density"), { target: { value: "expanded" } });
  await waitFor(() =>
    expect(client().getQueryData(key())).toMatchObject({
      revision: 2,
      preferences: { mailListDensity: "expanded" },
    }),
  );
  expect(h.serverA).toMatchObject({ revision: 2, preferences: { mailListDensity: "expanded" } });
  expect(screen.getByLabelText("List density")).toHaveValue("expanded");
  expect(h.writeA).toHaveBeenLastCalledWith("mail", {
    expectedRevision: 1,
    preferences: { mailListDensity: "expanded" },
  });
});
it("cancels an older in-flight Settings read before publishing the accepted reply", async () => {
  render(app());
  await screen.findByLabelText("List density");
  let finishRead!: (value: WorkspaceSettings<"mail">) => void;
  h.getA.mockReturnValueOnce(
    new Promise((resolve) => {
      finishRead = resolve;
    }),
  );
  let background!: Promise<void>;
  act(() => {
    background = client().refetchQueries({ queryKey: key(), exact: true });
  });
  await waitFor(() => expect(h.getA).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByLabelText("List density"), { target: { value: "compact" } });
  await waitFor(() => expect(client().getQueryData(key())).toMatchObject({ revision: 1 }));
  await act(async () => {
    finishRead(settings(0, "comfortable"));
    await background;
  });
  expect(client().getQueryData(key())).toMatchObject({
    revision: 1,
    preferences: { mailListDensity: "compact" },
  });
});
it("does not overwrite a newer sibling-published revision with an older accepted reply", async () => {
  render(app());
  await screen.findByLabelText("List density");
  let release!: () => void;
  const cancel = vi.spyOn(client(), "cancelQueries").mockReturnValueOnce(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  fireEvent.change(screen.getByLabelText("List density"), { target: { value: "compact" } });
  await waitFor(() => expect(cancel).toHaveBeenCalled());
  act(() => client().setQueryData(key(), settings(3, "expanded")));
  await act(async () => release());
  expect(client().getQueryData(key())).toMatchObject({
    revision: 3,
    preferences: { mailListDensity: "expanded" },
  });
});
it("rejects old-owner publication after an account epoch changes during cancellation", async () => {
  const view = render(app());
  await screen.findByLabelText("List density");
  let release!: () => void;
  const cancel = vi.spyOn(client(), "cancelQueries").mockReturnValueOnce(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  fireEvent.change(screen.getByLabelText("List density"), { target: { value: "compact" } });
  await waitFor(() => expect(cancel).toHaveBeenCalled());
  h.owner = "owner-b";
  h.epoch = 2;
  view.rerender(app());
  await waitFor(() => expect(screen.getByLabelText("List density")).toHaveValue("expanded"));
  await act(async () => release());
  expect(client().getQueryData(key("owner-b", 2))).toMatchObject({
    revision: 4,
    preferences: { mailListDensity: "expanded" },
  });
  expect(client().getQueryData(key())).toMatchObject({
    revision: 0,
    preferences: { mailListDensity: "comfortable" },
  });
  expect(h.error).not.toHaveBeenCalled();
});
