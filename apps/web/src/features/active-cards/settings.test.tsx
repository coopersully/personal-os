// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  nativeGet: vi.fn(),
  nativeSave: vi.fn(),
  desktop: vi.fn(),
  error: vi.fn(),
  action: vi.fn(),
  success: vi.fn(),
}));
vi.mock("../../api", () => ({
  api: { getActiveReminderPreferences: mocks.get, saveActiveReminderPreferences: mocks.save },
  errorMessage: (e: Error) => e.message,
}));
vi.mock("../desktop/bridge", async (original) => ({
  ...(await original<typeof import("../desktop/bridge")>()),
  isDesktop: mocks.desktop,
  getDesktopSettings: mocks.nativeGet,
  saveDesktopSettings: mocks.nativeSave,
  nativeAction: mocks.action,
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: mocks.error,
    dismiss: vi.fn(),
    loading: vi.fn(),
    success: mocks.success,
  }),
}));

import { ActiveCardsSettings } from "./settings";

const base = {
  accountId: "owner",
  settings: {
    serverUrl: "https://example.test",
    petEnabled: true,
    notifications: { enabled: true },
    activeRemindersEnabled: true,
    activeCardInteractions: {
      shake: true,
      sensitivity: "medium",
      snapping: true,
      guides: true,
      autoLock: false,
      sounds: true,
      volume: 0.35,
      reducedMotion: false,
      returnCards: true,
    },
  },
  native: {
    activeRemindersAvailable: true,
    displays: [{ id: "screen-a", label: "Main screen", isPrimary: true }],
  },
};
function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  cache.setQueryData(["me"], { id: "owner" });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <ActiveCardsSettings ownerId="owner" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { cache, user: userEvent.setup() };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.desktop.mockReturnValue(false);
  mocks.get.mockResolvedValue({
    defaultActiveReminder: false,
    defaultTaskActiveReminder: false,
    defaultReminderActiveReminder: true,
    revision: 4,
  });
  mocks.save.mockImplementation(async (input) => ({ ...input, revision: 5 }));
  mocks.nativeGet.mockResolvedValue(base);
  mocks.nativeSave.mockResolvedValue(base);
});
it("saves independent account defaults in a browser without native writes", async () => {
  const { user } = mount();
  const control = await screen.findByRole("switch", { name: "New tasks" });
  await waitFor(() => expect(control).toBeEnabled());
  await user.click(control);
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith(
      { defaultTaskActiveReminder: true, defaultReminderActiveReminder: true, expectedRevision: 4 },
      "owner",
    ),
  );
  expect(mocks.nativeGet).not.toHaveBeenCalled();
  expect(mocks.nativeSave).not.toHaveBeenCalled();
});
it("merges only active-card edits into the latest native settings", async () => {
  mocks.desktop.mockReturnValue(true);
  const { user } = mount();
  const control = await screen.findByRole("switch", { name: "Shake to gather" });
  await waitFor(() => expect(control).toBeEnabled());
  await user.click(control);
  await waitFor(() => expect(mocks.nativeSave).toHaveBeenCalled());
  const [settings, identity] = mocks.nativeSave.mock.calls[0]!;
  expect(settings.petEnabled).toBe(true);
  expect(settings.notifications).toEqual(base.settings.notifications);
  expect(settings.activeCardInteractions.shake).toBe(false);
  expect(identity).toEqual({ accountId: "owner", serverUrl: "https://example.test" });
  expect(mocks.save).not.toHaveBeenCalled();
});
it("retains a failed account draft and reports the error only through Sonner", async () => {
  mocks.save.mockRejectedValueOnce(new Error("Cannot save cards"));
  const { user } = mount();
  const control = await screen.findByRole("switch", { name: "New tasks" });
  await waitFor(() => expect(control).toBeEnabled());
  await user.click(control);
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(control).toBeChecked();
  expect(screen.queryByText("Cannot save cards")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry saving defaults" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry saving defaults" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Retry saving defaults" })).not.toBeInTheDocument(),
  );
  expect(control).toBeChecked();
  expect(mocks.error).toHaveBeenCalledTimes(1);
});
it("fences queued defaults after an account changes", async () => {
  let resolve!: (value: unknown) => void;
  mocks.get.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { cache } = mount();
  act(() => {
    cache.setQueryData(["me"], { id: "other" });
    resolve({
      defaultTaskActiveReminder: false,
      defaultReminderActiveReminder: false,
      defaultActiveReminder: false,
      revision: 4,
    });
  });
  await waitFor(() => expect(screen.getByRole("switch", { name: "New tasks" })).toBeDisabled());
  expect(mocks.save).not.toHaveBeenCalled();
});
it("carries a failed device patch into the next edit without replacing unrelated native values", async () => {
  mocks.desktop.mockReturnValue(true);
  mocks.nativeSave.mockRejectedValueOnce(new Error("native unavailable"));
  mocks.nativeGet.mockResolvedValue({
    ...base,
    settings: { ...base.settings, petEnabled: false, launchAtLogin: true },
  });
  const { user } = mount();
  const shake = await screen.findByRole("switch", { name: "Shake to gather" });
  await waitFor(() => expect(shake).toBeEnabled());
  await user.click(shake);
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(shake).not.toBeChecked();
  await user.click(screen.getByRole("switch", { name: "Lock new joins automatically" }));
  await waitFor(() => expect(mocks.nativeSave).toHaveBeenCalledTimes(2));
  expect(mocks.nativeSave.mock.calls[1]![0]).toMatchObject({
    petEnabled: false,
    launchAtLogin: true,
    activeCardInteractions: { shake: false, autoLock: true },
  });
});
it("does not write native settings after an in-flight read crosses an account epoch", async () => {
  mocks.desktop.mockReturnValue(true);
  let resolve!: (value: unknown) => void;
  mocks.nativeGet.mockResolvedValueOnce(base).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { cache, user } = mount();
  const shake = await screen.findByRole("switch", { name: "Shake to gather" });
  await waitFor(() => expect(shake).toBeEnabled());
  await user.click(shake);
  await waitFor(() => expect(mocks.nativeGet).toHaveBeenCalledTimes(2));
  act(() => {
    cache.setQueryData(["me"], { id: "other" });
    cache.setQueryData(["me"], { id: "owner" });
    resolve(base);
  });
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(mocks.nativeSave).not.toHaveBeenCalled();
});
it("serializes rapid defaults while preserving the newer visible draft", async () => {
  let resolve!: (value: unknown) => void;
  mocks.save.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { user } = mount();
  const tasks = await screen.findByRole("switch", { name: "New tasks" });
  await waitFor(() => expect(tasks).toBeEnabled());
  await user.click(tasks);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole("switch", { name: "New reminders" }));
  expect(mocks.save).toHaveBeenCalledTimes(1);
  act(() =>
    resolve({
      defaultTaskActiveReminder: true,
      defaultReminderActiveReminder: true,
      defaultActiveReminder: true,
      revision: 5,
    }),
  );
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[1]![0]).toMatchObject({ defaultReminderActiveReminder: false });
  expect(screen.getByRole("switch", { name: "New reminders" })).not.toBeChecked();
});
it("does not offer unconfigured Focus waiting and can clear a saved wait preference", async () => {
  mocks.desktop.mockReturnValue(true);
  mocks.nativeGet.mockResolvedValue({
    ...base,
    settings: {
      ...base.settings,
      activeCardInteractions: { ...base.settings.activeCardInteractions, respectFocus: true },
    },
    native: { ...base.native, focusAvailable: false },
  });
  const { user } = mount();
  const control = await screen.findByRole("combobox", { name: /Focus/ });
  await waitFor(() => expect(control).toBeEnabled());
  expect(screen.getByRole("option", { name: /Wait/ })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Allow Focus status access" }),
  ).not.toBeInTheDocument();
  await user.selectOptions(control, "show");
  await waitFor(() => expect(mocks.nativeSave).toHaveBeenCalled());
  expect(mocks.nativeSave.mock.calls[0]?.[0]).toMatchObject({
    activeCardInteractions: { respectFocus: false },
  });
  expect(mocks.action).not.toHaveBeenCalled();
});
it("keeps Focus permission feedback pending until macOS confirms authorization", async () => {
  mocks.desktop.mockReturnValue(true);
  const configured = { ...base, native: { ...base.native, focusAvailable: true } };
  mocks.action.mockResolvedValue({ ok: true });
  let resolve!: (value: unknown) => void;
  mocks.nativeGet
    .mockResolvedValueOnce(configured)
    .mockResolvedValueOnce({
      ...configured,
      native: { ...configured.native, focusPermissionPending: true },
    })
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
  const { user } = mount();
  const button = await screen.findByRole("button", { name: "Allow Focus status access" });
  await user.click(button);
  await waitFor(() => expect(mocks.nativeGet).toHaveBeenCalledTimes(3));
  expect(mocks.success).not.toHaveBeenCalled();
  act(() =>
    resolve({
      ...configured,
      native: {
        ...configured.native,
        focusPermission: "authorized",
        focusStatus: "off",
        focusPermissionPending: false,
      },
    }),
  );
  await waitFor(() =>
    expect(mocks.success).toHaveBeenCalledWith("Focus status access allowed", expect.anything()),
  );
  expect(screen.queryByText("Focus status access allowed")).not.toBeInTheDocument();
});

