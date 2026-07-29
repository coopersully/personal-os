import type {
  ApplyFinanceCategorizationsInput,
  CreateFinanceAccountInput,
  CreateFinanceBudgetInput,
  CreateFinanceTransactionInput,
  ExchangePlaidTokenInput,
  FinanceAccount,
  FinanceAlert,
  FinanceBudget,
  FinanceBudgetPace,
  FinanceBudgetPacePeriod,
  FinanceBudgetStatus,
  FinanceCategorizationApplyResult,
  FinanceCategorizationProposal,
  FinanceCategorizationProposalPage,
  FinanceCategory,
  FinanceCsvImportInput,
  FinanceExport,
  FinanceForecast,
  FinanceGuidedSetupContext,
  FinanceIncomeStream,
  FinanceLedgerHealth,
  FinanceMerchant,
  FinanceOverview,
  FinanceProfile,
  FinanceRecurringObligation,
  FinanceReviewCase,
  FinanceReviewDecisionInput,
  FinanceTransaction,
  FinanceTransactionQuery,
  FinanceTransactionUpdateReceipt,
  FinanceWealthSummary,
  MergeFinanceMerchantsInput,
  ResolveFinanceAlertInput,
  UpdateFinanceIncomeStreamInput,
  UpdateFinanceMerchantInput,
  UpdateFinanceProfileInput,
  UpdateFinanceRecurringObligationInput,
  UpdateFinanceTransactionInput,
} from "@personal-os/domain";

export type FinanceRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

