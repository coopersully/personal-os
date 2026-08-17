import {
  applyFinanceCategorizationsInputSchema,
  createFinanceAccountInputSchema,
  createFinanceBudgetInputSchema,
  createFinanceTransactionInputSchema,
  exchangePlaidTokenInputSchema,
  financeBudgetPaceQuerySchema,
  financeBudgetStatusQuerySchema,
  financeCsvImportInputSchema,
  financeMerchantQuerySchema,
  financeReviewDecisionInputSchema,
  financeScenarioInputSchema,
  financeTransactionQuerySchema,
  idSchema,
  maintenanceRequestSchema,
  maintenanceScopeQuerySchema,
  mergeFinanceMerchantsInputSchema,
  resolveFinanceAlertInputSchema,
  setFinanceBudgetPlanInputSchema,
  updateFinanceAutomationSettingsInputSchema,
  updateFinanceIncomeStreamInputSchema,
  updateFinanceMerchantInputSchema,
  updateFinanceProfileInputSchema,
  updateFinanceRecurringObligationInputSchema,
  updateFinanceTransactionInputSchema,
  upsertFinanceAttentionItemInputSchema,
} from "@personal-os/domain";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import type { createFinanceActionService, SupportedActionKind } from "../finance-action-service.js";
import type { FinanceMaintenanceService } from "../finance-maintenance-service.js";
import { compareFinanceScenarios } from "../finance-scenario-service.js";
import type { createFinanceService } from "../finance-service.js";
import type { FinanceStatusService } from "../finance-status-service.js";
import type { AppEnv, Principal } from "../types.js";
import {
  parseBody,
  parseOptionalBody,
  requireFeatureAccess,
  requireHuman,
  requireScope,
} from "./support.js";

type MutationContext = {
  principal: Principal;
  requestId: string;
};

type FinanceRouteOptions = {
  app: Hono<AppEnv>;
  actions?: ReturnType<typeof createFinanceActionService>;
  financeMaintenance: FinanceMaintenanceService;
  financeStatus: FinanceStatusService;
  finances: ReturnType<typeof createFinanceService>;
  mutationContext: (context: Context<AppEnv>) => MutationContext;
};

