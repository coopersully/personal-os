import type { Mailbox, MailThreadSummary } from "@personal-os/domain";
import { expect, it } from "vitest";
import {
  MAIL_PAGE_SIZE,
  mailboxIcon,
  mailboxLabel,
  mergeMailPages,
  messageTime,
  nextMailPage,
  scopeTitle,
  senderName,
  sortMailboxes,
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
