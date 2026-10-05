import type { Database } from "@personal-os/database";
import {
  searchableWorkspaceSchema,
  updateWorkspaceSettingsSchema,
  workspaceSearchQuerySchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import type { createAgentAccessWorkItemService } from "../agent-access-work-items.js";
import type { AppEnv, Principal } from "../types.js";
import { createWorkspaceSearchService } from "../workspace-search/service.js";
import { createWorkspaceSettingsService } from "../workspace-search/settings.js";
import { parseBody, requireFeatureAccess, requireHuman, requireScope } from "./support.js";

export function registerWorkspaceSearchRoutes({
  app,
  db,
  mutationContext,
  workItems,
}: {
  app: Hono<AppEnv>;
  db: Database;
  workItems: ReturnType<typeof createAgentAccessWorkItemService>;
  mutationContext: (context: Context<AppEnv>) => { principal: Principal; requestId: string };
}) {
  const search = createWorkspaceSearchService(db);
  const settings = createWorkspaceSettingsService(db);
  app.use("/v1/workspaces/:workspace/*", async (context, next) => {
    const workspace = searchableWorkspaceSchema.parse(context.req.param("workspace"));
    return requireFeatureAccess(workspace)(context, next);
  });
  app.get("/v1/workspaces/:workspace/search", async (context) => {
    const workspace = searchableWorkspaceSchema.parse(context.req.param("workspace"));
    const query = workspaceSearchQuerySchema.parse(context.req.query());
    const principal = context.get("principal");
    if (workspace === "tasks") await requireScope("reminders:read")(context, async () => {});
    const reviews = await workItems.searchItems(principal, workspace).then(
      (items) => ({ items, unavailable: false }),
      () => ({ items: [], unavailable: true }),
    );
    const result = await search.search(principal.userId, workspace, query, reviews.items);
    return context.json({
      ...result,
      ...(reviews.unavailable ? { unavailable: ["reviews"] } : {}),
    });
  });
  app.get("/v1/workspaces/:workspace/settings", async (context) =>
    context.json(
      await settings.get(
        context.get("principal").userId,
        searchableWorkspaceSchema.parse(context.req.param("workspace")),
      ),
    ),
  );
  app.patch("/v1/workspaces/:workspace/settings", requireHuman, async (context) =>
    context.json(
      await settings.update(
        searchableWorkspaceSchema.parse(context.req.param("workspace")),
        await parseBody(context, updateWorkspaceSettingsSchema),
        mutationContext(context),
      ),
    ),
  );
}
