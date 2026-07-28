import type { AccessScope } from "@personal-os/domain";
import { Hono } from "hono";
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
};

describe("Mail routes", () => {
  it("routes the complete read and write surface through the Mail service", async () => {
    const app = new Hono<AppEnv>();
    let scopes = new Set<AccessScope>(["mail:read", "mail:write"]);
    const mail = {
      createDraft: vi.fn(async () => ({ id })),
      createRule: vi.fn(async () => ({ id })),
      getThread: vi.fn(async () => thread),
      listDrafts: vi.fn(async () => [{ body: "Body", id, subject: "Subject" }]),
      listMailboxes: vi.fn(async () => []),
      listMessages: vi.fn(async () => []),
      listRules: vi.fn(async () => []),
      listThreads: vi.fn(async () => [thread]),
      previewRule: vi.fn(async () => ({ candidates: [], matchedCount: 0, scannedCount: 1 })),
      send: vi.fn(async () => undefined),
      snoozeThread: vi.fn(async () => undefined),
      updateRule: vi.fn(async () => ({ id })),
      updateThread: vi.fn(async () => thread),
    };
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "user",
        scopes,
        userId: id,
      });
      context.set("requestId", "request-1");
      await next();
    });
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
    expect(
      (
        await request(`/v1/mail/rules/${id}`, {
          body: JSON.stringify({ enabled: true, expectedVersion: 1 }),
          method: "PATCH",
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
  });
});
