import {
  ritualActionInputSchema,
  ritualDefinitionInputSchema,
  ritualResponseInputSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { createRitualService } from "../ritual-service.js";
import type { AppEnv, Principal } from "../types.js";
import { parseBody, requireHuman, requireScope } from "./support.js";
export function registerRitualRoutes({
  app,
  rituals,
  mutationContext,
}: {
  app: Hono<AppEnv>;
  rituals: ReturnType<typeof createRitualService>;
  mutationContext: (c: Context<AppEnv>) => { principal: Principal; requestId: string };
}) {
  const access = async (c: Context<AppEnv>, next: () => Promise<void>) => {
    await requireScope("tracking:read")(c, async () => {
      if (c.req.method !== "GET")
        await requireScope("tracking:write")(c, async () => {
          await requireHuman(c, next);
        });
      else await next();
    });
  };
  app.use("/v1/rituals", access);
  app.use("/v1/rituals/*", access);
  app.get("/v1/rituals", async (c) => c.json({ rituals: await rituals.list(mutationContext(c)) }));
  app.get("/v1/rituals/current", async (c) => c.json(await rituals.current(mutationContext(c))));
  app.get("/v1/rituals/history", async (c) =>
    c.json(
      await rituals.history(
        mutationContext(c),
        z
          .object({
            limit: z.coerce.number().int().min(1).max(100).default(50),
            cursor: z
              .string()
              .max(100)
              .refine((value) => {
                const [time, id, extra] = value.split("|");
                return (
                  z.iso.datetime({ offset: true }).safeParse(time).success &&
                  (!id || z.uuid().safeParse(id).success) &&
                  extra === undefined
                );
              }, "Invalid history cursor")
              .optional(),
            kind: z.enum(["morning", "night"]).optional(),
            dateFrom: z.iso.date().optional(),
            dateTo: z.iso.date().optional(),
          })
          .parse(c.req.query()),
      ),
    ),
  );
  app.get("/v1/rituals/export", requireHuman, async (c) =>
    c.json(await rituals.export(mutationContext(c))),
  );
  app.put("/v1/rituals/:kind", async (c) =>
    c.json(
      await rituals.saveDefinition(
        c.req.param("kind"),
        await parseBody(c, ritualDefinitionInputSchema),
        mutationContext(c),
      ),
    ),
  );
  app.put("/v1/rituals/occurrences/:id/responses/:stepId", async (c) =>
    c.json(
      await rituals.saveResponse(
        c.req.param("id"),
        c.req.param("stepId"),
        await parseBody(c, ritualResponseInputSchema),
        mutationContext(c),
      ),
    ),
  );
  app.post("/v1/rituals/occurrences/:id/actions", async (c) =>
    c.json(
      await rituals.act(
        c.req.param("id"),
        await parseBody(c, ritualActionInputSchema),
        mutationContext(c),
      ),
    ),
  );
  app.delete("/v1/rituals/:kind/data", async (c) => {
    await rituals.deleteData(c.req.param("kind"), mutationContext(c));
    return c.body(null, 204);
  });
}
