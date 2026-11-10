import { ApiClientError, type PersonalOsApiClient } from "@personal-os/api-client";
import type { MailDraft } from "@personal-os/domain";
import { beforeEach, expect, it, vi } from "vitest";
import { composePayload, DraftWriter, draftFields } from "./compose-state";

const initial = {
  id: "33333333-3333-4333-8333-333333333333",
  accountId: "11111111-1111-4111-8111-111111111111",
  subject: "Lunch",
  body: "Friday at noon?",
  to: [{ address: "sam@example.com", name: null }],
  cc: [],
  threadId: null,
  updatedAt: "2026-11-09T12:00:00.000Z",
  sendStatus: "draft",
  createdAt: "2026-11-09T12:00:00.000Z",
  reconciliationState: "none",
  sendClaimedAt: null,
  sentAt: null,
} as MailDraft;
const create = vi.fn();
const update = vi.fn();
const send = vi.fn();
const list = vi.fn();
const api = {
  createMailDraft: create,
  updateMailDraft: update,
  sendMailDraft: send,
  listMailDrafts: list,
} as unknown as PersonalOsApiClient;
beforeEach(() => {
  vi.resetAllMocks();
  create.mockResolvedValue(initial);
  update.mockResolvedValue({ ...initial, updatedAt: "2026-11-09T12:01:00.000Z" });
  send.mockResolvedValue(undefined);
});
it("validates recipients without requiring a recipient for an unfinished draft", () => {
  expect(
    composePayload(draftFields(undefined, "11111111-1111-4111-8111-111111111111")).success,
  ).toBe(true);
  expect(composePayload({ ...draftFields(initial), to: "bad-address" }).success).toBe(false);
  expect(
    composePayload({ ...draftFields(initial), to: "sam@example.com; alex@example.com" }).success,
  ).toBe(true);
  expect(composePayload({ ...draftFields(initial), subject: "Header\r\nInjected" }).success).toBe(
    false,
  );
});
it("serializes typing during creation and updates the returned revision without duplicate creation", async () => {
  let finish!: (d: MailDraft) => void;
  create.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const writer = new DraftWriter(api);
  const first = writer.save(draftFields(initial));
  const second = writer.save({ ...draftFields(initial), body: "Updated while saving" });
  await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(update).not.toHaveBeenCalled();
  finish(initial);
  await Promise.all([first, second]);
  expect(create).toHaveBeenCalledOnce();
  expect(update).toHaveBeenCalledWith(
    initial.id,
    expect.objectContaining({ body: "Updated while saving", expectedUpdatedAt: initial.updatedAt }),
  );
});
it("preserves account choice and skips unchanged autosaves", async () => {
  const writer = new DraftWriter(api, initial);
  await writer.save(draftFields(initial));
  expect(update).not.toHaveBeenCalled();
  await writer.save({ ...draftFields(initial), accountId: "22222222-2222-4222-8222-222222222222" });
  expect(update).toHaveBeenCalledWith(
    initial.id,
    expect.objectContaining({ accountId: "22222222-2222-4222-8222-222222222222" }),
  );
});
it("blocks ambiguous creation and queued retries rather than duplicating drafts", async () => {
  create.mockRejectedValue(new Error("response lost"));
  const writer = new DraftWriter(api);
  await expect(writer.save(draftFields(initial))).rejects.toThrow("Check Drafts");
  await expect(writer.save(draftFields(initial))).rejects.toThrow("Check Drafts");
  expect(create).toHaveBeenCalledOnce();
});
it("does not overwrite a conflicting revision", async () => {
  update.mockRejectedValue(
    new ApiClientError({ status: 409, code: "conflict", message: "changed" }),
  );
  const writer = new DraftWriter(api, initial);
  await expect(writer.save({ ...draftFields(initial), body: "Edit" })).rejects.toThrow();
  await expect(writer.save({ ...draftFields(initial), body: "Another edit" })).rejects.toThrow();
  expect(update).toHaveBeenCalledOnce();
});
it("allows a corrected save after a definite validation rejection", async () => {
  create.mockRejectedValueOnce(
    new ApiClientError({ status: 400, code: "bad_request", message: "invalid" }),
  );
  const writer = new DraftWriter(api);
  await expect(writer.save(draftFields(initial))).rejects.toThrow();
  await writer.save(draftFields(initial));
  expect(create).toHaveBeenCalledTimes(2);
});
it("sends the confirmed revision once and fences duplicate sends", async () => {
  const writer = new DraftWriter(api, initial);
  await writer.send(initial);
  await expect(writer.send(initial)).rejects.toThrow("already been sent");
  expect(send).toHaveBeenCalledExactlyOnceWith({
    draftId: initial.id,
    confirmedUpdatedAt: initial.updatedAt,
  });
});
it("never automatically retries uncertain delivery", async () => {
  send.mockRejectedValue(new Error("response lost"));
  const writer = new DraftWriter(api, initial);
  await expect(writer.send(initial)).rejects.toThrow("Check Sent");
  await expect(writer.send(initial)).rejects.toThrow("Check Sent");
  expect(send).toHaveBeenCalledOnce();
  expect(list).not.toHaveBeenCalled();
});
it("only permits retry-safe sends after recovering a current draft revision", async () => {
  send.mockRejectedValueOnce(
    new ApiClientError({
      status: 502,
      code: "provider",
      message: "not sent",
      details: { retrySafe: true },
    }),
  );
  const fresh = { ...initial, updatedAt: "2026-11-09T12:02:00.000Z" };
  list.mockResolvedValue([fresh]);
  const writer = new DraftWriter(api, initial);
  await expect(writer.send(initial)).rejects.toThrow("wasn’t sent");
  await expect(writer.send(initial)).rejects.toThrow("latest draft");
  await writer.send(fresh);
  expect(send).toHaveBeenCalledTimes(2);
});
it.each([
  "reconcile",
  "sending",
  "sent",
] as const)("does not edit or resend a reopened %s draft", async (sendStatus) => {
  const writer = new DraftWriter(api, { ...initial, sendStatus });
  await expect(writer.save(draftFields(initial))).rejects.toThrow();
  await expect(writer.send(initial)).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});