/** Register the Finance-owned HTTP surface without constructing shared services. */
export function registerFinanceRoutes({
  app,
  actions,
  financeMaintenance,
  financeStatus,
  finances,
  mutationContext,
}: FinanceRouteOptions) {
  const requireFinanceScope = requireFeatureAccess("finances");
  const requireFinanceRead = requireScope("finances:read");
  const requireFinanceMaintenance = requireScope("finances:maintain");
  const requireActions = () => {
    if (!actions) throw new Error("Finance action service is required for Finance mutations.");
    return actions;
  };
  const financeMutationContext = (context: Context<AppEnv>): MutationContext =>
    mutationContext(context);
  const act = async (
    context: Context<AppEnv>,
    actionKind: SupportedActionKind,
    input: Record<string, unknown>,
    direct: () => Promise<Response>,
  ) => {
    if (context.get("principal").actorType !== "agent") return direct();
    const outcome = await requireActions().performDirect(
      actionKind,
      input,
      financeMutationContext(context),
    );
    return context.json(outcome, outcome.status === "pending_review" ? 202 : 200);
  };
  const requireFinanceAccess: MiddlewareHandler<AppEnv> = async (context, next) => {
    if (context.req.method === "POST" && context.req.path === "/v1/finances/maintenance") {
      await requireFinanceMaintenance(context, next);
      return;
    }
    if (
      context.req.method === "POST" &&
      ["/v1/finances/categorizations/propose", "/v1/finances/scenarios/compare"].includes(
        context.req.path,
      )
    ) {
      await requireFinanceRead(context, next);
      return;
    }
    await requireFinanceScope(context, next);
  };
  app.use("/v1/finances", requireFinanceAccess);
  app.use("/v1/finances/*", requireFinanceAccess);
  app.post("/v1/finances/maintenance", async (context) => {
    const request = await parseOptionalBody(context, maintenanceRequestSchema);
    const created = await financeMaintenance.startOrResume(
      context.get("principal").userId,
      request.scope,
    );
    return context.json({ run: created }, 202);
  });
  app.get("/v1/finances/maintenance/:id", async (context) =>
    context.json({
      run: await financeMaintenance.getRun(
        context.get("principal").userId,
        idSchema.parse(context.req.param("id")),
      ),
    }),
  );
  app.get("/v1/finances/status", async (context) =>
    context.json({
      status: await financeStatus.getFinanceStatus(
        context.get("principal").userId,
        maintenanceScopeQuerySchema.parse(context.req.query()),
      ),
    }),
  );
  app.post("/v1/finances/scenarios/compare", async (context) =>
    context.json({
      scenario: compareFinanceScenarios(await parseBody(context, financeScenarioInputSchema)),
    }),
  );
  app.put("/v1/finances/budget-plan", async (context) => {
    const input = await parseBody(context, setFinanceBudgetPlanInputSchema);
    return act(context, "budget_plan", input, async () =>
      context.json({ plan: await finances.setBudgetPlan(input, financeMutationContext(context)) }),
    );
  });
  app.get("/v1/finances", async (context) => {
    const query = financeBudgetStatusQuerySchema.parse(context.req.query());
    const accountIds = context.req.query("accountIds")?.split(",").filter(Boolean);
    return context.json({
      overview: await finances.listOverview(
        context.get("principal").userId,
        query.month,
        accountIds,
      ),
    });
  });
  app.get("/v1/finances/wealth", async (context) =>
    context.json({ wealth: await finances.getWealthSummary(context.get("principal").userId) }),
  );
  app.get("/v1/finances/automation-settings", async (context) =>
    context.json({
      settings: await finances.getAutomationSettings(context.get("principal").userId),
    }),
  );
  app.patch("/v1/finances/automation-settings", requireHuman, async (context) =>
    context.json({
      settings: await finances.updateAutomationSettings(
        await parseBody(context, updateFinanceAutomationSettingsInputSchema),
        financeMutationContext(context),
      ),
    }),
  );
  app.get("/v1/finances/guided-setup", async (context) =>
    context.json({
      setup: await finances.getGuidedSetupContext(context.get("principal").userId),
    }),
  );
  app.get("/v1/finances/profile", async (context) =>
    context.json({ profile: await finances.getProfile(context.get("principal").userId) }),
  );
  app.put("/v1/finances/profile", async (context) => {
    const input = await parseBody(context, updateFinanceProfileInputSchema);
    return act(context, "profile", input, async () =>
      context.json({
        profile: await finances.updateProfile(input, financeMutationContext(context)),
      }),
    );
  });
  app.get("/v1/finances/income-streams", async (context) =>
    context.json({
      incomeStreams: await finances.listIncomeStreams(context.get("principal").userId),
    }),
  );
  app.patch("/v1/finances/income-streams/:id", async (context) => {
    const input = {
      id: context.req.param("id"),
      ...(await parseBody(context, updateFinanceIncomeStreamInputSchema)),
    };
    return act(context, "income_stream", input, async () =>
      context.json({
        incomeStream: await finances.updateIncomeStream(
          input.id,
          input,
          financeMutationContext(context),
        ),
      }),
    );
  });
  app.get("/v1/finances/recurring", async (context) =>
    context.json({
      recurring: await finances.listRecurringObligations(context.get("principal").userId),
    }),
  );
  app.patch("/v1/finances/recurring/:id", async (context) => {
    const input = {
      id: context.req.param("id"),
      ...(await parseBody(context, updateFinanceRecurringObligationInputSchema)),
    };
    return act(context, "recurring_obligation", input, async () =>
      context.json({
        recurring: await finances.updateRecurringObligation(
          input.id,
          input,
          financeMutationContext(context),
        ),
      }),
    );
  });
  app.get("/v1/finances/forecast", async (context) =>
    context.json({ forecast: await finances.getForecast(context.get("principal").userId) }),
  );
  app.get("/v1/finances/alerts", async (context) =>
    context.json({ alerts: await finances.listAlerts(context.get("principal").userId) }),
  );
  app.post("/v1/finances/alerts/:id", async (context) => {
    const input = {
      id: context.req.param("id"),
      ...(await parseBody(context, resolveFinanceAlertInputSchema)),
    };
    return act(context, "alert", input, async () =>
      context.json({
        alert: await finances.resolveAlert(input.id, input, financeMutationContext(context)),
      }),
    );
  });
  app.post("/v1/finances/insights/refresh", async (context) =>
    act(context, "alert", { operation: "refresh" }, async () =>
      context.json({
        result: await finances.refreshCashflowInsights(context.get("principal").userId),
      }),
    ),
  );
  app.get("/v1/finances/health", async (context) =>
    context.json({ health: await finances.getLedgerHealth(context.get("principal").userId) }),
  );
  app.get("/v1/finances/export", async (context) =>
    context.json({ export: await finances.exportData(context.get("principal").userId) }),
  );
  app.get("/v1/finances/budgets/pace", async (context) =>
    context.json({
      pace: await finances.getBudgetPace(
        context.get("principal").userId,
        financeBudgetPaceQuerySchema.parse(context.req.query()).period,
      ),
    }),
  );
  app.get("/v1/finances/categories", async (context) =>
    context.json({ categories: await finances.listCategories(context.get("principal").userId) }),
  );
  app.get("/v1/finances/budgets/status", async (context) =>
    context.json({
      budgets: await finances.getBudgetStatus(
        context.get("principal").userId,
        financeBudgetStatusQuerySchema.parse(context.req.query()).month,
      ),
    }),
  );
  app.get("/v1/finances/merchants", async (context) =>
    context.json({
      merchants: await finances.listMerchants(
        context.get("principal").userId,
        financeMerchantQuerySchema.parse(context.req.query()).limit,
      ),
    }),
  );
  app.patch("/v1/finances/merchants/:id", async (context) => {
    const body = await parseBody(context, updateFinanceMerchantInputSchema);
    const input = { id: context.req.param("id"), ...body };
    return act(context, "merchant", input, async () =>
      context.json({
        merchant: await finances.updateMerchant(input.id, body, financeMutationContext(context)),
      }),
    );
  });
  app.post("/v1/finances/merchants/merge", async (context) => {
    const input = await parseBody(context, mergeFinanceMerchantsInputSchema);
    return act(context, "merchant", input, async () =>
      context.json({
        merchant: await finances.mergeMerchants(input, financeMutationContext(context)),
      }),
    );
  });
  app.get("/v1/finances/transactions", async (context) =>
    context.json(
      await finances.listTransactions(
        context.get("principal").userId,
        financeTransactionQuerySchema.parse(context.req.query()),
      ),
    ),
  );
  app.get("/v1/finances/review", async (context) =>
    context.json({
      reviews: await finances.listReviewQueue(
        context.get("principal").userId,
        financeTransactionQuerySchema.shape.limit.parse(context.req.query("limit") ?? 50),
      ),
    }),
  );
  // Proposal generation never mutates the ledger, so it remains available on both verbs.
  const proposeCategorizations = async (context: Context<AppEnv>) => {
    const page = await finances.proposeCategorizations(
      context.get("principal").userId,
      financeTransactionQuerySchema.parse(context.req.query()),
    );
    return context.json({ nextCursor: page.nextCursor, proposals: page.items });
  };
  app.post("/v1/finances/categorizations/propose", proposeCategorizations);
  app.get("/v1/finances/categorizations/propose", proposeCategorizations);
  app.post("/v1/finances/categorizations/apply", async (context) => {
    const input = await parseBody(context, applyFinanceCategorizationsInputSchema);
    return act(context, "categorization", input, async () =>
      context.json({
        results: await finances.applyCategorizations(input, financeMutationContext(context)),
      }),
    );
  });
  app.post("/v1/finances/review/:id", requireHuman, async (context) =>
    context.json({
      result: await finances.resolveReview(
        context.req.param("id"),
        await parseBody(context, financeReviewDecisionInputSchema),
        financeMutationContext(context),
      ),
    }),
  );
  app.get("/v1/finances/action-reviews", requireHuman, async (context) =>
    context.json({
      reviews: await requireActions().listReviews(
        context.get("principal").userId,
        financeTransactionQuerySchema.shape.limit.parse(context.req.query("limit") ?? 50),
      ),
    }),
  );
  app.post("/v1/finances/action-reviews/:id/approve", requireHuman, async (context) =>
    context.json({
      outcome: await requireActions().approve(
        context.req.param("id"),
        financeMutationContext(context),
      ),
    }),
  );
  app.post("/v1/finances/action-reviews/:id/dismiss", requireHuman, async (context) =>
    context.json({
      review: await requireActions().dismiss(
        context.req.param("id"),
        financeMutationContext(context),
      ),
    }),
  );
  app.post("/v1/finances/questions/:id/answer", async (context) => {
    const { answer } = await parseBody(
      context,
      z.object({ answer: z.string().trim().min(1).max(4_000) }).strict(),
    );
    return context.json({
      outcome: await requireActions().answerQuestion(
        context.req.param("id"),
        answer,
        financeMutationContext(context),
      ),
    });
  });
  app.post("/v1/finances/accounts", requireHuman, async (context) =>
    context.json(
      {
        account: await finances.createAccount(
          await parseBody(context, createFinanceAccountInputSchema),
          mutationContext(context),
        ),
      },
      201,
    ),
  );
  app.delete("/v1/finances/accounts/:id", requireHuman, async (context) => {
    await finances.deleteAccount(context.req.param("id"), mutationContext(context));
    return context.body(null, 204);
  });
  app.post("/v1/finances/transactions", async (context) => {
    const input = await parseBody(context, createFinanceTransactionInputSchema);
    return act(context, "transaction", input, async () =>
      context.json(
        { transaction: await finances.createTransaction(input, financeMutationContext(context)) },
        201,
      ),
    );
  });
  app.put("/v1/finances/transactions/:id/attention", async (context) =>
    context.json({
      item: await finances.upsertAttentionItem(
        context.req.param("id"),
        await parseBody(context, upsertFinanceAttentionItemInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.patch("/v1/finances/transactions/:id", async (context) => {
    const body = await parseBody(context, updateFinanceTransactionInputSchema);
    const input = { id: context.req.param("id"), ...body };
    return act(context, "transaction", input, async () =>
      context.json({
        transaction: await finances.updateTransaction(
          input.id,
          body,
          financeMutationContext(context),
        ),
      }),
    );
  });
  app.post("/v1/finances/budgets", async (context) => {
    const input = await parseBody(context, createFinanceBudgetInputSchema);
    return act(context, "budget_plan", input, async () =>
      context.json(
        { budget: await finances.createBudget(input, financeMutationContext(context)) },
        201,
      ),
    );
  });
  app.get("/v1/finances/plaid/status", async (context) =>
    context.json({ available: finances.plaidAvailable() }),
  );
  app.post("/v1/finances/plaid/link-token", requireHuman, async (context) =>
    context.json({
      linkToken: await finances.createPlaidLinkToken(context.get("principal").userId),
    }),
  );
  app.post("/v1/finances/plaid/exchange", requireHuman, async (context) =>
    context.json(
      {
        accounts: await finances.exchangePlaidToken(
          await parseBody(context, exchangePlaidTokenInputSchema),
          mutationContext(context),
        ),
      },
      201,
    ),
  );
  app.post("/v1/finances/accounts/:id/sync", requireHuman, async (context) =>
    context.json({
      result: await finances.syncPlaidAccount(context.req.param("id"), mutationContext(context)),
    }),
  );
  app.post("/v1/finances/accounts/:id/import", requireHuman, async (context) =>
    context.json(
      {
        result: await finances.importCsv(
          {
            ...(await parseBody(context, financeCsvImportInputSchema)),
            accountId: context.req.param("id"),
          },
          mutationContext(context),
        ),
      },
      201,
    ),
  );
}
