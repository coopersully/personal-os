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
import { AppError } from "../errors.js";
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
  financeReviewBypass?: boolean;
  principal: Principal;
  requestId: string;
};

type FinanceRouteOptions = {
  app: Hono<AppEnv>;
  financeMaintenance: FinanceMaintenanceService;
  financeStatus: FinanceStatusService;
  finances: ReturnType<typeof createFinanceService>;
  mutationContext: (context: Context<AppEnv>) => MutationContext;
};

/** Register the Finance-owned HTTP surface without constructing shared services. */
export function registerFinanceRoutes({
  app,
  financeMaintenance,
  financeStatus,
  finances,
  mutationContext,
}: FinanceRouteOptions) {
  const requireFinanceScope = requireFeatureAccess("finances");
  const requireFinanceRead = requireScope("finances:read");
  const requireFinanceMaintenance = requireScope("finances:maintain");
  const requireFinanceReviewBypass: MiddlewareHandler<AppEnv> = async (context, next) => {
    const principal = context.get("principal");
    if (principal.actorType === "agent") {
      const settings = await finances.getAutomationSettings(principal.userId);
      if (!settings.reviewBypassEnabled) {
        throw new AppError(
          "forbidden",
          "This Finance action is waiting for review. Enable the Finance review bypass to let MCP act on your behalf.",
        );
      }
      context.set("financeReviewBypass", true);
    }
    await next();
  };
  const financeMutationContext = (context: Context<AppEnv>): MutationContext => ({
    ...mutationContext(context),
    financeReviewBypass: context.get("financeReviewBypass") === true,
  });
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
  app.put("/v1/finances/budget-plan", requireFinanceReviewBypass, async (context) =>
    context.json({
      plan: await finances.setBudgetPlan(
        await parseBody(context, setFinanceBudgetPlanInputSchema),
        financeMutationContext(context),
      ),
    }),
  );
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
  app.put("/v1/finances/profile", requireFinanceReviewBypass, async (context) =>
    context.json({
      profile: await finances.updateProfile(
        await parseBody(context, updateFinanceProfileInputSchema),
        financeMutationContext(context),
      ),
    }),
  );
  app.get("/v1/finances/income-streams", async (context) =>
    context.json({
      incomeStreams: await finances.listIncomeStreams(context.get("principal").userId),
    }),
  );
  app.patch("/v1/finances/income-streams/:id", requireFinanceReviewBypass, async (context) =>
    context.json({
      incomeStream: await finances.updateIncomeStream(
        context.req.param("id"),
        await parseBody(context, updateFinanceIncomeStreamInputSchema),
        financeMutationContext(context),
      ),
    }),
  );
  app.get("/v1/finances/recurring", async (context) =>
    context.json({
      recurring: await finances.listRecurringObligations(context.get("principal").userId),
    }),
  );
  app.patch("/v1/finances/recurring/:id", requireFinanceReviewBypass, async (context) =>
    context.json({
      recurring: await finances.updateRecurringObligation(
        context.req.param("id"),
        await parseBody(context, updateFinanceRecurringObligationInputSchema),
        financeMutationContext(context),
      ),
    }),
  );
  app.get("/v1/finances/forecast", async (context) =>
    context.json({ forecast: await finances.getForecast(context.get("principal").userId) }),
  );
  app.get("/v1/finances/alerts", async (context) =>
    context.json({ alerts: await finances.listAlerts(context.get("principal").userId) }),
  );
  app.post("/v1/finances/alerts/:id", requireFinanceReviewBypass, async (context) =>
    context.json({
      alert: await finances.resolveAlert(
        context.req.param("id"),
        await parseBody(context, resolveFinanceAlertInputSchema),
        financeMutationContext(context),
      ),
    }),
  );
  app.post("/v1/finances/insights/refresh", requireFinanceReviewBypass, async (context) =>
    context.json({
      result: await finances.refreshCashflowInsights(context.get("principal").userId),
    }),
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
  app.patch("/v1/finances/merchants/:id", requireFinanceReviewBypass, async (context) =>
    context.json({
      merchant: await finances.updateMerchant(
        context.req.param("id"),
        await parseBody(context, updateFinanceMerchantInputSchema),
        financeMutationContext(context),
      ),
    }),
  );
  app.post("/v1/finances/merchants/merge", requireFinanceReviewBypass, async (context) =>
    context.json({
      merchant: await finances.mergeMerchants(
        await parseBody(context, mergeFinanceMerchantsInputSchema),
        financeMutationContext(context),
      ),
    }),
  );
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
  app.post("/v1/finances/categorizations/apply", requireFinanceReviewBypass, async (context) =>
    context.json({
      results: await finances.applyCategorizations(
        await parseBody(context, applyFinanceCategorizationsInputSchema),
        financeMutationContext(context),
      ),
    }),
  );
  app.post("/v1/finances/review/:id", requireFinanceReviewBypass, async (context) =>
    context.json({
      result: await finances.resolveReview(
        context.req.param("id"),
        await parseBody(context, financeReviewDecisionInputSchema),
        financeMutationContext(context),
      ),
    }),
  );
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
  app.post("/v1/finances/transactions", requireFinanceReviewBypass, async (context) =>
    context.json(
      {
        transaction: await finances.createTransaction(
          await parseBody(context, createFinanceTransactionInputSchema),
          financeMutationContext(context),
        ),
      },
      201,
    ),
  );
  app.put("/v1/finances/transactions/:id/attention", async (context) =>
    context.json({
      item: await finances.upsertAttentionItem(
        context.req.param("id"),
        await parseBody(context, upsertFinanceAttentionItemInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.patch("/v1/finances/transactions/:id", requireFinanceReviewBypass, async (context) =>
    context.json({
      transaction: await finances.updateTransaction(
        context.req.param("id"),
        await parseBody(context, updateFinanceTransactionInputSchema),
        financeMutationContext(context),
      ),
    }),
  );
  app.post("/v1/finances/budgets", requireFinanceReviewBypass, async (context) =>
    context.json(
      {
        budget: await finances.createBudget(
          await parseBody(context, createFinanceBudgetInputSchema),
          financeMutationContext(context),
        ),
      },
      201,
    ),
  );
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
