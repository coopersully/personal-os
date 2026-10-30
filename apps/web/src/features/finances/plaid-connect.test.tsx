// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithFeedback as render } from "@/test-utils/feedback";
import { api } from "../../api.js";
import { PlaidConnectButton } from "./plaid-connect.js";

const link = vi.hoisted(() => ({ onSuccess: (_token: string, _metadata: unknown) => {} }));
vi.mock("react-plaid-link", () => ({
  usePlaidLink: (options: typeof link) => {
    link.onSuccess = options.onSuccess;
    return { open: vi.fn(), ready: false };
  },
}));
afterEach(() => {
  toast.dismiss();
  vi.restoreAllMocks();
});
const reconnectSuccess = "Bank authorization verified; synchronization scheduled.";
const reconnectRetryError =
  "Couldn’t verify bank authorization and schedule synchronization. Try again.";
const reconnectConflictError =
  "Couldn’t verify bank authorization and schedule synchronization. This item changed or is no longer available. Check the latest version before trying again.";
async function expectToast(type: "success" | "error", message: string) {
  await waitFor(() =>
    expect(
      [...document.querySelectorAll(`[data-sonner-toast][data-type="${type}"]`)].some(
        (node) =>
          node.getAttribute("data-removed") !== "true" && node.textContent?.includes(message),
      ),
    ).toBe(true),
  );
  expect(
    within(screen.getByRole("region", { name: "Bank connection controls" })).queryByText(message),
  ).not.toBeInTheDocument();
}

async function setup(accountId?: string) {
  vi.spyOn(api, "getPlaidStatus").mockResolvedValue({ available: true });
  const exchange = vi.spyOn(api, "exchangePlaidToken").mockResolvedValue([]);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <section aria-label="Bank connection controls">
        <PlaidConnectButton {...(accountId ? { accountId } : {})} onConnected={vi.fn()} />
      </section>
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "Connect bank" });
  return exchange;
}

it("passes actual Link account metadata to the server duplicate preflight", async () => {
  const exchange = await setup();
  act(() =>
    link.onSuccess("synthetic-public", {
      institution: { name: "Fixture Bank", institution_id: "ins-fixture" },
      accounts: [{ id: "account-1", name: "Checking", mask: "0042" }],
    }),
  );
  await waitFor(() =>
    expect(exchange).toHaveBeenCalledWith({
      publicToken: "synthetic-public",
      institution: "Fixture Bank",
      metadata: { institutionId: "ins-fixture", accounts: [{ name: "Checking", mask: "0042" }] },
    }),
  );
});

it("uses Sonner for missing token feedback without inline action-result copy", async () => {
  const exchange = await setup();
  const error = vi.spyOn(toast, "error");
  act(() => link.onSuccess("", {}));
  expect(exchange).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith(
    "Plaid completed without a bank connection. Try connecting again.",
  );
  await expectToast("error", "Plaid completed without a bank connection. Try connecting again.");
});

it("completes update-mode reconnect consent without a public-token exchange", async () => {
  const success = vi.spyOn(toast, "success");
  const complete = vi.spyOn(api, "completePlaidReconnect").mockResolvedValue({
    accountId: "owned-account",
    authorizationVerified: true,
    synchronizationScheduled: true,
  });
  const exchange = await setup("owned-account");
  act(() => link.onSuccess("", {}));
  await waitFor(() => expect(complete).toHaveBeenCalledWith("owned-account", expect.any(String)));
  expect(exchange).not.toHaveBeenCalled();
  await expectToast("success", reconnectSuccess);
  expect(success).toHaveBeenCalledWith(
    reconnectSuccess,
    expect.objectContaining({ id: expect.any(String) }),
  );
});

it("clearly identifies a sandbox connection before authorization", async () => {
  vi.spyOn(api, "getPlaidStatus").mockResolvedValue({ available: true, environment: "sandbox" });
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <PlaidConnectButton onConnected={vi.fn()} />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByRole("button", { name: "Connect bank · Sandbox test bank" }),
  ).toBeInTheDocument();
});

it("retains an uncertain reconnect key and renews it after a confirmed rejection", async () => {
  const complete = vi
    .spyOn(api, "completePlaidReconnect")
    .mockRejectedValueOnce(new Error("Network interrupted"))
    .mockRejectedValueOnce(
      new ApiClientError({ code: "conflict", status: 409, message: "Synchronizing." }),
    )
    .mockResolvedValue({
      accountId: "owned-account",
      authorizationVerified: true,
      synchronizationScheduled: true,
    });
  await setup("owned-account");
  act(() => link.onSuccess("", {}));
  await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
  await expectToast("error", reconnectRetryError);
  await waitFor(() => expect(screen.getByRole("button", { name: "Connect bank" })).toBeEnabled());
  act(() => link.onSuccess("", {}));
  await waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
  await expectToast("error", reconnectConflictError);
  await waitFor(() => expect(screen.getByRole("button", { name: "Connect bank" })).toBeEnabled());
  expect(complete.mock.calls[1]?.[1]).toBe(complete.mock.calls[0]?.[1]);
  act(() => link.onSuccess("", {}));
  await waitFor(() => expect(complete).toHaveBeenCalledTimes(3));
  await expectToast("success", reconnectSuccess);
  expect(complete.mock.calls[2]?.[1]).not.toBe(complete.mock.calls[1]?.[1]);
});

it("replays the same reconnect receipt after an uncertain HTTP 503 response", async () => {
  const complete = vi
    .spyOn(api, "completePlaidReconnect")
    .mockRejectedValueOnce(
      new ApiClientError({
        code: "service_unavailable",
        status: 503,
        message: "Response unconfirmed.",
      }),
    )
    .mockResolvedValue({
      accountId: "owned-account",
      authorizationVerified: true,
      synchronizationScheduled: true,
    });
  await setup("owned-account");
  act(() => link.onSuccess("", {}));
  await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
  await expectToast("error", reconnectRetryError);
  await waitFor(() => expect(screen.getByRole("button", { name: "Connect bank" })).toBeEnabled());
  act(() => link.onSuccess("", {}));
  await waitFor(() => expect(complete).toHaveBeenCalledTimes(2));
  await expectToast("success", reconnectSuccess);
  expect(complete.mock.calls[1]?.[1]).toBe(complete.mock.calls[0]?.[1]);
});
