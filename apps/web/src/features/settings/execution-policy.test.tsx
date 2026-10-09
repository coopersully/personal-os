// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/api";
import { ExecutionPolicySettingsCard } from "./execution-policy";

afterEach(() => vi.restoreAllMocks());
function accountClient(options?: ConstructorParameters<typeof QueryClient>[0]) {
  const cache = new QueryClient(options);
  cache.setQueryData(["me"], { id: "owner-a" });
  return cache;
}

it("retains a conflicted policy intent, survives a failed read and repeated conflict, and reapplies only the reviewed version", async () => {
  const get = vi
    .spyOn(api, "getExecutionPolicySettings")
    .mockResolvedValue({ reviewBypassEnabled: false, version: 1 });
  const update = vi
    .spyOn(api, "updateExecutionPolicySettings")
    .mockRejectedValue(new ApiClientError({ status: 409, code: "conflict", message: "Changed" }));
  render(
    <QueryClientProvider
      client={accountClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })}
    >
      <ExecutionPolicySettingsCard />
    </QueryClientProvider>,
  );
  const toggle = await screen.findByRole("switch");
  await waitFor(() => expect(toggle).toBeEnabled());
  await userEvent.click(toggle);
  expect(await screen.findByText("Your change: Enabled")).toBeInTheDocument();
  expect(update).toHaveBeenLastCalledWith({ reviewBypassEnabled: true, expectedVersion: 1 });
  get.mockRejectedValueOnce(new Error("Offline"));
  await userEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh latest settings" })).toBeEnabled(),
  );
  expect(screen.getByRole("button", { name: "Reapply reviewed change" })).toBeDisabled();
  expect(update).toHaveBeenCalledTimes(1);
  get.mockResolvedValue({ reviewBypassEnabled: false, version: 4 });
  await userEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reapply reviewed change" })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Reapply reviewed change" }));
  await waitFor(() =>
    expect(update).toHaveBeenLastCalledWith({ reviewBypassEnabled: true, expectedVersion: 4 }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reapply reviewed change" })).toBeDisabled(),
  );
  get.mockResolvedValue({ reviewBypassEnabled: false, version: 5 });
  update.mockResolvedValue({ reviewBypassEnabled: true, version: 6 });
  await userEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reapply reviewed change" })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Reapply reviewed change" }));
  await waitFor(() =>
    expect(update).toHaveBeenLastCalledWith({ reviewBypassEnabled: true, expectedVersion: 5 }),
  );
  await waitFor(() => expect(screen.queryByText("Your change: Enabled")).not.toBeInTheDocument());
});
it("explicitly accepts latest policy without another write", async () => {
  vi.spyOn(api, "getExecutionPolicySettings").mockResolvedValue({
    reviewBypassEnabled: false,
    version: 3,
  });
  const update = vi
    .spyOn(api, "updateExecutionPolicySettings")
    .mockRejectedValue(new ApiClientError({ status: 409, code: "conflict", message: "Changed" }));
  render(
    <QueryClientProvider client={accountClient({ defaultOptions: { queries: { retry: false } } })}>
      <ExecutionPolicySettingsCard />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
  await userEvent.click(screen.getByRole("switch"));
  await screen.findByText("Your change: Enabled");
  await userEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Use latest settings" })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Use latest settings" }));
  expect(update).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("switch")).not.toBeChecked();
});

it.each([
  "reject",
  "resolve",
  "refresh",
] as const)("fences deferred policy %s completion across logout and A to B to A", async (phase) => {
  const get = vi
    .spyOn(api, "getExecutionPolicySettings")
    .mockResolvedValue({ reviewBypassEnabled: false, version: 1 });
  let refreshStarted = false;
  let reject!: (error: Error) => void;
  let resolve!: (data: { reviewBypassEnabled: boolean; version: number }) => void;
  const update = vi.spyOn(api, "updateExecutionPolicySettings").mockImplementation(
    () =>
      new Promise((done, fail) => {
        resolve = done;
        reject = fail;
      }),
  );
  const cache = accountClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cache}>
      <ExecutionPolicySettingsCard />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
  await userEvent.click(screen.getByRole("switch"));
  await waitFor(() => expect(reject).toBeDefined());
  if (phase === "refresh") {
    await act(async () => reject(new Error("Offline")));
    await screen.findByText("Your change: Enabled");
    get.mockImplementationOnce(
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
  await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
  await act(async () => {
    if (phase === "reject") reject(new Error("Old failure"));
    else resolve({ reviewBypassEnabled: true, version: 99 });
  });
  expect(screen.queryByText("Your change: Enabled")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reapply reviewed change" })).not.toBeInTheDocument();
  expect(screen.getByRole("switch")).not.toBeChecked();
  expect(cache.getQueryData(["execution-policy"])).toEqual({
    reviewBypassEnabled: false,
    version: 1,
  });
  expect(update).toHaveBeenCalledTimes(1);
});

it("does not optimistically update or submit policy after the account changes during cancellation", async () => {
  vi.spyOn(api, "getExecutionPolicySettings").mockResolvedValue({
    reviewBypassEnabled: false,
    version: 2,
  });
  const update = vi.spyOn(api, "updateExecutionPolicySettings");
  const cache = accountClient({ defaultOptions: { queries: { retry: false } } });
  let release!: () => void;
  vi.spyOn(cache, "cancelQueries").mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        release = done;
      }),
  );
  render(
    <QueryClientProvider client={cache}>
      <ExecutionPolicySettingsCard />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
  await userEvent.click(screen.getByRole("switch"));
  await waitFor(() => expect(release).toBeDefined());
  act(() => {
    cache.setQueryData(["me"], { id: "owner-b" });
  });
  await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
  await act(async () => release());
  expect(update).not.toHaveBeenCalled();
  expect(screen.getByRole("switch")).not.toBeChecked();
  expect(screen.queryByText("Your change: Enabled")).not.toBeInTheDocument();
});

