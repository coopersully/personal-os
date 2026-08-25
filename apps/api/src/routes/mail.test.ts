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
  it("keeps legacy drafts readable/deletable and permanently rejects former send mutations", async () => {
    const app = new Hono<AppEnv>();
    const deleteLegacyDraft = vi.fn(async () => undefined);
    const listLegacyDrafts = vi.fn(async () => []);
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "user",
        scopes: new Set<AccessScope>(["mail:read", "mail:write"]),
        userId: id,
      });
      context.set("requestId", "request-legacy-drafts");
      await next();
    });
    app.onError(errorResponse);
    registerMailRoutes({
      app,
      mail: { deleteLegacyDraft, listLegacyDrafts } as unknown as ReturnType<
        typeof createMailService
      >,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });
    const request = (path: string, init?: RequestInit) =>
      app.request(path, { headers: { "content-type": "application/json" }, ...init });

    expect((await request("/v1/mail/drafts")).status).toBe(200);
    expect((await request(`/v1/mail/drafts/${id}`, { method: "DELETE" })).status).toBe(204);
    expect(deleteLegacyDraft).toHaveBeenCalledWith(id, id);

    for (const path of ["/v1/mail/drafts", `/v1/mail/drafts/${id}/reconcile`, "/v1/mail/send"]) {
      const response = await request(path, { body: "{}", method: "POST" });
      expect(response.status).toBe(410);
      await expect(response.json()).resolves.toMatchObject({
        error: {
          code: "feature_unavailable",
          details: { capability: "email_transmission", permanent: true },
        },
      });
    }
  });

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
      deleteLegacyDraft: vi.fn(async () => undefined),
      createRule: vi.fn(async () => ({ id })),
      getThread: vi.fn(async () => thread),
      listLegacyDrafts: vi.fn(async () => [{ body: "Body", id, subject: "Subject" }]),
      listMailboxes: vi.fn(async () => []),
      listMessages: vi.fn(async () => []),
      listRules: vi.fn(async () => []),
      listSetupContext: vi.fn(async () => ({ accounts: [], safety: {} })),
      listThreads: vi.fn(async () => [thread]),
      previewRule: vi.fn(async () => ({ candidates: [], matchedCount: 0, scannedCount: 1 })),
      previewSavedRule: vi.fn(async () => ({ candidates: [], matchedCount: 0, scannedCount: 1 })),
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
    expect((await request("/v1/mail/drafts", { body: "{}", method: "POST" })).status).toBe(403);
  });
});
