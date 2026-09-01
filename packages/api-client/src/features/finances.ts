import type {
  AnswerFinanceReviewInput,
  ApplyFinanceCategorizationsInput,
  ApproveFinanceBudgetInput,
  AttentionItem,
  ClassifyFinanceTransactionsInput,
  CreateFinanceAccountInput,
  CreateFinanceBudgetBucketInput,
  CreateFinanceBudgetInput,
  CreateFinanceBudgetVersionInput,
  CreateFinanceTransactionInput,
  DisconnectFinanceAccountInput,
  ExchangePlaidTokenInput,
  FinanceAccount,
  FinanceAccountConnection,
  FinanceAccountList,
  FinanceAccountQuery,
  FinanceActionOutcome,
  FinanceActionReview,
  FinanceAlert,
  FinanceAutomationSettings,
  FinanceBudget,
  FinanceBudgetBucketList,
  FinanceBudgetPace,
  FinanceBudgetPacePeriod,
  FinanceBudgetPlan,
  FinanceBudgetStatus,
  FinanceBudgetVersion,
  FinanceCategorizationApplyResult,
  FinanceCategorizationProposal,
  FinanceCategorizationProposalPage,
  FinanceCategory,
  FinanceCsvImportInput,
  FinanceExport,
  FinanceForecast,
  FinanceGoal,
  FinanceGuidedSetupContext,
  FinanceInboxCase,
  FinanceIncomeStream,
  FinanceLedgerChallenge,
  FinanceLedgerChallengePage,
  FinanceLedgerHealth,
  FinanceMaintenanceHistoryQuery,
  FinanceMaintenanceInput,
  FinanceMaintenancePayload,
  FinanceMerchant,
  FinanceOverview,
  FinancePeriodReview,
  FinancePlaybookResponse,
  FinanceProfile,
  FinanceProfileVersion,
  FinanceQuestion,
  FinanceReceiptReview,
  FinanceReceiptReviewInput,
  FinanceRecurringObligation,
  FinanceReimbursement,
  FinanceReimbursementQuestionAnswer,
  FinanceReviewCase,
  FinanceReviewDecisionInput,
  FinanceRule,
  FinanceScenarioInput,
  FinanceScenarioResult,
  FinanceSetupInput,
  FinanceSetupPayload,
  FinanceSnapshot,
  FinanceStatus,
  FinanceToolResult,
  FinanceTransaction,
  FinanceTransactionQuery,
  FinanceTransactionRelationship,
  FinanceWealthSummary,
  LinkFinanceTransactionsInput,
  MaintenanceRun,
  MaintenanceScope,
  ManageFinanceGoalInput,
  ManageFinanceRecurringItemInput,
  ManageFinanceRuleInput,
  MergeFinanceMerchantsInput,
  ReconcileFinanceReimbursementInput,
  RemoveFinanceTransactionInput,
  ResolveFinanceAlertInput,
  ReviseFinanceBudgetInput,
  SetFinanceBudgetPlanInput,
  SetFinanceTransactionBreakdownInput,
  SplitFinanceTransactionInput,
  StartFinanceAccountConnectionInput,
  SubmitFinanceLedgerChallengeInput,
  UpdateFinanceAccountInput,
  UpdateFinanceAutomationSettingsInput,
  UpdateFinanceBudgetBucketInput,
  UpdateFinanceIncomeStreamInput,
  UpdateFinanceMerchantInput,
  UpdateFinanceProfileInput,
  UpdateFinanceRecurringObligationInput,
  UpdateFinanceTransactionInput,
  UpdateFinancialProfileInput,
  UpsertFinanceAttentionItemInput,
} from "@personal-os/domain";
import {
  financeLedgerChallengePageSchema,
  financeLedgerChallengeSchema,
  financePeriodReviewSchema,
  financeStatusSchema,
  maintenanceRunSchema,
} from "@personal-os/domain";

export type FinanceRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

type FinanceActionResponse<T> = FinanceActionOutcome<T>;

/** Preserve a human result while honestly forwarding an agent action disposition. */
function actionResult<T, Key extends string>(
  response: FinanceActionResponse<T> | Record<Key, T>,
  legacyKey: Key,
): FinanceActionOutcome<T> | T {
  return "status" in response ? response : response[legacyKey];
}

