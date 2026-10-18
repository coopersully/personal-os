import type { Database } from "@personal-os/database";
import { todayCommitmentsQuerySchema, updateTodaySettingsSchema } from "@personal-os/domain";
import type { Context, Hono } from "hono";
import { createTodayCommitmentsService } from "../today/commitments-service.js";
import { createTodaySettingsService } from "../today/settings-service.js";
import type { AppEnv, Principal } from "../types.js";
import { parseBody } from "./support.js";
export function registerTodayRoutes({
  app,
  db,
  now,
  signingKey,
  mutationContext,
}: {
  app: Hono<AppEnv>;
  db: Database;
  now: () => Date;
  signingKey: string;
  mutationContext: (context: Context<AppEnv>) => { principal: Principal; requestId: string };
}) {
  const settings = createTodaySettingsService(db, now);
  const commitments = createTodayCommitmentsService(db, now, signingKey);
  app.get("/v1/today/settings", async (context) =>
    context.json(await settings.get(context.get("principal").userId)),
  );
  app.patch("/v1/today/settings", async (context) =>
    context.json(
      await settings.update(
        await parseBody(context, updateTodaySettingsSchema),
        mutationContext(context),
      ),
    ),
  );
  app.get("/v1/today/commitments", async (context) => {
    context.header("Cache-Control", "no-store");
    return context.json(
      await commitments.list(
        context.get("principal"),
        todayCommitmentsQuerySchema.parse(context.req.query()),
      ),
    );
  });
}
