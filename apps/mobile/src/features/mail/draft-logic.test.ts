import { ApiClientError } from "@personal-os/api-client";
import type { MailDraft, MailMessage, MailThreadSummary } from "@personal-os/domain";
import { expect, it } from "vitest";
import {
  draftInput,
  draftRecipients,
  draftStage,
  draftStart,
  formFromDraft,
  forwardStart,
  MAIL_BODY_LIMIT,
  newStart,
  parseRecipients,
  recipientText,
  replyRecipient,
  replyStart,
  sameDraft,
  saveProblem,
  sendNotAccepted,
  sendProblem,
} from "./draft-logic";

const draft = (patch: Partial<MailDraft> = {}): MailDraft => ({
  accountId: "personal",
  body: "Hello",
  cc: [],
  createdAt: "2026-11-16T10:00:00.000Z",
  id: "draft-1",
  reconciliationState: "none",
  sendClaimedAt: null,
  sendStatus: "draft",
  sentAt: null,
  subject: "Plans",
  threadId: null,
  to: [{ address: "maya@example.test", name: "Maya Chen" }],
  updatedAt: "2026-11-16T10:00:00.000Z",
  ...patch,
});
const thread = {
  accountId: "personal",
  from: { name: "Maya Chen", address: "maya@example.test" },
  id: "thread-1",
  subject: "Board packet",
} as MailThreadSummary;
const message = (patch: Partial<MailMessage> = {}) =>
  ({
    bodyText: "Please review.",
    cc: [],
    from: { name: "Maya Chen", address: "maya@example.test" },
    replyTo: [],
    to: [{ name: null, address: "me@example.test" }],
    ...patch,
  }) as MailMessage;
const form = formFromDraft(draft());

it("reads recipients typed as addresses or as names with addresses", () => {
  expect(
    parseRecipients('maya@example.test; "Sam Lee" <sam@example.test>,\nMAYA@example.test, nope'),
  ).toEqual({
    recipients: [
      { address: "maya@example.test", name: null },
      { address: "sam@example.test", name: "Sam Lee" },
    ],
    invalid: ["nope"],
  });
  expect(parseRecipients(" , ")).toEqual({ recipients: [], invalid: [] });
  expect(parseRecipients("<a b@example.test>").invalid).toEqual(["<a b@example.test>"]);
});

it("keeps a name that holds a separator as one recipient", () => {
  const named = [
    { address: "jane@example.test", name: "Doe, Jane" },
    { address: "sam@example.test", name: "evil@example.test; Sam" },
    { address: "lee@example.test", name: 'Lee "L" <x>' },
    { address: "kim@example.test", name: null },
  ];
  const text =
    '"Doe, Jane" <jane@example.test>, "evil@example.test; Sam" <sam@example.test>, ' +
    "\"Lee 'L' <x>\" <lee@example.test>, kim@example.test";
  expect(recipientText(named)).toBe(text);
  expect(parseRecipients(text)).toEqual({
    recipients: [named[0], named[1], { ...named[2], name: "Lee 'L' <x>" }, named[3]],
    invalid: [],
  });
  // An unquoted comma still separates, and a separator inside the brackets is not an address.
  expect(parseRecipients("Doe, Jane <jane@example.test>").invalid).toEqual(["Doe"]);
  expect(parseRecipients("Jane <a@example.test, b@example.test>").recipients).toEqual([]);
});

it("turns a draft into a form and back without changing it", () => {
  const stored = draft({ cc: [{ address: "sam@example.test", name: null }], threadId: "t" });
  expect(formFromDraft(stored)).toEqual({
    accountId: "personal",
    to: "Maya Chen <maya@example.test>",
    cc: "sam@example.test",
    subject: "Plans",
    body: "Hello",
    threadId: "t",
  });
  expect(sameDraft(stored, draftInput(formFromDraft(stored)))).toBe(true);
  expect(draftInput({ ...form, subject: "  Plans " }).subject).toBe("Plans");
  expect(draftRecipients(stored)).toBe("Maya Chen <maya@example.test>");
  expect(draftRecipients(draft({ to: [] }))).toBe("No recipients");
});

it("tells a stored draft from one holding different text", () => {
  const input = draftInput(form);
  expect(sameDraft(draft(), input)).toBe(true);
  for (const patch of [
    { accountId: "work" },
    { subject: "Other" },
    { body: "Hello!" },
    { threadId: "t" },
    { to: [] },
    { cc: [{ address: "sam@example.test", name: null }] },
  ])
    expect(sameDraft(draft(patch), input)).toBe(false);
  // Address case is not a difference; a missing thread is the same as none.
  expect(
    sameDraft(draft({ to: [{ address: "MAYA@example.test", name: "Maya Chen" }] }), {
      ...input,
      threadId: undefined,
    }),
  ).toBe(true);
});

