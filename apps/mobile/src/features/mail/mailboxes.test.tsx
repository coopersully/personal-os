// @vitest-environment jsdom
import type { MailDraft } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { visibleDrafts } from "./drafts";
import { MailboxesScreen } from "./mailboxes";
import { MailScopeProvider, useMailScope } from "./scope";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({ setup: vi.fn(), params: vi.fn() }));
vi.mock("sonner-native", () => ({
  toast: { info: vi.fn(), loading: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("react-native", async () => import("../../../test/native"));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("../../components/icons", () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
vi.mock("../../components/screen", () => ({
  Screen: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("../auth/context", () => ({
  useAuth: () => ({
    state: { user: { id: "owner" } },
    session: { api: () => ({ getMailSetupContext: h.setup }) },
  }),
}));
vi.mock("expo-router", () => ({ router: { setParams: h.params } }));
vi.mock("./inbox", () => ({
  MailInbox: ({ folder, onBack }: { folder: string; onBack: () => void }) => {
    const { accountId } = useMailScope();
    return (
      <div>
        <span>
          {folder}:{accountId || "all"}
        </span>
        <button onClick={onBack} type="button">
          Back
        </button>
      </div>
    );
  },
}));
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.setup.mockResolvedValue({
    accounts: [
      { accountId: "one", label: "Personal", email: "me@example.test" },
      { accountId: "two", label: "Work", email: "work@example.test" },
    ],
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});
function show() {
  return render(
    <QueryClientProvider client={client}>
      <MailScopeProvider>
        <MailboxesScreen />
      </MailScopeProvider>
    </QueryClientProvider>,
  );
}
it("shows all five icon-led folders and keeps the selected account while navigating", async () => {
  show();
  await screen.findByText("All accounts");
  for (const label of ["Inbox", "Sent", "Drafts", "Archive", "Trash"])
    expect(screen.getByText(label)).toBeTruthy();
  fireEvent.click(screen.getByText("Account"));
  fireEvent.click(screen.getByRole("radio", { name: "Work, work@example.test" }));
  expect(screen.getByText("work@example.test")).toBeTruthy();
  fireEvent.click(screen.getByText("Sent"));
  expect(screen.getByText("sent:two")).toBeTruthy();
  fireEvent.click(screen.getByText("Back"));
  fireEvent.click(screen.getByText("Archive"));
  expect(screen.getByText("archive:two")).toBeTruthy();
  expect(h.params).toHaveBeenCalledWith({ mailSearch: "" });
});
it("switches back to all accounts and exposes Drafts and Trash destinations", async () => {
  show();
  await screen.findByText("All accounts");
  fireEvent.click(screen.getByText("Account"));
  fireEvent.click(screen.getByRole("radio", { name: "Personal, me@example.test" }));
  fireEvent.click(screen.getByText("Account"));
  fireEvent.click(screen.getByRole("radio", { name: "All accounts" }));
  fireEvent.click(screen.getByText("Drafts"));
  expect(screen.getByText("drafts:all")).toBeTruthy();
  fireEvent.click(screen.getByText("Back"));
  fireEvent.click(screen.getByText("Trash"));
  expect(screen.getByText("trash:all")).toBeTruthy();
});
it("distinguishes missing accounts from failed account reads", async () => {
  h.setup.mockResolvedValue({ accounts: [] });
  show();
  expect(
    await screen.findByText("Connect a mailbox in Settings to see your messages."),
  ).toBeTruthy();
  cleanup();
  client.clear();
  h.setup.mockRejectedValue(new Error("offline"));
  show();
  expect(await screen.findByText("Reload accounts")).toBeTruthy();
  expect(screen.queryByText("Connect a mailbox in Settings to see your messages.")).toBeNull();
});
it("filters local drafts by account and search and never presents sent records as drafts", () => {
  const base = {
    accountId: "one",
    subject: "Dinner",
    body: "Friday",
    to: [{ address: "maya@example.test" }],
    sendStatus: "draft",
  } as MailDraft;
  const records = [
    base,
    { ...base, accountId: "two" },
    { ...base, sendStatus: "sent" as const },
    { ...base, sendStatus: "reconcile" as const },
  ];
  expect(visibleDrafts(records, "one", "MAYA")).toHaveLength(2);
  expect(visibleDrafts(records, "", "Friday")).toHaveLength(3);
  expect(visibleDrafts(records, "one", "missing")).toEqual([]);
});
