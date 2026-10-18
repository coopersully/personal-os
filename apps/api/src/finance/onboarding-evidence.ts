import {
  accessTokens,
  automationHostSchedules,
  type Database,
  financeGoals,
} from "@personal-os/database";
import {
  automationHostScheduleSchema,
  type FinanceAccount,
  type FinanceConversationReadiness,
  type FinanceOnboardingQuestionReview,
  type FinanceProfileVersion,
  type WorkspaceSettings,
} from "@personal-os/domain";
import { and, eq } from "drizzle-orm";
import { activeHostConnectionGrant } from "../automation-host-grant.js";
import { AppError } from "../errors.js";
import type { FinanceOnboardingEvidence } from "../finance-onboarding-service.js";
import { requireWorkspaceExecution } from "../workspace-execution.js";
import { createWorkspaceSettingsService } from "../workspace-settings/service.js";
import { createFinanceAccountService } from "./account-service.js";
import type { FinanceTransaction } from "./context.js";
import { createFinanceConversationService } from "./conversation-persistence.js";
import { createProfileBudgetService } from "./profile-budget-service.js";
import { availableSetupQuestions } from "./setup-service.js";

type Goal = Pick<typeof financeGoals.$inferSelect, "name" | "priority" | "status">;
export interface FinanceOnboardingEvidenceInput {
  profile: FinanceProfileVersion | null;
  accounts: FinanceAccount[];
  preferences: WorkspaceSettings<"finances">["preferences"];
  goals: Goal[];
  existingAccess: boolean;
  registrationCount: number;
  authorizedRegistrationWithCadence: boolean;
  chat: FinanceConversationReadiness | null;
}

const essentialIds = new Set([
  "profile:location",
  "profile:household_size",
  "profile:monthly_take_home",
  "profile:liquid_reserves",
  "profile:income_stability",
  "profile:debts",
  "planning:obligations",
]);
const essentialQuestions = availableSetupQuestions(null).filter((question) =>
  essentialIds.has(question.id),
);
function reviewedValue(input: FinanceOnboardingEvidenceInput, id: string): string | null {
  const p = input.profile;
  if (!p) return null;
  switch (id) {
    case "profile:location":
      return p.jurisdiction;
    case "profile:household_size":
      return p.householdSize === null ? null : `${p.householdSize} people`;
    case "profile:monthly_take_home":
      return p.expectedMonthlyTakeHome === null
        ? null
        : `${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(p.expectedMonthlyTakeHome)} monthly take-home`;
    case "profile:liquid_reserves":
      return p.liquidReserves === null
        ? null
        : `${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(p.liquidReserves)} in liquid reserves`;
    case "profile:income_stability":
      return p.incomeStability === "unknown" ? null : p.incomeStability;
    case "profile:debts":
      return p.provenance.debts
        ? p.debts.length
          ? p.debts.map((debt) => debt.name).join(", ")
          : "No debts"
        : null;
    case "planning:obligations":
      return p.planning?.obligations === null || p.planning?.obligations === undefined
        ? null
        : p.planning.obligations.length
          ? p.planning.obligations.map((item) => item.name).join(", ")
          : "No bills or debt minimums";
    default:
      return null;
  }
}
function source(accounts: FinanceAccount[]): FinanceOnboardingEvidence["source"] {
  const included = accounts.filter((account) => account.includeInPlanning);
  const owned = included.filter(
    (account) =>
      (account.ownershipType === "individual" && account.ownershipShare === 1) ||
      (account.ownershipType === "joint" &&
        account.ownershipShare !== null &&
        account.ownershipShare > 0),
  );
  const usable = owned.filter(
    (account) => account.status !== "needs_reauth" && account.synchronization.state !== "blocked",
  );
  const current = usable.find(
    (account) => account.status === "manual" || account.synchronization.state === "current",
  );
  if (current)
    return {
      state: "usable",
      summary: `${current.name} is included with confirmed ownership.`,
      recoveryHref: "/finances/accounts",
    };
  if (usable.length)
    return {
      state: "syncing",
      summary: `${usable[0]?.name} is included; source data is not current yet.`,
      recoveryHref: "/finances/accounts",
    };
  if (
    included.some(
      (account) => account.ownershipType === "unknown" || account.ownershipShare === null,
    )
  )
    return {
      state: "ownership_required",
      summary: "Confirm ownership and your share for an included account.",
      recoveryHref: "/finances/accounts",
    };
  if (owned.length)
    return {
      state: "unavailable",
      summary: "Your included sources need reconnection or synchronization recovery.",
      recoveryHref: "/finances/accounts",
    };
  return {
    state: "missing",
    summary: "Include an account or manual source to continue.",
    recoveryHref: "/finances/accounts",
  };
}

