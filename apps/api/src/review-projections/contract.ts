import type {
  attentionItems,
  calendarAccounts,
  domainProfiles,
  financeAccounts,
  financeAgentActionReviews,
  financeReviewCases,
  financeTransactions,
  mailRules,
  mailStewardshipQuestions,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import type { AgentAccessWorkItem } from "@personal-os/domain";

export type SourceInput = { snapshotAt: Date; userId: string };
export type SourceReaders = {
  accounts: (input: SourceInput) => Promise<Array<typeof calendarAccounts.$inferSelect>>;
  attention: (input: SourceInput) => Promise<Array<typeof attentionItems.$inferSelect>>;
  financeEffects: (input: SourceInput) => Promise<AgentAccessWorkItem[]>;
  financeAccounts: (input: SourceInput) => Promise<Array<typeof financeAccounts.$inferSelect>>;
  financeActions: (
    input: SourceInput,
  ) => Promise<Array<typeof financeAgentActionReviews.$inferSelect>>;
  financeContextual: (input: SourceInput) => Promise<AgentAccessWorkItem[]>;
  financeReviews: (input: SourceInput) => Promise<
    Array<
      typeof financeReviewCases.$inferSelect & {
        transaction?: typeof financeTransactions.$inferSelect | null;
      }
    >
  >;
  mailQuestions: (
    input: SourceInput,
  ) => Promise<Array<typeof mailStewardshipQuestions.$inferSelect>>;
  mailRules: (input: SourceInput) => Promise<Array<typeof mailRules.$inferSelect>>;
  mailRuns: (input: SourceInput) => Promise<Array<typeof workspaceMaintenanceRuns.$inferSelect>>;
  profiles: (input: SourceInput) => Promise<Array<typeof domainProfiles.$inferSelect>>;
};

export type SourceKey = keyof SourceReaders;
export type SourceResult = {
  accounts: Awaited<ReturnType<SourceReaders["accounts"]>>;
  attention: Awaited<ReturnType<SourceReaders["attention"]>>;
  financeEffects: Awaited<ReturnType<SourceReaders["financeEffects"]>>;
  financeAccounts: Awaited<ReturnType<SourceReaders["financeAccounts"]>>;
  financeActions: Awaited<ReturnType<SourceReaders["financeActions"]>>;
  financeContextual: Awaited<ReturnType<SourceReaders["financeContextual"]>>;
  financeReviews: Awaited<ReturnType<SourceReaders["financeReviews"]>>;
  mailQuestions: Awaited<ReturnType<SourceReaders["mailQuestions"]>>;
  mailRules: Awaited<ReturnType<SourceReaders["mailRules"]>>;
  mailRuns: Awaited<ReturnType<SourceReaders["mailRuns"]>>;
  profiles: Awaited<ReturnType<SourceReaders["profiles"]>>;
};

export type ProjectionInput = {
  includePreview: boolean;
  results: Partial<SourceResult>;
};

export type ReviewProjection = (input: ProjectionInput) => AgentAccessWorkItem[];
