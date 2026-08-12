import {
  cancelTaskInputSchema,
  completeTaskInputSchema,
  createTaskInputSchema,
  moveTaskInputSchema,
  reopenTaskInputSchema,
  restoreTaskInputSchema,
  taskListQuerySchema,
  taskMovePreviewInputSchema,
  trashTaskInputSchema,
  updateTaskInputSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import type { createTaskService } from "../task-service.js";
import type { AppEnv, Principal } from "../types.js";
import { parseBody, parseOptionalBody, requireFeatureAccess } from "./support.js";

type MutationContext = { principal: Principal; requestId: string };

type TaskRouteOptions = {
  app: Hono<AppEnv>;
  mutationContext: (context: Context<AppEnv>) => MutationContext;
  tasks: ReturnType<typeof createTaskService>;
};

/** Register the task HTTP surface without constructing its service. */
export function registerTaskRoutes({ app, mutationContext, tasks }: TaskRouteOptions) {
  const requireTasksAccess = requireFeatureAccess("tasks");
  app.use("/v1/tasks", requireTasksAccess);
  app.use("/v1/tasks/*", requireTasksAccess);

  app.get("/v1/tasks", async (context) =>
    context.json(
      await tasks.list(
        context.get("principal").userId,
        taskListQuerySchema.parse(context.req.query()),
      ),
    ),
  );
  app.post("/v1/tasks", async (context) => {
    const task = await tasks.create(
      await parseBody(context, createTaskInputSchema),
      mutationContext(context),
    );
    return context.json({ task }, 201);
  });
  app.get("/v1/tasks/:id", async (context) =>
    context.json({
      task: await tasks.get(context.req.param("id"), context.get("principal").userId),
    }),
  );
  app.patch("/v1/tasks/:id", async (context) =>
    context.json({
      task: await tasks.update(
        context.req.param("id"),
        await parseBody(context, updateTaskInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.delete("/v1/tasks/:id", async (context) => {
    const id = context.req.param("id");
    await tasks.trash(
      id,
      await parseOptionalBody(context, trashTaskInputSchema),
      mutationContext(context),
    );
    context.header("Deprecation", "@1786492800");
    context.header("Link", `</v1/tasks/${id}/trash>; rel="successor-version"`);
    return context.body(null, 204);
  });
  app.post("/v1/tasks/:id/complete", async (context) => {
    const input = await parseBody(context, completeTaskInputSchema);
    return context.json({
      task: await tasks.complete(context.req.param("id"), input, mutationContext(context)),
    });
  });
  app.post("/v1/tasks/:id/cancel", async (context) =>
    context.json({
      task: await tasks.cancel(
        context.req.param("id"),
        await parseBody(context, cancelTaskInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/tasks/:id/reopen", async (context) =>
    context.json({
      task: await tasks.reopen(
        context.req.param("id"),
        await parseBody(context, reopenTaskInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/tasks/:id/trash", async (context) =>
    context.json({
      task: await tasks.trash(
        context.req.param("id"),
        await parseBody(context, trashTaskInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/tasks/:id/restore", async (context) =>
    context.json({
      task: await tasks.restore(
        context.req.param("id"),
        await parseBody(context, restoreTaskInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/tasks/:id/move/preview", async (context) =>
    context.json({
      preview: await tasks.previewMove(
        context.req.param("id"),
        await parseBody(context, taskMovePreviewInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/tasks/:id/move", async (context) =>
    context.json({
      task: await tasks.move(
        context.req.param("id"),
        await parseBody(context, moveTaskInputSchema),
        mutationContext(context),
      ),
    }),
  );
}