/** Typed Finance operations sharing the authenticated client transport. */
export function createFinanceApi(request: FinanceRequest) {
  return {
    async applyFinanceCategorizations(
      input: ApplyFinanceCategorizationsInput,
    ): Promise<FinanceCategorizationApplyResult[]> {
      const response = await request<{ results: FinanceCategorizationApplyResult[] }>(
        "/v1/finances/categorizations/apply",
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      );
      return response.results;
    },
    async createFinanceAccount(input: CreateFinanceAccountInput): Promise<FinanceAccount> {
      const response = await request<{ account: FinanceAccount }>("/v1/finances/accounts", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.account;
    },
    async createFinanceBudget(input: CreateFinanceBudgetInput): Promise<FinanceBudget> {
      const response = await request<{ budget: FinanceBudget }>("/v1/finances/budgets", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.budget;
    },
    async createFinanceTransaction(
      input: CreateFinanceTransactionInput,
    ): Promise<FinanceTransaction> {
      const response = await request<{ transaction: FinanceTransaction }>(
        "/v1/finances/transactions",
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      );
      return response.transaction;
    },
    async deleteFinanceAccount(id: string): Promise<void> {
      await request<void>(`/v1/finances/accounts/${id}`, { method: "DELETE" });
    },
    async exchangePlaidToken(input: ExchangePlaidTokenInput): Promise<FinanceAccount[]> {
      const response = await request<{ accounts: FinanceAccount[] }>(
        "/v1/finances/plaid/exchange",
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      );
      return response.accounts;
    },
    async getFinanceOverview(): Promise<FinanceOverview> {
      const response = await request<{ overview: FinanceOverview }>("/v1/finances");
      return response.overview;
    },
    async getFinanceGuidedSetup(): Promise<FinanceGuidedSetupContext> {
      const response = await request<{ setup: FinanceGuidedSetupContext }>(
        "/v1/finances/guided-setup",
      );
      return response.setup;
    },
    async getFinanceOverviewForMonth(month: string): Promise<FinanceOverview> {
      const response = await request<{ overview: FinanceOverview }>(
        `/v1/finances?month=${encodeURIComponent(month)}`,
      );
      return response.overview;
    },
    async getFinanceOverviewForAccounts(
      month: string,
      accountIds: string[],
    ): Promise<FinanceOverview> {
      const params = new URLSearchParams({ accountIds: accountIds.join(","), month });
      const response = await request<{ overview: FinanceOverview }>(`/v1/finances?${params}`);
      return response.overview;
    },
    async getFinanceBudgetPace(period: FinanceBudgetPacePeriod): Promise<FinanceBudgetPace> {
      const response = await request<{ pace: FinanceBudgetPace }>(
        `/v1/finances/budgets/pace?period=${encodeURIComponent(period)}`,
      );
      return response.pace;
    },
    async getFinanceWealthSummary(): Promise<FinanceWealthSummary> {
      const response = await request<{ wealth: FinanceWealthSummary }>("/v1/finances/wealth");
      return response.wealth;
    },
    async getFinanceProfile(): Promise<FinanceProfile | null> {
      const response = await request<{ profile: FinanceProfile | null }>("/v1/finances/profile");
      return response.profile;
    },
    async updateFinanceProfile(input: UpdateFinanceProfileInput): Promise<FinanceProfile> {
      const response = await request<{ profile: FinanceProfile }>("/v1/finances/profile", {
        body: JSON.stringify(input),
        method: "PUT",
      });
      return response.profile;
    },
    async listFinanceIncomeStreams(): Promise<FinanceIncomeStream[]> {
      const response = await request<{ incomeStreams: FinanceIncomeStream[] }>(
        "/v1/finances/income-streams",
      );
      return response.incomeStreams;
    },
    async updateFinanceIncomeStream(
      id: string,
      input: UpdateFinanceIncomeStreamInput,
    ): Promise<FinanceIncomeStream> {
      const response = await request<{ incomeStream: FinanceIncomeStream }>(
        `/v1/finances/income-streams/${id}`,
        { body: JSON.stringify(input), method: "PATCH" },
      );
      return response.incomeStream;
    },
    async listFinanceRecurringObligations(): Promise<FinanceRecurringObligation[]> {
      const response = await request<{ recurring: FinanceRecurringObligation[] }>(
        "/v1/finances/recurring",
      );
      return response.recurring;
    },
    async updateFinanceRecurringObligation(
      id: string,
      input: UpdateFinanceRecurringObligationInput,
    ): Promise<FinanceRecurringObligation> {
      const response = await request<{ recurring: FinanceRecurringObligation }>(
        `/v1/finances/recurring/${id}`,
        { body: JSON.stringify(input), method: "PATCH" },
      );
      return response.recurring;
    },
    async getFinanceForecast(): Promise<FinanceForecast> {
      const response = await request<{ forecast: FinanceForecast }>("/v1/finances/forecast");
      return response.forecast;
    },
    async listFinanceAlerts(): Promise<FinanceAlert[]> {
      const response = await request<{ alerts: FinanceAlert[] }>("/v1/finances/alerts");
      return response.alerts;
    },
    async resolveFinanceAlert(id: string, input: ResolveFinanceAlertInput): Promise<FinanceAlert> {
      const response = await request<{ alert: FinanceAlert }>(`/v1/finances/alerts/${id}`, {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.alert;
    },
    async refreshFinanceInsights(): Promise<{ refreshed: boolean }> {
      const response = await request<{ result: { refreshed: boolean } }>(
        "/v1/finances/insights/refresh",
        { method: "POST" },
      );
      return response.result;
    },
    async getFinanceLedgerHealth(): Promise<FinanceLedgerHealth> {
      const response = await request<{ health: FinanceLedgerHealth }>("/v1/finances/health");
      return response.health;
    },
    async exportFinanceData(): Promise<FinanceExport> {
      const response = await request<{ export: FinanceExport }>("/v1/finances/export");
      return response.export;
    },
    async getFinanceCategories(): Promise<FinanceCategory[]> {
      const response = await request<{ categories: FinanceCategory[] }>("/v1/finances/categories");
      return response.categories;
    },
    async getFinanceBudgetStatus(month?: string): Promise<FinanceBudgetStatus[]> {
      const response = await request<{ budgets: FinanceBudgetStatus[] }>(
        `/v1/finances/budgets/status${month ? `?month=${encodeURIComponent(month)}` : ""}`,
      );
      return response.budgets;
    },
    async getFinanceReviewQueue(limit = 50): Promise<FinanceReviewCase[]> {
      const response = await request<{ reviews: FinanceReviewCase[] }>(
        `/v1/finances/review?limit=${limit}`,
      );
      return response.reviews;
    },
    async listFinanceTransactions(query: Partial<FinanceTransactionQuery> = {}): Promise<{
      items: FinanceTransaction[];
      nextCursor: string | null;
    }> {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) search.set(key, String(value));
      }
      return request(`/v1/finances/transactions${search.size ? `?${search}` : ""}`);
    },
    async listFinanceMerchants(limit = 50): Promise<FinanceMerchant[]> {
      const response = await request<{ merchants: FinanceMerchant[] }>(
        `/v1/finances/merchants?limit=${limit}`,
      );
      return response.merchants;
    },
    async mergeFinanceMerchants(input: MergeFinanceMerchantsInput): Promise<FinanceMerchant> {
      const response = await request<{ merchant: FinanceMerchant }>(
        "/v1/finances/merchants/merge",
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      );
      return response.merchant;
    },
    async proposeFinanceCategorizations(
      query: Partial<FinanceTransactionQuery> = {},
    ): Promise<FinanceCategorizationProposalPage> {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) search.set(key, String(value));
      }
      const response = await request<{
        nextCursor: string | null;
        proposals: FinanceCategorizationProposal[];
      }>(`/v1/finances/categorizations/propose${search.size ? `?${search}` : ""}`);
      return { items: response.proposals, nextCursor: response.nextCursor };
    },
    async getPlaidLinkToken(): Promise<string> {
      const response = await request<{ linkToken: string }>("/v1/finances/plaid/link-token", {
        method: "POST",
      });
      return response.linkToken;
    },
    async getPlaidStatus(): Promise<{ available: boolean }> {
      return request<{ available: boolean }>("/v1/finances/plaid/status");
    },
    async importFinanceCsv(
      input: FinanceCsvImportInput,
    ): Promise<{ imported: number; skipped: number }> {
      const response = await request<{ result: { imported: number; skipped: number } }>(
        `/v1/finances/accounts/${input.accountId}/import`,
        { body: JSON.stringify(input), method: "POST" },
      );
      return response.result;
    },
    async syncFinanceAccount(id: string): Promise<number> {
      const response = await request<{ result: { changed: number } }>(
        `/v1/finances/accounts/${id}/sync`,
        { method: "POST" },
      );
      return response.result.changed;
    },
    async resolveFinanceReview(id: string, input: FinanceReviewDecisionInput) {
      const response = await request<{
        result:
          | { deferred: true }
          | { applied: boolean; threshold: number; transaction: FinanceTransaction };
      }>(`/v1/finances/review/${id}`, { body: JSON.stringify(input), method: "POST" });
      return response.result;
    },
    async updateFinanceTransaction(
      id: string,
      input: UpdateFinanceTransactionInput,
    ): Promise<FinanceTransaction | FinanceTransactionUpdateReceipt> {
      const response = await request<{
        transaction: FinanceTransaction | FinanceTransactionUpdateReceipt;
      }>(`/v1/finances/transactions/${id}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return response.transaction;
    },
    async updateFinanceMerchant(
      id: string,
      input: UpdateFinanceMerchantInput,
    ): Promise<FinanceMerchant> {
      const response = await request<{ merchant: FinanceMerchant }>(
        `/v1/finances/merchants/${id}`,
        {
          body: JSON.stringify(input),
          method: "PATCH",
        },
      );
      return response.merchant;
    },
  };
}
