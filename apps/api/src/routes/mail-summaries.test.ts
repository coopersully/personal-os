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
  app.use("*", async (c, next) => {
    c.set("principal", { actorId: id, actorType: "user", userId: id, scopes });
    await next();
  });
  const mail = { listThreads: vi.fn().mockResolvedValue([thread]) };
  registerMailRoutes({
    app,
    mail: mail as never,
    mutationContext: (c) => ({ principal: c.get("principal"), requestId: "test" }),
  });
  app.onError((error, c) => errorResponse(error, c));
  return { app, mail };
}
it("returns body-free summaries, no-store and preserves the authenticated owner and cursor", async () => {
  const { app, mail } = setup();
  const response = await app.request(
    `/v1/mail/thread-summaries?mailboxRole=inbox&limit=50&beforeReceivedAt=${timestamp}&beforeId=${id}`,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const data = await response.json();
  expect(data.threads[0]).toMatchObject({ subject: "Hello", unread: true });
  for (const key of ["bodyText", "to", "remoteThreadId"])
    expect(data.threads[0]).not.toHaveProperty(key);
  expect(mail.listThreads).toHaveBeenCalledWith(
    id,
    expect.objectContaining({ limit: 50, beforeId: id }),
    expect.objectContaining({ beforeReceivedAt: timestamp }),
  );
});
it("denies missing Mail authority", async () => {
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
it("preserves the existing web thread response", async () => {
  const { app } = setup();
  const response = await app.request("/v1/mail/threads");
  expect((await response.json()).threads[0].bodyText).toBe("private body");
});
