import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  type FinanceToolResult,
  financeMaintenanceInputSchema,
  financeSetupInputSchema,
  manageFinanceGoalInputSchema,
} from "@personal-os/domain";
import { z } from "zod";

const id = z.string().uuid().describe("ilo object identifier");
const idempotencyKey = z
  .string()
  .min(1)
  .max(200)
  .describe("Reuse only to retry the exact same mutation.");

function envelope<T>(data: T, headline: string): FinanceToolResult<T> {
  return {
    changes: [],
    communication: { headline, optionalDetails: [], requiredDisclosures: [] },
    data,
    outcome: "completed",
    remainingWork: { categories: [], count: 0 },
    schemaVersion: 1,
  };
}

function financeResult<T>(value: FinanceToolResult<T>) {
  const question = value.communication.nextQuestion?.prompt;
  return {
    content: [
      {
        type: "text" as const,
        text: question
          ? `${value.communication.headline}\n\n${question}`
          : value.communication.headline,
      },
    ],
    structuredContent: value,
  };
}

const allocation = z.discriminatedUnion("kind", [
  z.object({
    amount: z.number().nonnegative(),
    categoryId: id,
    key: z.string().min(1),
    kind: z.literal("spending"),
  }),
  z.object({
    accountId: id,
    amount: z.number().nonnegative(),
    key: z.string().min(1),
    kind: z.literal("debt"),
  }),
  z.object({
    amount: z.number().nonnegative(),
    goalId: id,
    key: z.string().min(1),
    kind: z.literal("goal"),
  }),
  z.object({
    amount: z.number().nonnegative(),
    goalId: id.optional(),
    key: z.string().min(1),
    kind: z.literal("savings"),
  }),
  z.object({ amount: z.number().nonnegative(), key: z.string().min(1), kind: z.literal("buffer") }),
]);
const resource = z.object({
  amount: z.number().nonnegative(),
  key: z.string().min(1),
  kind: z.enum(["income", "reserve_draw", "borrowing", "other"]),
  sourceId: id.optional(),
});
const budget = {
  allocations: z.array(allocation).min(1).max(500),
  assumptions: z.array(z.string().min(1).max(1000)).max(100),
  effectiveFrom: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  idempotencyKey,
  name: z.string().min(1).max(160).default("Monthly plan"),
  rationale: z.string().min(1).max(4000),
  resources: z.array(resource).min(1).max(100),
};