/** Canonical facts only; this projection cannot write setup progress or grant Chat capability. */
export function projectFinanceOnboardingEvidence(
  input: FinanceOnboardingEvidenceInput,
): FinanceOnboardingEvidence {
  const questions: FinanceOnboardingQuestionReview[] = essentialQuestions.map((question) => {
    const answerSummary = reviewedValue(input, question.id);
    return {
      questionId: question.id,
      label: question.prompt,
      answerSummary,
      disposition: answerSummary === null ? "unreviewed" : "answered",
      allowsNone: question.id === "profile:debts" || question.id === "planning:obligations",
    };
  });
  const goals = input.goals.filter((goal) => goal.status !== "removed");
  questions.push({
    questionId: "profile:goals",
    label: "Which financial goals and priorities should nohmi consider?",
    disposition: goals.length ? "answered" : "unreviewed",
    answerSummary: goals.length
      ? goals.map((goal) => `${goal.name} (${goal.priority} priority)`).join(", ")
      : null,
    allowsNone: true,
  });
  const p = input.preferences;
  return {
    existingAccess: input.existingAccess,
    source: source(input.accounts),
    contextReview: "reviewed",
    questions,
    displayPreferences: {
      summary: [
        `Transactions: ${p.financeTransactionView}; grouping: ${p.financeTransactionGroup}.`,
        `Spending: ${p.financeSpendingView}; grouping: ${p.financeSpendingGrouping}; period: ${p.financeSpendingPeriod}.`,
        `Pending: ${p.financeSpendingIncludePending ? "included" : "excluded"}; uncategorized: ${p.financeSpendingIncludeUncategorized ? "included" : "excluded"}.`,
        `Basis: ${p.financeSpendingBasis}; refunds: ${p.financeSpendingSubtractRefunds ? "subtracted" : "included"}.`,
        `Spending accounts: ${p.spendAccountIds === null ? "all eligible accounts" : p.spendAccountIds.length ? p.spendAccountIds.join(", ") : "none selected"}.`,
      ],
    },
    manualVisibility: p.financeManualVisibility,
    automation: {
      registrationCount: input.registrationCount,
      authorizedRegistrationWithCadence: input.authorizedRegistrationWithCadence,
      chatVerification:
        input.chat === null
          ? "unavailable"
          : input.chat.messageCapability === "verified"
            ? "verified"
            : "pending",
      canSendChat: input.chat?.canSend ?? false,
      historyAvailable: input.chat?.historyReadable ?? true,
    },
  };
}

/** All reads use the supplied executor, including nested Chat savepoints on that connection. */
export function createFinanceOnboardingEvidenceLoader(options: {
  now?: () => Date;
  onChatFailure?: (failure: { category: "unexpected" }) => void;
  hasLegacyAccess: (executor: Database | FinanceTransaction, userId: string) => Promise<boolean>;
}) {
  const now = options.now ?? (() => new Date());
  return async (
    executor: Database | FinanceTransaction,
    userId: string,
  ): Promise<FinanceOnboardingEvidence> => {
    const db = executor as Database;
    // Sequential reads preserve one transaction connection and propagate unexpected storage failures.
    const profile = await createProfileBudgetService({ db, now }).getFinancialProfile(userId);
    const accounts = await createFinanceAccountService({ db, now }).list(userId, {
      includeExcluded: true,
    });
    const preferences = await createWorkspaceSettingsService(db, now).get(userId, "finances");
    const goals = await executor.select().from(financeGoals).where(eq(financeGoals.userId, userId));
    const schedules = await executor
      .select()
      .from(automationHostSchedules)
      .where(eq(automationHostSchedules.userId, userId));
    let authorizedRegistrationWithCadence = false;
    for (const row of schedules) {
      const parsed = automationHostScheduleSchema.safeParse(row.schedule);
      if (
        !parsed.success ||
        parsed.data.state !== "active" ||
        !parsed.data.hostAutomationId ||
        parsed.data.tenantAuthorizationConnectionId !== row.authorizationConnectionId ||
        !parsed.data.effectiveScopes.includes("finances:maintain")
      )
        continue;
      const tokens = await executor
        .select()
        .from(accessTokens)
        .where(
          and(
            eq(accessTokens.userId, userId),
            eq(accessTokens.authorizationConnectionId, row.authorizationConnectionId),
            activeHostConnectionGrant(now()),
          ),
        );
      for (const token of tokens) {
        if (!token.scopes.includes("finances:maintain")) continue;
        try {
          await requireWorkspaceExecution(
            executor,
            {
              userId,
              actorId: token.id,
              actorType: "agent",
              authorizationConnectionId: row.authorizationConnectionId,
              scopes: new Set(token.scopes),
            },
            "finances",
            now(),
          );
          authorizedRegistrationWithCadence = true;
          break;
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== "forbidden") throw error;
        }
      }
      if (authorizedRegistrationWithCadence) break;
    }
    let chat: FinanceConversationReadiness | null;
    try {
      // getReadiness owns a nested transaction/savepoint; catch only after its rollback.
      chat = await createFinanceConversationService({ db, now }).getReadiness(userId);
    } catch {
      options.onChatFailure?.({ category: "unexpected" });
      chat = null;
    }
    return projectFinanceOnboardingEvidence({
      profile: profile.data,
      accounts: accounts.accounts,
      preferences: preferences.preferences,
      goals,
      existingAccess: await options.hasLegacyAccess(executor, userId),
      registrationCount: schedules.filter(
        (row) => row.schedule.state !== "cancelled" && row.schedule.state !== "revoked",
      ).length,
      authorizedRegistrationWithCadence,
      chat,
    });
  };
}
