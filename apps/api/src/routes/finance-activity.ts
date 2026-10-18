import { financeActivityQuerySchema } from "@personal-os/domain";
import type { Hono } from "hono";
import type { createFinanceActivityService } from "../finance/activity-service.js";
import type { AppEnv } from "../types.js";
import { requireHuman, requireScope } from "./support.js";

/** Source messages are human history, never an agent's pre-start message queue. */
export function registerFinanceActivityRoutes({
  app,
  activity,
}: {
  app: Hono<AppEnv>;
  activity: ReturnType<typeof createFinanceActivityService>;
}) {
  app.get("/v1/finances/activity", requireScope("finances:read"), requireHuman, async (context) => {
    context.header("cache-control", "no-store");
    return context.json(
      await activity.listActivity(
        context.get("principal").userId,
        financeActivityQuerySchema.parse(context.req.query()),
      ),
    );
  });
}
