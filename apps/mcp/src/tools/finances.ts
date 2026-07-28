import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { z } from "zod";
import { result } from "../tool-result.js";

const id = z.string().uuid().describe("ilo object identifier");
const readAnnotations = {
  openWorldHint: false,
  readOnlyHint: true,
} as const;
const reviewedMutationAnnotations = {
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
  readOnlyHint: false,
} as const;
const consequentialMutationAnnotations = {
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
  readOnlyHint: false,
} as const;

/** Finance-owned MCP surface. Domain policy remains enforced by the API. */
export function registerFinanceTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "get_finance_guided_setup",
    {
      annotations: readAnnotations,
      description:
        "Start Finance setup here. Read the durable Finance profile, source/readiness context, ledger health, human-only boundaries, and currently useful reviewed workflows before interviewing the user.",
      inputSchema: {},
      title: "Get Finance guided setup",
    },
    async () => {
      const [context, profile] = await Promise.all([
        api.getFinanceGuidedSetup(),
        api.getDomainProfile("finances"),
      ]);
      return result({ context, profile });
    },
  );

  server.registerTool(
    "get_finance_wealth_summary",
    {
      annotations: readAnnotations,
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
      annotations: readAnnotations,
      description:
        "Read the user's human-managed financial profile, expected income streams, recurring obligations, and conservative forecast for informational cash-flow guidance. Forecasts are not balances or guarantees.",
      inputSchema: {},
      title: "Get finance cash flow",
    },
    async () => {
      const [alerts, forecast, incomeStreams, profile, recurringObligations] = await Promise.all([
        api.listFinanceAlerts(),
        api.getFinanceForecast(),
        api.listFinanceIncomeStreams(),
        api.getFinanceProfile(),
        api.listFinanceRecurringObligations(),
      ]);
      return result({ alerts, forecast, incomeStreams, profile, recurringObligations });
    },
  );

  server.registerTool(
    "review_finance_recurring_payment",
    {
      annotations: reviewedMutationAnnotations,
      description:
        "Change Ilo's review state for a detected recurring bill or subscription only after explicit user confirmation. This changes forecast context; it does not cancel or modify a provider payment.",
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
      annotations: consequentialMutationAnnotations,
      description:
        "Dismiss or resolve an Ilo financial alert only after checking its evidence and confirming the user no longer needs it. This does not change a paycheck, bill, category, or subscription.",
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
      annotations: readAnnotations,
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
      annotations: readAnnotations,
      description:
        "List transactions with explicit date, account, category, pending, and review filters. Use this instead of the overview for investigation or monthly analysis.",
      inputSchema: {
        accountId: id.optional(),
        categoryId: id.optional(),
        cursor: z.string().min(1).max(600).optional(),
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
      annotations: readAnnotations,
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
      annotations: readAnnotations,
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
      annotations: readAnnotations,
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
      annotations: reviewedMutationAnnotations,
      description:
        "Set a clear display name for one canonical merchant after the user confirms the identity. This never changes historical amounts or categories and is audited as an agent action.",
      inputSchema: { displayName: z.string().min(1).max(240), id },
      title: "Rename finance merchant",
    },
    async ({ id: merchantId, displayName }) =>
      result(await api.updateFinanceMerchant(merchantId, { displayName })),
  );

  server.registerTool(
    "merge_finance_merchants",
    {
      annotations: consequentialMutationAnnotations,
      description:
        "Merge duplicate merchant records only after explicit user confirmation that their aliases represent the same real place. This removes the source record, moves its aliases and transactions, and cannot be replayed.",
      inputSchema: {
        rationale: z.string().min(1).max(1_000),
        sourceMerchantId: id,
        targetMerchantId: id,
      },
      title: "Merge finance merchants",
    },
    async (input) => result(await api.mergeFinanceMerchants(input)),
  );

  server.registerTool(
    "get_finance_review_queue",
    {
      annotations: readAnnotations,
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
      annotations: readAnnotations,
      description:
        "Prepare conservative category proposals for transactions needing review. This read-scoped preview does not change a transaction or create a merchant rule; meetsPolicyThreshold is eligibility, not automatic execution.",
      inputSchema: {
        accountId: id.optional(),
        cursor: z.string().min(1).max(600).optional(),
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
      annotations: consequentialMutationAnnotations,
      description:
        "Apply accepted category proposals. The API enforces its adaptive threshold; lower-confidence items remain in review. Agents cannot create permanent merchant rules. Inspect every returned status because a batch reports any partial failures per transaction.",
      inputSchema: {
        decisions: z
          .array(
            z.object({
              categoryId: id,
              confidence: z.number().min(0).max(1),
              expectedTransactionUpdatedAt: z
                .string()
                .datetime()
                .describe("updatedAt returned by the accepted categorization proposal"),
              learnMerchant: z.enum(["never", "suggest"]).default("suggest"),
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
      annotations: consequentialMutationAnnotations,
      description:
        "Record an accepted category decision or defer a review case. Agents cannot confirm ambiguous transfers or create merchant rules; direct the user to Finance for those human-only decisions.",
      inputSchema: {
        action: z.enum(["approve", "defer", "recategorize"]),
        categoryId: id.optional(),
        id,
        learnMerchant: z.enum(["never", "suggest"]).default("suggest"),
        rationale: z.string().max(1_000).nullable().default(null),
      },
      title: "Resolve finance review",
    },
    async ({ id: reviewId, ...input }) => result(await api.resolveFinanceReview(reviewId, input)),
  );

  server.registerTool(
    "get_finance_overview",
    {
      annotations: readAnnotations,
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
      annotations: reviewedMutationAnnotations,
      description:
        "Add a manual Ilo transaction only after the user confirms the account, amount, date, direction, and merchant. This is not provider import. Omit category when uncertain so it enters review.",
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
}
