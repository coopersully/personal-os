import { Hono } from "hono";
import { errorResponse } from "../errors.js";
import type { AppEnv, Principal } from "../types.js";
import { registerFinanceConversationUnreadRoutes } from "./finance-conversation-unread.js";

it("allows only authenticated human read authority and rejects every owner override before reading", async () => {
  const app = new Hono<AppEnv>();
  const owner = "11111111-1111-4111-8111-111111111111";
  let principal: Principal = {
    userId: owner,
    actorId: owner,
    actorType: "user",
    scopes: new Set(["finances:read"]),
  };
  const unread = {
    readUnread: vi.fn(async () => ({
      unreadCount: "0",
      readThroughSequence: "0",
      latestAgentSequence: "0",
    })),
  };
  app.use("*", async (c, next) => {
    c.set("principal", principal);
    c.set("requestId", "unread-test");
    await next();
  });
  app.onError(errorResponse);
  registerFinanceConversationUnreadRoutes({ app, unread });
  const url = "/v1/finances/conversation/unread";
  const response = await app.request(url);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(unread.readUnread).toHaveBeenCalledWith(owner);
  for (const query of ["userId=foreign", "ownerId=foreign", "readThroughSequence=999"])
    expect((await app.request(`${url}?${query}`)).status).toBe(400);
  principal = { ...principal, actorType: "agent" };
  expect((await app.request(url)).status).toBe(403);
  principal = { ...principal, actorType: "user", scopes: new Set() };
  expect((await app.request(url)).status).toBe(403);
  expect(unread.readUnread).toHaveBeenCalledTimes(1);
});
