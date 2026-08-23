import type { Database } from "@personal-os/database";
import {
  answerFinanceReviewInputSchema,
  applyFinanceCategorizationsInputSchema,
  approveFinanceBudgetInputSchema,
  createFinanceAccountInputSchema,
  createFinanceBudgetInputSchema,
  createFinanceBudgetVersionInputSchema,
  createFinanceTransactionInputSchema,
  exchangePlaidTokenInputSchema,
  financeBudgetPaceQuerySchema,
  financeBudgetStatusQuerySchema,
  financeCsvImportInputSchema,
  financeMerchantQuerySchema,
  financeReviewDecisionInputSchema,
  financeTransactionQuerySchema,
  manageFinanceGoalInputSchema,
  mergeFinanceMerchantsInputSchema,
  resolveFinanceAlertInputSchema,
  reviseFinanceBudgetInputSchema,
  updateFinanceIncomeStreamInputSchema,
  updateFinanceMerchantInputSchema,
  updateFinanceProfileInputSchema,
  updateFinanceRecurringObligationInputSchema,
  updateFinanceTransactionInputSchema,
  updateFinancialProfileInputSchema,
} from "@personal-os/domain";
import type { Context, Hono } from "hono";
import { loadFinanceAuthorization } from "../finance/context.js";
import type { createFinanceService } from "../finance-service.js";
import type { AppEnv, Principal } from "../types.js";
import { parseBody, requireFeatureAccess } from "./support.js";

type MutationContext = { principal: Principal; requestId: string };

type FinanceRouteOptions = {
  app: Hono<AppEnv>;
  db: Database;
  finances: ReturnType<typeof createFinanceService>;
  mutationContext: (context: Context<AppEnv>) => MutationContext;
};

