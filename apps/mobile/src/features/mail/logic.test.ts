import { ApiClientError } from "@personal-os/api-client";
import type { Mailbox, MailThreadSummary } from "@personal-os/domain";
import { expect, it } from "vitest";
import {
  archivedMailboxIds,
  leftMailTarget,
  MAIL_PAGE_SIZE,
  mailboxIcon,
  mailboxLabel,
  mailWriteRejected,
  mergeMailPages,
  messageTime,
  nextMailPage,
  scopeTitle,
  senderName,
  sortMailboxes,
  withMailChanges,
  withMailRow,
} from "./logic";

const thread = { id: "thread", receivedAt: "2026-11-09T12:00:00.000Z" } as MailThreadSummary;

it("continues only after a full page, from its last row's timestamp and ID", () => {
  expect(nextMailPage([])).toBeUndefined();
  expect(nextMailPage([thread])).toBeUndefined();
  const last = { ...thread, id: "last", receivedAt: "2026-11-08T09:00:00.000Z" };
  expect(nextMailPage([...Array(MAIL_PAGE_SIZE - 1).fill(thread), last])).toEqual({
    beforeId: "last",
    beforeReceivedAt: "2026-11-08T09:00:00.000Z",
  });
});

it("keeps one row per conversation when pages overlap", () => {
  const other = { ...thread, id: "other" };
  expect(mergeMailPages(undefined)).toEqual([]);
  expect(mergeMailPages([[thread, other], [other]]).map((item) => item.id)).toEqual([
    "thread",
    "other",
  ]);
});

it("shows a time for today's mail and a date for older mail", () => {
  const received = new Date(thread.receivedAt);
  expect(messageTime(thread.receivedAt, received)).toBe(
    received.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  );
  expect(messageTime(thread.receivedAt, new Date("2026-12-01T12:00:00.000Z"))).toBe(
    received.toLocaleDateString([], { month: "short", day: "numeric" }),
  );
});

it("names senders and scopes", () => {
  expect(senderName({ name: " Maya Chen ", address: "maya@example.test" })).toBe("Maya Chen");
  expect(senderName({ name: " ", address: "maya@example.test" })).toBe("maya@example.test");
  expect(senderName({ name: null, address: "maya@example.test" })).toBe("maya@example.test");
  expect(scopeTitle({ kind: "inbox" })).toBe("Inbox");
  expect(scopeTitle({ kind: "mailbox", mailboxId: "id", title: "Receipts", account: "Work" })).toBe(
    "Receipts",
  );
});

it("orders standard folders before an account's own folders and labels them plainly", () => {
  const box = (role: Mailbox["role"], name: string) => ({ role, name }) as Mailbox;
  const sorted = sortMailboxes([
    box("custom", "travel"),
    box("trash", "[Gmail]/Trash"),
    box("custom", "Receipts"),
    box("sent", "[Gmail]/Sent Mail"),
    box("spam", "Junk"),
    box("archive", "All Mail"),
    box("inbox", "INBOX"),
    box("drafts", "Drafts"),
  ]);
  expect(sorted.map(mailboxLabel)).toEqual([
    "Inbox",
    "Drafts",
    "Sent",
    "Archive",
    "Spam",
    "Trash",
    "Receipts",
    "travel",
  ]);
  expect(sorted.map((item) => mailboxIcon(item.role))).toEqual([
    "inbox",
    "edit",
    "send",
    "archive",
    "attention",
    "trash",
    "mail",
    "mail",
  ]);
});

it("archives by dropping every inbox and only when the conversation is in one", () => {
  const mailboxes = [
    { id: "inbox", role: "inbox" },
    { id: "label", role: "custom" },
  ] as Mailbox[];
  expect(archivedMailboxIds({ mailboxIds: ["inbox", "label"] }, mailboxes)).toEqual(["label"]);
  expect(archivedMailboxIds({ mailboxIds: ["inbox"] }, mailboxes)).toEqual([]);
  expect(archivedMailboxIds({ mailboxIds: ["label"] }, mailboxes)).toBeNull();
  // Without the mailbox list there is no way to tell, so nothing is offered.
  expect(archivedMailboxIds({ mailboxIds: ["inbox"] }, undefined)).toBeNull();
});

