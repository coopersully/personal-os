import type { AccessScope } from "@personal-os/domain";
import { Hono } from "hono";
import { errorResponse } from "../errors.js";
import type { createMailService } from "../mail-service.js";
import type { AppEnv } from "../types.js";
import { registerMailRoutes } from "./mail.js";

const id = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const thread = {
  accountId,
  bodyText: "Body",
  from: { address: "from@example.com", name: null },
  id,
  mailboxIds: [id],
  messageCount: 1,
  provider: "google" as const,
  receivedAt: "2026-07-13T12:00:00.000Z",
  remoteThreadId: "remote",
  snippet: "Body",
  starred: false,
  subject: "Subject",
  to: [],
  unread: true,
  updatedAt: "2026-07-13T12:00:00.000Z",
};

describe("Mail routes", () => {
  it("routes the complete read and write surface through the Mail service", async () => {
    const app = new Hono<AppEnv>();
    let actorType: "agent" | "user" = "user";
    let scopes = new Set<AccessScope>(["mail:read", "mail:write"]);
    const mail = {
      activateRule: vi.fn(async () => ({ preview: {}, rule: { id } })),
      bulkUpdateThreads: vi.fn(async () => ({
        failedCount: 0,
        failures: [],
        updatedCount: 1,
        updatedIds: [id],
      })),
      createDraft: vi.fn(async () => ({ id })),
      createRule: vi.fn(async () => ({ id })),
      getThread: vi.fn(async () => thread),
      listDrafts: vi.fn(async () => [{ body: "Body", id, subject: "Subject" }]),
      listMailboxes: vi.fn(async () => []),
      listMessages: vi.fn(async () => []),
      listRules: vi.fn(async () => []),
      listSetupContext: vi.fn(async () => ({ accounts: [], safety: {} })),
      listThreads: vi.fn(async () => [thread]),
      previewRule: vi.fn(async () => ({ candidates: [], matchedCount: 0, scannedCount: 1 })),
      previewSavedRule: vi.fn(async () => ({ candidates: [], matchedCount: 0, scannedCount: 1 })),
      reconcileDraft: vi.fn(async () => ({ id, sendStatus: "draft" })),
      send: vi.fn(async () => undefined),
      snoozeThread: vi.fn(async () => undefined),
      updateRule: vi.fn(async () => ({ id })),
      updateThread: vi.fn(async () => thread),
      upsertAttentionItem: vi.fn(async () => ({ id })),
    };
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType,
        scopes,
        userId: id,
      });
      context.set("requestId", "request-1");
      await next();
    });
    app.onError(errorResponse);
    registerMailRoutes({
      app,
      mail: mail as unknown as ReturnType<typeof createMailService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });
    const request = (path: string, init?: RequestInit) =>
      app.request(path, { headers: { "content-type": "application/json" }, ...init });

    expect((await request("/v1/mailboxes")).status).toBe(200);
    expect((await request("/v1/mail/setup-context")).status).toBe(200);
    expect((await request("/v1/mail/drafts")).status).toBe(200);
    expect((await request("/v1/mail/rules")).status).toBe(200);
    expect((await request("/v1/mail/threads?limit=10")).status).toBe(200);
    expect((await request(`/v1/mail/threads/${id}`)).status).toBe(200);
    expect((await request(`/v1/mail/threads/${id}/messages`)).status).toBe(200);
    expect(
      (
        await request("/v1/mail/drafts", {
          body: JSON.stringify({
            accountId,
            body: "Body",
            cc: [],
            subject: "Subject",
            to: [{ address: "to@example.com", name: null }],
          }),
          method: "POST",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request("/v1/mail/rules", {
          body: JSON.stringify({
            actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
            condition: { field: "sender", operator: "contains", value: "news" },
            name: "Duplicate sources",
            sourceIds: [accountId, accountId],
          }),
          method: "POST",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/v1/mail/rules", {
          body: JSON.stringify({
            actions: [{ afterDays: 1, mailboxId: null, type: "archive" }],
            condition: { field: "any", operator: "contains", value: "news" },
            enabled: false,
            name: "Archive",
          }),
          method: "POST",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await request("/v1/mail/rules/preview", {
          body: JSON.stringify({
            actions: [{ afterDays: 1, mailboxId: null, type: "archive" }],
            condition: { field: "any", operator: "contains", value: "news" },
          }),
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect((await request(`/v1/mail/rules/${id}/preview`)).status).toBe(200);
    expect(
      (
        await request(`/v1/mail/rules/${id}/activate`, {
          body: JSON.stringify({
            expectedCandidateIds: [],
            expectedPreviewFingerprint: "a".repeat(64),
            expectedPreviewedAt: "2026-07-28T12:00:00.000Z",
            expectedVersion: 1,
          }),
          method: "POST",
        })
      ).status,
    ).toBe(200);
    actorType = "agent";
    expect(
      (
        await request(`/v1/mail/drafts/${id}/reconcile`, {
          body: JSON.stringify({ outcome: "not_sent" }),
          method: "POST",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(`/v1/mail/rules/${id}/activate`, {
          body: JSON.stringify({
            expectedCandidateIds: [],
            expectedPreviewFingerprint: "a".repeat(64),
            expectedPreviewedAt: "2026-07-28T12:00:00.000Z",
            expectedVersion: 1,
          }),
          method: "POST",
        })
      ).status,
    ).toBe(403);
    actorType = "user";
    expect(
      (
        await request(`/v1/mail/rules/${id}`, {
          body: JSON.stringify({ enabled: true, expectedVersion: 1 }),
          method: "PATCH",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/v1/mail/threads/bulk", {
          body: JSON.stringify({
            items: [{ expectedUpdatedAt: thread.updatedAt, id }],
            unread: false,
          }),
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/v1/mail/threads/${id}/attention`, {
          body: JSON.stringify({
            importance: "high",
            kind: "important",
            summary: "Reply needed.",
            title: "Important reply",
          }),
          method: "PUT",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("/v1/mail/send", {
          body: JSON.stringify({
            accountId,
            body: "Body",
            cc: [],
            subject: "Subject",
            to: [{ address: "to@example.com", name: null }],
          }),
          method: "POST",
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await request("/v1/mail/send", {
          body: JSON.stringify({
            accountId,
            body: "No subject",
            subject: "",
            to: [{ address: "to@example.com", name: null }],
          }),
          method: "POST",
        })
      ).status,
    ).toBe(202);
    expect(
      (
        await request(`/v1/mail/drafts/${id}/reconcile`, {
          body: JSON.stringify({ outcome: "not_sent" }),
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(mail.send).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ accountId, subject: "Subject" }),
      {
        principal: {
          actorId: id,
          actorType: "user",
          scopes,
          userId: id,
        },
        requestId: "request-1",
      },
    );
    expect(
      (
        await request("/v1/mail/send", {
          body: JSON.stringify({
            accountId,
            body: "Body",
            cc: [],
            subject: "Subject",
            to: [{ address: "not-an-email", name: null }],
          }),
          method: "POST",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/v1/mail/send", {
          body: JSON.stringify({
            accountId,
            body: "Body",
            cc: [],
            subject: "Safe\r\nBcc: attacker@example.com",
            to: [{ address: "to@example.com", name: null }],
          }),
          method: "POST",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/v1/mail/send", {
          body: JSON.stringify({
            accountId,
            body: "Body",
            cc: [],
            subject: "Subject",
            to: [
              {
                address: "to@example.com",
                name: "Safe\r\nBcc: attacker@example.com",
              },
            ],
          }),
          method: "POST",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/v1/mail/drafts", {
          body: JSON.stringify({
            accountId,
            body: "Body",
            cc: [],
            subject: "Subject",
            to: [{ address: "to@example.com", name: "x".repeat(201) }],
          }),
          method: "POST",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/v1/mail/send", {
          body: JSON.stringify({
            accountId,
            body: "Body",
            cc: [],
            subject: "Subject",
            to: Array.from({ length: 101 }, (_, index) => ({
              address: `recipient-${index}@example.com`,
              name: null,
            })),
          }),
          method: "POST",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/v1/mail/threads/${id}`, {
          body: JSON.stringify({ starred: true }),
          method: "PATCH",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(`/v1/mail/threads/${id}/snooze`, {
          body: JSON.stringify({ until: "2026-07-14T12:00:00.000Z" }),
          method: "POST",
        })
      ).status,
    ).toBe(204);
    scopes = new Set<AccessScope>(["mail:read"]);
    expect(
      (
        await request("/v1/mail/rules/preview", {
          body: JSON.stringify({
            actions: [{ afterDays: 1, mailboxId: null, type: "archive" }],
            condition: { field: "any", operator: "contains", value: "news" },
          }),
          method: "POST",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request("/v1/mail/rules", {
          body: JSON.stringify({
            actions: [{ afterDays: 1, mailboxId: null, type: "archive" }],
            condition: { field: "any", operator: "contains", value: "news" },
            name: "Newsletter archive",
          }),
          method: "POST",
        })
      ).status,
    ).toBe(403);
  });
});
