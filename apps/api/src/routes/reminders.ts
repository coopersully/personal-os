import {
  completeInputSchema,
  createReminderInputSchema,
  reminderDeferralPreviewInputSchema,
  reminderListQuerySchema,
  updateReminderInputSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import type { createReminderService } from "../reminder-service.js";
import type { AppEnv, Principal } from "../types.js";
import { parseBody, requireFeatureAccess } from "./support.js";

type MutationContext = { principal: Principal; requestId: string };

type ReminderRouteOptions = {
  app: Hono<AppEnv>;
  mutationContext: (context: Context<AppEnv>) => MutationContext;
  reminders: ReturnType<typeof createReminderService>;
};

/** Register the reminder HTTP surface without constructing its service. */
export function registerReminderRoutes({ app, mutationContext, reminders }: ReminderRouteOptions) {
  const requireRemindersAccess = requireFeatureAccess("reminders");
  app.use("/v1/reminders", requireRemindersAccess);
  app.use("/v1/reminders/*", requireRemindersAccess);

  app.get("/v1/reminders", async (context) =>
    context.json(
      await reminders.list(
        context.get("principal").userId,
        reminderListQuerySchema.parse(context.req.query()),
      ),
    ),
  );
  app.get("/v1/reminders/overdue-deferral-preview", async (context) =>
    context.json({
      preview: await reminders.previewOverdueDeferral(
        context.get("principal").userId,
        reminderDeferralPreviewInputSchema.parse(context.req.query()),
      ),
    }),
  );
  app.post("/v1/reminders", async (context) => {
    const reminder = await reminders.create(
      await parseBody(context, createReminderInputSchema),
      mutationContext(context),
    );
    return context.json({ reminder }, 201);
  });
  app.get("/v1/reminders/:id", async (context) =>
    context.json({
      reminder: await reminders.get(context.req.param("id"), context.get("principal").userId),
    }),
  );
  app.patch("/v1/reminders/:id", async (context) =>
    context.json({
      reminder: await reminders.update(
        context.req.param("id"),
        await parseBody(context, updateReminderInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.delete("/v1/reminders/:id", async (context) => {
    await reminders.delete(context.req.param("id"), mutationContext(context));
    return context.body(null, 204);
  });
  app.post("/v1/reminders/:id/complete", async (context) => {
    const input = await parseBody(context, completeInputSchema);
    return context.json({
      reminder: await reminders.complete(
        context.req.param("id"),
        input.completed,
        mutationContext(context),
      ),
    });
  });
  app.post("/v1/reminders/:id/restore", async (context) =>
    context.json({
      reminder: await reminders.restore(context.req.param("id"), mutationContext(context)),
    }),
  );
}
