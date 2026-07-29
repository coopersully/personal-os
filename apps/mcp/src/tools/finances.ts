import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { z } from "zod";
import { apiResult } from "../tool-result.js";

const id = z.string().uuid().describe("ilo object identifier");
const readAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
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
    async () =>
      apiResult(async () => {
        const [context, profile] = await Promise.all([
          api.getFinanceGuidedSetup(),
          api.getDomainProfile("finances"),
        ]);
        return { context, profile };
      }),
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
    async () => apiResult(() => api.getFinanceWealthSummary()),
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
    async () =>
      apiResult(async () => {
        const [alerts, forecast, incomeStreams, profile, recurringObligations] = await Promise.all([
          api.listFinanceAlerts(),
          api.getFinanceForecast(),
          api.listFinanceIncomeStreams(),
          api.getFinanceProfile(),
          api.listFinanceRecurringObligations(),
        ]);
        return { alerts, forecast, incomeStreams, profile, recurringObligations };
      }),
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
    async () => apiResult(() => api.getFinanceLedgerHealth()),
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
    async (input) => apiResult(() => api.listFinanceTransactions(input)),
  );

  server.registerTool(
    "get_finance_categories",
    {
      annotations: readAnnotations,
      description:
        "List the user's stable finance categories before preparing a proposal. Applying a category requires the signed-in Finance surface.",
      inputSchema: {},
      title: "Get finance categories",
    },
    async () => apiResult(() => api.getFinanceCategories()),
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
    async ({ month }) => apiResult(() => api.getFinanceBudgetStatus(month)),
  );

  server.registerTool(
    "list_finance_merchants",
    {
      annotations: readAnnotations,
      description:
        "List canonical merchant display names and their raw provider aliases. Merchant renames and merges require the signed-in Finance surface.",
      inputSchema: { limit: z.number().int().min(1).max(200).default(50) },
      title: "List finance merchants",
    },
    async ({ limit }) => apiResult(() => api.listFinanceMerchants(limit)),
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
    async ({ limit }) => apiResult(() => api.getFinanceReviewQueue(limit)),
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
      apiResult(() => api.proposeFinanceCategorizations({ ...input, review: "needs_review" })),
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
    async () => apiResult(() => api.getFinanceOverview()),
  );
}
