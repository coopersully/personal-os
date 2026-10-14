// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { QueryFeedback } from "./async-state";
import { ReadFailureBoundary } from "./read-failure-boundary";

function setup(key: string, fetch: () => Promise<string>, path = "/today") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData([key], "Last update");
  function Content() {
    const query = useQuery({ queryKey: [key], queryFn: fetch });
    return (
      <>
        <nav aria-label="Workspace">Today</nav>
        <section aria-label="Bento">
          <input aria-label="Draft" defaultValue="Keep this edit" />
          <p>{typeof query.data === "string" ? query.data : "Source data"}</p>
        </section>
        <QueryFeedback query={query} title="Couldn’t refresh optional data." />
      </>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ReadFailureBoundary>
          <Content />
        </ReadFailureBoundary>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
afterEach(() => vi.restoreAllMocks());

it.each([
  "me",
  "daily-brief",
  "today-commitments",
])("blocks cached %s failures with one recovery screen, then restores the same draft", async (key) => {
  let failed = true;
  const feedback = vi.spyOn(toast, "promise");
  setup(key, async () => {
    if (failed) throw new TypeError("private transport diagnostic");
    return "Fresh update";
  });
  expect(await screen.findByRole("heading", { name: "Can’t connect" })).toBeVisible();
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Bento" })).not.toBeInTheDocument();
  expect(screen.queryByText("private transport diagnostic")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
  failed = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Fresh update")).toBeVisible();
  expect(screen.getByLabelText("Draft")).toHaveValue("Keep this edit");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(feedback).toHaveBeenCalledWith(
    expect.any(Promise),
    expect.objectContaining({
      loading: "Reconnecting…",
      success: expect.any(String),
      error: expect.any(String),
    }),
  );
});
it.each([
  [403, "Access denied"],
  [503, "Back soon"],
  [500, "Server error"],
])("uses the real HTTP %s error state", async (status, title) => {
  setup("daily-brief", async () => {
    throw new ApiClientError({ status: Number(status), code: "failed", message: "private" });
  });
  expect(await screen.findByRole("heading", { name: String(title) })).toBeVisible();
});
it("keeps optional failures out of layout and deduplicates their Sonner announcement", async () => {
  const error = vi.spyOn(toast, "error");
  const client = setup("weather", async () => {
    throw new Error("failed");
  });
  await waitFor(() =>
    expect(error).toHaveBeenCalledWith("Couldn’t refresh optional data.", expect.any(Object)),
  );
  const count = error.mock.calls.length;
  await act(async () => {
    await client.refetchQueries({ queryKey: ["weather"] });
  });
  expect(error).toHaveBeenCalledTimes(count);
  expect(screen.getByRole("navigation")).toBeVisible();
  expect(screen.getByRole("region", { name: "Bento" })).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("does not let an inactive failed Today query block another workspace", async () => {
  setup(
    "daily-brief",
    async () => {
      throw new Error("failed");
    },
    "/calendar",
  );
  await waitFor(() => expect(screen.getByText("Last update")).toBeVisible());
  expect(screen.getByRole("navigation")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Can’t connect" })).not.toBeInTheDocument();
});
it("retains the blocker through retry and remains blocked when the retry fails", async () => {
  const feedback = vi.spyOn(toast, "promise").mockImplementation((promise) => {
    if (promise instanceof Promise) void promise.catch(() => {});
    return { unwrap: () => Promise.resolve() };
  });
  let reject: (error: Error) => void = () => {};
  let first = true;
  setup("daily-brief", () => {
    if (first) {
      first = false;
      return Promise.reject(new Error("unavailable"));
    }
    return new Promise((_resolve, fail) => {
      reject = fail;
    });
  });
  await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  await act(async () => {
    reject(new Error("still unavailable"));
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled());
  expect(screen.getByRole("heading", { name: "Can’t connect" })).toBeVisible();
  expect(feedback).toHaveBeenCalledOnce();
});

it("blocks offline once, refuses a false-success retry, and recovers on connection restoration", async () => {
  const feedback = vi.spyOn(toast, "error");
  const fetch = vi.fn().mockResolvedValue("Fresh update");
  setup("weather", fetch);
  await screen.findByText("Fresh update");
  fireEvent(window, new Event("offline"));
  expect(await screen.findByRole("heading", { name: "Can’t connect" })).toBeVisible();
  const calls = fetch.mock.calls.length;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(feedback).toHaveBeenCalledWith("You’re offline. Reconnect, then try again.");
  expect(fetch).toHaveBeenCalledTimes(calls);
  fireEvent(window, new Event("online"));
  expect(screen.getByRole("navigation")).toBeVisible();
});

it("blocks a successful response when both essential commitment sources are unavailable", async () => {
  const client = setup("today-commitments", async () => "Fresh update");
  await screen.findByText("Fresh update");
  await act(async () => {
    client.setQueryData(["today-commitments"], { unavailableSources: ["tasks", "reminders"] });
  });
  expect(screen.getByRole("heading", { name: "Can’t connect" })).toBeVisible();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});
