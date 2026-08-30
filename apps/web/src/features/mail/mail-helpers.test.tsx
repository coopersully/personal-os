// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api.js";
import { SidebarProvider } from "../../components/ui/sidebar.js";
import {
  isMailListScope,
  MailSidebar,
  MailTopbarSearch,
  mailListScopeFromSearch,
  mailListScopeParams,
  mailListScopeQuery,
  persistMailReaderLayout,
  storedMailReaderLayout,
} from "./mail.js";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("Mail workspace helpers", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    cleanup();
    vi.restoreAllMocks();
  });

  it("maps every URL list scope without retaining stale parameters", () => {
    expect(isMailListScope("all")).toBe(true);
    expect(isMailListScope("outbox")).toBe(false);
    expect(mailListScopeFromSearch(new URLSearchParams("view=starred"))).toBe("starred");
    expect(mailListScopeFromSearch(new URLSearchParams("view=snoozed"))).toBe("snoozed");
    expect(mailListScopeFromSearch(new URLSearchParams("view=sent"))).toBe("sent");
    expect(mailListScopeFromSearch(new URLSearchParams("view=drafts"))).toBe("drafts");
    expect(mailListScopeFromSearch(new URLSearchParams("unread=1"))).toBe("unread");
    expect(mailListScopeFromSearch(new URLSearchParams())).toBe("all");
    expect(
      ["all", "unread", "starred", "snoozed", "sent", "drafts"].map((scope) =>
        mailListScopeParams(scope as never),
      ),
    ).toEqual([
      { unread: null, view: null },
      { unread: "1", view: null },
      { unread: null, view: "starred" },
      { unread: null, view: "snoozed" },
      { unread: null, view: "sent" },
      { unread: null, view: "drafts" },
    ]);
    expect(
      ["all", "unread", "starred", "snoozed", "sent", "drafts"].map((scope) =>
        mailListScopeQuery(scope as never),
      ),
    ).toEqual([
      {},
      { unread: true },
      { starred: true },
      { snoozed: true },
      { mailboxRole: "sent" },
      {},
    ]);
  });

  it("makes the combined Inbox primary and keeps account navigation collapsed", async () => {
    vi.spyOn(api, "listConnectors").mockResolvedValue([
      {
        calendarEnabled: false,
        email: "person@example.com",
        health: {
          message: null,
          nextSyncAt: "2026-08-28T12:05:00.000Z",
          recovery: null,
          state: "ready",
        },
        id: "22222222-2222-4222-8222-222222222222",
        label: "Personal Google",
        lastSyncAttemptAt: "2026-08-28T12:00:00.000Z",
        lastSyncedAt: "2026-08-28T12:00:00.000Z",
        mailEnabled: true,
        nextSyncAt: "2026-08-28T12:05:00.000Z",
        provider: "google",
        syncError: null,
        syncStatus: "idle",
      },
    ]);
    vi.spyOn(api, "listMailboxes").mockResolvedValue([
      {
        accountId: "22222222-2222-4222-8222-222222222222",
        id: "33333333-3333-4333-8333-333333333333",
        name: "INBOX",
        provider: "google",
        role: "inbox",
        totalCount: 12,
        unreadCount: 2,
      },
    ]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/mail"]}>
          <SidebarProvider>
            <MailSidebar onNavigate={vi.fn()} />
          </SidebarProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("link", { name: /Inbox/ })).toHaveAttribute("href", "/mail");
    expect(screen.getByRole("link", { name: "Unread" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Starred" })).toBeVisible();
    expect(screen.queryByText("Unified inbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Stewardship review")).not.toBeInTheDocument();
    expect(screen.queryByText("Personal Google")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Accounts" }));
    expect(screen.getByText("Personal Google")).toBeVisible();
  });

  it("accepts only a complete numeric reader layout and tolerates unavailable storage", () => {
    expect(storedMailReaderLayout()).toBeUndefined();
    for (const value of [
      "[]",
      '{"mail-list":"wide"}',
      '{"mail-list":40,"mail-reader":"wide"}',
      "{",
    ]) {
      window.localStorage.setItem("ilo.mail.reader-layout.v1", value);
      expect(storedMailReaderLayout()).toBeUndefined();
    }
    window.localStorage.setItem(
      "ilo.mail.reader-layout.v1",
      JSON.stringify({ "mail-list": 42, "mail-reader": 58 }),
    );
    expect(storedMailReaderLayout()).toEqual({ "mail-list": 42, "mail-reader": 58 });

    vi.spyOn(window.localStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("storage blocked");
    });
    expect(() => persistMailReaderLayout({ "mail-list": 45, "mail-reader": 55 })).not.toThrow();

    vi.stubGlobal("window", undefined);
    expect(storedMailReaderLayout()).toBeUndefined();
  });

  it("replaces and clears pending debounced Mail searches", () => {
    const onSearch = vi.fn();
    const view = render(<MailTopbarSearch onSearch={onSearch} search="" />);
    const input = screen.getByRole("searchbox", { name: "Search mail" });
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ab" } });
    view.unmount();
    expect(onSearch).not.toHaveBeenCalled();
  });

  it("preserves typing entered while a committed search reaches the URL", () => {
    const onSearch = vi.fn();
    const view = render(<MailTopbarSearch onSearch={onSearch} search="" />);
    const input = screen.getByRole("searchbox", { name: "Search mail" });
    fireEvent.change(input, { target: { value: "project" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(onSearch).toHaveBeenCalledWith("project");

    fireEvent.change(input, { target: { value: "project update" } });
    view.rerender(<MailTopbarSearch onSearch={onSearch} search="project" />);

    expect(input).toHaveValue("project update");
  });
});
