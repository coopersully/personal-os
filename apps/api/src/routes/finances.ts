import type { Database } from "@personal-os/database";
import {
  answerFinanceReviewInputSchema,
  applyFinanceCategorizationsInputSchema,
  approveFinanceBudgetInputSchema,
  cancelFinanceReimbursementInputSchema,
  classifyFinanceTransactionsInputSchema,
  createFinanceAccountInputSchema,
  createFinanceBudgetInputSchema,
  createFinanceBudgetVersionInputSchema,
  createFinanceTransactionInputSchema,
  disconnectFinanceAccountInputSchema,
  exchangePlaidTokenInputSchema,
  financeAccountQuerySchema,
  financeBudgetPaceQuerySchema,
  financeBudgetStatusQuerySchema,
  financeCsvImportInputSchema,
  financeMaintenanceHistoryQuerySchema,
  financeMaintenanceInputSchema,
  financeMerchantQuerySchema,
  financeReceiptReviewInputSchema,
  financeReviewDecisionInputSchema,
  financeScenarioInputSchema,
  financeSetupInputSchema,
  financeTransactionQuerySchema,
  idSchema,
  linkFinanceTransactionsInputSchema,
  maintenanceRequestSchema,
  maintenanceScopeQuerySchema,
  manageFinanceGoalInputSchema,
  manageFinanceRecurringItemInputSchema,
  manageFinanceRuleInputSchema,
  mergeFinanceMerchantsInputSchema,
  reconcileFinanceReimbursementInputSchema,
  resolveFinanceAlertInputSchema,
  reviseFinanceBudgetInputSchema,
  setFinanceBudgetPlanInputSchema,
  setFinanceTransactionBreakdownInputSchema,
  splitFinanceTransactionInputSchema,
  startFinanceAccountConnectionInputSchema,
  submitFinanceLedgerChallengeInputSchema,
  updateFinanceAccountInputSchema,
  updateFinanceAutomationSettingsInputSchema,
  updateFinanceIncomeStreamInputSchema,
  updateFinanceMerchantInputSchema,
  updateFinanceProfileInputSchema,
  updateFinanceRecurringObligationInputSchema,
  updateFinanceTransactionInputSchema,
  updateFinancialProfileInputSchema,
  upsertFinanceAttentionItemInputSchema,
} from "@personal-os/domain";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { z } from "zod";
import { loadFinanceAuthorization } from "../finance/context.js";
import {
  buildFinancePeriodReviewResult,
  buildFinanceSnapshotResult,
} from "../finance/presentation-service.js";
import type { createFinanceActionService, SupportedActionKind } from "../finance-action-service.js";
import type { FinanceChallengeService } from "../finance-challenge-service.js";
import type { FinanceMaintenanceService } from "../finance-maintenance-service.js";
import type { FinancePeriodReviewService } from "../finance-period-review-service.js";
import type { createFinancePlaybookService } from "../finance-playbook-service.js";
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
  db?: Database;
  actions?: ReturnType<typeof createFinanceActionService>;
  financeChallenges?: FinanceChallengeService;
  financeMaintenance: FinanceMaintenanceService;
  financePeriodReviews?: FinancePeriodReviewService;
  financePlaybook?: ReturnType<typeof createFinancePlaybookService>;
  financeStatus: FinanceStatusService;
  finances: ReturnType<typeof createFinanceService>;
  mutationContext: (context: Context<AppEnv>) => MutationContext;
};

