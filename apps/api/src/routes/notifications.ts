import {
  idSchema,
  notificationScopeSchema,
  resetFinanceNotificationPreferencesSchema,
  saveNotificationPreferencesSchema,
} from "@personal-os/domain";
import type { Hono } from "hono";
import { AppError } from "../errors.js";
import type { createNotificationService } from "../notification-service.js";
import type { AppEnv } from "../types.js";
import { parseBody, requireFeatureAccess, requireScope } from "./support.js";

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
  app.get("/v1/texting/notifications/attempts/:id", async (context) => {
    context.header("Cache-Control", "no-store");
    if (Object.keys(context.req.query()).length)
      throw new AppError(
        "invalid_request",
        "Notification attempt inspection accepts only its path ID.",
      );
    return context.json(
      await notifications.getAttempt(
        context.get("principal"),
        idSchema.parse(context.req.param("id")),
      ),
    );
  });
  app.delete(
    "/v1/texting/notifications/preferences/finances",
    requireScope("texting:write"),
    async (context) =>
      context.json(
        await notifications.resetFinancePreferences(
          context.get("principal"),
          await parseBody(context, resetFinanceNotificationPreferencesSchema),
          context.get("requestId"),
        ),
      ),
  );
  app.patch("/v1/texting/notifications/preferences/:scope", async (context) =>
    context.json(
      await notifications.savePreferences(
        context.get("principal"),
        notificationScopeSchema.parse(context.req.param("scope")),
        await parseBody(context, saveNotificationPreferencesSchema),
        context.get("requestId"),
      ),
    ),
  );
}