/** Register the Finance-owned HTTP surface without constructing shared services. */
export function registerFinanceRoutes({ app, db, finances, mutationContext }: FinanceRouteOptions) {
  const requireFinanceScope = requireFeatureAccess("finances");
  const financeContext = (context: Context<AppEnv>) =>
    loadFinanceAuthorization({
      db,
      principal: context.get("principal"),
      requestId: context.get("requestId"),
    });
  app.use("/v1/finances", requireFinanceScope);
  app.use("/v1/finances/*", requireFinanceScope);
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
  app.get("/v1/finances/profile", async (context) =>
    context.json({ profile: await finances.getProfile(context.get("principal").userId) }),
  );
  app.get("/v1/finances/profile/current", async (context) =>
    context.json(await finances.getFinancialProfile(context.get("principal").userId)),
  );
  app.patch("/v1/finances/profile", async (context) =>
    context.json(
      await finances.updateFinancialProfile(
        await parseBody(context, updateFinancialProfileInputSchema),
        await financeContext(context),
      ),
    ),
  );
  app.put("/v1/finances/profile", async (context) =>
    context.json({
      profile: await finances.updateProfile(
        await parseBody(context, updateFinanceProfileInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.get("/v1/finances/income-streams", async (context) =>
    context.json({
      incomeStreams: await finances.listIncomeStreams(context.get("principal").userId),
    }),
  );
  app.patch("/v1/finances/income-streams/:id", async (context) =>
    context.json({
      incomeStream: await finances.updateIncomeStream(
        context.req.param("id"),
        await parseBody(context, updateFinanceIncomeStreamInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.get("/v1/finances/recurring", async (context) =>
    context.json({
      recurring: await finances.listRecurringObligations(context.get("principal").userId),
    }),
  );
  // A scoped MCP agent may make this bounded status decision; the service audits its actor.
  app.patch("/v1/finances/recurring/:id", async (context) =>
    context.json({
      recurring: await finances.updateRecurringObligation(
        context.req.param("id"),
        await parseBody(context, updateFinanceRecurringObligationInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.get("/v1/finances/forecast", async (context) =>
    context.json({ forecast: await finances.getForecast(context.get("principal").userId) }),
  );
  app.get("/v1/finances/alerts", async (context) =>
    context.json({ alerts: await finances.listAlerts(context.get("principal").userId) }),
  );
  // Resolving an alert is likewise a bounded, audited MCP action, not a provider mutation.
  app.post("/v1/finances/alerts/:id", async (context) =>
    context.json({
      alert: await finances.resolveAlert(
        context.req.param("id"),
        await parseBody(context, resolveFinanceAlertInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/finances/insights/refresh", async (context) =>
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
  app.patch("/v1/finances/merchants/:id", async (context) =>
    context.json({
      merchant: await finances.updateMerchant(
        context.req.param("id"),
        await parseBody(context, updateFinanceMerchantInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/finances/merchants/merge", async (context) =>
    context.json({
      merchant: await finances.mergeMerchants(
        await parseBody(context, mergeFinanceMerchantsInputSchema),
        mutationContext(context),
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
  app.get("/v1/finances/inbox", async (context) =>
    context.json(await finances.getFinanceInbox(context.get("principal").userId)),
  );
  app.post("/v1/finances/inbox/:id/answer", async (context) =>
    context.json(
      await finances.answerFinanceReview(
        context.req.param("id"),
        await parseBody(context, answerFinanceReviewInputSchema),
        await financeContext(context),
      ),
    ),
  );
  app.post("/v1/finances/categorizations/propose", async (context) =>
    context.json({
      proposals: await finances.proposeCategorizations(
        context.get("principal").userId,
        financeTransactionQuerySchema.parse(context.req.query()),
      ),
    }),
  );
  app.post("/v1/finances/categorizations/apply", async (context) =>
    context.json({
      results: await finances.applyCategorizations(
        await parseBody(context, applyFinanceCategorizationsInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/finances/review/:id", async (context) =>
    context.json({
      result: await finances.resolveReview(
        context.req.param("id"),
        await parseBody(context, financeReviewDecisionInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/finances/accounts", async (context) =>
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
  app.delete("/v1/finances/accounts/:id", async (context) => {
    await finances.deleteAccount(context.req.param("id"), mutationContext(context));
    return context.body(null, 204);
  });
  app.post("/v1/finances/transactions", async (context) =>
    context.json(
      {
        transaction: await finances.createTransaction(
          await parseBody(context, createFinanceTransactionInputSchema),
          mutationContext(context),
        ),
      },
      201,
    ),
  );
  app.patch("/v1/finances/transactions/:id", async (context) =>
    context.json({
      transaction: await finances.updateTransaction(
        context.req.param("id"),
        await parseBody(context, updateFinanceTransactionInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.post("/v1/finances/budgets", async (context) =>
    context.json(
      {
        budget: await finances.createBudget(
          await parseBody(context, createFinanceBudgetInputSchema),
          mutationContext(context),
        ),
      },
      201,
    ),
  );
  app.get("/v1/finances/budget-plans", async (context) =>
    context.json(
      await finances.getFinanceBudget(context.get("principal").userId, context.req.query("planId")),
    ),
  );
  app.post("/v1/finances/budget-plans", async (context) =>
    context.json(
      await finances.createFinanceBudget(
        await parseBody(context, createFinanceBudgetVersionInputSchema),
        await financeContext(context),
      ),
      201,
    ),
  );
  app.post("/v1/finances/budget-plans/:id/revisions", async (context) => {
    const body = await context.req.json();
    return context.json(
      await finances.reviseFinanceBudget(
        reviseFinanceBudgetInputSchema.parse({
          ...(body as Record<string, unknown>),
          planId: context.req.param("id"),
        }),
        await financeContext(context),
      ),
      201,
    );
  });
  app.post("/v1/finances/budget-versions/:id/approve", async (context) => {
    const body = await context.req.json();
    return context.json(
      await finances.approveFinanceBudget(
        approveFinanceBudgetInputSchema.parse({
          ...(body as Record<string, unknown>),
          budgetVersionId: context.req.param("id"),
        }),
        await financeContext(context),
      ),
    );
  });
  app.get("/v1/finances/budget-status", async (context) =>
    context.json(await finances.getFinanceBudgetStatus(context.get("principal").userId)),
  );
  app.get("/v1/finances/goals", async (context) =>
    context.json(await finances.listFinanceGoals(context.get("principal").userId)),
  );
  app.post("/v1/finances/goals", async (context) =>
    context.json(
      await finances.manageFinanceGoal(
        await parseBody(context, manageFinanceGoalInputSchema),
        await financeContext(context),
      ),
      201,
    ),
  );
  app.patch("/v1/finances/goals/:id", async (context) => {
    const body = await context.req.json();
    return context.json(
      await finances.manageFinanceGoal(
        manageFinanceGoalInputSchema.parse({
          ...(body as Record<string, unknown>),
          goalId: context.req.param("id"),
          operation: "update",
        }),
        await financeContext(context),
      ),
    );
  });
  app.delete("/v1/finances/goals/:id", async (context) => {
    const body = await context.req.json();
    return context.json(
      await finances.manageFinanceGoal(
        manageFinanceGoalInputSchema.parse({
          ...(body as Record<string, unknown>),
          goalId: context.req.param("id"),
          operation: "remove",
        }),
        await financeContext(context),
      ),
    );
  });
  app.get("/v1/finances/plaid/status", async (context) =>
    context.json({ available: finances.plaidAvailable() }),
  );
  app.post("/v1/finances/plaid/link-token", async (context) =>
    context.json({
      linkToken: await finances.createPlaidLinkToken(context.get("principal").userId),
    }),
  );
  app.post("/v1/finances/plaid/exchange", async (context) =>
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
  app.post("/v1/finances/accounts/:id/sync", async (context) =>
    context.json({
      result: await finances.syncPlaidAccount(context.req.param("id"), mutationContext(context)),
    }),
  );
  app.post("/v1/finances/accounts/:id/import", async (context) =>
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
