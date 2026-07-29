import {
  createEventBlockInputSchema,
  createEventInputSchema,
  createLocalCalendarInputSchema,
  deleteEventBlockInputSchema,
  deleteEventInputSchema,
  eventListQuerySchema,
  previewCalendarCommitmentInputSchema,
  restoreEventInputSchema,
  updateEventBlockInputSchema,
  updateEventInputSchema,
  updateLocalCalendarInputSchema,
  upsertCalendarAttentionItemInputSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import { type ZodType, z } from "zod";
import type { createCalendarService } from "../calendar-service.js";
import { AppError } from "../errors.js";
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
        {},
      ),
    }),
  );
  // Revision-bearing destructive requests use POST so intermediaries cannot drop their CAS body.
  app.post("/v1/events/:id/blocks/:blockId/trash", async (context) =>
    context.json({
      event: await calendar.deleteEventBlock(
        context.req.param("id"),
        context.req.param("blockId"),
        mutationContext(context),
        await parseBody(context, deleteEventBlockInputSchema),
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
    await calendar.deleteEvent(context.req.param("id"), mutationContext(context), {});
    return context.body(null, 204);
  });
  // The legacy DELETE path is bodyless; this is the reliable revision-bearing transport.
  app.post("/v1/events/:id/trash", async (context) =>
    context.json({
      revision: await calendar.deleteEvent(
        context.req.param("id"),
        mutationContext(context),
        await parseBody(context, deleteEventInputSchema),
      ),
    }),
  );
  app.post("/v1/events/:id/restore", async (context) =>
    context.json({
      event: await calendar.restoreEvent(
        context.req.param("id"),
        mutationContext(context),
        await parseOptionalBody(context, restoreEventInputSchema),
      ),
    }),
  );
  app.put("/v1/events/:id/attention", async (context) =>
    context.json({
      item: await calendar.upsertAttentionItem(
        context.req.param("id"),
        await parseBody(context, upsertCalendarAttentionItemInputSchema),
        mutationContext(context),
      ),
    }),
  );
}

const createSelectedInputSchema = z.object({ selected: z.boolean() });

async function parseOptionalBody<T>(context: Context<AppEnv>, schema: ZodType<T>): Promise<T> {
  const raw = await context.req.text();
  if (!raw.trim()) return schema.parse({});
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AppError("invalid_request", "The request body must be valid JSON.");
  }
  return schema.parse(value);
}
