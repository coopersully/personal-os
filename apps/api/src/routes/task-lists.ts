import {
  archiveTaskListInputSchema,
  createTaskListInputSchema,
  paginationSchema,
  updateTaskListInputSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import type { createTaskListService } from "../task-list-service.js";
import type { AppEnv, Principal } from "../types.js";
import { parseBody, requireFeatureAccess } from "./support.js";

type MutationContext = { principal: Principal; requestId: string };

type TaskListRouteOptions = {
  app: Hono<AppEnv>;
  mutationContext: (context: Context<AppEnv>) => MutationContext;
  taskLists: ReturnType<typeof createTaskListService>;
};

/** Register the Task List HTTP surface without constructing its service. */
export function registerTaskListRoutes({ app, mutationContext, taskLists }: TaskListRouteOptions) {
  const requireTasksAccess = requireFeatureAccess("tasks");
  app.use("/v1/task-lists", requireTasksAccess);
  app.use("/v1/task-lists/*", requireTasksAccess);

  app.get("/v1/task-lists", async (context) =>
    context.json(
      await taskLists.list(
        context.get("principal").userId,
        paginationSchema.parse(context.req.query()),
      ),
    ),
  );
  app.post("/v1/task-lists", async (context) => {
    const taskList = await taskLists.create(
      await parseBody(context, createTaskListInputSchema),
      mutationContext(context),
    );
    return context.json({ taskList }, 201);
  });
  app.get("/v1/task-lists/:id", async (context) =>
    context.json({
      taskList: await taskLists.get(context.req.param("id"), context.get("principal").userId),
    }),
  );
  app.patch("/v1/task-lists/:id", async (context) =>
    context.json({
      taskList: await taskLists.update(
        context.req.param("id"),
        await parseBody(context, updateTaskListInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/task-lists/:id/archive", async (context) =>
    context.json({
      taskList: await taskLists.archive(
        context.req.param("id"),
        await parseBody(context, archiveTaskListInputSchema),
        mutationContext(context),
      ),
    }),
  );
}