/** Register the Finance-owned HTTP surface without constructing shared services. */
export function registerFinanceRoutes({
  app,
  actions,
  db,
  financeChallenges,
  financeMaintenance,
  financePeriodReviews,
  financePlaybook,
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
  const financeContext = (context: Context<AppEnv>) =>
    db
      ? loadFinanceAuthorization({
          db,
          principal: context.get("principal"),
          requestId: context.get("requestId"),
        })
      : Promise.reject(new Error("Finance database access is unavailable."));
  const routeId = (context: Context<AppEnv>) => idSchema.parse(context.req.param("id"));
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
    if (
      (context.req.method === "POST" && context.req.path === "/v1/finances/maintenance") ||
      context.req.path.includes("/v1/finances/maintenance/challenges/")
    ) {
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
  app.get("/v1/finances/maintenance/challenges/:id", async (context) => {
    if (!financeChallenges) throw new Error("Finance challenge service is unavailable.");
    return context.json({
      page: await financeChallenges.getPage(
        context.get("principal").userId,
        idSchema.parse(context.req.param("id")),
        context.req.query("cursor"),
      ),
    });
  });
  app.post("/v1/finances/maintenance/challenges/:id/submit", async (context) => {
    if (!financeChallenges) throw new Error("Finance challenge service is unavailable.");
    const input = await parseBody(context, submitFinanceLedgerChallengeInputSchema);
    const id = idSchema.parse(context.req.param("id"));
    if (input.challengeId !== id)
      throw new Error("The Finance challenge path and body do not match.");
    return context.json({
      challenge: await financeChallenges.submit(input, financeMutationContext(context)),
    });
  });
  app.get("/v1/finances/status", async (context) =>
    context.json({
      status: await financeStatus.getFinanceStatus(
        context.get("principal").userId,
        maintenanceScopeQuerySchema.parse(context.req.query()),
      ),
    }),
  );
  app.get("/v1/finances/snapshot", async (context) => {
    const userId = context.get("principal").userId;
    const [status, budget, wealth] = await Promise.all([
      financeStatus.getFinanceStatus(userId, { type: "all_outstanding" }),
      finances.getFinanceBudget(userId),
      finances.getWealthSummary(userId),
    ]);
    return context.json(buildFinanceSnapshotResult(status, budget, wealth));
  });
  app.get("/v1/finances/period-reviews/:id/presentation", async (context) => {
    if (!financePeriodReviews) throw new Error("Finance period reviews are unavailable.");
    const review = await financePeriodReviews.getOwned(
      context.get("principal").userId,
      idSchema.parse(context.req.param("id")),
    );
    return context.json(buildFinancePeriodReviewResult(review));
  });
  app.get("/v1/finances/period-reviews/:id", async (context) => {
    if (!financePeriodReviews) throw new Error("Finance period reviews are unavailable.");
    return context.json({
      review: await financePeriodReviews.getOwned(
        context.get("principal").userId,
        idSchema.parse(context.req.param("id")),
      ),
    });
  });
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
  app.post("/v1/finances/setup", async (context) =>
    context.json(
      await finances.setupFinances(
        await parseBody(context, financeSetupInputSchema),
        await financeContext(context),
      ),
    ),
  );
  app.get("/v1/finances/wealth", async (context) =>
    context.json({ wealth: await finances.getWealthSummary(context.get("principal").userId) }),
  );
  app.get("/v1/finances/playbook", async (context) =>
    context.json(await financePlaybook?.get(context.get("principal").userId)),
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
      id: routeId(context),
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
      id: routeId(context),
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
      id: routeId(context),
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
        result: await finances.refreshCashflowInsights(
          context.get("principal").userId,
          financeMutationContext(context),
        ),
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
  app.get("/v1/finances/rules", async (context) =>
    context.json(await finances.listFinanceRules(context.get("principal").userId)),
  );
  app.post("/v1/finances/rules", async (context) =>
    context.json(
      await finances.manageFinanceRule(
        await parseBody(context, manageFinanceRuleInputSchema),
        await financeContext(context),
      ),
    ),
  );
  app.get("/v1/finances/recurring-items", async (context) =>
    context.json(await finances.listFinanceRecurringItems(context.get("principal").userId)),
  );
  app.post("/v1/finances/recurring-items", async (context) =>
    context.json(
      await finances.manageFinanceRecurringItem(
        await parseBody(context, manageFinanceRecurringItemInputSchema),
        await financeContext(context),
      ),
    ),
  );
  app.patch("/v1/finances/merchants/:id", async (context) => {
    const input = await parseBody(context, updateFinanceMerchantInputSchema);
    const actionInput = { id: routeId(context), displayName: input.displayName };
    return act(context, "merchant", actionInput, async () =>
      context.json({
        merchant: await finances.updateMerchant(
          actionInput.id,
          { displayName: actionInput.displayName },
          financeMutationContext(context),
        ),
      }),
    );
  });
  app.patch("/v1/finances/merchants/:id/canonical", async (context) =>
    context.json(
      await finances.updateFinanceMerchant(
        routeId(context),
        await parseBody(
          context,
          updateFinanceMerchantInputSchema.extend({
            idempotencyKey: z.string().trim().min(1).max(200),
          }),
        ),
        await financeContext(context),
      ),
    ),
  );
  app.post("/v1/finances/merchants/merge", async (context) => {
    const input = await parseBody(context, mergeFinanceMerchantsInputSchema);
    return act(context, "merchant", input, async () =>
      context.json({
        merchant: await finances.mergeMerchants(input, financeMutationContext(context)),
      }),
    );
  });
  app.post("/v1/finances/merchants/merge/canonical", async (context) =>
    context.json(
      await finances.mergeFinanceMerchantRecords(
        await parseBody(
          context,
          mergeFinanceMerchantsInputSchema.and(
            z.object({ idempotencyKey: z.string().trim().min(1).max(200) }),
          ),
        ),
        await financeContext(context),
      ),
    ),
  );
  app.get("/v1/finances/transactions", async (context) =>
    context.json(
      await finances.listTransactions(
        context.get("principal").userId,
        financeTransactionQuerySchema.parse(context.req.query()),
      ),
    ),
  );
  app.get("/v1/finances/transactions/:id", async (context) =>
    context.json(
      await finances.getFinanceTransaction(
        context.get("principal").userId,
        context.req.param("id"),
      ),
    ),
  );
  app.post("/v1/finances/transactions/:id/receipt-review", async (context) =>
    context.json({
      review: await finances.reviewReceipt(
        context.get("principal").userId,
        context.req.param("id"),
        await parseBody(context, financeReceiptReviewInputSchema),
      ),
    }),
  );
  app.post("/v1/finances/transactions/:id/remove", async (context) => {
    const input = await parseBody(
      context,
      z.object({ idempotencyKey: z.string().trim().min(1).max(200) }),
    );
    return context.json(
      await finances.removeFinanceTransaction(
        context.req.param("id"),
        input.idempotencyKey,
        await financeContext(context),
      ),
    );
  });
  app.post("/v1/finances/transactions/split", async (context) =>
    context.json(
      await finances.splitFinanceTransaction(
        await parseBody(context, splitFinanceTransactionInputSchema),
        await financeContext(context),
      ),
    ),
  );
  app.post("/v1/finances/transactions/classify", async (context) => {
    const input = await parseBody(context, classifyFinanceTransactionsInputSchema);
    return context.json(
      await finances.classifyFinanceTransactions(
        input.classifications,
        input.idempotencyKey,
        await financeContext(context),
      ),
    );
  });
  app.post("/v1/finances/transactions/link", async (context) =>
    context.json(
      await finances.linkFinanceTransactions(
        await parseBody(context, linkFinanceTransactionsInputSchema),
        await financeContext(context),
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
  app.post("/v1/finances/maintenance/protocol", async (context) =>
    context.json(
      await finances.maintainFinances(
        await parseBody(context, financeMaintenanceInputSchema),
        await financeContext(context),
      ),
    ),
  );
  app.get("/v1/finances/maintenance", async (context) =>
    context.json(
      await finances.getFinanceMaintenanceHistory(
        context.get("principal").userId,
        financeMaintenanceHistoryQuerySchema.parse(context.req.query()),
      ),
    ),
  );
  app.get("/v1/finances/maintenance/protocol/:id", async (context) =>
    context.json(
      await finances.getFinanceMaintenanceRun(
        context.get("principal").userId,
        context.req.param("id"),
      ),
    ),
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
        routeId(context),
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
  app.get("/v1/finances/questions", async (context) =>
    context.json({
      questions: await requireActions().listQuestions(
        context.get("principal").userId,
        financeTransactionQuerySchema.shape.limit.parse(context.req.query("limit") ?? 50),
      ),
    }),
  );
  app.post("/v1/finances/action-reviews/:id/approve", requireHuman, async (context) =>
    context.json({
      outcome: await requireActions().approve(routeId(context), financeMutationContext(context)),
    }),
  );
  app.post("/v1/finances/action-reviews/:id/dismiss", requireHuman, async (context) =>
    context.json({
      review: await requireActions().dismiss(routeId(context), financeMutationContext(context)),
    }),
  );
  app.post("/v1/finances/questions/:id/answer", async (context) => {
    const { answer } = await parseBody(
      context,
      z.object({ answer: z.string().trim().min(1).max(4_000) }).strict(),
    );
    return context.json({
      outcome: await requireActions().answerQuestion(
        routeId(context),
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
  app.get("/v1/finances/accounts", async (context) =>
    context.json(
      await finances.listFinanceAccounts(
        context.get("principal").userId,
        financeAccountQuerySchema.parse(context.req.query()),
      ),
    ),
  );
  app.delete("/v1/finances/accounts/:id", requireHuman, async (context) => {
    await finances.deleteAccount(routeId(context), mutationContext(context));
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
        routeId(context),
        await parseBody(context, upsertFinanceAttentionItemInputSchema),
        mutationContext(context),
      ),
    }),
  );
  app.patch("/v1/finances/transactions/:id", async (context) => {
    const body = await parseBody(context, updateFinanceTransactionInputSchema);
    const input = { id: routeId(context), ...body };
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
  app.patch("/v1/finances/transactions/:id/canonical", async (context) =>
    context.json(
      await finances.updateFinanceTransaction(
        routeId(context),
        await parseBody(
          context,
          updateFinanceTransactionInputSchema.and(
            z.object({ idempotencyKey: z.string().trim().min(1).max(200) }),
          ),
        ),
        await financeContext(context),
      ),
    ),
  );
  app.put("/v1/finances/transactions/:id/breakdown", async (context) => {
    const body = await parseBody(context, setFinanceTransactionBreakdownInputSchema);
    const input = { id: routeId(context), ...body };
    return act(context, "transaction_breakdown", input, async () =>
      context.json({
        transaction: await finances.setTransactionBreakdown(
          input.id,
          body,
          financeMutationContext(context),
        ),
      }),
    );
  });
  app.get("/v1/finances/reimbursements", async (context) =>
    context.json({
      reimbursements: await finances.listReimbursements(context.get("principal").userId),
    }),
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
    const body = await parseBody(context, z.record(z.string(), z.unknown()));
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
    const body = await parseBody(context, z.record(z.string(), z.unknown()));
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
    const body = await parseBody(context, z.record(z.string(), z.unknown()));
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
    const body = await parseBody(context, z.record(z.string(), z.unknown()));
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
  app.post("/v1/finances/reimbursements/reconcile", async (context) => {
    const input = await parseBody(context, reconcileFinanceReimbursementInputSchema);
    return act(context, "reimbursement", input, async () =>
      context.json({
        reimbursement: await finances.reconcileReimbursement(
          input,
          financeMutationContext(context),
        ),
      }),
    );
  });
  app.post("/v1/finances/reimbursements/:id/cancel", async (context) => {
    const body = await parseBody(
      context,
      cancelFinanceReimbursementInputSchema.omit({
        reimbursementId: true,
        operation: true,
      }),
    );
    const input = { ...body, operation: "cancel" as const, reimbursementId: routeId(context) };
    return act(context, "reimbursement", input, async () =>
      context.json({
        reimbursement: await finances.reconcileReimbursement(
          input,
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
      result: await finances.syncPlaidAccount(routeId(context), mutationContext(context)),
    }),
  );
  app.get("/v1/finances/account-connections/:id", async (context) =>
    context.json(
      await finances.getFinanceAccountConnection(
        context.get("principal").userId,
        context.req.param("id"),
      ),
    ),
  );
  app.post("/v1/finances/account-connections", async (context) =>
    context.json(
      await finances.startFinanceAccountConnection(
        await parseBody(context, startFinanceAccountConnectionInputSchema),
        await financeContext(context),
      ),
    ),
  );
  app.patch("/v1/finances/accounts/:id", async (context) =>
    context.json(
      await finances.updateFinanceAccount(
        context.req.param("id"),
        await parseBody(context, updateFinanceAccountInputSchema),
        await financeContext(context),
      ),
    ),
  );
  app.post("/v1/finances/accounts/:id/disconnect", async (context) => {
    const input = await parseBody(context, disconnectFinanceAccountInputSchema);
    return context.json(
      await finances.disconnectFinanceAccount(
        context.req.param("id"),
        input.idempotencyKey,
        await financeContext(context),
      ),
    );
  });
  app.post("/v1/finances/accounts/:id/import", async (context) => {
    const input = await parseBody(context, financeCsvImportInputSchema);
    return context.json(
      {
        result: await finances.importCsv(
          { ...input, accountId: routeId(context) },
          mutationContext(context),
        ),
      },
      201,
    );
  });
  app.post("/v1/finances/accounts/:id/import/canonical", async (context) => {
    const input = await parseBody(
      context,
      financeCsvImportInputSchema.extend({
        idempotencyKey: z.string().trim().min(1).max(200),
      }),
    );
    return context.json(
      await finances.importFinanceTransactions(
        { ...input, accountId: routeId(context) },
        await financeContext(context),
      ),
      201,
    );
  });
}