it("retries a device draft against the latest unrelated native preferences", async () => {
  mocks.desktop.mockReturnValue(true);
  mocks.nativeSave
    .mockRejectedValueOnce(new Error("Cannot save this Mac"))
    .mockImplementation(async (settings) => ({ ...base, settings }));
  const { user } = mount();
  const control = await screen.findByRole("switch", { name: "Shake to gather" });
  await waitFor(() => expect(control).toBeEnabled());
  await user.click(control);
  const retry = await screen.findByRole("button", { name: "Retry saving card settings" });
  expect(control).not.toBeChecked();
  expect(mocks.error).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Cannot save this Mac")).not.toBeInTheDocument();
  mocks.nativeGet.mockResolvedValue({
    ...base,
    settings: { ...base.settings, petEnabled: false, notifications: { enabled: false } },
  });
  await user.click(retry);
  await waitFor(() => expect(mocks.nativeSave).toHaveBeenCalledTimes(2));
  expect(mocks.nativeSave.mock.calls[1]?.[0]).toMatchObject({
    petEnabled: false,
    notifications: { enabled: false },
    activeCardInteractions: { shake: false },
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Retry saving card settings" }),
    ).not.toBeInTheDocument(),
  );
});
it("reports a configured build's denied Focus request only through Sonner", async () => {
  mocks.desktop.mockReturnValue(true);
  mocks.action.mockResolvedValue({ ok: true });
  const configured = { ...base, native: { ...base.native, focusAvailable: true } };
  mocks.nativeGet.mockResolvedValueOnce(configured).mockResolvedValue({
    ...configured,
    native: { ...configured.native, focusPermission: "denied", focusPermissionPending: false },
  });
  const { user } = mount();
  await user.click(await screen.findByRole("button", { name: "Allow Focus status access" }));
  await waitFor(() => expect(mocks.error).toHaveBeenCalled());
  expect(mocks.success).not.toHaveBeenCalled();
  expect(screen.queryByText(/Focus status access was not allowed/)).not.toBeInTheDocument();
});

