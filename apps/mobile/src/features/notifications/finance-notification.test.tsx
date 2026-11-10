// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinanceNotificationScreen, financeNotificationWebUrl } from "./finance-notification";

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
  loading: vi.fn(() => "web-toast"),
  success: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
  params: { eventId: "event", installationId: "installation" },
}));
vi.mock("react-native", async () => ({
  ...(await import("../../../test/native")),
  AppState: { addEventListener: () => ({ remove: vi.fn() }) },
  Linking: { openURL: h.open },
}));
vi.mock("expo-router", () => ({ router: { push: h.push }, useLocalSearchParams: () => h.params }));
vi.mock("sonner-native", () => ({
  toast: { loading: h.loading, success: h.success, error: h.error, dismiss: h.dismiss },
}));
const session = { epoch: () => h.epoch, api: () => ({ getNativePushEvent: h.get }) };
vi.mock("../auth/context", () => ({
  mobileAppOrigin: "https://nohmi.example",
  useAuth: () => ({ state: { user: { id: "owner" } }, session }),
}));
vi.mock("../finances/ui", () => ({
  FinanceScreen: ({ title, children }: PropsWithChildren<{ title: string }>) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
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
    onPress,
  }: {
    title: string;
    subtitle?: string;
    value?: string;
    onPress?: () => void;
  }) =>
    onPress ? (
      <button type="button" onClick={onPress}>
        {title}
        <span>{subtitle}</span>
      </button>
    ) : (
      <p>
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
  h.get.mockResolvedValue({ audience: "audience", destination: "finance_attention", detail });
});
afterEach(cleanup);
it("renders a contextual question absent from the transaction queue with an actual owner destination and chat option", async () => {
  mount();
  expect(await screen.findByText(detail.summary)).toBeInTheDocument();
  expect(screen.getByText("Status open")).toBeInTheDocument();
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
    },
    {
      title: "Finance routine",
      summary: "The routine needs a connected account before continuing.",
      status: "blocked",
    },
  ]) {
    h.get.mockResolvedValue({
      audience: "audience",
      destination: "finance_attention",
      detail: { ...detail, ...source },
    });
    const view = mount();
    expect(await screen.findByText(source.summary)).toBeInTheDocument();
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
