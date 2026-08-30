import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { z } from "zod";
import { result } from "../tool-result.js";

const id = z.string().uuid().describe("ilo object identifier");

/** Finance-owned MCP surface. Domain policy remains enforced by the API. */
export function registerFinanceTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "review_finance_receipt",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Review one ambiguous transaction using bounded, opt-in Mail receipt evidence. It never categorizes or creates a merchant rule; ask the person what they bought when evidence is missing or conflicting.",
      inputSchema: {
        id,
        searchMail: z.boolean().default(false),
        windowDays: z.number().int().min(1).max(30).default(7),
      },
      title: "Review finance receipt evidence",
    },
    async ({ id: transactionId, searchMail, windowDays }) =>
      result(await api.reviewFinanceReceipt(transactionId, { searchMail, windowDays })),
  );

  server.registerTool(
    "get_finance_wealth_summary",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Read net worth split into cash, investments, debt, and other assets plus annualized income and current monthly budget capacity.",
      inputSchema: {},
      title: "Get finance wealth summary",
    },
    async () => result(await api.getFinanceWealthSummary()),
  );

  server.registerTool(
    "get_finance_cashflow",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Read the user's financial profile, expected income streams, recurring obligations, and conservative cash-flow forecast before giving financial-planning guidance.",
      inputSchema: {},
      title: "Get finance cash flow",
    },
    async () =>
      result({
        alerts: await api.listFinanceAlerts(),
        forecast: await api.getFinanceForecast(),
        incomeStreams: await api.listFinanceIncomeStreams(),
        profile: await api.getFinanceProfile(),
        recurringObligations: await api.listFinanceRecurringObligations(),
      }),
  );

  server.registerTool(
    "review_finance_recurring_payment",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Confirm, pause, or cancel a detected recurring bill or subscription after inspecting its evidence. Confirmation makes the inferred pattern user-owned.",
      inputSchema: {
        id,
        status: z.enum(["active", "cancelled", "paused"]),
      },
      title: "Review finance recurring payment",
    },
    async ({ id: recurringId, status }) =>
      result(await api.updateFinanceRecurringObligation(recurringId, { status })),
  );

  server.registerTool(
    "resolve_finance_alert",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Dismiss or resolve an in-app financial alert after checking its evidence. This does not change a paycheck, bill, category, or subscription automatically.",
      inputSchema: {
        action: z.enum(["dismiss", "resolve"]),
        id,
        rationale: z.string().max(1_000).nullable().optional(),
      },
      title: "Resolve finance alert",
    },
    async ({ id: alertId, action, rationale }) =>
      result(await api.resolveFinanceAlert(alertId, { action, rationale: rationale ?? null })),
  );

  server.registerTool(
    "get_finance_ledger_health",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Read the integrity health of the finance ledger: pending activity, unmatched transfer candidates, possible duplicates, stale accounts, missing provenance, and open review work. Use this before trusting a budget or cash-flow total.",
      inputSchema: {},
      title: "Get finance ledger health",
    },
    async () => result(await api.getFinanceLedgerHealth()),
  );

  server.registerTool(
    "list_finance_transactions",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "List transactions with explicit date, account, category, pending, and review filters. Use this instead of the overview for investigation or monthly analysis.",
      inputSchema: {
        accountId: id.optional(),
        categoryId: id.optional(),
        cursor: z.string().datetime().optional(),
        from: z.iso.date().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        pending: z.boolean().optional(),
        review: z.enum(["all", "needs_review", "resolved"]).default("all"),
        to: z.iso.date().optional(),
      },
      title: "List finance transactions",
    },
    async (input) => result(await api.listFinanceTransactions(input)),
  );

  server.registerTool(
    "get_finance_categories",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "List the user's stable finance categories before proposing or applying a category.",
      inputSchema: {},
      title: "Get finance categories",
    },
    async () => result(await api.getFinanceCategories()),
  );

  server.registerTool(
    "get_finance_budget_status",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Read budget limits, month-to-date spending, and remaining funds. Use this before suggesting a spending change or flagging an over-budget category.",
      inputSchema: {
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional(),
      },
      title: "Get finance budget status",
    },
    async ({ month }) => result(await api.getFinanceBudgetStatus(month)),
  );

  server.registerTool(
    "list_finance_merchants",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "List canonical merchant display names and their raw provider aliases. Inspect this before renaming or merging merchant records.",
      inputSchema: { limit: z.number().int().min(1).max(200).default(50) },
      title: "List finance merchants",
    },
    async ({ limit }) => result(await api.listFinanceMerchants(limit)),
  );

  server.registerTool(
    "rename_finance_merchant",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Set a clear, user-facing display name for one canonical merchant. This never changes historical amounts or categories.",
      inputSchema: { displayName: z.string().min(1).max(240), id },
      title: "Rename finance merchant",
    },
    async ({ id: merchantId, displayName }) =>
      result(await api.updateFinanceMerchant(merchantId, { displayName })),
  );

  server.registerTool(
    "merge_finance_merchants",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Merge duplicate merchant records only after confirming their aliases represent the same real place. Moves aliases and transactions to the target merchant while preserving the target display name.",
      inputSchema: { sourceMerchantId: id, targetMerchantId: id },
      title: "Merge finance merchants",
    },
    async (input) => result(await api.mergeFinanceMerchants(input)),
  );

  server.registerTool(
    "get_finance_review_queue",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Read transactions deliberately held for review, including the reason, candidate category, merchant evidence, and current status.",
      inputSchema: { limit: z.number().int().min(1).max(200).default(50) },
      title: "Get finance review queue",
    },
    async ({ limit }) => result(await api.getFinanceReviewQueue(limit)),
  );

  server.registerTool(
    "propose_finance_categorizations",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Prepare conservative category proposals for transactions needing review. This does not change any transaction or create a reusable merchant rule.",
      inputSchema: {
        accountId: id.optional(),
        from: z.iso.date().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        to: z.iso.date().optional(),
      },
      title: "Propose finance categorizations",
    },
    async (input) =>
      result(await api.proposeFinanceCategorizations({ ...input, review: "needs_review" })),
  );

  server.registerTool(
    "apply_finance_categorizations",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Apply proposed agent categorizations. The service enforces an adaptive high-confidence threshold; below it, the transaction stays in review. Set learnMerchant to always only when a durable rule is explicitly intended.",
      inputSchema: {
        decisions: z
          .array(
            z.object({
              categoryId: id,
              confidence: z.number().min(0).max(1),
              learnMerchant: z.enum(["always", "never", "suggest"]).default("suggest"),
              rationale: z.string().min(1).max(1_000),
              transactionId: id,
            }),
          )
          .min(1)
          .max(100),
      },
      title: "Apply finance categorizations",
    },
    async (input) => result(await api.applyFinanceCategorizations(input)),
  );

  server.registerTool(
    "resolve_finance_review",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Record a user's review decision: approve, recategorize, defer, or mark a transfer. User confirmations build confidence gradually; no permanent rule is created unless requested.",
      inputSchema: {
        action: z.enum(["approve", "defer", "not_purchase", "recategorize"]),
        categoryId: id.optional(),
        id,
        learnMerchant: z.enum(["always", "never", "suggest"]).default("suggest"),
        rationale: z.string().max(1_000).nullable().default(null),
      },
      title: "Resolve finance review",
    },
    async ({ id: reviewId, ...input }) => result(await api.resolveFinanceReview(reviewId, input)),
  );

  server.registerTool(
    "get_finance_overview",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Read finance accounts, budgets, recent transactions, spending, and the uncategorized review queue.",
      inputSchema: {},
      title: "Get finance overview",
    },
    async () => result(await api.getFinanceOverview()),
  );

  server.registerTool(
    "add_finance_transaction",
    {
      annotations: { openWorldHint: false },
      description:
        "Add a finance transaction. Omit category only when the agent is genuinely uncertain; it will enter the user's review queue.",
      inputSchema: {
        accountId: id,
        amount: z.number().positive(),
        category: z.string().min(1).max(80).nullable().default(null),
        date: z.iso.date(),
        direction: z.enum(["income", "expense", "transfer"]),
        merchant: z.string().min(1).max(240),
        notes: z.string().max(4_000).nullable().default(null),
      },
      title: "Add finance transaction",
    },
    async (input) =>
      result(
        await api.createFinanceTransaction({
          ...input,
          categoryConfidence: input.category === null ? null : 1,
        }),
      ),
  );

  server.registerTool(
    "categorize_finance_transaction",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Legacy direct categorization. Prefer propose_finance_categorizations and apply_finance_categorizations so confidence, review, and learning intent are recorded.",
      inputSchema: {
        category: z.string().min(1).max(80),
        id,
        learnMerchant: z.boolean().default(false),
      },
      title: "Categorize finance transaction",
    },
    async ({ id: transactionId, category, learnMerchant }) =>
      result(await api.updateFinanceTransaction(transactionId, { category, learnMerchant })),
  );
}
