// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadLegacyMailDraft,
  HistoricalMailDrafts,
  isMailListScope,
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
    expect(mailListScopeFromSearch(new URLSearchParams("unread=1"))).toBe("unread");
    expect(mailListScopeFromSearch(new URLSearchParams())).toBe("all");
    expect(
      ["all", "unread", "starred", "snoozed"].map((scope) => mailListScopeParams(scope as never)),
    ).toEqual([
      { unread: null, view: null },
      { unread: "1", view: null },
      { unread: null, view: "starred" },
      { unread: null, view: "snoozed" },
    ]);
    expect(
      ["all", "unread", "starred", "snoozed"].map((scope) => mailListScopeQuery(scope as never)),
    ).toEqual([{}, { unread: true }, { starred: true }, { snoozed: true }]);
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

  it("exports blank historical subjects under a safe local filename", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:mail-draft");
    const revokeObjectURL = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadLegacyMailDraft({ subject: "---" } as never);
    downloadLegacyMailDraft({ subject: "" } as never);

    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll("a[download]")).toHaveLength(2);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mail-draft");
  });

  it("keeps historical draft loading, failure, empty, and sparse states honest", async () => {
    const props = {
      accounts: [],
      drafts: [],
      error: null,
      isPending: false,
      mutationError: null,
      mutationPending: false,
      remove: vi.fn(),
      timeZone: "America/New_York",
    };
    const view = render(<HistoricalMailDrafts {...props} isPending />);
    expect(view.container).toBeEmptyDOMElement();
    view.rerender(<HistoricalMailDrafts {...props} error={new Error("Drafts unavailable")} />);
    expect(screen.getByText("Drafts unavailable")).toBeVisible();
    view.rerender(<HistoricalMailDrafts {...props} />);
    expect(view.container).toBeEmptyDOMElement();

    view.rerender(
      <HistoricalMailDrafts
        {...props}
        drafts={[
          {
            accountId: "missing-account",
            deliveryState: "unsent",
            id: "draft-1",
            subject: "",
            to: [],
            updatedAt: "2026-08-25T12:00:00.000Z",
          } as never,
        ]}
        mutationError={new Error("Delete unavailable")}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Historical drafts (1)" }));
    expect(screen.getByText("(No subject)")).toBeVisible();
    expect(screen.getByText("To: No recipients")).toBeVisible();
    expect(screen.getByText("Updated Aug 25, 2026, 8:00 AM")).toBeVisible();
    expect(screen.getByText("Delete unavailable")).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Delete historical draft: No subject" }),
    );
    view.rerender(
      <HistoricalMailDrafts
        {...props}
        drafts={[
          {
            accountId: "missing-account",
            deliveryState: "unsent",
            id: "draft-1",
            subject: "",
            to: [],
            updatedAt: "2026-08-25T12:00:00.000Z",
          } as never,
        ]}
        mutationPending
      />,
    );
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
  });
});
