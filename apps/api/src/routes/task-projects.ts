import {
  archiveTaskProjectInputSchema,
  cancelTaskProjectInputSchema,
  completeTaskProjectInputSchema,
  createTaskProjectInputSchema,
  moveTaskProjectInputSchema,
  paginationSchema,
  taskProjectMovePreviewInputSchema,
  updateTaskProjectInputSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import type { createTaskProjectService } from "../task-project-service.js";
import type { AppEnv, Principal } from "../types.js";
import { parseBody, requireFeatureAccess, requireScope } from "./support.js";

type MutationContext = { principal: Principal; requestId: string };

type TaskProjectRouteOptions = {
  app: Hono<AppEnv>;
  mutationContext: (context: Context<AppEnv>) => MutationContext;
  taskProjects: ReturnType<typeof createTaskProjectService>;
};

/** Register the Task Project HTTP surface without constructing its service. */
export function registerTaskProjectRoutes({
  app,
  mutationContext,
  taskProjects,
}: TaskProjectRouteOptions) {
  const requireTasksAccess = requireFeatureAccess("tasks");
  const requireTasksRead = requireScope("tasks:read");
  app.use("/v1/task-projects", requireTasksAccess);
  app.use("/v1/task-projects/*", (context, next) =>
    context.req.method === "POST" &&
    /^\/v1\/task-projects\/[^/]+\/move\/preview$/u.test(context.req.path)
      ? requireTasksRead(context, next)
      : requireTasksAccess(context, next),
  );

  app.get("/v1/task-projects", async (context) =>
    context.json(
      await taskProjects.list(
        context.get("principal").userId,
        paginationSchema.parse(context.req.query()),
      ),
    ),
  );
  app.post("/v1/task-projects", async (context) => {
    const taskProject = await taskProjects.create(
      await parseBody(context, createTaskProjectInputSchema),
      mutationContext(context),
    );
    return context.json({ taskProject }, 201);
  });
  app.get("/v1/task-projects/:id", async (context) =>
    context.json({
      taskProject: await taskProjects.get(context.req.param("id"), context.get("principal").userId),
    }),
  );
  app.patch("/v1/task-projects/:id", async (context) =>
    context.json({
      taskProject: await taskProjects.update(
        context.req.param("id"),
        await parseBody(context, updateTaskProjectInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/task-projects/:id/complete", async (context) =>
    context.json({
      taskProject: await taskProjects.complete(
        context.req.param("id"),
        await parseBody(context, completeTaskProjectInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/task-projects/:id/cancel", async (context) =>
    context.json({
      taskProject: await taskProjects.cancel(
        context.req.param("id"),
        await parseBody(context, cancelTaskProjectInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/task-projects/:id/archive", async (context) =>
    context.json({
      taskProject: await taskProjects.archive(
        context.req.param("id"),
        await parseBody(context, archiveTaskProjectInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/task-projects/:id/move/preview", async (context) =>
    context.json({
      preview: await taskProjects.previewMove(
        context.req.param("id"),
        await parseBody(context, taskProjectMovePreviewInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/task-projects/:id/move", async (context) =>
    context.json({
      taskProject: await taskProjects.move(
        context.req.param("id"),
        await parseBody(context, moveTaskProjectInputSchema),
        mutationContext(context),
      ),
    }),
  );
}
