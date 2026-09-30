import { notificationScopeSchema, saveNotificationPreferencesSchema } from "@personal-os/domain";
import type { Hono } from "hono";
import type { createNotificationService } from "../notification-service.js";
import type { AppEnv } from "../types.js";
import { parseBody, requireFeatureAccess, requireHuman, requireScope } from "./support.js";

/** Explicit bounded invocations only; external hosts retain cadence ownership. */
export function registerNotificationRoutes(options: {
  app: Hono<AppEnv>;
  notifications: ReturnType<typeof createNotificationService>;
}) {
  const { app, notifications } = options;
  app.use(
    "/v1/texting/notifications",
    requireFeatureAccess("texting"),
    requireScope("finances:read"),
    requireScope("texting:read"),
  );
  app.use(
    "/v1/texting/notifications/*",
    requireFeatureAccess("texting"),
    requireScope("finances:read"),
    requireScope("texting:read"),
  );
  app.get("/v1/texting/notifications", async (context) =>
    context.json(await notifications.status(context.get("principal"))),
  );
  app.patch("/v1/texting/notifications/preferences/:scope", requireHuman, async (context) =>
    context.json(
      await notifications.savePreferences(
        context.get("principal"),
        notificationScopeSchema.parse(context.req.param("scope")),
        await parseBody(context, saveNotificationPreferencesSchema),
      ),
    ),
  );
}
