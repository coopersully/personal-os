import type { Database } from "@personal-os/database";
import { workspaceSchema, workspaceSettingsUpdateSchemas } from "@personal-os/domain";
import type { Context, Hono } from "hono";
import type { AppEnv, Principal } from "../types.js";
import { createWorkspaceSettingsService } from "../workspace-settings/service.js";
import { parseBody, requireFeatureAccess } from "./support.js";

export function registerWorkspaceSettingsRoutes({
  app,
  db,
  mutationContext,
  now = () => new Date(),
}: {
  app: Hono<AppEnv>;
  db: Database;
  now?: () => Date;
  mutationContext: (context: Context<AppEnv>) => { principal: Principal; requestId: string };
}) {
  const settings = createWorkspaceSettingsService(db, now);
  app.use("/v1/workspaces/:workspace/settings", async (context, next) =>
    requireFeatureAccess(workspaceSchema.parse(context.req.param("workspace")))(context, next),
  );
  app.get("/v1/workspaces/:workspace/settings", async (context) =>
    context.json(
      await settings.get(
        context.get("principal").userId,
        workspaceSchema.parse(context.req.param("workspace")),
      ),
    ),
  );
  app.patch("/v1/workspaces/:workspace/settings", async (context) => {
    const workspace = workspaceSchema.parse(context.req.param("workspace"));
    return context.json(
      await settings.update(
        workspace,
        await parseBody(context, workspaceSettingsUpdateSchemas[workspace]),
        mutationContext(context),
      ),
    );
  });
}
