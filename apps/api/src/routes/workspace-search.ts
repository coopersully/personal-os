import type { Database } from "@personal-os/database";
import { searchableWorkspaceSchema, workspaceSearchQuerySchema } from "@personal-os/domain";
import type { Context, Hono } from "hono";
import type { createAgentAccessWorkItemService } from "../agent-access-work-items.js";
import { workspaceSearchBudget } from "../read-budget.js";
import type { AppEnv, Principal } from "../types.js";
import { createWorkspaceSearchService } from "../workspace-search/service.js";
import { requireFeatureAccess, requireScope } from "./support.js";
import { registerWorkspaceSettingsRoutes } from "./workspace-settings.js";

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
  registerWorkspaceSettingsRoutes({ app, db, mutationContext });
  app.use("/v1/workspaces/:workspace/search", async (context, next) => {
    const workspace = searchableWorkspaceSchema.parse(context.req.param("workspace"));
    return requireFeatureAccess(workspace)(context, next);
  });
  app.get("/v1/workspaces/:workspace/search", async (context) => {
    const workspace = searchableWorkspaceSchema.parse(context.req.param("workspace"));
    const query = workspaceSearchQuerySchema.parse(context.req.query());
    const principal = context.get("principal");
    if (workspace === "tasks") await requireScope("reminders:read")(context, async () => {});
    context.header("Cache-Control", "no-store");
    return workspaceSearchBudget(
      principal.userId,
      async () => {
        const reviews =
          query.kind === "content"
            ? { items: [], unavailable: false }
            : await workItems.searchItems(principal, workspace, context.get("requestId")).then(
                ({ items, unavailableSources }) => ({
                  items,
                  unavailable: unavailableSources.length > 0,
                }),
                () => ({ items: [], unavailable: true }),
              );
        context.req.raw.signal.throwIfAborted();
        const result = await search.search(principal.userId, workspace, query, reviews.items);
        return context.json({
          ...result,
          ...(reviews.unavailable ? { unavailable: ["reviews"] } : {}),
        });
      },
      context.req.raw.signal,
    );
  });
}
