// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/api";
import { ExecutionPolicySettingsCard } from "./execution-policy";

afterEach(() => vi.restoreAllMocks());
it("retains a conflicted policy intent, survives a failed read and repeated conflict, and reapplies only the reviewed version", async () => {
  const get = vi
    .spyOn(api, "getExecutionPolicySettings")
    .mockResolvedValue({ reviewBypassEnabled: false, version: 1 });
  const update = vi
    .spyOn(api, "updateExecutionPolicySettings")
    .mockRejectedValue(new ApiClientError({ status: 409, code: "conflict", message: "Changed" }));
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
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
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
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
