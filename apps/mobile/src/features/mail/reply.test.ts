import type { MailMessage, MailThread } from "@personal-os/domain";
import { expect, it } from "vitest";
import { composePayload } from "./compose-state";
import { messageIntent, splitQuotedBody } from "./reply";

const thread = {
  id: "11111111-1111-4111-8111-111111111111",
  accountId: "22222222-2222-4222-8222-222222222222",
  subject: "Lunch",
} as MailThread;
const address = (address: string) => ({ address, name: null });
const message = {
  id: "33333333-3333-4333-8333-333333333333",
  threadId: thread.id,
  from: address("sam@example.com"),
  to: [address("me@example.com"), address("alex@example.com")],
  cc: [address("pat@example.com"), address("ALEX@example.com"), address("ME@example.com")],
  replyTo: [],
  bodyText: "Original message\nSecond line",
  receivedAt: "2026-11-09T12:00:00.000Z",
  attachments: [],
  messageId: "<one@example.com>",
  references: [],
} satisfies MailMessage;
it("keeps source account and thread, and honors Reply-To", () => {
  const result = messageIntent(
    thread,
    { ...message, replyTo: [address("team@example.com")] },
    "me@example.com",
    "reply",
  );
  expect(result).toMatchObject({
    accountId: thread.accountId,
    threadId: thread.id,
    to: "team@example.com",
    cc: "",
    subject: "Re: Lunch",
  });
  expect(result.body).toContain("> Original message\n> Second line");
  const payload = composePayload(result);
  expect(payload.success).toBe(true);
  if (payload.success) expect(payload.data.threadId).toBe(thread.id);
});
it("reply-all keeps To/Cc roles, deduplicates case-insensitively and excludes self", () => {
  expect(messageIntent(thread, message, "ME@example.com", "replyAll")).toMatchObject({
    to: "sam@example.com, alex@example.com",
    cc: "pat@example.com",
  });
});
it("replies to a sent message address the other person, not self", () => {
  const sent = {
    ...message,
    from: address("me@example.com"),
    to: [address("sam@example.com")],
    cc: [address("pat@example.com")],
  };
  expect(messageIntent(thread, sent, "me@example.com", "reply").to).toBe("sam@example.com");
  expect(messageIntent(thread, sent, "me@example.com", "replyAll")).toMatchObject({
    to: "sam@example.com",
    cc: "pat@example.com",
  });
});
it("forward keeps account, clears recipients/thread and quotes only the selected message", () => {
  const result = messageIntent(thread, message, "me@example.com", "forward");
  expect(result).toMatchObject({
    accountId: thread.accountId,
    threadId: null,
    to: "",
    cc: "",
    subject: "Fwd: Lunch",
  });
  expect(result.body).toContain("Forwarded message");
  expect(result.body).toContain(message.bodyText);
  const payload = composePayload(result);
  if (payload.success) expect(payload.data.threadId).toBeNull();
});
it("does not duplicate subject prefixes and refuses mismatched message/thread or unknown own identity", () => {
  expect(
    messageIntent({ ...thread, subject: "re: Lunch" }, message, "me@example.com", "reply").subject,
  ).toBe("re: Lunch");
  expect(
    messageIntent({ ...thread, subject: "Fwd: Lunch" }, message, null, "forward").subject,
  ).toBe("Fwd: Lunch");
  expect(() =>
    messageIntent(thread, { ...message, threadId: "another" }, "me@example.com", "reply"),
  ).toThrow();
  expect(() => messageIntent(thread, message, null, "replyAll")).toThrow();
});

it("forwards original attachment references but leaves them out of replies", () => {
  const source = {
    ...message,
    attachments: [
      { id: "provider-file:1", filename: "notes.txt", contentType: "text/plain", size: 4 },
      { id: "provider-file:2", filename: "notes.txt", contentType: "text/plain", size: 7 },
      { id: "provider-file:3", filename: "report.pdf", contentType: "application/pdf", size: 19 },
    ],
  };
  const forward = messageIntent(thread, source, "me@example.com", "forward");
  expect(composePayload(forward).success).toBe(true);
  expect(forward.attachments).toEqual(
    source.attachments.map((file) => ({
      ...file,
      source: { messageId: message.id, attachmentId: file.id },
    })),
  );
  expect(messageIntent(thread, source, "me@example.com", "reply").attachments).toEqual([]);
});

it("separates generated quotes without dropping their original bytes", () => {
  for (const intent of ["reply", "forward"] as const) {
    const draft = messageIntent(thread, message, "me@example.com", intent);
    const result = splitQuotedBody(`My response${draft.body}`);
    expect(result.message).toBe("My response");
    expect(result.quote).toBe(draft.body);
    expect(result.message + result.quote).toBe(`My response${draft.body}`);
  }
  expect(splitQuotedBody("A plain message\nwith another line")).toEqual({
    message: "A plain message\nwith another line",
    quote: "",
  });
});
