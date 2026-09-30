// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InlineError, PageLoading, QueryFeedback } from "./async-state.js";

describe("query feedback", () => {
  it("names initial load failure safely and retains an actionable retry", async () => {
    const retry = vi.fn();
    render(
      <InlineError
        error={new Error("SQL credentials: secret")}
        title="Couldn’t load your calendar."
        retry={retry}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Couldn’t load your calendar.");
    expect(screen.getByRole("status")).toHaveTextContent("check your connection");
    expect(screen.queryByText(/SQL credentials/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("uses safe default copy for unexpected non-error values without inventing a retry control", () => {
    render(<InlineError error={{ internal: "secret" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Couldn’t load this material.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it.each([
    [401, "Your session has expired. Sign in again to continue."],
    [403, "You don’t have access to this material. Check the account’s permissions."],
  ])("explains HTTP %s access blockers even when existing data is stale", (status, message) => {
    render(
      <InlineError
        error={
          new ApiClientError({
            code: "specialized",
            status: Number(status),
            message: "private diagnostic",
          })
        }
        stale
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(message);
    expect(screen.queryByText(/private diagnostic/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Try refreshing/)).not.toBeInTheDocument();
  });
  it("marks retained data as stale and exposes refetch without removing children", async () => {
    const refetch = vi.fn();
    render(
      <>
        <p>Saved event</p>
        <QueryFeedback
          query={{ isError: true, error: new Error("secret"), data: [], refetch }}
          title="Couldn’t refresh your calendar."
        />
      </>,
    );
    expect(screen.getByText("Saved event")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Showing the last available update");
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledOnce();
  });
  it("shows initial failures, hides stale-only initial failures, and clears recovered query feedback", () => {
    const failed = { isError: true, error: new Error("secret") };
    const { rerender } = render(<QueryFeedback query={failed} title="Couldn’t load notes." />);
    expect(screen.getByRole("status")).toHaveTextContent("Couldn’t load notes.");
    expect(screen.getByRole("status")).not.toHaveTextContent("last available update");
    rerender(<QueryFeedback query={failed} title="Couldn’t load notes." staleOnly />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(
      <QueryFeedback query={{ ...failed, data: null }} title="Couldn’t refresh notes." staleOnly />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("last available update");
    rerender(
      <QueryFeedback
        query={{ ...failed, data: [], isError: false }}
        title="Couldn’t load notes."
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("makes loading perceivable to assistive technology", () => {
    render(<PageLoading />);
    expect(screen.getByText("Loading").closest('[role="status"]')).toBeInTheDocument();
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });
});
