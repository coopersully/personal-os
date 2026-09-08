import { taskWorkspaceQuerySchema } from "@personal-os/domain";
import type { Hono } from "hono";
import type { createTaskWorkspaceService } from "../task-workspace-service.js";
import type { AppEnv } from "../types.js";
import { requireScope } from "./support.js";

/** Mixed reads require both domains; kind-specific reads retain least privilege. */
export function registerTaskWorkspaceRoutes({
  app,
  taskWorkspace,
}: {
  app: Hono<AppEnv>;
  taskWorkspace: ReturnType<typeof createTaskWorkspaceService>;
}) {
  app.get("/v1/task-workspace", async (context) => {
    const query = taskWorkspaceQuerySchema.parse(context.req.query());
    if (query.kind !== "reminder") await requireScope("tasks:read")(context, async () => {});
    if (query.kind !== "task") await requireScope("reminders:read")(context, async () => {});
    return context.json(await taskWorkspace.list(context.get("principal").userId, query));
  });
}
