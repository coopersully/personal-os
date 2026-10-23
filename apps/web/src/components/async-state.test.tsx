// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type Action, toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineError, PageLoading, QueryFeedback } from "./async-state.js";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("query feedback", () => {
  it("announces safe failures through Sonner and retains initial recovery inside the content region", async () => {
    const retry = vi.fn();
    render(
      <InlineError
        error={new Error("SQL credentials: secret")}
        title="Couldn’t load your calendar."
        retry={retry}
      />,
    );
    expect(toast.error).toHaveBeenCalledWith("Couldn’t load your calendar.", expect.any(Object));
    expect(screen.getByRole("region")).toHaveTextContent("check your connection");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/SQL credentials/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it("uses safe default copy for unexpected values without inventing retry", () => {
    render(<InlineError error={{ internal: "secret" }} />);
    expect(screen.getByRole("region")).toHaveTextContent("Couldn’t load this material.");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it.each([
    [401, "Your session has expired."],
    [403, "You don’t have access"],
  ])("explains initial HTTP %s blockers safely", (status, message) => {
    render(
      <InlineError
        error={
          new ApiClientError({
            code: "specialized",
            status: Number(status),
            message: "private diagnostic",
          })
        }
      />,
    );
    expect(screen.getByRole("region")).toHaveTextContent(String(message));
    expect(screen.queryByText(/private diagnostic/)).not.toBeInTheDocument();
  });
  it("never inserts stale refresh feedback into the layout and offers retry in Sonner", () => {
    const refetch = vi.fn();
    const view = render(
      <>
        <p>Saved event</p>
        <QueryFeedback
          query={{ isError: true, error: new Error("secret"), data: [], refetch }}
          title="Couldn’t refresh your calendar."
        />
      </>,
    );
    expect(view.container.innerHTML).toBe("<p>Saved event</p>");
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn’t refresh your calendar.",
      expect.objectContaining({ action: expect.objectContaining({ label: "Try again" }) }),
    );
    const action = vi.mocked(toast.error).mock.calls[0]?.[1]?.action as Action;
    action.onClick({} as Parameters<Action["onClick"]>[0]);
    expect(refetch).toHaveBeenCalledOnce();
  });
  it("hides stale-only initial failures and clears recovered feedback", () => {
    const failed = { isError: true, error: new Error("secret") };
    const view = render(<QueryFeedback query={failed} title="Couldn’t load notes." staleOnly />);
    expect(view.container).toBeEmptyDOMElement();
    expect(toast.error).not.toHaveBeenCalled();
    view.rerender(
      <QueryFeedback query={{ ...failed, data: null }} title="Couldn’t refresh notes." staleOnly />,
    );
    expect(toast.error).toHaveBeenCalledOnce();
    expect(view.container).toBeEmptyDOMElement();
    view.rerender(
      <QueryFeedback
        query={{ ...failed, data: [], isError: false }}
        title="Couldn’t load notes."
      />,
    );
    expect(toast.dismiss).toHaveBeenCalled();
  });
  it("makes loading perceivable", () => {
    render(<PageLoading />);
    expect(screen.getByRole("status", { name: "Loading content" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});

it("keeps initial navigation errors entirely out of layout with a toast retry", () => {
  const retry = vi.fn();
  const view = render(
    <QueryFeedback
      query={{ isError: true, error: new Error("offline"), refetch: retry }}
      title="Couldn’t load navigation."
      toastOnly
    />,
  );
  expect(view.container).toBeEmptyDOMElement();
  expect(toast.error).toHaveBeenCalledWith(
    "Couldn’t load navigation.",
    expect.objectContaining({ action: expect.objectContaining({ label: "Try again" }) }),
  );
});
