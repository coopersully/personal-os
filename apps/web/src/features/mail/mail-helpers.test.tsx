// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api.js";
import { SidebarProvider } from "../../components/ui/sidebar.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import {
  isMailListScope,
  MailSidebar,
  MailTopbarSearch,
  mailListScopeFromSearch,
  mailListScopeParams,
  mailListScopeQuery,
  mailReplyRecipient,
  persistMailListDensity,
  persistMailReaderLayout,
  storedMailListDensity,
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
      { mailboxRole: "inbox" },
      { unread: true },
      { starred: true },
      { snoozed: true },
      { mailboxRole: "sent" },
      {},
    ]);
  });

  it("replies to Reply-To and never addresses an outbound message back to the connected account", () => {
    const fallback = { address: "reply@example.com", name: "Reply desk" };
    const base = {
      attachments: [],
      bodyText: "",
      cc: [],
      id: "33333333-3333-4333-8333-333333333333",
      messageId: "<message@example.com>",
      receivedAt: "2026-08-28T12:00:00.000Z",
      references: [],
      replyTo: [fallback],
      threadId: "22222222-2222-4222-8222-222222222222",
      to: [{ address: "me@example.com", name: null }],
    };
    expect(
      mailReplyRecipient(
        { ...base, from: { address: "sender@example.com", name: "Sender" } },
        "me@example.com",
        fallback,
      ),
    ).toEqual(fallback);
    expect(
      mailReplyRecipient(
        {
          ...base,
          from: { address: "me@example.com", name: null },
          replyTo: [],
          to: [{ address: "recipient@example.com", name: "Recipient" }],
        },
        "me@example.com",
        fallback,
      ),
    ).toEqual({ address: "recipient@example.com", name: "Recipient" });
  });

  it("makes the combined Inbox primary and keeps sources out of navigation", async () => {
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
          <TooltipProvider>
            <SidebarProvider defaultOpen={false}>
              <MailSidebar onNavigate={vi.fn()} />
            </SidebarProvider>
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("link", { name: /Inbox/ })).toHaveAttribute("href", "/mail");
    expect(screen.getByRole("link", { name: "Unread" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Starred" })).toBeVisible();
    expect(screen.queryByText("Unified inbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Stewardship review")).not.toBeInTheDocument();
    expect(screen.queryByText("Personal Google")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accounts" })).not.toBeInTheDocument();
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

  it("defaults list density safely when its device preference is missing or unavailable", () => {
    expect(storedMailListDensity()).toBe("comfortable");
    window.localStorage.setItem("ilo.mail.list-density.v1", "compact");
    expect(storedMailListDensity()).toBe("compact");
    window.localStorage.setItem("ilo.mail.list-density.v1", "unsupported");
    expect(storedMailListDensity()).toBe("comfortable");

    vi.spyOn(window.localStorage, "getItem").mockImplementationOnce(() => {
      throw new Error("storage blocked");
    });
    expect(storedMailListDensity()).toBe("comfortable");
    vi.spyOn(window.localStorage, "setItem").mockImplementationOnce(() => {
      throw new Error("storage blocked");
    });
    expect(() => persistMailListDensity("expanded")).not.toThrow();

    vi.stubGlobal("window", undefined);
    expect(storedMailListDensity()).toBe("comfortable");
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

  it("commits an unchanged Mail search without retaining a pending URL value", () => {
    const onSearch = vi.fn();
    render(<MailTopbarSearch onSearch={onSearch} search="Project update" />);
    fireEvent.submit(screen.getByRole("searchbox", { name: "Search mail" }));
    expect(onSearch).toHaveBeenLastCalledWith("Project update");
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

  it("can resubmit the current trimmed Mail search", () => {
    const onSearch = vi.fn();
    render(<MailTopbarSearch onSearch={onSearch} search="Project update" />);

    fireEvent.submit(screen.getByRole("searchbox", { name: "Search mail" }));

    expect(onSearch).toHaveBeenCalledWith("Project update");
  });
});