it.each([
  "uncertain",
  "rejected",
] as const)("keeps a %s attempt to disable policy distinct from the latest enabled policy", async (kind) => {
  const get = vi
    .spyOn(api, "getExecutionPolicySettings")
    .mockResolvedValue({ reviewBypassEnabled: true, version: 2 });
  const update = vi
    .spyOn(api, "updateExecutionPolicySettings")
    .mockRejectedValueOnce(
      kind === "uncertain"
        ? new Error("Response lost")
        : new ApiClientError({ status: 403, code: "forbidden", message: "No access" }),
    );
  render(
    <QueryClientProvider client={accountClient({ defaultOptions: { queries: { retry: false } } })}>
      <ExecutionPolicySettingsCard />
    </QueryClientProvider>,
  );
  const toggle = await screen.findByRole("switch");
  await waitFor(() => expect(toggle).toBeEnabled());
  await userEvent.click(toggle);
  expect(await screen.findByText("Your change: Disabled")).toBeVisible();
  expect(
    await screen.findByText(
      kind === "uncertain"
        ? "The change may have been saved. Refresh checks the current values without writing."
        : "The change could not be applied. Refresh the current values before trying again.",
    ),
  ).toBeVisible();
  expect(update).toHaveBeenLastCalledWith({ expectedVersion: 2, reviewBypassEnabled: false });
  get.mockResolvedValue({ reviewBypassEnabled: true, version: 7 });
  await userEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Use latest settings" })).toBeEnabled(),
  );
  expect(screen.getByText("Latest: Enabled")).toBeVisible();
  expect(update).toHaveBeenCalledTimes(1);
  if (kind === "rejected") {
    await userEvent.click(screen.getByRole("button", { name: "Use latest settings" }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(toggle).toBeChecked();
  } else {
    update.mockResolvedValue({ reviewBypassEnabled: false, version: 8 });
    get.mockResolvedValue({ reviewBypassEnabled: false, version: 8 });
    await userEvent.click(screen.getByRole("button", { name: "Reapply reviewed change" }));
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith({ expectedVersion: 7, reviewBypassEnabled: false }),
    );
  }
  await waitFor(() => expect(screen.queryByText("Your change: Disabled")).not.toBeInTheDocument());
});

it("preserves the newest reviewed account-policy version when an older refresh completes later", async () => {
  vi.spyOn(api, "getExecutionPolicySettings").mockResolvedValue({
    reviewBypassEnabled: false,
    version: 4,
  });
  const update = vi
    .spyOn(api, "updateExecutionPolicySettings")
    .mockRejectedValue(new ApiClientError({ status: 409, code: "conflict", message: "Changed" }));
  type Result = Awaited<ReturnType<QueryObserver["refetch"]>>;
  let older!: (result: Result) => void;
  let newer!: (result: Result) => void;
  vi.spyOn(QueryObserver.prototype, "refetch")
    .mockImplementationOnce(
      () =>
        new Promise<Result>((resolve) => {
          older = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<Result>((resolve) => {
          newer = resolve;
        }),
    );
  render(
    <QueryClientProvider client={accountClient({ defaultOptions: { queries: { retry: false } } })}>
      <ExecutionPolicySettingsCard />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
  await userEvent.click(screen.getByRole("switch"));
  await screen.findByText("Your change: Enabled");
  const refresh = screen.getByRole("button", { name: "Refresh latest settings" });
  act(() => {
    refresh.click();
    refresh.click();
  });
  await act(async () =>
    newer({ data: { reviewBypassEnabled: true, version: 8 }, isError: false } as Result),
  );
  await screen.findByText("Latest: Enabled");
  await act(async () =>
    older({ data: { reviewBypassEnabled: false, version: 6 }, isError: false } as Result),
  );
  expect(screen.getByText("Latest: Enabled")).toBeVisible();
  expect(screen.queryByText("Latest: Disabled")).not.toBeInTheDocument();
  expect(update).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Reapply reviewed change" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update).toHaveBeenLastCalledWith({ reviewBypassEnabled: true, expectedVersion: 8 });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reapply reviewed change" })).toBeDisabled(),
  );
  expect(screen.getByText("Your change: Enabled")).toBeVisible();
});