it("knows when a change takes a conversation out of the listed target", () => {
  expect(leftMailTarget("inbox", ["inbox", "label"], ["label"])).toBe(true);
  expect(leftMailTarget("inbox", ["label"], ["inbox", "label"])).toBe(false);
  expect(leftMailTarget("inbox", ["inbox"], ["inbox"])).toBe(false);
  expect(leftMailTarget("inbox", ["inbox"], ["other"])).toBe(false);
  expect(leftMailTarget("inbox-id", ["inbox-id", "label"], ["label"])).toBe(true);
  expect(leftMailTarget("label", ["inbox-id", "label"], ["label"])).toBe(false);
  expect(leftMailTarget("label", ["inbox-id"], ["inbox-id"])).toBe(false);
});

it("overlays changes in flight without touching the rows it was given", () => {
  const rows = [
    { ...thread, id: "a", unread: true, mailboxIds: ["inbox"] },
    { ...thread, id: "b", unread: false, mailboxIds: ["inbox", "label"] },
    { ...thread, id: "c", unread: false, mailboxIds: ["inbox"] },
  ];
  expect(withMailChanges(rows, new Map(), "inbox")).toBe(rows);
  const changes = new Map([
    ["a", { unread: false }],
    ["b", { mailboxIds: ["label"] }],
  ]);
  expect(withMailChanges(rows, changes, "inbox").map((row) => [row.id, row.unread])).toEqual([
    ["a", false],
    ["c", false],
  ]);
  // In a mailbox the conversation keeps, an archive in flight only changes its mailboxes.
  expect(withMailChanges(rows, changes, "label").map((row) => row.mailboxIds)).toEqual([
    ["inbox"],
    ["label"],
    ["inbox"],
  ]);
  expect(rows[0].unread).toBe(true);
});

it("treats only a definitive client rejection as proof that mail was not changed", () => {
  const error = (status: number, details?: unknown) =>
    new ApiClientError({ code: "c", message: "m", status, details });
  expect(mailWriteRejected(error(404))).toBe(true);
  expect(mailWriteRejected(error(409, { currentUpdatedAt: "x" }))).toBe(true);
  expect(mailWriteRejected(error(409, { partialEffect: true }))).toBe(false);
  expect(mailWriteRejected(error(408))).toBe(false);
  expect(mailWriteRejected(error(500, null))).toBe(false);
  expect(mailWriteRejected(new TypeError("Network request failed"))).toBe(false);
});

it("puts a conversation back at its place by date", () => {
  const at = (id: string, minute: string) =>
    ({ ...thread, id, receivedAt: `2026-11-09T12:${minute}:00.000Z` }) as MailThreadSummary;
  const ids = (pages: MailThreadSummary[][]) => pages.map((page) => page.map((row) => row.id));
  const pages = [[at("e", "50"), at("d", "40")], [at("b", "20")]];

  expect(ids(withMailRow(pages, at("c", "30")))).toEqual([
    ["e", "d"],
    ["c", "b"],
  ]);
  expect(ids(withMailRow(pages, at("f", "55")))).toEqual([["f", "e", "d"], ["b"]]);
  // The same minute orders by id, newest id first.
  expect(ids(withMailRow(pages, at("c", "20")))).toEqual([
    ["e", "d"],
    ["c", "b"],
  ]);
  // Older than everything read: it ends a list that is complete.
  expect(ids(withMailRow(pages, at("a", "10")))).toEqual([
    ["e", "d"],
    ["b", "a"],
  ]);
  // Already listed, or nothing read yet: unchanged.
  expect(withMailRow(pages, at("d", "40"))).toBe(pages);
  expect(withMailRow([], at("a", "10"))).toEqual([]);
  // Older than a full last page: it belongs to a page not read yet.
  const full = [Array.from({ length: MAIL_PAGE_SIZE }, (_, index) => at(`n${index}`, "30"))];
  expect(withMailRow(full, at("a", "10"))).toBe(full);
});
