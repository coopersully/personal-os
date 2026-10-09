// @vitest-environment jsdom
import { defaultNotificationPreferences, type NotificationStatus } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  FinanceNotificationPreferenceSummary,
  FinanceNotificationPreferences,
} from "./finance-preferences";

const mocks = vi.hoisted(() => ({
  getNotificationStatus: vi.fn(),
  resetFinanceNotificationPreferences: vi.fn(),
}));
vi.mock("@/api", () => ({ api: mocks, errorMessage: (error: Error) => error.message }));
const status: NotificationStatus = {
  capability: "available",
  reason: null,
  timeZone: "America/New_York",
  preferences: [],
  effective: defaultNotificationPreferences,
  intents: [],
  attempts: [],
};
function accountClient(options?: ConstructorParameters<typeof QueryClient>[0]) {
  const cache = new QueryClient(options);
  cache.setQueryData(["me"], { id: "owner-a" });
  return cache;
}

it("shows inherited default preferences without claiming delivery readiness", () => {
  render(<FinanceNotificationPreferenceSummary status={status} />);
  expect(screen.getByText("Inherited from global preferences")).toBeInTheDocument();
  expect(screen.getByText("Global preferences use the default settings.")).toBeInTheDocument();
  expect(screen.getByText("22:00–08:00 (America/New_York)")).toBeInTheDocument();
  expect(screen.getByText("Every 7 days")).toBeInTheDocument();
});
it("identifies overrides even when their values match global settings and uses effective detail", () => {
  render(
    <FinanceNotificationPreferenceSummary
      status={{
        ...status,
        preferences: [
          {
            scope: "global",
            revision: 2,
            preferences: { ...defaultNotificationPreferences, detail: "minimal" },
          },
          { scope: "finances", revision: 1, preferences: defaultNotificationPreferences },
        ],
        effective: { ...defaultNotificationPreferences, detail: "minimal" },
      }}
    />,
  );
  expect(screen.getByText("Overridden for Finances")).toBeInTheDocument();
  expect(screen.getByText("Minimal")).toBeInTheDocument();
  expect(screen.getByText(/Global preferences limit message detail/)).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
it("honestly shows unavailable capability and disabled options", () => {
  render(
    <FinanceNotificationPreferenceSummary
      status={{
        ...status,
        capability: "unavailable",
        reason: "producer_not_registered",
        effective: {
          ...defaultNotificationPreferences,
          enabled: false,
          quietMode: "any_time",
          reminderDays: null,
        },
      }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("unavailable on this deployment");
  expect(screen.getByText("Disabled")).toBeInTheDocument();
  expect(screen.getByText("No reminders")).toBeInTheDocument();
  expect(screen.getByText("No quiet hours")).toBeInTheDocument();
});
it("shows a load error rather than presenting inherited defaults as saved state", async () => {
  mocks.getNotificationStatus.mockRejectedValue(new Error("Unavailable"));
  render(
    <QueryClientProvider client={accountClient({ defaultOptions: { queries: { retry: false } } })}>
      <FinanceNotificationPreferences />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText("Couldn’t load Finance notification preferences."),
  ).toBeInTheDocument();
  expect(screen.queryByText("Inherited from global preferences")).not.toBeInTheDocument();
});

it("resets the exact override and shows inheritance after success", async () => {
  mocks.getNotificationStatus
    .mockResolvedValueOnce({
      ...status,
      preferences: [
        { scope: "finances", revision: 4, preferences: defaultNotificationPreferences },
      ],
    })
    .mockResolvedValue(status);
  mocks.resetFinanceNotificationPreferences.mockResolvedValue({
    scope: "finances",
    inherited: true,
  });
  render(
    <QueryClientProvider client={accountClient({ defaultOptions: { queries: { retry: false } } })}>
      <FinanceNotificationPreferences />
    </QueryClientProvider>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Use global notification preferences" }),
  );
  await waitFor(() =>
    expect(mocks.resetFinanceNotificationPreferences).toHaveBeenCalledWith({ expectedRevision: 4 }),
  );
  expect(await screen.findByText("Inherited from global preferences")).toBeInTheDocument();
});
it("retains the override after a failed reset", async () => {
  mocks.getNotificationStatus.mockResolvedValue({
    ...status,
    preferences: [{ scope: "finances", revision: 4, preferences: defaultNotificationPreferences }],
  });
  mocks.resetFinanceNotificationPreferences.mockRejectedValue(new Error("Changed elsewhere"));
  render(
    <QueryClientProvider client={accountClient({ defaultOptions: { queries: { retry: false } } })}>
      <FinanceNotificationPreferences />
    </QueryClientProvider>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Use global notification preferences" }),
  );
  expect(
    await screen.findByText(
      "Finance notification reset has not been confirmed. Review the latest settings before applying your change.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByText("Overridden for Finances")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Use global notification preferences" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Refresh latest settings" })).toBeEnabled();
});

it("omits reset controls without edit access", async () => {
  mocks.getNotificationStatus.mockResolvedValue({
    ...status,
    preferences: [{ scope: "finances", revision: 4, preferences: defaultNotificationPreferences }],
  });
  render(
    <QueryClientProvider client={accountClient({ defaultOptions: { queries: { retry: false } } })}>
      <FinanceNotificationPreferences canEdit={false} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Overridden for Finances")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Use global notification preferences" }),
  ).not.toBeInTheDocument();
});

it("retains reset intent through read failure and repeated conflicts without resetting an unseen revision", async () => {
  const makeStatus = (revision: number) => ({
    ...status,
    preferences: [
      { scope: "finances" as const, revision, preferences: defaultNotificationPreferences },
    ],
  });
  mocks.getNotificationStatus.mockResolvedValue(makeStatus(4));
  mocks.resetFinanceNotificationPreferences.mockRejectedValue(new Error("Changed"));
  render(
    <QueryClientProvider client={accountClient({ defaultOptions: { queries: { retry: false } } })}>
      <FinanceNotificationPreferences />
    </QueryClientProvider>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Use global notification preferences" }),
  );
  await screen.findByRole("button", { name: "Refresh latest settings" });
  mocks.getNotificationStatus.mockRejectedValueOnce(new Error("Offline"));
  await userEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh latest settings" })).toBeEnabled(),
  );
  expect(screen.getByRole("button", { name: "Reapply reviewed change" })).toBeDisabled();
  const callsBefore = mocks.resetFinanceNotificationPreferences.mock.calls.length;
  mocks.getNotificationStatus.mockResolvedValue(makeStatus(6));
  await userEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reapply reviewed change" })).toBeEnabled(),
  );
  expect(mocks.resetFinanceNotificationPreferences).toHaveBeenCalledTimes(callsBefore);
  mocks.getNotificationStatus.mockResolvedValue(makeStatus(7));
  await userEvent.click(screen.getByRole("button", { name: "Reapply reviewed change" }));
  await waitFor(() =>
    expect(mocks.resetFinanceNotificationPreferences).toHaveBeenLastCalledWith({
      expectedRevision: 6,
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reapply reviewed change" })).toBeDisabled(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Use latest settings" })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Use latest settings" }));
  expect(mocks.resetFinanceNotificationPreferences).toHaveBeenCalledTimes(callsBefore + 1);
  expect(screen.getByRole("button", { name: "Use global notification preferences" })).toBeEnabled();
});

it.each([
  "reject",
  "resolve",
  "refresh",
] as const)("fences deferred Finance reset %s completion across logout and A to B to A", async (phase) => {
  mocks.getNotificationStatus.mockReset();
  mocks.resetFinanceNotificationPreferences.mockReset();
  const ownedStatus: NotificationStatus = {
    ...status,
    preferences: [{ scope: "finances", revision: 4, preferences: defaultNotificationPreferences }],
  };
  mocks.getNotificationStatus.mockResolvedValue(ownedStatus);
  let refreshStarted = false;
  let reject!: (error: Error) => void;
  let resolve!: (data: unknown) => void;
  mocks.resetFinanceNotificationPreferences.mockImplementation(
    () =>
      new Promise((done, fail) => {
        resolve = done;
        reject = fail;
      }),
  );
  const cache = accountClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cache}>
      <FinanceNotificationPreferences />
    </QueryClientProvider>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Use global notification preferences" }),
  );
  await waitFor(() => expect(reject).toBeDefined());
  if (phase === "refresh") {
    await act(async () => reject(new Error("Offline")));
    await screen.findByText(/Your change: Use global preferences/);
    mocks.getNotificationStatus.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
          refreshStarted = true;
        }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
    await waitFor(() => expect(refreshStarted).toBe(true));
  }
  act(() => {
    cache.removeQueries({ queryKey: ["me"] });
    cache.setQueryData(["me"], { id: "owner-b" });
    cache.setQueryData(["me"], { id: "owner-a" });
  });
  await screen.findByRole("button", { name: "Use global notification preferences" });
  await act(async () => {
    if (phase === "reject") reject(new Error("Old failure"));
    else resolve(phase === "refresh" ? status : { reset: true });
  });
  expect(screen.queryByText(/Your change: Use global preferences/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reapply reviewed change" })).not.toBeInTheDocument();
  expect(cache.getQueryData(["notification-status"])).toEqual(ownedStatus);
  expect(mocks.resetFinanceNotificationPreferences).toHaveBeenCalledTimes(1);
});
