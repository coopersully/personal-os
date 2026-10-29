import {
  confirmFinanceBudgetBaselineQualificationInputSchema,
  financeBudgetBaselineQualificationQuerySchema,
  prepareFinanceBudgetBaselineQualificationInputSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import type { createFinanceBudgetBaselineQualificationService } from "../finance/baseline-qualification-service.js";
import type { FinanceMutationContext } from "../finance/context.js";
import type { AppEnv } from "../types.js";
import { parseBody, requireScope } from "./support.js";

export function registerFinanceBaselineQualificationRoutes({
  app,
  service,
  financeContext,
}: {
  app: Hono<AppEnv>;
  service: ReturnType<typeof createFinanceBudgetBaselineQualificationService> | undefined;
  financeContext: (context: Context<AppEnv>) => Promise<FinanceMutationContext>;
}) {
  const available = () => {
    if (!service) throw new Error("Finance budget baseline qualification service is unavailable.");
    return service;
  };
  app.get(
    "/v1/finances/budget-baselines/qualification",
    requireScope("finances:read"),
    async (context) => {
      const { month } = financeBudgetBaselineQualificationQuerySchema.parse(context.req.query());
      context.header("Cache-Control", "no-store");
      return context.json(
        await available().getQualification(context.get("principal").userId, month),
      );
    },
  );
  app.post(
    "/v1/finances/budget-baselines/qualification/prepare",
    requireScope("finances:write"),
    async (context) =>
      context.json(
        await available().prepare(
          await parseBody(context, prepareFinanceBudgetBaselineQualificationInputSchema),
          await financeContext(context),
        ),
        201,
      ),
  );
  app.post(
    "/v1/finances/budget-baselines/qualification/confirm",
    requireScope("finances:write"),
    async (context) =>
      context.json(
        await available().confirm(
          await parseBody(context, confirmFinanceBudgetBaselineQualificationInputSchema),
          await financeContext(context),
        ),
      ),
  );
}
