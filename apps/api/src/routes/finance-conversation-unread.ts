import type { Hono } from "hono";
import { z } from "zod";
import type { createFinanceConversationUnreadService } from "../finance/conversation-unread-service.js";
import type { AppEnv } from "../types.js";
import { requireHuman, requireScope } from "./support.js";

export function registerFinanceConversationUnreadRoutes({
  app,
  unread,
}: {
  app: Hono<AppEnv>;
  unread: ReturnType<typeof createFinanceConversationUnreadService>;
}) {
  app.get(
    "/v1/finances/conversation/unread",
    requireScope("finances:read"),
    requireHuman,
    async (context) => {
      context.header("cache-control", "no-store");
      z.strictObject({}).parse(context.req.query());
      return context.json(await unread.readUnread(context.get("principal").userId));
    },
  );
}
