import { ApiClientError } from "@personal-os/api-client";
import type { Mailbox, MailThreadSummary } from "@personal-os/domain";
import { expect, it } from "vitest";
import {
  actionsKey,
  archivedMailboxIds,
  conversations,
  leftMailTarget,
  MAIL_PAGE_SIZE,
  mailboxIcon,
  mailboxLabel,
  mailWriteRejected,
  mergeMailPages,
  messageTime,
  nextMailPage,
  pickedSnooze,
  pickerDay,
  planningZone,
  scopeTarget,
  scopeTitle,
  senderName,
  snoozeActive,
  snoozeChoices,
  snoozeTime,
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

it("names the Snoozed list and keeps each scope's lists apart", () => {
  expect(scopeTitle({ kind: "snoozed" })).toBe("Snoozed");
  expect(scopeTarget({ kind: "inbox" })).toBe("inbox");
  expect(scopeTarget({ kind: "snoozed" })).toBe("snoozed");
  expect(scopeTarget({ kind: "mailbox", mailboxId: "m1", title: "Receipts", account: "A" })).toBe(
    "m1",
  );
});

it("takes a conversation being snoozed out of every list but Snoozed, and back", () => {
  const rows = [{ ...thread, id: "a", mailboxIds: ["inbox"], unread: true }] as MailThreadSummary[];
  const wake = "2026-11-20T08:00:00.000Z";
  expect(withMailChanges(rows, new Map([["a", { snoozedUntil: wake }]]), "inbox")).toEqual([]);
  // A conversation snoozed again shows the time it now waits for.
  expect(withMailChanges(rows, new Map([["a", { snoozedUntil: wake }]]), "snoozed")).toEqual([
    { ...rows[0], snoozedUntil: wake },
  ]);
  expect(withMailChanges(rows, new Map([["a", { snoozedUntil: null }]]), "snoozed")).toEqual([]);
  // Ending a snooze adds nothing to the row.
  expect(withMailChanges(rows, new Map([["a", { snoozedUntil: null }]]), "inbox")).toEqual(rows);
});

const chicago = "America/Chicago";

it("offers snooze times in the planning time zone, with mornings at eight and next week on a Monday", () => {
  // Wednesday 18 November 2026, 15:30 in Chicago, whatever zone this device is in.
  const now = new Date("2026-11-18T21:30:00.000Z");
  const [hours, tomorrow, week] = snoozeChoices(now, chicago);
  expect([hours.label, tomorrow.label, week.label]).toEqual([
    "In 3 hours",
    "Tomorrow morning",
    "Next week",
  ]);
  expect(hours.until.toISOString()).toBe("2026-11-19T00:30:00.000Z");
  expect(tomorrow.until.toISOString()).toBe("2026-11-19T14:00:00.000Z");
  expect(week.until.toISOString()).toBe("2026-11-23T14:00:00.000Z");
  // The same moment is already Thursday in Auckland, so its tomorrow is Friday there.
  expect(snoozeChoices(now, "Pacific/Auckland")[1].until.toISOString()).toBe(
    "2026-11-19T19:00:00.000Z",
  );
  // On a Monday, next week is the Monday after, never later the same day.
  expect(snoozeChoices(new Date("2026-11-16T13:00:00.000Z"), chicago)[2].until.toISOString()).toBe(
    "2026-11-23T14:00:00.000Z",
  );
  // On a Sunday it is the next day.
  expect(snoozeChoices(new Date("2026-11-15T18:00:00.000Z"), chicago)[2].until.toISOString()).toBe(
    "2026-11-16T14:00:00.000Z",
  );
});

it("keeps mornings at eight across a daylight-saving change", () => {
  // Saturday 31 October 2026 in Chicago; clocks go back that night.
  const now = new Date("2026-10-31T20:00:00.000Z");
  const [hours, tomorrow, week] = snoozeChoices(now, chicago);
  expect(hours.until.getTime() - now.getTime()).toBe(3 * 3_600_000);
  expect(tomorrow.until.toISOString()).toBe("2026-11-01T14:00:00.000Z");
  expect(week.until.toISOString()).toBe("2026-11-02T14:00:00.000Z");
  // Saturday 7 March 2026; clocks go forward that night.
  expect(snoozeChoices(new Date("2026-03-07T20:00:00.000Z"), chicago)[1].until.toISOString()).toBe(
    "2026-03-08T13:00:00.000Z",
  );
});

it("names the planning time zone's day for the picker", () => {
  const late = new Date("2026-11-19T03:00:00.000Z");
  expect(pickerDay(late, chicago)).toBe("2026-11-18");
  expect(pickerDay(late, "UTC")).toBe("2026-11-19");
});

it("reads a picked day and time in the planning time zone and refuses the past or the impossible", () => {
  const now = new Date("2026-11-18T21:30:00.000Z");
  expect(pickedSnooze("2026-11-20", "09:30", now, chicago)?.toISOString()).toBe(
    "2026-11-20T15:30:00.000Z",
  );
  expect(pickedSnooze("2026-11-18", "15:31", now, chicago)?.toISOString()).toBe(
    "2026-11-18T21:31:00.000Z",
  );
  expect(pickedSnooze("2026-11-18", "15:30", now, chicago)).toBeNull();
  // Ahead on a UTC clock, already past in Chicago.
  expect(pickedSnooze("2026-11-18", "22:00", now, "UTC")).not.toBeNull();
  expect(pickedSnooze("2026-11-18", "15:00", now, chicago)).toBeNull();
  expect(pickedSnooze("2026-11-17", "09:00", now, chicago)).toBeNull();
  expect(pickedSnooze("2026-02-31", "09:00", now, chicago)).toBeNull();
  expect(pickedSnooze("2026-13-01", "09:00", now, chicago)).toBeNull();
  expect(pickedSnooze("2026-11-20", "25:00", now, chicago)).toBeNull();
  expect(pickedSnooze("2026-11-20", "09:60", now, chicago)).toBeNull();
  expect(pickedSnooze("tomorrow", "09:00", now, chicago)).toBeNull();
  expect(pickedSnooze("2026-11-20", "nine", now, chicago)).toBeNull();
});

it("says when a snooze ends in the planning time zone, with the day only when it is not today", () => {
  const now = new Date("2026-11-18T21:30:00.000Z");
  const time = (date: Date) =>
    date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: chicago });
  const today = new Date("2026-11-19T03:30:00.000Z");
  const later = new Date("2026-11-23T14:00:00.000Z");
  // 21:30 on the 18th in Chicago is still today there, though the 19th in UTC.
  expect(snoozeTime(today, now, chicago)).toBe(time(today));
  expect(snoozeTime(today, now, "UTC")).toContain(",");
  expect(snoozeTime(later, now, chicago)).toBe(
    `${later.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: chicago })}, ${time(later)}`,
  );
});

