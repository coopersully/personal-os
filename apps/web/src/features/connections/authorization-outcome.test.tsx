// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ConnectorAuthorizationOutcome } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ConnectionAuthorizationOutcome } from "./authorization-outcome.js";

const attemptId = "11111111-1111-4111-8111-111111111111";

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="location">{`${location.pathname}${location.search}`}</output>;
}

function setup(
  outcome: ConnectorAuthorizationOutcome,
  onRetry = vi.fn(),
  entry = `/settings?section=connections&connection_attempt=${attemptId}`,
) {
  const loadAttempt = vi.fn(async () => outcome);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <ConnectionAuthorizationOutcome loadAttempt={loadAttempt} onRetry={onRetry} />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { loadAttempt, onRetry };
}

describe("connection authorization outcome", () => {
  it.each([
    ["connected", "Google is connected", false],
    ["cancelled", "Connection cancelled", true],
    ["expired", "Connection link expired", true],
    ["permission_incomplete", "Google needs permission", true],
    ["failed", "Google couldn't connect", true],
    ["pending", "Finishing your Google connection", false],
  ] as const)("renders the safe %s outcome", async (status, title, retry) => {
    const { onRetry } = setup({
      accountId: status === "connected" ? attemptId : null,
      provider: "google",
      retryable: status === "failed",
      status,
    });
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText(/raw-provider-canary/u)).not.toBeInTheDocument();
    if (retry) expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    else expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    if (retry) {
      await userEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(onRetry).toHaveBeenCalledWith("google");
    }
  });

  it("clears only callback parameters after loading", async () => {
    setup({ accountId: attemptId, provider: "google", retryable: false, status: "connected" });
    await screen.findByText("Google is connected");
    await waitFor(() =>
      expect(screen.getByLabelText("location")).toHaveTextContent("/settings?section=connections"),
    );
  });

  it("turns an unknown callback into one restart action without making a lookup", async () => {
    const onRetry = vi.fn();
    const { loadAttempt } = setup(
      { accountId: null, provider: "google", retryable: false, status: "failed" },
      onRetry,
      "/settings?section=connections&connection_result=restart_required",
    );
    expect(screen.getByText("Restart the connection")).toBeInTheDocument();
    expect(loadAttempt).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Connect an account" }));
    expect(onRetry).toHaveBeenCalledWith(null);
  });

  it("labels a non-retryable X failure without exposing provider details", async () => {
    const { onRetry } = setup({
      accountId: null,
      provider: "x",
      retryable: false,
      status: "failed",
    });

    expect(await screen.findByText("X couldn't connect")).toBeInTheDocument();
    expect(
      screen.getByText("Your existing connection was not changed. Start again to finish securely."),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledWith("x");
  });

  it("turns a failed outcome lookup into one safe restart action", async () => {
    const onRetry = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[`/settings?section=connections&connection_attempt=${attemptId}`]}
        >
          <ConnectionAuthorizationOutcome
            loadAttempt={vi.fn(async () => {
              throw new Error("raw-provider-canary");
            })}
            onRetry={onRetry}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Restart the connection")).toBeInTheDocument();
    expect(screen.queryByText(/raw-provider-canary/u)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Connect an account" }));
    expect(onRetry).toHaveBeenCalledWith(null);
  });
});
