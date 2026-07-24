import {
  createGoalInputSchema,
  createMotiveInputSchema,
  updateGoalInputSchema,
  updateMotiveInputSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import type { createGoalsService } from "../goals-service.js";
import type { AppEnv, Principal } from "../types.js";
import { parseBody, requireFeatureAccess } from "./support.js";

type MutationContext = { principal: Principal; requestId: string };

type GoalsRouteOptions = {
  app: Hono<AppEnv>;
  goals: ReturnType<typeof createGoalsService>;
  mutationContext: (context: Context<AppEnv>) => MutationContext;
};

/** Register the goals and motives HTTP surface without constructing services. */
export function registerGoalsRoutes({ app, goals, mutationContext }: GoalsRouteOptions) {
  const requireGoalsAccess = requireFeatureAccess("goals");
  app.use("/v1/goals", requireGoalsAccess);
  app.use("/v1/goals/*", requireGoalsAccess);
  app.use("/v1/motives", requireGoalsAccess);
  app.use("/v1/motives/*", requireGoalsAccess);

  app.get("/v1/goals", async (context) =>
    context.json({ goals: await goals.listGoals(context.get("principal").userId) }),
  );
  app.post("/v1/goals", async (context) =>
    context.json(
      {
        goal: await goals.createGoal(
          await parseBody(context, createGoalInputSchema),
          mutationContext(context),
        ),
      },
      201,
    ),
  );
  app.patch("/v1/goals/:id", async (context) =>
    context.json({
      goal: await goals.updateGoal(
        context.req.param("id"),
        await parseBody(context, updateGoalInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.delete("/v1/goals/:id", async (context) => {
    await goals.deleteGoal(context.req.param("id"), mutationContext(context));
    return context.body(null, 204);
  });

  app.get("/v1/motives", async (context) =>
    context.json({ motives: await goals.listMotives(context.get("principal").userId) }),
  );
  app.post("/v1/motives", async (context) =>
    context.json(
      {
        motive: await goals.createMotive(
          await parseBody(context, createMotiveInputSchema),
          mutationContext(context),
        ),
      },
      201,
    ),
  );
  app.patch("/v1/motives/:id", async (context) =>
    context.json({
      motive: await goals.updateMotive(
        context.req.param("id"),
        await parseBody(context, updateMotiveInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.delete("/v1/motives/:id", async (context) => {
    await goals.deleteMotive(context.req.param("id"), mutationContext(context));
    return context.body(null, 204);
  });
}