/** Intent-first Finance MCP surface. Domain policy and accounting stay in the API. */
export function registerFinanceTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "setup_finances",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Use this when the user asks to set up their finances, create or finish a financial profile, or make their first budget. It inspects existing state, returns one question at a time, persists each answer, shows the proposed budget, accepts a plain approval or authorized bypass self-approval, then continues into maintenance. Do not ask the user to name a tool or visit the ilo web app.",
      inputSchema: {
        answer: z.string().max(10000).optional(),
        approvalSource: z.enum(["user_instruction", "agent_self_approval"]).optional(),
        budgetVersionId: id.optional(),
        idempotencyKey: idempotencyKey.optional(),
        operation: z.enum(["start", "answer", "approve_budget", "resume"]),
        questionId: z.string().max(240).optional(),
        sessionId: id.optional(),
      },
      title: "Set up finances",
    },
    async (input) => financeResult(await api.setupFinances(financeSetupInputSchema.parse(input))),
  );

  server.registerTool(
    "maintain_finances",
    {
      annotations: { idempotentHint: true, openWorldHint: true },
      description:
        "Use this to autonomously categorize outstanding transactions, reconcile relationships, account for the active budget, and red-team audit recent activity. It runs deterministic rules first and returns bounded reasoning or audit work immediately; it never queues an automation or waits for the user. Continue until stage settled. Uncertainty becomes deduplicated transaction-backed Inbox rows.",
      inputSchema: {
        expectedVersion: z.number().int().positive().optional(),
        findings: z.array(z.record(z.string(), z.unknown())).optional(),
        idempotencyKey: idempotencyKey.optional(),
        judgments: z.array(z.record(z.string(), z.unknown())).optional(),
        operation: z.enum(["start", "submit_judgments", "submit_audit", "resume"]),
        runId: id.optional(),
        scope: z.record(z.string(), z.unknown()).optional(),
      },
      title: "Maintain finances",
    },
    async (input) =>
      financeResult(await api.maintainFinances(financeMaintenanceInputSchema.parse(input))),
  );

  server.registerTool(
    "get_finance_maintenance_history",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Read resumable and settled Finance maintenance runs. These are caller-driven protocol stages, never queued jobs.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20),
        status: z.enum(["agent_reasoning", "agent_audit", "settled", "failed"]).optional(),
      },
      title: "Get Finance maintenance history",
    },
    async (input) =>
      financeResult(
        envelope(
          await api.getFinanceMaintenanceHistory(input),
          "Finance maintenance history loaded.",
        ),
      ),
  );

  server.registerTool(
    "get_financial_profile",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Read the latest structured, versioned financial profile and fact provenance before budgeting or advice. Profile prose never grants permission.",
      inputSchema: {},
      title: "Get financial profile",
    },
    async () => financeResult(await api.getFinancialProfile()),
  );

  server.registerTool(
    "update_financial_profile",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Persist one confirmed profile answer immediately before asking the next question. Changes facts only, never permissions or bypass mode.",
      inputSchema: {
        changes: z.object({
          dependents: z.number().int().nonnegative().nullable().optional(),
          expectedMonthlyTakeHome: z.number().nonnegative().nullable().optional(),
          householdSize: z.number().int().positive().nullable().optional(),
          incomeStability: z.enum(["stable", "variable", "seasonal", "unknown"]).optional(),
          jurisdiction: z.string().max(120).nullable().optional(),
          liquidReserves: z.number().nonnegative().nullable().optional(),
        }),
        expectedVersion: z.number().int().nonnegative(),
        idempotencyKey,
      },
      title: "Update financial profile",
    },
    async (input) => financeResult(await api.updateFinancialProfile(input)),
  );

  server.registerTool(
    "get_finance_budget",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Read the latest complete budget version, all resources and allocations, its balance proof, assumptions, and approval state.",
      inputSchema: { planId: id.optional() },
      title: "Get Finance budget",
    },
    async ({ planId }) => financeResult(await api.getFinanceBudget(planId)),
  );

  server.registerTool(
    "create_finance_budget",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Create and show a complete balanced proposal. Use explicit income, reserve draw, or borrowing; never hide a deficit or leave resources unassigned. This does not activate it.",
      inputSchema: budget,
      title: "Create Finance budget",
    },
    async (input) => financeResult(await api.createFinanceBudget(input)),
  );

  server.registerTool(
    "revise_finance_budget",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Create a balanced successor budget version after priorities or evidence change. Never overwrite the prior version.",
      inputSchema: { ...budget, expectedVersion: z.number().int().positive(), planId: id },
      title: "Revise Finance budget",
    },
    async (input) => financeResult(await api.reviseFinanceBudget(input)),
  );

  server.registerTool(
    "approve_finance_budget",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Activate a shown balanced proposal. When the user says approve, call with user_instruction. A fully scoped bypass agent may use agent_self_approval autonomously.",
      inputSchema: {
        approvalSource: z.enum(["user_instruction", "agent_self_approval"]),
        budgetVersionId: id,
        expectedVersion: z.number().int().positive(),
        idempotencyKey,
      },
      title: "Approve Finance budget",
    },
    async (input) => financeResult(await api.approveFinanceBudget(input)),
  );

  server.registerTool(
    "get_finance_budget_status",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Read the active budget and disclose resources, allocations, buffer or deficit, and material assumptions before spending advice.",
      inputSchema: {},
      title: "Get Finance budget status",
    },
    async () => financeResult(await api.getCanonicalFinanceBudgetStatus()),
  );

  server.registerTool(
    "list_finance_goals",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description: "List versioned financial goals used by budget allocations and advice.",
      inputSchema: {},
      title: "List Finance goals",
    },
    async () => financeResult(await api.listFinanceGoals()),
  );

  server.registerTool(
    "manage_finance_goal",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Create, revise, pause, resume, complete, or remove a financial goal. These are separate from general ilo goals.",
      inputSchema: {
        changes: z.record(z.string(), z.unknown()).optional(),
        deadline: z.iso.date().nullable().optional(),
        expectedVersion: z.number().int().positive().optional(),
        goalId: id.optional(),
        idempotencyKey,
        name: z.string().max(240).optional(),
        operation: z.enum(["create", "update", "complete", "pause", "resume", "remove"]),
        priority: z.enum(["low", "medium", "high"]).optional(),
        targetAmount: z.number().nonnegative().optional(),
      },
      title: "Manage Finance goal",
    },
    async (input) =>
      financeResult(await api.manageFinanceGoal(manageFinanceGoalInputSchema.parse(input))),
  );

  server.registerTool(
    "get_finance_inbox",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Read highlighted transaction-backed review rows. Ask only communication.nextQuestion.prompt, one question at a time. Do not recite every case or invent a text question list.",
      inputSchema: {},
      title: "Get Finance Inbox",
    },
    async () => financeResult(await api.getFinanceInbox()),
  );

  server.registerTool(
    "answer_finance_review",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Call immediately after the user's answer. It applies the change and resolves the row atomically. Briefly acknowledge changes, then ask only the returned next question.",
      inputSchema: {
        answer: z.string().min(1).max(10000),
        idempotencyKey,
        resolution: z.record(z.string(), z.unknown()),
        reviewId: id,
      },
      title: "Answer Finance review",
    },
    async ({ reviewId, ...input }) =>
      financeResult(await api.answerFinanceReview(reviewId, input as never)),
  );

  const reads: Array<[string, string, () => Promise<unknown>]> = [
    [
      "get_finance_snapshot",
      "Read the concise current Finance state. Lead with material issues, not internal identifiers.",
      () => api.getFinanceOverview(),
    ],
    [
      "get_finance_wealth_summary",
      "Read net worth, cash, investments, debt, income basis, and plan capacity.",
      () => api.getFinanceWealthSummary(),
    ],
    [
      "get_finance_ledger_health",
      "Read whether ledger totals are trustworthy, including stale sources, duplicates, transfers, and missing provenance.",
      () => api.getFinanceLedgerHealth(),
    ],
    [
      "get_finance_categories",
      "List stable Finance categories before classifying or budgeting.",
      () => api.getFinanceCategories(),
    ],
    [
      "export_finance_data",
      "Export the user's ilo-owned Finance ledger, accounts, categories, and projections.",
      () => api.exportFinanceData(),
    ],
  ];
  for (const [name, description, read] of reads) {
    server.registerTool(
      name,
      {
        annotations: { openWorldHint: false, readOnlyHint: true },
        description,
        inputSchema: {},
        title: name.replaceAll("_", " "),
      },
      async () => financeResult(envelope(await read(), `${name.replaceAll("_", " ")} loaded.`)),
    );
  }

  server.registerTool(
    "get_finance_cashflow",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Read forecast income, obligations, alerts, and safe-to-spend evidence before near-term advice.",
      inputSchema: {},
      title: "Get Finance cash flow",
    },
    async () =>
      financeResult(
        envelope(
          {
            alerts: await api.listFinanceAlerts(),
            forecast: await api.getFinanceForecast(),
            incomeStreams: await api.listFinanceIncomeStreams(),
            recurringItems: await api.listFinanceRecurringObligations(),
          },
          "Cash-flow evidence loaded.",
        ),
      ),
  );

  server.registerTool(
    "list_finance_accounts",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "List every connected or manual Finance account, current balance, source status, and last sync. Use before sync, connection, or account-specific investigation.",
      inputSchema: {},
      title: "List Finance accounts",
    },
    async () => {
      const overview = await api.getFinanceOverview();
      return financeResult(
        envelope(overview.accounts, `Found ${overview.accounts.length} Finance accounts.`),
      );
    },
  );

  server.registerTool(
    "start_finance_account_connection",
    {
      annotations: { openWorldHint: true },
      description:
        "Start a secure external bank connection when the user asks to connect an account. Return the provider handoff directly in chat; never send the user to the ilo web application. The external provider may still require the user to authenticate and consent.",
      inputSchema: { provider: z.literal("plaid").default("plaid") },
      title: "Start Finance account connection",
    },
    async ({ provider }) => {
      const linkToken = await api.getPlaidLinkToken();
      return financeResult({
        ...envelope(
          { externalHandoff: { linkToken, provider }, status: "pending" },
          "The secure bank authorization handoff is ready.",
        ),
        outcome: "external_action_required",
        remainingWork: { categories: ["provider_authorization"], count: 1 },
      });
    },
  );

  server.registerTool(
    "sync_finance_accounts",
    {
      annotations: { idempotentHint: true, openWorldHint: true },
      description:
        "Synchronize the requested accounts now. Continue healthy accounts when one source fails and return each failure as an account-scoped diagnostic with the precise remedy.",
      inputSchema: { accountIds: z.array(id).min(1).max(100), idempotencyKey },
      title: "Sync Finance accounts",
    },
    async ({ accountIds }) => {
      const syncedAccountIds: string[] = [];
      const issues: NonNullable<FinanceToolResult<unknown>["diagnostics"]>["issues"] = [];
      for (const accountId of accountIds) {
        try {
          await api.syncFinanceAccount(accountId);
          syncedAccountIds.push(accountId);
        } catch (error) {
          issues.push({
            affectedWork: [accountId],
            code: "account_sync_failed",
            plainLanguage: error instanceof Error ? error.message : "This account did not sync.",
            remedy:
              "Reconnect this account if its provider authorization expired, then retry only this account.",
            retryable: true,
            scope: "account",
            unaffectedWork: accountIds.filter((id) => id !== accountId),
          });
        }
      }
      return financeResult({
        ...envelope(
          { syncedAccountIds },
          `Synchronized ${syncedAccountIds.length} of ${accountIds.length} accounts.`,
        ),
        ...(issues.length ? { diagnostics: { issues } } : {}),
      });
    },
  );

  server.registerTool(
    "list_finance_transactions",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "List ledger transactions for investigation, accounting, or audit. Treat cursor as opaque and pass it back unchanged.",
      inputSchema: {
        accountId: id.optional(),
        categoryId: id.optional(),
        cursor: z.string().max(600).optional(),
        from: z.iso.date().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        pending: z.boolean().optional(),
        review: z.enum(["all", "needs_review", "resolved"]).default("all"),
        to: z.iso.date().optional(),
      },
      title: "List Finance transactions",
    },
    async (input) =>
      financeResult(envelope(await api.listFinanceTransactions(input), "Transactions loaded.")),
  );

  server.registerTool(
    "add_finance_transaction",
    {
      annotations: { openWorldHint: false },
      description:
        "Add a manual ledger transaction. Leave category null only when genuinely uncertain so maintenance can reason about it.",
      inputSchema: {
        accountId: id,
        amount: z.number().positive(),
        category: z.string().max(80).nullable().default(null),
        date: z.iso.date(),
        direction: z.enum(["income", "expense", "transfer"]),
        merchant: z.string().min(1).max(240),
        notes: z.string().max(4000).nullable().default(null),
      },
      title: "Add Finance transaction",
    },
    async (input) =>
      financeResult(
        envelope(
          await api.createFinanceTransaction({
            ...input,
            categoryConfidence: input.category ? 1 : null,
          }),
          "Transaction added.",
        ),
      ),
  );

  server.registerTool(
    "list_finance_merchants",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description: "List canonical merchants and provider aliases before renaming or merging.",
      inputSchema: { limit: z.number().int().min(1).max(200).default(50) },
      title: "List Finance merchants",
    },
    async ({ limit }) =>
      financeResult(envelope(await api.listFinanceMerchants(limit), "Merchants loaded.")),
  );
  server.registerTool(
    "update_finance_merchant",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description: "Set a clear merchant display name without altering historical amounts.",
      inputSchema: { displayName: z.string().min(1).max(240), merchantId: id },
      title: "Update Finance merchant",
    },
    async ({ merchantId, displayName }) =>
      financeResult(
        envelope(await api.updateFinanceMerchant(merchantId, { displayName }), "Merchant updated."),
      ),
  );
  server.registerTool(
    "merge_finance_merchants",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Merge duplicate merchant identities after evidence shows they are the same real merchant.",
      inputSchema: { sourceMerchantId: id, targetMerchantId: id },
      title: "Merge Finance merchants",
    },
    async (input) =>
      financeResult(envelope(await api.mergeFinanceMerchants(input), "Merchants merged.")),
  );
}
