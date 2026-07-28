import {
  createEventBlockInputSchema,
  createEventInputSchema,
  createLocalCalendarInputSchema,
  eventListQuerySchema,
  previewCalendarCommitmentInputSchema,
  updateEventBlockInputSchema,
  updateEventInputSchema,
  updateLocalCalendarInputSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { createCalendarService } from "../calendar-service.js";
import type { AppEnv, Principal } from "../types.js";
import { parseBody, requireFeatureAccess, requireScope } from "./support.js";

type MutationContext = { principal: Principal; requestId: string };

type CalendarRouteOptions = {
  app: Hono<AppEnv>;
  calendar: ReturnType<typeof createCalendarService>;
  mutationContext: (context: Context<AppEnv>) => MutationContext;
};

/** Register the Calendar-owned HTTP surface without constructing shared services. */
export function registerCalendarRoutes({ app, calendar, mutationContext }: CalendarRouteOptions) {
  const calendarFeatureAccess = requireFeatureAccess("calendar");
  const calendarReadAccess = requireScope("calendar:read");
  app.use("/v1/calendars", calendarFeatureAccess);
  app.use("/v1/calendars/*", (context, next) =>
    context.req.method === "POST" && context.req.path === "/v1/calendars/commitments/preview"
      ? calendarReadAccess(context, next)
      : calendarFeatureAccess(context, next),
  );
  app.use("/v1/events", calendarFeatureAccess);
  app.use("/v1/events/*", calendarFeatureAccess);

  app.get("/v1/calendars", async (context) =>
    context.json({ calendars: await calendar.list(context.get("principal").userId) }),
  );
  app.post("/v1/calendars", async (context) =>
    context.json(
      {
        calendar: await calendar.createLocalCalendar(
          await parseBody(context, createLocalCalendarInputSchema),
          mutationContext(context),
        ),
      },
      201,
    ),
  );
  app.post("/v1/calendars/commitments/preview", async (context) =>
    context.json({
      proposal: await calendar.previewCommitment(
        context.get("principal").userId,
        await parseBody(context, previewCalendarCommitmentInputSchema),
      ),
    }),
  );
  app.patch("/v1/calendars/:id", async (context) =>
    context.json({
      calendar: await calendar.updateLocalCalendar(
        context.req.param("id"),
        await parseBody(context, updateLocalCalendarInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.delete("/v1/calendars/:id", async (context) => {
    await calendar.deleteLocalCalendar(context.req.param("id"), mutationContext(context));
    return context.body(null, 204);
  });
  app.patch("/v1/calendars/:id/selected", async (context) =>
    context.json({
      calendar: await calendar.setSelected(
        context.req.param("id"),
        (await parseBody(context, createSelectedInputSchema)).selected,
        mutationContext(context),
      ),
    }),
  );

  app.get("/v1/events", async (context) =>
    context.json({
      events: await calendar.listEvents(
        context.get("principal").userId,
        eventListQuerySchema.parse(context.req.query()),
      ),
    }),
  );
  app.post("/v1/events", async (context) =>
    context.json(
      {
        event: await calendar.createEvent(
          await parseBody(context, createEventInputSchema),
          mutationContext(context),
        ),
      },
      201,
    ),
  );
  app.post("/v1/events/:id/blocks", async (context) =>
    context.json(
      {
        event: await calendar.createEventBlock(
          context.req.param("id"),
          await parseBody(context, createEventBlockInputSchema),
          mutationContext(context),
        ),
      },
      201,
    ),
  );
  app.patch("/v1/events/:id/blocks/:blockId", async (context) =>
    context.json({
      event: await calendar.updateEventBlock(
        context.req.param("id"),
        context.req.param("blockId"),
        await parseBody(context, updateEventBlockInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.delete("/v1/events/:id/blocks/:blockId", async (context) =>
    context.json({
      event: await calendar.deleteEventBlock(
        context.req.param("id"),
        context.req.param("blockId"),
        mutationContext(context),
      ),
    }),
  );
  app.get("/v1/events/:id", async (context) =>
    context.json({
      event: await calendar.getEvent(context.req.param("id"), context.get("principal").userId),
    }),
  );
  app.patch("/v1/events/:id", async (context) =>
    context.json({
      event: await calendar.updateEvent(
        context.req.param("id"),
        await parseBody(context, updateEventInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.delete("/v1/events/:id", async (context) => {
    await calendar.deleteEvent(context.req.param("id"), mutationContext(context));
    return context.body(null, 204);
  });
  app.post("/v1/events/:id/restore", async (context) =>
    context.json({
      event: await calendar.restoreEvent(context.req.param("id"), mutationContext(context)),
    }),
  );
}

const createSelectedInputSchema = z.object({ selected: z.boolean() });