it("can pause cards when upgrading from native settings without active-card fields", async () => {
  mocks.desktop.mockReturnValue(true);
  const legacy = {
    ...base,
    settings: {
      serverUrl: base.settings.serverUrl,
      petEnabled: true,
      notifications: { enabled: true },
    },
  };
  mocks.nativeGet.mockResolvedValue(legacy);
  mocks.nativeSave.mockImplementation(async (settings) => ({ ...legacy, settings }));
  const { user } = mount();
  const control = await screen.findByRole("switch", { name: "Show active cards on this Mac" });
  await waitFor(() => expect(control).toBeEnabled());
  expect(control).toBeChecked();
  await user.click(control);
  await waitFor(() => expect(mocks.nativeSave).toHaveBeenCalledTimes(1));
  expect(mocks.nativeSave.mock.calls[0]?.[0]).toMatchObject({
    activeRemindersEnabled: false,
    petEnabled: true,
    notifications: { enabled: true },
  });
  expect(control).not.toBeChecked();
});
it("saves a volume adjustment once after the preview and commit phases", async () => {
  mocks.desktop.mockReturnValue(true);
  mocks.nativeSave.mockImplementation(async (settings) => ({ ...base, settings }));
  const { cache, user } = mount();
  const control = await screen.findByRole("slider", { name: "Overall volume" });
  await waitFor(() => expect(control).not.toHaveAttribute("aria-disabled", "true"));
  control.focus();
  await user.keyboard("{ArrowRight}");
  await waitFor(() => expect(mocks.nativeSave).toHaveBeenCalled());
  await waitFor(() => expect(cache.isMutating()).toBe(0));
  expect(mocks.nativeSave).toHaveBeenCalledTimes(1);
  expect(mocks.nativeSave.mock.calls[0]?.[0]).toMatchObject({
    activeCardInteractions: { volume: 0.36 },
  });
  expect(control).toHaveAttribute("aria-valuenow", "36");
});

