import { Hono } from "hono";
import { errorResponse } from "../errors.js";
import type { AppEnv, Principal } from "../types.js";
import { registerMailRoutes } from "./mail.js";

const id = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-11-09T12:00:00.000Z";
const thread = {
  id,
  accountId: id,
  bodyText: "private body",
  from: { name: "Maya", address: "maya@example.test" },
  mailboxIds: [id],
  messageCount: 1,
  provider: "google",
  receivedAt: timestamp,
  remoteThreadId: "private-provider-id",
  snippet: "Preview",
  starred: false,
  subject: "Hello",
  to: [{ name: null, address: "private@example.test" }],
  unread: true,
  updatedAt: timestamp,
};

function setup(scopes: Principal["scopes"] = new Set(["mail:read"])) {
  const app = new Hono<AppEnv>();
  app.use("*", async (context, next) => {
    context.set("principal", { actorId: id, actorType: "user", userId: id, scopes });
    await next();
  });
  const mail = { listThreads: vi.fn().mockResolvedValue([thread]) };
  registerMailRoutes({
    app,
    mail: mail as never,
    mutationContext: (context) => ({ principal: context.get("principal"), requestId: "test" }),
  });
  app.onError((error, context) => errorResponse(error, context));
  return { app, mail };
}

describe("Mail thread summaries", () => {
  it("returns body-free rows without caching and forwards the owner, filters and cursor", async () => {
    const { app, mail } = setup();
    const response = await app.request(
      `/v1/mail/thread-summaries?mailboxRole=inbox&query=board&limit=50&beforeReceivedAt=${timestamp}&beforeId=${id}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const data = await response.json();
    expect(Object.keys(data.threads[0]).sort()).toEqual([
      "accountId",
      "from",
      "id",
      "mailboxIds",
      "messageCount",
      "provider",
      "receivedAt",
      "snippet",
      "starred",
      "subject",
      "unread",
      "updatedAt",
    ]);
    expect(JSON.stringify(data)).not.toMatch(/private body|private@example|private-provider-id/);
    expect(mail.listThreads).toHaveBeenCalledWith(
      id,
      { limit: 50, mailboxRole: "inbox", query: "board" },
      { beforeId: id, beforeReceivedAt: timestamp },
    );
  });

  it("serves the first page without a cursor", async () => {
    const { app, mail } = setup();

    expect((await app.request("/v1/mail/thread-summaries")).status).toBe(200);
    expect(mail.listThreads).toHaveBeenCalledWith(
      id,
      { limit: 100 },
      { beforeId: undefined, beforeReceivedAt: undefined },
    );
  });

  it("denies a caller without Mail read authority", async () => {
    const { app, mail } = setup(new Set());

    expect((await app.request("/v1/mail/thread-summaries")).status).toBe(403);
    expect(mail.listThreads).not.toHaveBeenCalled();
  });

  it.each([
    `beforeId=${id}`,
    `beforeReceivedAt=${timestamp}`,
    "limit=201",
    "beforeId=invalid&beforeReceivedAt=invalid",
  ])("rejects malformed pagination %s", async (query) => {
    const { app, mail } = setup();

    expect((await app.request(`/v1/mail/thread-summaries?${query}`)).status).toBe(400);
    expect(mail.listThreads).not.toHaveBeenCalled();
  });

  it("keeps the full thread response the web client reads", async () => {
    const { app, mail } = setup();
    const response = await app.request("/v1/mail/threads?mailboxRole=inbox");

    expect((await response.json()).threads[0]).toEqual(thread);
    expect(mail.listThreads).toHaveBeenCalledWith(id, { limit: 100, mailboxRole: "inbox" });
  });
});
