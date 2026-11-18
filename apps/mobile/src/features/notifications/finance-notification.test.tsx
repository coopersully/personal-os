// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import FinanceNotificationScreen from "../../app/finance-notification";
import { financeNotificationWebUrl } from "./finance-notification";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  get: vi.fn(),
  open: vi.fn(async () => {}),
  push: vi.fn(),
  epoch: 1,
  user: { id: "owner" } as { id: string } | null,
  app: undefined as ((state: string) => void) | undefined,
  loading: vi.fn(() => "web-toast"),
  success: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
  params: { eventId: "event", installationId: "installation" },
}));
vi.mock("react-native", async () => ({
  ...(await import("../../../test/native")),
  AppState: {
    addEventListener: (_event: string, callback: (state: string) => void) => {
      h.app = callback;
      return { remove: vi.fn() };
    },
  },
  Linking: { openURL: h.open },
}));
vi.mock("expo-router", () => ({ router: { push: h.push }, useLocalSearchParams: () => h.params }));
vi.mock("sonner-native", () => ({
  toast: { loading: h.loading, success: h.success, error: h.error, dismiss: h.dismiss },
}));
const session = { epoch: () => h.epoch, api: () => ({ getNativePushEvent: h.get }) };
vi.mock("../auth/context", () => ({
  mobileAppOrigin: "https://nohmi.example",
  useAuth: () => ({ state: { user: h.user }, session }),
}));
vi.mock("../../components/screen", () => ({
  Screen: ({ children }: PropsWithChildren) => <main>{children}</main>,
}));
vi.mock("../finances/ui", () => ({
  Card: ({ children }: PropsWithChildren) => <section>{children}</section>,
  Copy: ({ children }: PropsWithChildren) => <p>{children}</p>,
  ReadState: ({
    query,
    children,
  }: PropsWithChildren<{ query: { isPending: boolean; isError: boolean } }>) =>
    query.isPending ? <p>Loading</p> : query.isError ? <p>Retry loading</p> : children,
  FinanceRow: ({
    title,
    subtitle,
    value,
    valueTone,
    onPress,
  }: {
    title: string;
    subtitle?: string;
    value?: string;
    valueTone?: string;
    onPress?: () => void;
  }) =>
    onPress ? (
      <button type="button" onClick={onPress}>
        {title}
        <span>{subtitle}</span>
      </button>
    ) : (
      <p data-tone={valueTone}>
        {title} {value}
      </p>
    ),
}));
const detail = {
  title: "Finance question",
  summary: "Is this purchase shared with your household?",
  status: "open",
  webPath: "/finances/review?contextualQuestion=question",
  webUrl: "https://nohmi.example/finances/review?contextualQuestion=question",
};
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <FinanceNotificationScreen />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  h.epoch = 1;
  h.user = { id: "owner" };
  h.open.mockResolvedValue(undefined);
  h.get.mockResolvedValue({ audience: "audience", destination: "finance_attention", detail });
});
afterEach(cleanup);
it("renders a contextual question absent from the transaction queue with an actual owner destination and chat option", async () => {
  mount();
  expect(await screen.findByText(detail.summary)).toBeInTheDocument();
  expect(screen.getByText("Status Needs your input")).toBeInTheDocument();
  expect(screen.queryByText("No transaction reviews waiting.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Open in web/ }));
  await waitFor(() => expect(h.open).toHaveBeenCalledWith(detail.webUrl));
  expect(h.get).toHaveBeenCalledWith("event", "installation");
  expect(h.success).toHaveBeenCalledWith("Finance opened in your browser.", { id: "web-toast" });
  expect(screen.queryByText("Finance opened in your browser.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Continue in Finance chat/ }));
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/(workspaces)/finances/assistant",
    params: { view: "Conversation" },
  });
});
it("shows current pending action and blocked run summaries rather than an empty transaction queue", async () => {
  for (const source of [
    {
      title: "Finance action review",
      summary: "Review the proposed account change.",
      status: "pending",
      label: "Approval needed",
    },
    {
      title: "Finance routine",
      summary: "The routine needs a connected account before continuing.",
      status: "blocked",
      label: "Needs attention",
    },
  ]) {
    h.get.mockResolvedValue({
      audience: "audience",
      destination: "finance_attention",
      detail: { ...detail, ...source },
    });
    const view = mount();
    expect(await screen.findByText(source.summary)).toBeInTheDocument();
    expect(screen.getByText(`Status ${source.label}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open in web/ })).toBeInTheDocument();
    view.unmount();
  }
});
it("handles resolved or replaced events honestly and retains the conversation escape", async () => {
  h.get.mockRejectedValue(
    new ApiClientError({ code: "not_found", status: 404, message: "No longer available" }),
  );
  mount();
  expect(await screen.findByText(/This update is no longer available/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Open in web/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Continue in Finance chat/ })).toBeInTheDocument();
});
it("revalidates before web handoff and never opens a source resolved since display", async () => {
  mount();
  await screen.findByText(detail.summary);
  h.get.mockRejectedValue(
    new ApiClientError({ code: "not_found", status: 404, message: "Resolved" }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Open in web/ }));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.open).not.toHaveBeenCalled();
  expect(
    screen.queryByText("Couldn’t open this Finance update. Refresh it and try again."),
  ).toBeNull();
});
it("rejects unsafe or unsupported external destinations", () => {
  for (const value of [
    "javascript:alert(1)",
    "https://evil.example/finances/review",
    "https://user:secret@nohmi.example/finances/review",
    "https://nohmi.example/settings",
    "http://nohmi.example/finances/review",
    "https://nohmi.example/finances/review#script",
  ])
    expect(() => financeNotificationWebUrl(value)).toThrow();
  expect(financeNotificationWebUrl("https://nohmi.example/finances/activity")).toBe(
    "https://nohmi.example/finances/activity",
  );
});

it("uses the native header and gives terminal failure a readable status", async () => {
  h.get.mockResolvedValue({ detail: { ...detail, status: "failed_terminal" } });
  mount();
  expect(await screen.findByText("Status Bookkeeping failed")).toHaveAttribute(
    "data-tone",
    "incorrect",
  );
  expect(screen.queryByRole("heading", { name: "Finance update" })).toBeNull();
  expect(screen.queryByText("failed terminal")).toBeNull();
});

it("hides the detail when signed out", () => {
  h.user = null;
  mount();
  expect(screen.queryByText(detail.summary)).toBeNull();
  expect(h.get).not.toHaveBeenCalled();
});

it("refreshes the current source on foreground and removes resolved actions", async () => {
  mount();
  await screen.findByText(detail.summary);
  h.get.mockRejectedValue(
    new ApiClientError({ code: "not_found", status: 404, message: "Resolved" }),
  );
  await act(async () => h.app?.("active"));
  expect(await screen.findByText(/This update is no longer available/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Open in web/ })).toBeNull();
});

it("deduplicates web handoff while revalidation is pending and stops it after logout", async () => {
  mount();
  await screen.findByText(detail.summary);
  const fresh = Promise.withResolvers<{ detail: typeof detail }>();
  h.get.mockReturnValueOnce(fresh.promise);
  const button = screen.getByRole("button", { name: /Open in web/ });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(h.loading).toHaveBeenCalledOnce();
  h.epoch += 1;
  await act(async () => fresh.resolve({ detail }));
  await waitFor(() => expect(h.dismiss).toHaveBeenCalledWith("web-toast"));
  expect(h.open).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
});

it.each([
  "resolve",
  "reject",
] as const)("dismisses a browser handoff that completes after unmount (%s)", async (outcome) => {
  const view = mount();
  await screen.findByText(detail.summary);
  const browser = Promise.withResolvers<void>();
  h.open.mockReturnValueOnce(browser.promise);
  fireEvent.click(screen.getByRole("button", { name: /Open in web/ }));
  await waitFor(() => expect(h.open).toHaveBeenCalledOnce());
  view.unmount();
  await act(async () => {
    if (outcome === "resolve") browser.resolve();
    else browser.reject(new Error("Browser unavailable"));
  });
  await waitFor(() => expect(h.dismiss).toHaveBeenCalledWith("web-toast"));
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
});

it("shows a readable fallback for a newer server status", async () => {
  h.get.mockResolvedValue({ detail: { ...detail, status: "unknown_provider_state" } });
  mount();
  expect(await screen.findByText("Status Needs attention")).toHaveAttribute(
    "data-tone",
    "attention",
  );
  expect(screen.getByRole("button", { name: /Open in web/ })).toBeInTheDocument();
});