it("says why a form cannot be saved or sent", () => {
  expect(saveProblem(form)).toBeNull();
  expect(saveProblem({ ...form, accountId: "" })).toBe("Choose the account to send from.");
  expect(saveProblem({ ...form, to: "maya" })).toBe("“maya” is not an email address.");
  expect(saveProblem({ ...form, cc: "x@y" })).toBe("“x@y” is not an email address.");
  const many = Array.from({ length: 101 }, (_, index) => `p${index}@example.test`).join(",");
  expect(saveProblem({ ...form, to: many })).toMatch(/up to 100 recipients/);
  expect(saveProblem({ ...form, cc: many })).toMatch(/up to 100 recipients/);
  expect(saveProblem({ ...form, subject: "a".repeat(999) })).toBe("The subject is too long.");
  expect(saveProblem({ ...form, subject: "a\nb" })).toBe("The subject must be a single line.");
  expect(saveProblem({ ...form, body: "a".repeat(MAIL_BODY_LIMIT + 1) })).toBe(
    "The message is too long to save.",
  );
  // An empty draft can be saved, but not sent.
  expect(saveProblem({ ...form, to: "", subject: "", body: "" })).toBeNull();
  expect(sendProblem(form)).toBeNull();
  expect(sendProblem({ ...form, to: "maya" })).toBe("“maya” is not an email address.");
  expect(sendProblem({ ...form, to: " " })).toBe("Add at least one recipient.");
  expect(sendProblem({ ...form, subject: " ", body: " " })).toBe("Add a subject or a message.");
  expect(sendProblem({ ...form, subject: "", body: "Hi" })).toBeNull();
});

it("reads where a draft stands from its record", () => {
  expect(draftStage(draft())).toBe("editable");
  expect(draftStage(draft({ sendStatus: "sending", reconciliationState: "in_progress" }))).toBe(
    "sending",
  );
  // A send claim that went stale needs the person, whatever its status says.
  expect(
    draftStage(draft({ sendStatus: "sending", reconciliationState: "sent_mail_review_required" })),
  ).toBe("review");
  expect(draftStage(draft({ sendStatus: "reconcile" }))).toBe("review");
  expect(draftStage(draft({ sendStatus: "sent" }))).toBe("sent");
  expect(draftStage(draft({ sentAt: "2026-11-16T10:05:00.000Z" }))).toBe("sent");
});

it("trusts only the API's own word that a message was not accepted", () => {
  const error = (details: unknown) =>
    new ApiClientError({ code: "service_unavailable", message: "x", status: 503, details });
  expect(sendNotAccepted(error({ retrySafe: true }))).toBe(true);
  expect(sendNotAccepted(error({ retrySafe: false }))).toBe(false);
  expect(sendNotAccepted(error(null))).toBe(false);
  expect(sendNotAccepted(error("retrySafe"))).toBe(false);
  expect(sendNotAccepted(new Error("offline"))).toBe(false);
});

it("replies to the sender, their reply address, or the other party", () => {
  const own = "me@example.test";
  expect(replyRecipient(undefined, own, thread.from)).toEqual(thread.from);
  expect(replyRecipient(message(), own, thread.from)?.address).toBe("maya@example.test");
  expect(
    replyRecipient(
      message({ replyTo: [{ name: null, address: "desk@example.test" }] }),
      own,
      thread.from,
    )?.address,
  ).toBe("desk@example.test");
  const mine = message({
    from: { name: null, address: "ME@example.test" },
    to: [{ name: null, address: "me@example.test" }],
    cc: [{ name: null, address: "sam@example.test" }],
  });
  expect(replyRecipient(mine, own, thread.from)?.address).toBe("sam@example.test");
  expect(replyRecipient({ ...mine, cc: [] }, own, thread.from)).toBeNull();
});

it("starts a reply in the conversation and a forward outside it", () => {
  expect(replyStart(thread, [message()], "me@example.test")).toEqual({
    title: "Reply",
    form: {
      accountId: "personal",
      to: "Maya Chen <maya@example.test>",
      cc: "",
      subject: "Re: Board packet",
      body: "",
      threadId: "thread-1",
    },
  });
  expect(replyStart({ ...thread, subject: "RE: Board packet" }, [], null).form.subject).toBe(
    "RE: Board packet",
  );
  const mine = message({ from: { name: null, address: "me@example.test" }, to: [] });
  expect(replyStart(thread, [mine], "me@example.test").form.to).toBe("");

  const forward = forwardStart(thread, [message({ bodyText: "First" }), message()]);
  expect(forward.title).toBe("Forward");
  expect(forward.form).toMatchObject({ to: "", subject: "Fwd: Board packet", threadId: null });
  expect(forward.form.body).toBe(
    "\n\n---------- Forwarded message ----------\nFrom: Maya Chen <maya@example.test>\nSubject: Board packet\n\nPlease review.",
  );
  expect(forwardStart({ ...thread, subject: "Fwd: x" }, []).form).toMatchObject({
    subject: "Fwd: x",
    body: expect.stringMatching(/From: Maya Chen <maya@example\.test>\nSubject: Fwd: x\n\n$/),
  });
  const long = forwardStart(thread, [message({ bodyText: "a".repeat(MAIL_BODY_LIMIT) })]);
  expect(long.form.body).toHaveLength(MAIL_BODY_LIMIT);
});

it("starts a new message empty and a draft from its record", () => {
  expect(newStart("work")).toEqual({
    title: "New message",
    form: { accountId: "work", to: "", cc: "", subject: "", body: "", threadId: null },
  });
  const stored = draft();
  expect(draftStart(stored)).toEqual({
    title: "Draft",
    form: formFromDraft(stored),
    draft: stored,
  });
});
