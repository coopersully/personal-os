import { saveActiveReminderPreferencesSchema } from "@personal-os/domain";
import type { Hono } from "hono";
import { z } from "zod";
import type { createActiveReminderService } from "../active-reminder-service.js";
import { AppError } from "../errors.js";
import type { AppEnv } from "../types.js";
import { parseBody, requireHuman } from "./support.js";

const querySchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
});
export function registerActiveReminderRoutes({
  app,
  activeReminders,
}: {
  app: Hono<AppEnv>;
  activeReminders: ReturnType<typeof createActiveReminderService>;
}) {
  app.use("/v1/active-reminders/*", async (c, next) => {
    const expected = c.req.header("x-nohmi-account");
    if (expected && expected !== c.get("principal").userId)
      throw new AppError("conflict", "Your account changed. Reload these settings.");
    await next();
  });
  app.get("/v1/active-reminders/preferences", requireHuman, async (c) =>
    c.json(await activeReminders.getPreferences(c.get("principal").userId)),
  );
  app.patch("/v1/active-reminders/preferences", requireHuman, async (c) =>
    c.json(
      await activeReminders.savePreferences(
        c.get("principal").userId,
        await parseBody(c, saveActiveReminderPreferencesSchema),
        { principal: c.get("principal"), requestId: c.get("requestId") },
      ),
    ),
  );
  app.get("/v1/desktop/active-reminders", requireHuman, async (c) =>
    c.json(
      await activeReminders.listCandidates(
        c.get("principal").userId,
        querySchema.parse(c.req.query()),
      ),
    ),
  );
}
