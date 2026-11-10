import type { Mailbox, MailThreadSummary } from "@personal-os/domain";
import { expect, it } from "vitest";
import { messageTime, nextMailPage, swipeAction, threadChange } from "./logic";

const thread = {
  id: "thread",
  accountId: "account",
  mailboxIds: ["inbox", "label"],
  unread: true,
  updatedAt: "2026-11-09T12:00:00.000Z",
  receivedAt: "2026-11-09T12:00:00.000Z",
} as MailThreadSummary;
const boxes = [
  { id: "inbox", accountId: "account", role: "inbox" },
  { id: "other", accountId: "other-account", role: "inbox" },
] as Mailbox[];
it("maps physical left to archive and right to read", () => {
  expect(swipeAction("left")).toBe("archive");
  expect(swipeAction("right")).toBe("read");
});
it("archives only this account’s inbox and preserves labels with a revision fence", () => {
  expect(threadChange(thread, "archive", boxes)).toEqual({
    mailboxIds: ["label"],
    expectedUpdatedAt: thread.updatedAt,
  });
  expect(() => threadChange(thread, "archive", [])).toThrow("Refresh");
});
it("toggles both read states with optimistic concurrency", () => {
  expect(threadChange(thread, "read", [])).toMatchObject({
    unread: false,
    expectedUpdatedAt: thread.updatedAt,
  });
  expect(threadChange({ ...thread, unread: false }, "read", [])).toMatchObject({ unread: true });
});
it("pages by both timestamp and ID without silently truncating a full page", () => {
  expect(nextMailPage([])).toBeUndefined();
  expect(nextMailPage([thread])).toBeUndefined();
  expect(nextMailPage(Array(50).fill(thread))).toEqual({
    beforeId: thread.id,
    beforeReceivedAt: thread.receivedAt,
  });
});
it("uses compact times today and calendar dates on older mail", () => {
  expect(messageTime(thread.receivedAt, new Date(thread.receivedAt))).toBe(
    new Date(thread.receivedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  );
  expect(messageTime(thread.receivedAt, new Date("2026-12-01"))).toBe(
    new Date(thread.receivedAt).toLocaleDateString([], { month: "short", day: "numeric" }),
  );
});