/** Typed Finance operations sharing the authenticated client transport. */
export function createFinanceApi(request: FinanceRequest) {
  function createFinanceBudget(
    input: CreateFinanceBudgetInput,
  ): Promise<FinanceActionOutcome<FinanceBudget> | FinanceBudget>;
  function createFinanceBudget(
    input: CreateFinanceBudgetVersionInput,
  ): Promise<FinanceToolResult<FinanceBudgetVersion>>;
  async function createFinanceBudget(
    input: CreateFinanceBudgetInput | CreateFinanceBudgetVersionInput,
  ): Promise<
    FinanceActionOutcome<FinanceBudget> | FinanceBudget | FinanceToolResult<FinanceBudgetVersion>
  > {
    if ("resources" in input) {
      return request<FinanceToolResult<FinanceBudgetVersion>>("/v1/finances/budget-plans", {
        body: JSON.stringify(input),
        method: "POST",
      });
    }
    const response = await request<
      FinanceActionResponse<FinanceBudget> | { budget: FinanceBudget }
    >("/v1/finances/budgets", {
      body: JSON.stringify(input),
      method: "POST",
    });
    return actionResult(response, "budget");
  }

  return {
    async reviewFinanceReceipt(
      id: string,
      input: FinanceReceiptReviewInput,
    ): Promise<FinanceReceiptReview> {
      const response = await request<{ review: FinanceReceiptReview }>(
        `/v1/finances/transactions/${encodeURIComponent(id)}/receipt-review`,
        { body: JSON.stringify(input), method: "POST" },
      );
      return response.review;
    },
    createFinanceBudget,
    async setupFinances(input: FinanceSetupInput): Promise<FinanceToolResult<FinanceSetupPayload>> {
      return request("/v1/finances/setup", {
        body: JSON.stringify(input),
        method: "POST",
      });
    },
    async applyFinanceCategorizations(
      input: ApplyFinanceCategorizationsInput,
    ): Promise<
      FinanceActionOutcome<FinanceCategorizationApplyResult[]> | FinanceCategorizationApplyResult[]
    > {
      const response = await request<
        | FinanceActionResponse<FinanceCategorizationApplyResult[]>
        | {
            results: FinanceCategorizationApplyResult[];
          }
      >("/v1/finances/categorizations/apply", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return actionResult(response, "results");
    },
    async createFinanceAccount(input: CreateFinanceAccountInput): Promise<FinanceAccount> {
      const response = await request<{ account: FinanceAccount }>("/v1/finances/accounts", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.account;
    },
    async listFinanceAccounts(
      query: Partial<FinanceAccountQuery> = {},
    ): Promise<FinanceAccountList> {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) search.set(key, String(value));
      }
      return request(`/v1/finances/accounts${search.size ? `?${search}` : ""}`);
    },
    async approveFinanceBudget(
      input: ApproveFinanceBudgetInput,
    ): Promise<FinanceToolResult<FinanceBudgetVersion>> {
      return request(
        `/v1/finances/budget-versions/${encodeURIComponent(input.budgetVersionId)}/approve`,
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      );
    },
    async createFinanceTransaction(
      input: CreateFinanceTransactionInput,
    ): Promise<FinanceActionOutcome<FinanceTransaction> | FinanceTransaction> {
      const response = await request<
        FinanceActionResponse<FinanceTransaction> | { transaction: FinanceTransaction }
      >("/v1/finances/transactions", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return actionResult(response, "transaction");
    },
    async deleteFinanceAccount(id: string): Promise<void> {
      await request<void>(`/v1/finances/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
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
    async getFinanceAutomationSettings(): Promise<FinanceAutomationSettings> {
      const response = await request<{ settings: FinanceAutomationSettings }>(
        "/v1/finances/automation-settings",
      );
      return response.settings;
    },
    async updateFinanceAutomationSettings(
      input: UpdateFinanceAutomationSettingsInput,
    ): Promise<FinanceAutomationSettings> {
      const response = await request<{ settings: FinanceAutomationSettings }>(
        "/v1/finances/automation-settings",
        { body: JSON.stringify(input), method: "PATCH" },
      );
      return response.settings;
    },
    async getFinanceGuidedSetup(): Promise<FinanceGuidedSetupContext> {
      const response = await request<{ setup: FinanceGuidedSetupContext }>(
        "/v1/finances/guided-setup",
      );
      return response.setup;
    },
    async getFinanceStatus(scope?: MaintenanceScope): Promise<FinanceStatus> {
      const response = await request<{ status: unknown }>(
        `/v1/finances/status${financeMaintenanceScopeQuery(scope)}`,
      );
      return financeStatusSchema.parse(response.status);
    },
    async getFinanceSnapshot(): Promise<FinanceToolResult<FinanceSnapshot>> {
      return request("/v1/finances/snapshot");
    },
    async compareFinanceScenarios(input: FinanceScenarioInput): Promise<FinanceScenarioResult> {
      const response = await request<{ scenario: FinanceScenarioResult }>(
        "/v1/finances/scenarios/compare",
        { body: JSON.stringify(input), method: "POST" },
      );
      return response.scenario;
    },
    async setFinanceBudgetPlan(
      input: SetFinanceBudgetPlanInput,
    ): Promise<FinanceActionOutcome<FinanceBudgetPlan> | FinanceBudgetPlan> {
      const response = await request<
        FinanceActionResponse<FinanceBudgetPlan> | { plan: FinanceBudgetPlan }
      >("/v1/finances/budget-plan", {
        body: JSON.stringify(input),
        method: "PUT",
      });
      return actionResult(response, "plan");
    },
    async setFinanceTransactionBreakdown(
      id: string,
      input: SetFinanceTransactionBreakdownInput,
    ): Promise<FinanceActionOutcome<FinanceTransaction> | FinanceTransaction> {
      const response = await request<
        FinanceActionResponse<FinanceTransaction> | { transaction: FinanceTransaction }
      >(`/v1/finances/transactions/${encodeURIComponent(id)}/breakdown`, {
        body: JSON.stringify(input),
        method: "PUT",
      });
      return actionResult(response, "transaction");
    },
    async listFinanceReimbursements(): Promise<{
      reimbursements: FinanceReimbursement[];
      unmatchedCredits: Array<{ amount: number; date: string; transactionId: string }>;
    }> {
      const response = await request<{
        reimbursements: {
          reimbursements: FinanceReimbursement[];
          unmatchedCredits: Array<{ amount: number; date: string; transactionId: string }>;
        };
      }>("/v1/finances/reimbursements");
      return response.reimbursements;
    },
    async reconcileFinanceReimbursement(
      input: ReconcileFinanceReimbursementInput,
    ): Promise<FinanceActionOutcome<FinanceReimbursement> | FinanceReimbursement> {
      const response = await request<
        FinanceActionResponse<FinanceReimbursement> | { reimbursement: FinanceReimbursement }
      >("/v1/finances/reimbursements/reconcile", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return actionResult(response, "reimbursement");
    },
    async startFinanceMaintenance(
      scope: MaintenanceScope = { type: "all_outstanding" },
    ): Promise<MaintenanceRun> {
      const response = await request<{ run: unknown }>("/v1/finances/maintenance", {
        body: JSON.stringify({ scope }),
        method: "POST",
      });
      return maintenanceRunSchema.parse(response.run);
    },
    async getWorkspaceFinanceMaintenanceRun(id: string): Promise<MaintenanceRun> {
      const response = await request<{ run: unknown }>(
        `/v1/finances/maintenance/${encodeURIComponent(id)}`,
      );
      return maintenanceRunSchema.parse(response.run);
    },
    async getFinanceLedgerChallenge(
      id: string,
      cursor?: string,
    ): Promise<FinanceLedgerChallengePage> {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const response = await request<{ page: unknown }>(
        `/v1/finances/maintenance/challenges/${encodeURIComponent(id)}${query}`,
      );
      return financeLedgerChallengePageSchema.parse(response.page);
    },
    async submitFinanceLedgerChallenge(
      input: SubmitFinanceLedgerChallengeInput,
    ): Promise<FinanceLedgerChallenge> {
      const response = await request<{ challenge: unknown }>(
        `/v1/finances/maintenance/challenges/${encodeURIComponent(input.challengeId)}/submit`,
        { body: JSON.stringify(input), method: "POST" },
      );
      return financeLedgerChallengeSchema.parse(response.challenge);
    },
    async getFinancePeriodReview(id: string): Promise<FinancePeriodReview> {
      const response = await request<{ review: unknown }>(
        `/v1/finances/period-reviews/${encodeURIComponent(id)}`,
      );
      return financePeriodReviewSchema.parse(response.review);
    },
    async getFinancePeriodReviewPresentation(
      id: string,
    ): Promise<FinanceToolResult<FinancePeriodReview>> {
      return request(`/v1/finances/period-reviews/${encodeURIComponent(id)}/presentation`);
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
    async getFinancePlaybook(): Promise<FinancePlaybookResponse> {
      return request("/v1/finances/playbook");
    },
    async getFinanceProfile(): Promise<FinanceProfile | null> {
      const response = await request<{ profile: FinanceProfile | null }>("/v1/finances/profile");
      return response.profile;
    },
    async getFinancialProfile(): Promise<FinanceToolResult<FinanceProfileVersion | null>> {
      return request("/v1/finances/profile/current");
    },
    async updateFinancialProfile(
      input: UpdateFinancialProfileInput,
    ): Promise<FinanceToolResult<FinanceProfileVersion>> {
      return request("/v1/finances/profile", {
        body: JSON.stringify(input),
        method: "PATCH",
      });
    },
    async getFinanceBudget(
      planId?: string,
    ): Promise<FinanceToolResult<FinanceBudgetVersion | null>> {
      return request(
        `/v1/finances/budget-plans${planId ? `?planId=${encodeURIComponent(planId)}` : ""}`,
      );
    },
    async reviseFinanceBudget(
      input: ReviseFinanceBudgetInput,
    ): Promise<FinanceToolResult<FinanceBudgetVersion>> {
      return request(`/v1/finances/budget-plans/${encodeURIComponent(input.planId)}/revisions`, {
        body: JSON.stringify(input),
        method: "POST",
      });
    },
    async getCanonicalFinanceBudgetStatus(): Promise<
      FinanceToolResult<FinanceBudgetVersion | null>
    > {
      return request("/v1/finances/budget-status");
    },
    async listFinanceGoals(): Promise<FinanceToolResult<FinanceGoal[]>> {
      return request("/v1/finances/goals");
    },
    async manageFinanceGoal(
      input: ManageFinanceGoalInput,
    ): Promise<FinanceToolResult<FinanceGoal>> {
      return request("/v1/finances/goals", {
        body: JSON.stringify(input),
        method: "POST",
      });
    },
    async updateFinanceProfile(
      input: UpdateFinanceProfileInput,
    ): Promise<FinanceActionOutcome<FinanceProfile> | FinanceProfile> {
      const response = await request<
        FinanceActionResponse<FinanceProfile> | { profile: FinanceProfile }
      >("/v1/finances/profile", {
        body: JSON.stringify(input),
        method: "PUT",
      });
      return actionResult(response, "profile");
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
    ): Promise<FinanceActionOutcome<FinanceIncomeStream> | FinanceIncomeStream> {
      const response = await request<
        FinanceActionResponse<FinanceIncomeStream> | { incomeStream: FinanceIncomeStream }
      >(`/v1/finances/income-streams/${encodeURIComponent(id)}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return actionResult(response, "incomeStream");
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
    ): Promise<FinanceActionOutcome<FinanceRecurringObligation> | FinanceRecurringObligation> {
      const response = await request<
        | FinanceActionResponse<FinanceRecurringObligation>
        | {
            recurring: FinanceRecurringObligation;
          }
      >(`/v1/finances/recurring/${encodeURIComponent(id)}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return actionResult(response, "recurring");
    },
    async getFinanceForecast(): Promise<FinanceForecast> {
      const response = await request<{ forecast: FinanceForecast }>("/v1/finances/forecast");
      return response.forecast;
    },
    async listFinanceAlerts(): Promise<FinanceAlert[]> {
      const response = await request<{ alerts: FinanceAlert[] }>("/v1/finances/alerts");
      return response.alerts;
    },
    async resolveFinanceAlert(
      id: string,
      input: ResolveFinanceAlertInput,
    ): Promise<FinanceActionOutcome<FinanceAlert> | FinanceAlert> {
      const response = await request<FinanceActionResponse<FinanceAlert> | { alert: FinanceAlert }>(
        `/v1/finances/alerts/${encodeURIComponent(id)}`,
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      );
      return actionResult(response, "alert");
    },
    async refreshFinanceInsights(): Promise<
      FinanceActionOutcome<{ refreshed: boolean }> | { refreshed: boolean }
    > {
      const response = await request<
        FinanceActionResponse<{ refreshed: boolean }> | { result: { refreshed: boolean } }
      >("/v1/finances/insights/refresh", {
        method: "POST",
      });
      return actionResult(response, "result");
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
    async listFinanceBudgetBuckets(month?: string): Promise<FinanceBudgetBucketList> {
      const query = month ? `?month=${encodeURIComponent(month)}` : "";
      return request(`/v1/finances/budget-buckets${query}`);
    },
    async createFinanceBudgetBucket(
      input: CreateFinanceBudgetBucketInput,
    ): Promise<
      | FinanceActionOutcome<NonNullable<FinanceBudgetBucketList["taxonomy"]>>
      | NonNullable<FinanceBudgetBucketList["taxonomy"]>
    > {
      return request(`/v1/finances/budget-buckets`, {
        body: JSON.stringify(input),
        method: "POST",
      });
    },
    async updateFinanceBudgetBucket(
      id: string,
      input: Omit<UpdateFinanceBudgetBucketInput, "bucketId">,
    ): Promise<
      | FinanceActionOutcome<NonNullable<FinanceBudgetBucketList["taxonomy"]>>
      | NonNullable<FinanceBudgetBucketList["taxonomy"]>
    > {
      return request(`/v1/finances/budget-buckets/${encodeURIComponent(id)}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
    },
    async getFinanceBudgetStatus(month?: string): Promise<FinanceBudgetStatus[]> {
      const response = await request<{ budgets: FinanceBudgetStatus[] }>(
        `/v1/finances/budgets/status${month ? `?month=${encodeURIComponent(month)}` : ""}`,
      );
      return response.budgets;
    },
    async getFinanceReviewQueue(limit = 50): Promise<FinanceReviewCase[]> {
      const response = await request<{ reviews: FinanceReviewCase[] }>(
        `/v1/finances/review?limit=${encodeURIComponent(limit)}`,
      );
      return response.reviews;
    },
    async getFinanceInbox(): Promise<FinanceToolResult<FinanceInboxCase[]>> {
      return request("/v1/finances/inbox");
    },
    async answerFinanceReview(
      id: string,
      input: AnswerFinanceReviewInput,
    ): Promise<FinanceToolResult<FinanceInboxCase[]>> {
      return request(`/v1/finances/inbox/${encodeURIComponent(id)}/answer`, {
        body: JSON.stringify(input),
        method: "POST",
      });
    },
    async maintainFinances(
      input: FinanceMaintenanceInput,
    ): Promise<FinanceToolResult<FinanceMaintenancePayload>> {
      return request("/v1/finances/maintenance/protocol", {
        body: JSON.stringify(input),
        method: "POST",
      });
    },
    async getFinanceMaintenanceHistory(
      query: Partial<FinanceMaintenanceHistoryQuery> = {},
    ): Promise<{
      items: FinanceMaintenancePayload[];
      nextCursor: string | null;
    }> {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) search.set(key, String(value));
      }
      return request(`/v1/finances/maintenance${search.size ? `?${search}` : ""}`);
    },
    async getFinanceMaintenanceRun(id: string): Promise<FinanceMaintenancePayload> {
      return request(`/v1/finances/maintenance/protocol/${encodeURIComponent(id)}`);
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
    async getFinanceAccountConnection(
      id: string,
    ): Promise<FinanceToolResult<FinanceAccountConnection>> {
      return request(`/v1/finances/account-connections/${encodeURIComponent(id)}`);
    },
    async startFinanceAccountConnection(
      input: StartFinanceAccountConnectionInput,
    ): Promise<FinanceToolResult<FinanceAccountConnection>> {
      return request("/v1/finances/account-connections", {
        body: JSON.stringify(input),
        method: "POST",
      });
    },
    async updateFinanceAccount(
      id: string,
      input: UpdateFinanceAccountInput,
    ): Promise<FinanceToolResult<FinanceAccount>> {
      return request(`/v1/finances/accounts/${encodeURIComponent(id)}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
    },
    async disconnectFinanceAccount(
      id: string,
      input: DisconnectFinanceAccountInput,
    ): Promise<FinanceToolResult<FinanceAccount>> {
      return request(`/v1/finances/accounts/${encodeURIComponent(id)}/disconnect`, {
        body: JSON.stringify(input),
        method: "POST",
      });
    },
    async getFinanceTransaction(id: string): Promise<FinanceToolResult<FinanceTransaction>> {
      return request(`/v1/finances/transactions/${encodeURIComponent(id)}`);
    },
    async removeFinanceTransaction(
      id: string,
      input: RemoveFinanceTransactionInput,
    ): Promise<FinanceToolResult<{ id: string; removed: true }>> {
      return request(`/v1/finances/transactions/${encodeURIComponent(id)}/remove`, {
        body: JSON.stringify(input),
        method: "POST",
      });
    },
    async splitFinanceTransaction(
      input: SplitFinanceTransactionInput,
    ): Promise<FinanceToolResult<FinanceTransaction[]>> {
      return request("/v1/finances/transactions/split", {
        body: JSON.stringify(input),
        method: "POST",
      });
    },
    async classifyFinanceTransactions(
      input: ClassifyFinanceTransactionsInput,
    ): Promise<FinanceToolResult<FinanceTransaction[]>> {
      return request("/v1/finances/transactions/classify", {
        body: JSON.stringify(input),
        method: "POST",
      });
    },
    async linkFinanceTransactions(
      input: LinkFinanceTransactionsInput,
    ): Promise<FinanceToolResult<FinanceTransactionRelationship>> {
      return request("/v1/finances/transactions/link", {
        body: JSON.stringify(input),
        method: "POST",
      });
    },
    async listFinanceRules(): Promise<FinanceToolResult<FinanceRule[]>> {
      return request("/v1/finances/rules");
    },
    async manageFinanceRule(
      input: ManageFinanceRuleInput,
    ): Promise<FinanceToolResult<FinanceRule | { id: string; removed: true }>> {
      return request("/v1/finances/rules", {
        body: JSON.stringify(input),
        method: "POST",
      });
    },
    async listFinanceRecurringItems(): Promise<
      FinanceToolResult<{
        income: FinanceIncomeStream[];
        obligations: FinanceRecurringObligation[];
      }>
    > {
      return request("/v1/finances/recurring-items");
    },
    async manageFinanceRecurringItem(
      input: ManageFinanceRecurringItemInput,
    ): Promise<FinanceToolResult<FinanceIncomeStream | FinanceRecurringObligation>> {
      return request("/v1/finances/recurring-items", {
        body: JSON.stringify(input),
        method: "POST",
      });
    },
    async listFinanceMerchants(limit = 50): Promise<FinanceMerchant[]> {
      const response = await request<{ merchants: FinanceMerchant[] }>(
        `/v1/finances/merchants?limit=${encodeURIComponent(limit)}`,
      );
      return response.merchants;
    },
    async mergeFinanceMerchants(
      input: MergeFinanceMerchantsInput,
    ): Promise<FinanceActionOutcome<FinanceMerchant> | FinanceMerchant> {
      const response = await request<
        FinanceActionResponse<FinanceMerchant> | { merchant: FinanceMerchant }
      >("/v1/finances/merchants/merge", {
        body: JSON.stringify(input),
        method: "POST",
      });
      return actionResult(response, "merchant");
    },
    async mergeFinanceMerchantsCanonical(
      input: MergeFinanceMerchantsInput & { idempotencyKey: string },
    ): Promise<FinanceToolResult<unknown>> {
      return request("/v1/finances/merchants/merge/canonical", {
        body: JSON.stringify(input),
        method: "POST",
      });
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
        `/v1/finances/accounts/${encodeURIComponent(input.accountId)}/import`,
        { body: JSON.stringify(input), method: "POST" },
      );
      return response.result;
    },
    async importFinanceTransactions(
      input: FinanceCsvImportInput & { idempotencyKey: string },
    ): Promise<FinanceToolResult<unknown>> {
      return request(
        `/v1/finances/accounts/${encodeURIComponent(input.accountId)}/import/canonical`,
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      );
    },
    async syncFinanceAccount(id: string): Promise<number> {
      const response = await request<{ result: { changed: number } }>(
        `/v1/finances/accounts/${encodeURIComponent(id)}/sync`,
        { method: "POST" },
      );
      return response.result.changed;
    },
    async resolveFinanceReview(id: string, input: FinanceReviewDecisionInput) {
      const response = await request<{
        result:
          | { deferred: true }
          | { applied: boolean; threshold: number; transaction: FinanceTransaction };
      }>(`/v1/finances/review/${encodeURIComponent(id)}`, {
        body: JSON.stringify(input),
        method: "POST",
      });
      return response.result;
    },
    /** Answer a Finance question; this cannot change bypass or approve a queued action. */
    async answerFinanceQuestion(
      id: string,
      answer: string | FinanceReimbursementQuestionAnswer,
    ): Promise<FinanceActionOutcome<unknown>> {
      const response = await request<{ outcome: FinanceActionOutcome<unknown> }>(
        `/v1/finances/questions/${encodeURIComponent(id)}/answer`,
        {
          // Existing question types use their established JSON string. Typed
          // reimbursement answers are nested under the generic bounded
          // `answer` field rather than flattened into a prior action input.
          body: JSON.stringify({
            answer: typeof answer === "string" ? answer : JSON.stringify({ answer }),
          }),
          method: "POST",
        },
      );
      return response.outcome;
    },
    async listFinanceActionReviews(limit = 50): Promise<FinanceActionReview[]> {
      const response = await request<{ reviews: FinanceActionReview[] }>(
        `/v1/finances/action-reviews?limit=${encodeURIComponent(limit)}`,
      );
      return response.reviews;
    },
    async listFinanceQuestions(limit = 50): Promise<FinanceQuestion[]> {
      const response = await request<{ questions: FinanceQuestion[] }>(
        `/v1/finances/questions?limit=${encodeURIComponent(limit)}`,
      );
      return response.questions;
    },
    async approveFinanceActionReview(id: string): Promise<FinanceActionOutcome<unknown>> {
      const response = await request<{ outcome: FinanceActionOutcome<unknown> }>(
        `/v1/finances/action-reviews/${encodeURIComponent(id)}/approve`,
        { method: "POST" },
      );
      return response.outcome;
    },
    async dismissFinanceActionReview(id: string): Promise<FinanceActionReview> {
      const response = await request<{ review: FinanceActionReview }>(
        `/v1/finances/action-reviews/${encodeURIComponent(id)}/dismiss`,
        { method: "POST" },
      );
      return response.review;
    },
    async updateFinanceTransaction(
      id: string,
      input: UpdateFinanceTransactionInput,
    ): Promise<FinanceActionOutcome<FinanceTransaction> | FinanceTransaction> {
      const response = await request<
        FinanceActionResponse<FinanceTransaction> | { transaction: FinanceTransaction }
      >(`/v1/finances/transactions/${encodeURIComponent(id)}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return actionResult(response, "transaction");
    },
    async upsertFinanceAttentionItem(
      transactionId: string,
      input: UpsertFinanceAttentionItemInput,
    ): Promise<AttentionItem> {
      const response = await request<{ item: AttentionItem }>(
        `/v1/finances/transactions/${encodeURIComponent(transactionId)}/attention`,
        { body: JSON.stringify(input), method: "PUT" },
      );
      return response.item;
    },
    async updateFinanceTransactionCanonical(
      id: string,
      input: UpdateFinanceTransactionInput & { idempotencyKey: string },
    ): Promise<FinanceToolResult<unknown>> {
      return request(`/v1/finances/transactions/${encodeURIComponent(id)}/canonical`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
    },
    async updateFinanceMerchant(
      id: string,
      input: UpdateFinanceMerchantInput,
    ): Promise<FinanceActionOutcome<FinanceMerchant> | FinanceMerchant> {
      const response = await request<
        FinanceActionResponse<FinanceMerchant> | { merchant: FinanceMerchant }
      >(`/v1/finances/merchants/${encodeURIComponent(id)}`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
      return actionResult(response, "merchant");
    },
    async updateFinanceMerchantCanonical(
      id: string,
      input: UpdateFinanceMerchantInput & { idempotencyKey: string },
    ): Promise<FinanceToolResult<unknown>> {
      return request(`/v1/finances/merchants/${encodeURIComponent(id)}/canonical`, {
        body: JSON.stringify(input),
        method: "PATCH",
      });
    },
  };
}

function financeMaintenanceScopeQuery(scope?: MaintenanceScope): string {
  if (!scope || scope.type === "all_outstanding") return "";
  const parameters = new URLSearchParams();
  if (scope.type === "window") {
    parameters.set("start", scope.start);
    parameters.set("end", scope.end);
  } else {
    parameters.set("entityType", scope.entityType);
    parameters.set("targetId", scope.id);
  }
  return `?${parameters}`;
}