it("ignores a defaults response that finishes after the account changes", async () => {
  let finish!: (value: unknown) => void;
  mocks.save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { cache, user } = mount();
  const tasks = await screen.findByRole("switch", { name: "New tasks" });
  await waitFor(() => expect(tasks).toBeEnabled());
  const before = cache.getQueryData(["active-reminder-preferences", "owner"]);
  await user.click(tasks);
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  const replacement = {
    defaultTaskActiveReminder: false,
    defaultReminderActiveReminder: false,
    revision: 20,
  };
  act(() => {
    cache.setQueryData(["me"], { id: "other" });
    cache.setQueryData(["active-reminder-preferences", "other"], replacement);
    finish({ defaultTaskActiveReminder: true, defaultReminderActiveReminder: true, revision: 5 });
  });
  await waitFor(() => expect(cache.isMutating()).toBe(0));
  expect(cache.getQueryData(["active-reminder-preferences", "owner"])).toEqual(before);
  expect(cache.getQueryData(["active-reminder-preferences", "other"])).toEqual(replacement);
});
it("does not replace another account's native cache with a late save response", async () => {
  mocks.desktop.mockReturnValue(true);
  let finish!: (value: unknown) => void;
  mocks.nativeSave.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { cache, user } = mount();
  const shake = await screen.findByRole("switch", { name: "Shake to gather" });
  await waitFor(() => expect(shake).toBeEnabled());
  await user.click(shake);
  await waitFor(() => expect(mocks.nativeSave).toHaveBeenCalledTimes(1));
  const replacement = {
    ...base,
    accountId: "other",
    settings: { ...base.settings, petEnabled: false },
  };
  act(() => {
    cache.setQueryData(["me"], { id: "other" });
    cache.setQueryData(["desktop-settings"], replacement);
    finish({
      ...base,
      settings: {
        ...base.settings,
        activeCardInteractions: { ...base.settings.activeCardInteractions, shake: false },
      },
    });
  });
  await waitFor(() => expect(cache.isMutating()).toBe(0));
  expect(cache.getQueryData(["desktop-settings"])).toEqual(replacement);
});
