// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
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
  it("retains stale data and sends refresh failures to Sonner without any layout node", async () => {
    const feedback = vi.spyOn(toast, "error");
    const promise = vi.spyOn(toast, "promise");
    const refetch = vi.fn().mockResolvedValue({ isError: false });
    const { container, rerender } = render(
      <QueryFeedback
        query={{ isError: true, error: new Error("secret"), data: [], refetch }}
        title="Couldn’t refresh your calendar."
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(feedback).toHaveBeenCalledWith(
      "Couldn’t refresh your calendar.",
      expect.objectContaining({
        description: "Showing the last available update.",
        action: expect.objectContaining({ label: "Try again" }),
      }),
    );
    const options = feedback.mock.calls.at(-1)?.[1];
    const action = options?.action;
    if (action && typeof action === "object" && "onClick" in action) action.onClick({} as never);
    expect(refetch).toHaveBeenCalledOnce();
    expect(promise).toHaveBeenCalled();
    rerender(
      <QueryFeedback
        query={{ isError: false, error: null, data: [] }}
        title="Couldn’t refresh your calendar."
      />,
    );
    expect(container).toBeEmptyDOMElement();
    vi.restoreAllMocks();
  });
  it("announces initial failures through Sonner, while stale-only ignores initial failures", () => {
    const feedback = vi.spyOn(toast, "error");
    const failed = { isError: true, error: new Error("secret") };
    const { container, rerender } = render(
      <QueryFeedback query={failed} title="Couldn’t load notes." staleOnly />,
    );
    expect(feedback).not.toHaveBeenCalled();
    rerender(<QueryFeedback query={failed} title="Couldn’t load notes." />);
    expect(feedback).toHaveBeenCalledWith(
      "Couldn’t load notes.",
      expect.objectContaining({ description: "Try again in a moment." }),
    );
    expect(container).toBeEmptyDOMElement();
    vi.restoreAllMocks();
  });
  it("makes loading perceivable to assistive technology", () => {
    render(<PageLoading />);
    expect(screen.getByRole("status", { name: "Loading content" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getAllByRole("status").length).toBeGreaterThan(0);
  });
});