it("knows a snooze is running only while its time is ahead", () => {
  const now = Date.parse("2026-11-18T21:30:00.000Z");
  expect(snoozeActive({ snoozedUntil: "2026-11-18T21:30:00.001Z" }, now)).toBe(true);
  expect(snoozeActive({ snoozedUntil: "2026-11-18T21:30:00.000Z" }, now)).toBe(false);
  expect(snoozeActive({}, now)).toBe(false);
  expect(snoozeActive({ snoozedUntil: "2999-01-01T00:00:00.000Z" })).toBe(true);
});

it("counts conversations in words", () => {
  expect(conversations(1)).toBe("1 conversation");
  expect(conversations(3)).toBe("3 conversations");
});

it("gives a menu a new key when an action or its icon changes", () => {
  const read = { id: "unread", icon: "check" };
  const snooze = { id: "snooze", icon: "clock" };
  expect(actionsKey([read, snooze])).toBe(actionsKey([{ ...read }, { ...snooze }]));
  expect(actionsKey([read, snooze])).not.toBe(
    actionsKey([read, { id: "archive", icon: "archive" }, snooze]),
  );
  expect(actionsKey([read])).not.toBe(actionsKey([{ id: "unread", icon: "mail" }]));
});

it("reads Mail in UTC when the stored planning time zone is not one the device accepts", () => {
  expect(planningZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  expect(planningZone("UTC")).toBe("UTC");
  for (const stored of ["Invalid/Zone", "", undefined, null]) {
    const zone = planningZone(stored);
    expect(zone).toBe("UTC");
    const now = new Date("2026-11-18T21:30:00.000Z");
    expect(() => snoozeChoices(now, zone)).not.toThrow();
    expect(() => snoozeTime(now, now, zone)).not.toThrow();
  }
});
