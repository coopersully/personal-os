import type {
  AccessScope,
  AccountSetupStatus,
  AccountSetupStep,
  AccountSetupWorkspace,
  ActorType,
  AgentAccessDomain,
  AgentAccessWorkItem,
  AgentAccessWorkItemKind,
  AgentAccessWorkItemSummary,
  AgentMutationPolicy,
  AssistantDomain,
  AttentionItemImportance,
  AttentionItemKind,
  AttentionItemStatus,
  CalendarFinding,
  CalendarFindingEvidence,
  CalendarFindingKind,
  CalendarFindingSeverity,
  CalendarFindingStatus,
  CalendarHealthAssessment,
  CalendarMaintenanceScope,
  CalendarProvider,
  CalendarRecommendation,
  CalendarReviewState,
  CalendarSourceFreshness,
  ConnectorFailureCategory,
  ConnectorSubscriptionKind,
  ConnectorSubscriptionStatus,
  ConnectorSyncRecovery,
  ConnectorSyncStatus,
  ConnectorSyncTriggerReason,
  DomainProfile,
  FinanceProvider,
  GoogleConnectionService,
  HomeLocation,
  LegacyMailRuleAction,
  MailAddress,
  MailAttachment,
  MailboxRole,
  MailProvider,
  MailRuleAction,
  MailRuleCondition,
  MailRuleProviderEffect,
  MailRuleWorkStatus,
  MaintenanceRunStatus,
  MaintenanceScope,
  MaterialSourceReference,
  TextContentKind,
  TextingConnectionState,
  TextingCountry,
  TextMessageDirection,
  TextMessageStatus,
  TextOccurredAtSource,
  Theme,
  TransactionDirection,
} from "@personal-os/domain";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable("users", {
  accentColor: text("accent_color").notNull().default("#c7d23c"),
  theme: text("theme").$type<Theme>().notNull().default("system"),
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  setupStatus: text("setup_status").$type<AccountSetupStatus>().notNull().default("dismissed"),
  setupCurrentStep: text("setup_current_step")
    .$type<AccountSetupStep>()
    .notNull()
    .default("welcome"),
  setupSelectedWorkspaces: jsonb("setup_selected_workspaces")
    .$type<AccountSetupWorkspace[]>()
    .notNull()
    .default(sql`'["calendar","tasks","mail","finances"]'::jsonb`),
  setupStartedAt: timestamp("setup_started_at", { withTimezone: true }),
  setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
  setupDismissedAt: timestamp("setup_dismissed_at", { withTimezone: true }),
  planningTimezone: text("planning_timezone").notNull().default("UTC"),
  homeLocation: jsonb("home_location").$type<HomeLocation>(),
  workdayStartMinute: integer("workday_start_minute")
    .notNull()
    .default(9 * 60),
  workdayEndMinute: integer("workday_end_minute")
    .notNull()
    .default(17 * 60),
  ...timestamps,
});

type MaintenanceSafeError = { code: string; message: string };

export const workspaceMaintenanceRuns = pgTable(
  "workspace_maintenance_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    domain: text("domain").$type<AssistantDomain>().notNull(),
    scope: jsonb("scope").$type<MaintenanceScope>().notNull(),
    status: text("status").$type<MaintenanceRunStatus>().notNull().default("queued"),
    rulebookVersion: text("rulebook_version").notNull(),
    sourceSnapshot: jsonb("source_snapshot").$type<unknown>(),
    checkpoint: jsonb("checkpoint").$type<unknown>(),
    leaseClaimId: uuid("lease_claim_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    retryAt: timestamp("retry_at", { withTimezone: true }),
    lastSafeError: jsonb("last_safe_error").$type<MaintenanceSafeError>(),
    settledResult: jsonb("settled_result").$type<unknown>(),
    ...timestamps,
  },
  (table) => [
    check(
      "workspace_maintenance_runs_status_check",
      sql`${table.status} IN ('queued', 'running', 'completed', 'completed_with_questions', 'awaiting_agent_challenge', 'awaiting_approval', 'blocked', 'failed_recoverable', 'failed_terminal')`,
    ),
    check(
      "workspace_maintenance_runs_lease_check",
      sql`(
        (${table.status} = 'running' AND ${table.leaseClaimId} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL)
        OR
        (${table.status} <> 'running' AND ${table.leaseClaimId} IS NULL AND ${table.leaseExpiresAt} IS NULL)
      )`,
    ),
    check(
      "workspace_maintenance_runs_retry_check",
      sql`(
        (${table.status} = 'failed_recoverable' AND ${table.retryAt} IS NOT NULL)
        OR
        (${table.status} <> 'failed_recoverable' AND ${table.retryAt} IS NULL)
      )`,
    ),
    uniqueIndex("workspace_maintenance_runs_open_user_domain_idx")
      .on(table.userId, table.domain)
      .where(
        sql`${table.status} IN ('queued', 'running', 'awaiting_agent_challenge', 'awaiting_approval', 'blocked', 'failed_recoverable')`,
      ),
    uniqueIndex("workspace_maintenance_runs_id_user_id_unique").on(table.id, table.userId),
    index("workspace_maintenance_runs_claimable_idx")
      .on(table.status, table.retryAt, table.leaseExpiresAt, table.updatedAt)
      .where(sql`${table.status} IN ('queued', 'running', 'failed_recoverable')`),
    index("workspace_maintenance_runs_user_history_idx").on(
      table.userId,
      table.domain,
      table.createdAt,
    ),
  ],
);

export const workspaceMaintenanceSteps = pgTable(
  "workspace_maintenance_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workspaceMaintenanceRuns.id, { onDelete: "cascade" }),
    stepName: text("step_name").notNull(),
    status: text("status")
      .$type<"completed" | "failed_recoverable" | "failed_terminal">()
      .notNull(),
    attemptCount: integer("attempt_count").notNull().default(1),
    idempotencyKey: text("idempotency_key").notNull(),
    attemptClaimId: uuid("attempt_claim_id").notNull(),
    safeResult: jsonb("safe_result").$type<unknown>(),
    safeError: jsonb("safe_error").$type<MaintenanceSafeError>(),
    ...timestamps,
  },
  (table) => [
    check(
      "workspace_maintenance_steps_status_check",
      sql`${table.status} IN ('completed', 'failed_recoverable', 'failed_terminal')`,
    ),
    check("workspace_maintenance_steps_attempt_check", sql`${table.attemptCount} > 0`),
    check(
      "workspace_maintenance_steps_result_check",
      sql`(
        (${table.status} = 'completed' AND ${table.safeError} IS NULL)
        OR
        (${table.status} IN ('failed_recoverable', 'failed_terminal') AND ${table.safeResult} IS NULL AND ${table.safeError} IS NOT NULL)
      )`,
    ),
    uniqueIndex("workspace_maintenance_steps_run_step_idx").on(table.runId, table.stepName),
    uniqueIndex("workspace_maintenance_steps_run_idempotency_idx").on(
      table.runId,
      table.idempotencyKey,
    ),
  ],
);

/**
 * The private candidate ledger for a single Finance maintenance run.  A
 * superseded revision is retained for audit/recovery, while the partial index
 * permits only one current candidate for that run.
 */
export const financeMaintenanceCandidates = pgTable(
  "finance_maintenance_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull(),
    state: text("state")
      .$type<
        | "preparing"
        | "ready_for_challenge"
        | "challenged"
        | "awaiting_approval"
        | "committing"
        | "committed"
        | "superseded"
      >()
      .notNull()
      .default("preparing"),
    revision: text("revision").notNull(),
    projection: jsonb("projection").$type<Record<string, unknown>>().notNull().default({
      budgetActual: null,
      budgetTotal: null,
      budgetVariance: null,
      grossCashSpending: 0,
      matchedReimbursementIncome: 0,
      monthlyCapacity: null,
      personalSpending: 0,
      plannedIncome: 0,
      profileExpectedNetIncome: null,
      questions: 0,
      recurringCommittedOutflow: 0,
      reimbursementsOutstanding: 0,
      workItems: 0,
    }),
    /** The next stable proposal cursor, visible only to the preparer. */
    preparationCursor: text("preparation_cursor"),
    nextOrdinal: integer("next_ordinal").notNull().default(0),
    discoveryRevision: text("discovery_revision"),
    preparationCheckpoint: jsonb("preparation_checkpoint")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    ...timestamps,
  },
  (table) => [
    check(
      "finance_maintenance_candidates_state_check",
      sql`${table.state} IN ('preparing', 'ready_for_challenge', 'challenged', 'awaiting_approval', 'committing', 'committed', 'superseded')`,
    ),
    check("finance_maintenance_candidates_next_ordinal_check", sql`${table.nextOrdinal} >= 0`),
    uniqueIndex("finance_maintenance_candidates_active_run_idx")
      .on(table.runId)
      .where(sql`${table.state} <> 'superseded'`),
    index("finance_maintenance_candidates_user_state_idx").on(
      table.userId,
      table.state,
      table.updatedAt,
    ),
    foreignKey({
      columns: [table.runId, table.userId],
      foreignColumns: [workspaceMaintenanceRuns.id, workspaceMaintenanceRuns.userId],
      name: "finance_maintenance_candidates_run_user_fk",
    }).onDelete("cascade"),
  ],
);

/** Private prepared actions/questions; public views project only safeChanges. */
export const financeMaintenanceCandidateItems = pgTable(
  "finance_maintenance_candidate_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => financeMaintenanceCandidates.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    actionKind: text("action_kind").notNull(),
    privatePayload: jsonb("private_payload").$type<Record<string, unknown>>().notNull(),
    safeChanges: jsonb("safe_changes")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    sourceRefs: jsonb("source_refs").$type<Array<Record<string, unknown>>>().notNull().default([]),
    expectedRevision: text("expected_revision"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    fingerprint: text("fingerprint").notNull(),
    disposition: text("disposition")
      .$type<"prepared" | "question" | "removed" | "committed">()
      .notNull()
      .default("prepared"),
    ...timestamps,
  },
  (table) => [
    check("finance_maintenance_candidate_items_ordinal_check", sql`${table.ordinal} >= 0`),
    check(
      "finance_maintenance_candidate_items_disposition_check",
      sql`${table.disposition} IN ('prepared', 'question', 'removed', 'committed')`,
    ),
    uniqueIndex("finance_maintenance_candidate_items_candidate_ordinal_idx").on(
      table.candidateId,
      table.ordinal,
    ),
    uniqueIndex("finance_maintenance_candidate_items_candidate_fingerprint_idx").on(
      table.candidateId,
      table.fingerprint,
    ),
    index("finance_maintenance_candidate_items_candidate_disposition_idx").on(
      table.candidateId,
      table.disposition,
      table.ordinal,
    ),
  ],
);

export const financeLedgerChallenges = pgTable(
  "finance_ledger_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => workspaceMaintenanceRuns.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => financeMaintenanceCandidates.id, { onDelete: "cascade" }),
    candidateRevision: text("candidate_revision").notNull(),
    rubricVersion: text("rubric_version").notNull(),
    cutoff: timestamp("cutoff", { withTimezone: true }).notNull(),
    state: text("state")
      .$type<"prepared" | "submitted" | "resolved">()
      .notNull()
      .default("prepared"),
    coverage: jsonb("coverage").$type<Record<string, unknown>>().notNull().default({}),
    submittingAgentId: text("submitting_agent_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      "finance_ledger_challenges_state_check",
      sql`${table.state} IN ('prepared', 'submitted', 'resolved')`,
    ),
    uniqueIndex("finance_ledger_challenges_run_candidate_idx").on(table.runId, table.candidateId),
    index("finance_ledger_challenges_user_state_idx").on(
      table.userId,
      table.state,
      table.updatedAt,
    ),
  ],
);

export const financeLedgerChallengeFindings = pgTable(
  "finance_ledger_challenge_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    challengeId: uuid("challenge_id")
      .notNull()
      .references(() => financeLedgerChallenges.id, { onDelete: "cascade" }),
    candidateItemId: uuid("candidate_item_id").references(
      () => financeMaintenanceCandidateItems.id,
      { onDelete: "set null" },
    ),
    kind: text("kind").notNull(),
    severity: text("severity").notNull(),
    sourceRefs: jsonb("source_refs").$type<Array<Record<string, unknown>>>().notNull().default([]),
    evidence: text("evidence").notNull(),
    rationale: text("rationale").notNull(),
    resolution: jsonb("resolution").$type<Record<string, unknown>>().notNull(),
    ...timestamps,
  },
  (table) => [
    check(
      "finance_ledger_challenge_findings_kind_check",
      sql`${table.kind} IN ('correction', 'question', 'blocker', 'observation')`,
    ),
    check(
      "finance_ledger_challenge_findings_severity_check",
      sql`${table.severity} IN ('info', 'warning', 'blocker')`,
    ),
    index("finance_ledger_challenge_findings_challenge_idx").on(table.challengeId, table.createdAt),
  ],
);

export const financePeriodReviews = pgTable(
  "finance_period_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => workspaceMaintenanceRuns.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    cutoff: timestamp("cutoff", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    report: jsonb("report").$type<Record<string, unknown>>().notNull(),
    sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("finance_period_reviews_period_check", sql`${table.periodStart} <= ${table.periodEnd}`),
    check(
      "finance_period_reviews_status_check",
      sql`${table.status} IN ('completed', 'completed_with_questions')`,
    ),
    uniqueIndex("finance_period_reviews_run_idx").on(table.runId),
    index("finance_period_reviews_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const accountActionTokens = pgTable(
  "account_action_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").$type<"email_verification" | "password_reset">().notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("account_action_tokens_token_hash_idx").on(table.tokenHash),
    index("account_action_tokens_user_purpose_idx").on(table.userId, table.purpose),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    codeHash: text("code_hash").notNull(),
    email: text("email"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    redeemedByUserId: uuid("redeemed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("invitations_code_hash_idx").on(table.codeHash),
    index("invitations_created_by_user_idx").on(table.createdByUserId),
    index("invitations_redeemable_idx").on(table.redeemedAt, table.expiresAt),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_idx").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
  ],
);

export const accessTokens = pgTable(
  "access_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    audience: text("audience"),
    clientId: text("client_id"),
    tokenHash: text("token_hash").notNull(),
    scopes: jsonb("scopes").$type<AccessScope[]>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("access_tokens_token_hash_idx").on(table.tokenHash),
    index("access_tokens_user_idx").on(table.userId),
  ],
);

export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthAuthorizationCodes = pgTable(
  "oauth_authorization_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    codeChallenge: text("code_challenge").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redirectUri: text("redirect_uri").notNull(),
    resource: text("resource").notNull(),
    scopes: jsonb("scopes").$type<AccessScope[]>().notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("oauth_authorization_codes_hash_idx").on(table.codeHash)],
);

export const oauthRefreshTokens = pgTable(
  "oauth_refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accessTokenId: uuid("access_token_id")
      .notNull()
      .references(() => accessTokens.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    replacedAt: timestamp("replaced_at", { withTimezone: true }),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("oauth_refresh_tokens_hash_idx").on(table.tokenHash)],
);

export type StoredDailyBrief = {
  allDay: unknown[];
  anytime: unknown[];
  capacity: {
    availableMinutes: number;
    busyMinutes: number;
    flexibleTaskMinutes: number;
    overcommitted: boolean;
    scheduledTaskMinutes: number;
    workdayEndsAt: string;
    workdayStartsAt: string;
  };
  generatedAt: string;
  laterToday: unknown[];
  next: unknown | null;
  now: unknown[];
  overdue: unknown[];
  recommendedTasks: unknown[];
  timeZone: string;
  tasks: unknown[];
  completedTasks: unknown[];
  today: unknown[];
  tomorrow: unknown[];
};

export const automationRoutines = pgTable(
  "automation_routines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    template: text("template").$type<"morning_brief" | "nightly_review">().notNull(),
    title: text("title").notNull(),
    schedule: text("schedule").notNull(),
    timezone: text("timezone").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("automation_routines_user_idx").on(table.userId),
    uniqueIndex("automation_routines_user_template_idx").on(table.userId, table.template),
  ],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    routineId: uuid("routine_id")
      .notNull()
      .references(() => automationRoutines.id, { onDelete: "cascade" }),
    status: text("status").$type<"completed" | "dry_run" | "failed">().notNull(),
    summary: text("summary").notNull(),
    brief: jsonb("brief").$type<StoredDailyBrief>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("automation_runs_routine_time_idx").on(table.routineId, table.startedAt),
    index("automation_runs_user_time_idx").on(table.userId, table.startedAt),
  ],
);

export const domainProfiles = pgTable(
  "domain_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    domain: text("domain").$type<AssistantDomain>().notNull(),
    objective: text("objective").notNull(),
    summary: text("summary").notNull(),
    instructions: jsonb("instructions").$type<string[]>().notNull().default([]),
    sourceContexts: jsonb("source_contexts")
      .$type<
        Array<{
          notes: string | null;
          purpose: string;
          sourceId: string;
          sourceLabel: string;
        }>
      >()
      .notNull()
      .default([]),
    categories: jsonb("categories")
      .$type<Array<{ description: string; examples: string[]; key: string; label: string }>>()
      .notNull()
      .default([]),
    preferences: jsonb("preferences")
      .$type<Record<string, boolean | null | number | string | string[]>>()
      .notNull()
      .default({}),
    status: text("status").$type<"active" | "draft">().notNull().default("draft"),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("domain_profiles_user_domain_idx").on(table.userId, table.domain),
    uniqueIndex("domain_profiles_id_user_domain_idx").on(table.id, table.userId, table.domain),
    index("domain_profiles_user_status_idx").on(table.userId, table.status),
  ],
);

export const domainProfileApprovals = pgTable(
  "domain_profile_approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    domain: text("domain").$type<AssistantDomain>().notNull(),
    profileId: uuid("profile_id").notNull(),
    profileVersion: integer("profile_version").notNull(),
    profile: jsonb("profile").$type<DomainProfile>().notNull(),
    approvedByUserId: uuid("approved_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("domain_profile_approvals_user_domain_idx").on(table.userId, table.domain),
    index("domain_profile_approvals_profile_idx").on(table.profileId),
    foreignKey({
      columns: [table.profileId, table.userId, table.domain],
      foreignColumns: [domainProfiles.id, domainProfiles.userId, domainProfiles.domain],
      name: "domain_profile_approvals_owned_profile_fk",
    }).onDelete("cascade"),
    check("domain_profile_approvals_owner_check", sql`${table.approvedByUserId} = ${table.userId}`),
    check(
      "domain_profile_approvals_snapshot_check",
      sql`(${table.profile}->>'id' = ${table.profileId}::text
        AND ${table.profile}->>'domain' = ${table.domain}
        AND (${table.profile}->>'version')::integer = ${table.profileVersion}
        AND ${table.profile}->>'status' = 'active') IS TRUE`,
    ),
  ],
);

export const financeSetupBackfillState = pgTable("finance_setup_backfill_state", {
  allocationCursor: uuid("allocation_cursor"),
  allocationsComplete: boolean("allocations_complete").notNull().default(false),
  key: text("key").primaryKey(),
  categoriesComplete: boolean("categories_complete").notNull().default(false),
  profileCursor: uuid("profile_cursor"),
  profilesComplete: boolean("profiles_complete").notNull().default(false),
  userCursor: uuid("user_cursor"),
  ...timestamps,
});

export const agentAccessWorkItemSnapshots = pgTable(
  "agent_access_work_item_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    actorType: text("actor_type").$type<Extract<ActorType, "agent" | "user">>().notNull(),
    domain: text("domain").$type<AgentAccessDomain>(),
    kind: text("kind").$type<AgentAccessWorkItemKind>(),
    items: jsonb("items").$type<AgentAccessWorkItem[]>().notNull(),
    filteredTotal: integer("filtered_total"),
    summary: jsonb("summary").$type<AgentAccessWorkItemSummary>().notNull(),
    unavailableDomains: jsonb("unavailable_domains")
      .$type<AgentAccessDomain[]>()
      .notNull()
      .default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agent_access_work_item_snapshots_user_expiry_idx").on(table.userId, table.expiresAt),
  ],
);

export const attentionItems = pgTable(
  "attention_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    domain: text("domain").$type<AssistantDomain>().notNull(),
    kind: text("kind").$type<AttentionItemKind>().notNull(),
    importance: text("importance").$type<AttentionItemImportance>().notNull(),
    status: text("status").$type<AttentionItemStatus>().notNull().default("open"),
    version: integer("version").notNull().default(1),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    occursAt: timestamp("occurs_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    source: jsonb("source").$type<MaterialSourceReference>(),
    relatedEntityType: text("related_entity_type"),
    relatedEntityId: uuid("related_entity_id"),
    ...timestamps,
  },
  (table) => [
    index("attention_items_user_domain_status_idx").on(
      table.userId,
      table.domain,
      table.status,
      table.createdAt,
    ),
    index("attention_items_user_occurs_idx").on(table.userId, table.occursAt),
    check("attention_items_version_check", sql`${table.version} > 0`),
  ],
);

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").$type<"active" | "paused" | "completed">().notNull().default("active"),
    progress: integer("progress").notNull().default(0),
    targetDate: text("target_date"),
    ...timestamps,
  },
  (table) => [index("goals_user_status_idx").on(table.userId, table.status, table.targetDate)],
);

export const motives = pgTable(
  "motives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    detail: text("detail"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [index("motives_user_active_idx").on(table.userId, table.isActive)],
);

export const oauthStates = pgTable(
  "oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<CalendarProvider | "x">().notNull(),
    encryptedVerifier: jsonb("encrypted_verifier").$type<EncryptedCredentials>(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    status: text("status")
      .$type<
        | "pending"
        | "processing"
        | "connected"
        | "cancelled"
        | "expired"
        | "permission_incomplete"
        | "failed"
      >()
      .notNull()
      .default("pending"),
    outcomeCode: text("outcome_code"),
    connectedAccountId: uuid("connected_account_id"),
    redirectUri: text("redirect_uri"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    requestId: text("request_id"),
    targetAccountId: uuid("target_account_id"),
    requestedServices: jsonb("requested_services").$type<GoogleConnectionService[]>(),
    returnPath: text("return_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("oauth_states_token_hash_idx").on(table.tokenHash),
    index("oauth_states_user_idx").on(table.userId),
    index("oauth_states_status_expiry_idx").on(table.status, table.expiresAt),
    index("oauth_states_expiry_idx").on(table.expiresAt),
    index("oauth_states_user_created_idx").on(table.userId, table.createdAt),
    check(
      "oauth_states_status_check",
      sql`${table.status} IN ('pending', 'processing', 'connected', 'cancelled', 'expired', 'permission_incomplete', 'failed')`,
    ),
    check(
      "oauth_states_lifecycle_check",
      sql`(
        (${table.status} = 'pending' AND ${table.consumedAt} IS NULL AND ${table.completedAt} IS NULL)
        OR (${table.status} = 'processing' AND ${table.consumedAt} IS NOT NULL AND ${table.completedAt} IS NULL)
        OR (${table.status} IN ('connected', 'cancelled', 'expired', 'permission_incomplete', 'failed') AND ${table.consumedAt} IS NOT NULL AND ${table.completedAt} IS NOT NULL)
      )`,
    ),
  ],
);

export type EncryptedCredentials = {
  ciphertext: string;
  iv: string;
  tag: string;
  version: 1;
};

export const calendarAccounts = pgTable(
  "calendar_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<CalendarProvider>().notNull(),
    label: text("label").notNull(),
    providerAccountId: text("provider_account_id"),
    email: text("email"),
    avatarUrl: text("avatar_url"),
    encryptedCredentials: jsonb("encrypted_credentials").$type<EncryptedCredentials>(),
    calendarEnabled: boolean("calendar_enabled").notNull().default(true),
    mailEnabled: boolean("mail_enabled").notNull().default(false),
    mailSyncToken: text("mail_sync_token"),
    syncStatus: text("sync_status").$type<ConnectorSyncStatus>().notNull().default("idle"),
    syncGeneration: integer("sync_generation").notNull().default(0),
    syncClaimId: uuid("sync_claim_id"),
    syncError: text("sync_error"),
    syncErrorCode: text("sync_error_code"),
    syncErrorCategory: text("sync_error_category").$type<ConnectorFailureCategory>(),
    syncRecovery: text("sync_recovery").$type<ConnectorSyncRecovery>(),
    syncFailureCount: integer("sync_failure_count").notNull().default(0),
    lastSyncAttemptAt: timestamp("last_sync_attempt_at", { withTimezone: true }),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("calendar_accounts_user_idx").on(table.userId),
    index("calendar_accounts_sync_due_idx").on(table.syncStatus, table.nextSyncAt),
    uniqueIndex("calendar_accounts_remote_idx").on(
      table.userId,
      table.provider,
      table.providerAccountId,
    ),
    check("calendar_accounts_sync_generation_check", sql`${table.syncGeneration} >= 0`),
    check("calendar_accounts_sync_failure_count_check", sql`${table.syncFailureCount} >= 0`),
    check(
      "calendar_accounts_sync_claim_check",
      sql`(${table.syncStatus} = 'syncing') = (${table.syncClaimId} IS NOT NULL)`,
    ),
    check(
      "calendar_accounts_sync_recovery_check",
      sql`(
        ${table.provider} = 'local'
        OR
        (${table.syncFailureCount} = 0 AND ${table.syncError} IS NULL AND ${table.syncErrorCode} IS NULL AND ${table.syncErrorCategory} IS NULL AND ${table.syncRecovery} IS NULL)
        OR
        (${table.syncFailureCount} > 0 AND ${table.syncError} IS NOT NULL AND ${table.syncErrorCode} IS NOT NULL AND ${table.syncErrorCategory} IN ('authorization', 'configuration', 'invalid_response', 'not_found', 'rate_limited', 'rejected', 'temporary', 'transport', 'unknown') AND ${table.syncRecovery} IN ('automatic', 'operator', 'reconnect'))
      )`,
    ),
  ],
);

export const xBookmarkAccounts = pgTable(
  "x_bookmark_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerAccountId: text("provider_account_id").notNull(),
    username: text("username").notNull(),
    displayName: text("display_name"),
    encryptedCredentials: jsonb("encrypted_credentials").$type<EncryptedCredentials>().notNull(),
    selectedFolderId: text("selected_folder_id"),
    selectedFolderName: text("selected_folder_name"),
    syncStatus: text("sync_status").$type<"idle" | "syncing" | "error">().notNull().default("idle"),
    syncError: text("sync_error"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("x_bookmark_accounts_user_idx").on(table.userId),
    uniqueIndex("x_bookmark_accounts_remote_idx").on(table.userId, table.providerAccountId),
  ],
);

export const xBookmarkFolders = pgTable(
  "x_bookmark_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => xBookmarkAccounts.id, { onDelete: "cascade" }),
    remoteFolderId: text("remote_folder_id").notNull(),
    name: text("name").notNull(),
    ...timestamps,
  },
  (table) => [
    index("x_bookmark_folders_account_idx").on(table.accountId),
    uniqueIndex("x_bookmark_folders_remote_idx").on(table.accountId, table.remoteFolderId),
  ],
);

export const xBookmarks = pgTable(
  "x_bookmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => xBookmarkAccounts.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => xBookmarkFolders.id, { onDelete: "set null" }),
    remotePostId: text("remote_post_id").notNull(),
    text: text("text").notNull(),
    authorId: text("author_id"),
    authorName: text("author_name"),
    authorUsername: text("author_username"),
    postUrl: text("post_url").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("x_bookmarks_user_synced_idx").on(table.userId, table.syncedAt),
    index("x_bookmarks_account_folder_idx").on(table.accountId, table.folderId),
    uniqueIndex("x_bookmarks_remote_idx").on(table.accountId, table.remotePostId),
  ],
);

export const pinterestConnections = pgTable(
  "pinterest_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    boardUrl: text("board_url"),
    backgroundColor: text("background_color").notNull().default("#ffffff"),
    backgroundMode: text("background_mode")
      .notNull()
      .default("white")
      .$type<"white" | "custom" | "matched" | "random">(),
    cornerRadius: integer("corner_radius").notNull().default(0),
    enabled: boolean("enabled").notNull().default(false),
    frameSpacing: integer("frame_spacing").notNull().default(16),
    layout: text("layout").notNull().default("grid").$type<"grid" | "stack">(),
    lastAppliedAt: timestamp("last_applied_at", { withTimezone: true }),
    mosaicFit: text("mosaic_fit").notNull().default("preserve").$type<"preserve" | "fill">(),
    paddingBottom: integer("padding_bottom").notNull().default(16),
    paddingEnd: integer("padding_end").notNull().default(16),
    paddingLinked: boolean("padding_linked").notNull().default(true),
    paddingStart: integer("padding_start").notNull().default(16),
    paddingTop: integer("padding_top").notNull().default(16),
    rotationDegrees: integer("rotation_degrees").notNull().default(0),
    tileSize: integer("tile_size").notNull().default(64),
    ...timestamps,
  },
  (table) => [uniqueIndex("pinterest_connections_user_idx").on(table.userId)],
);

export const mailboxes = pgTable(
  "mailboxes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => calendarAccounts.id, { onDelete: "cascade" }),
    provider: text("provider").$type<MailProvider>().notNull(),
    remoteMailboxId: text("remote_mailbox_id").notNull(),
    name: text("name").notNull(),
    role: text("role").$type<MailboxRole>().notNull().default("custom"),
    providerRevision: text("provider_revision"),
    unreadCount: integer("unread_count").notNull().default(0),
    totalCount: integer("total_count").notNull().default(0),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("mailboxes_user_idx").on(table.userId),
    uniqueIndex("mailboxes_remote_idx").on(table.accountId, table.remoteMailboxId),
  ],
);

export const mailThreads = pgTable(
  "mail_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => calendarAccounts.id, { onDelete: "cascade" }),
    provider: text("provider").$type<MailProvider>().notNull(),
    remoteThreadId: text("remote_thread_id").notNull(),
    subject: text("subject").notNull(),
    snippet: text("snippet").notNull(),
    bodyText: text("body_text").notNull(),
    from: jsonb("from_address").$type<MailAddress>().notNull(),
    to: jsonb("to_addresses").$type<MailAddress[]>().notNull().default([]),
    remoteMailboxIds: jsonb("remote_mailbox_ids").$type<string[]>().notNull().default([]),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    messageCount: integer("message_count").notNull().default(1),
    unread: boolean("unread").notNull().default(false),
    starred: boolean("starred").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("mail_threads_user_time_idx").on(table.userId, table.receivedAt),
    uniqueIndex("mail_threads_remote_idx").on(table.accountId, table.remoteThreadId),
  ],
);

export const mailMessages = pgTable(
  "mail_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => mailThreads.id, { onDelete: "cascade" }),
    remoteMessageId: text("remote_message_id").notNull(),
    bodyText: text("body_text").notNull(),
    from: jsonb("from_address").$type<MailAddress>().notNull(),
    to: jsonb("to_addresses").$type<MailAddress[]>().notNull().default([]),
    cc: jsonb("cc_addresses").$type<MailAddress[]>().notNull().default([]),
    attachments: jsonb("attachments").$type<MailAttachment[]>().notNull().default([]),
    providerMailboxIds: jsonb("provider_mailbox_ids").$type<string[]>().notNull().default([]),
    providerRevision: text("provider_revision"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("mail_messages_remote_idx").on(table.threadId, table.remoteMessageId)],
);

export const mailCalendarCommitmentIntakes = pgTable(
  "mail_calendar_commitment_intakes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => calendarAccounts.id, { onDelete: "cascade" }),
    sourceThreadId: uuid("source_thread_id").references(() => mailThreads.id, {
      onDelete: "set null",
    }),
    sourceMessageId: uuid("source_message_id").references(() => mailMessages.id, {
      onDelete: "set null",
    }),
    remoteThreadId: text("remote_thread_id").notNull(),
    remoteMessageId: text("remote_message_id").notNull(),
    remotePartId: text("remote_part_id").notNull(),
    sourceThreadRevision: timestamp("source_thread_revision", { withTimezone: true }).notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    sourceMessageMailboxIds: jsonb("source_message_mailbox_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    sourceMessageRevision: text("source_message_revision"),
    providerAccountAddressHintHash: text("provider_account_address_hint_hash"),
    attachmentFingerprint: text("attachment_fingerprint").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    attachment: jsonb("attachment").$type<MailAttachment>().notNull(),
    evidenceKind: text("evidence_kind").notNull(),
    authority: text("authority")
      .$type<"provider_projected_unverified" | "server_verified">()
      .notNull()
      .default("provider_projected_unverified"),
    status: text("status")
      .$type<"preview_only" | "pending" | "claimed" | "reconcile" | "succeeded" | "failed">()
      .notNull()
      .default("preview_only"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("mail_calendar_commitment_intake_identity_idx").on(
      table.accountId,
      table.remoteMessageId,
      table.remotePartId,
    ),
    uniqueIndex("mail_calendar_commitment_intake_idempotency_idx").on(table.idempotencyKey),
    index("mail_calendar_commitment_intake_user_status_idx").on(table.userId, table.status),
    check(
      "mail_calendar_commitment_intake_source_fingerprint_check",
      sql`${table.sourceFingerprint} ~ '^[0-9a-f]{64}$' AND ${table.attachmentFingerprint} ~ '^[0-9a-f]{64}$' AND ${table.idempotencyKey} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "mail_calendar_commitment_intake_account_address_hint_hash_check",
      sql`${table.providerAccountAddressHintHash} IS NULL OR ${table.providerAccountAddressHintHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "mail_calendar_commitment_intake_authority_check",
      sql`${table.authority} IN ('provider_projected_unverified', 'server_verified')`,
    ),
    check(
      "mail_calendar_commitment_intake_status_check",
      sql`${table.status} IN ('preview_only', 'pending', 'claimed', 'reconcile', 'succeeded', 'failed')`,
    ),
    check(
      "mail_calendar_commitment_intake_authority_status_check",
      sql`${table.authority} <> 'provider_projected_unverified' OR ${table.status} = 'preview_only'`,
    ),
  ],
);

export const mailDrafts = pgTable(
  "mail_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => calendarAccounts.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").references(() => mailThreads.id, { onDelete: "set null" }),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull().default(""),
    to: jsonb("to_addresses").$type<MailAddress[]>().notNull().default([]),
    cc: jsonb("cc_addresses").$type<MailAddress[]>().notNull().default([]),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sendClaimId: uuid("send_claim_id"),
    sendClaimedAt: timestamp("send_claimed_at", { withTimezone: true }),
    sendStatus: text("send_status")
      .$type<"draft" | "sending" | "sent" | "reconcile">()
      .notNull()
      .default("draft"),
    ...timestamps,
  },
  (table) => [
    index("mail_drafts_user_updated_idx").on(table.userId, table.updatedAt),
    check(
      "mail_drafts_send_state_check",
      sql`
        (
          ${table.sendStatus} = 'draft'
          AND ${table.sentAt} IS NULL
          AND ${table.sendClaimId} IS NULL
          AND ${table.sendClaimedAt} IS NULL
        )
        OR (
          ${table.sendStatus} = 'sending'
          AND ${table.sentAt} IS NULL
          AND ${table.sendClaimId} IS NOT NULL
          AND ${table.sendClaimedAt} IS NOT NULL
        )
        OR (
          ${table.sendStatus} = 'reconcile'
          AND ${table.sentAt} IS NULL
          AND ${table.sendClaimId} IS NOT NULL
          AND ${table.sendClaimedAt} IS NOT NULL
        )
        OR (
          ${table.sendStatus} = 'sent'
          AND ${table.sentAt} IS NOT NULL
          AND ${table.sendClaimId} IS NULL
          AND ${table.sendClaimedAt} IS NULL
        )
      `,
    ),
  ],
);

export const mailSnoozes = pgTable(
  "mail_snoozes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => mailThreads.id, { onDelete: "cascade" }),
    until: timestamp("until", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("mail_snoozes_thread_idx").on(table.threadId),
    index("mail_snoozes_until_idx").on(table.until),
  ],
);

export const mailRules = pgTable(
  "mail_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").references(() => domainProfiles.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    legacyQuery: text("query").notNull().default("__ilo_rule_v2__"),
    legacyAction: text("action").$type<LegacyMailRuleAction>().notNull().default("archive"),
    description: text("description").notNull().default(""),
    condition: jsonb("condition").$type<MailRuleCondition>(),
    actions: jsonb("actions").$type<MailRuleAction[]>(),
    sourceAccountIds: jsonb("source_account_ids").$type<string[]>().notNull().default([]),
    confidenceThreshold: integer("confidence_threshold_basis_points"),
    policy: text("policy").$type<AgentMutationPolicy>().notNull().default("preview"),
    enabled: boolean("enabled").notNull().default(false),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("mail_rules_user_idx").on(table.userId),
    index("mail_rules_user_enabled_idx").on(table.userId, table.enabled),
    check(
      "mail_rules_activation_state_check",
      sql`
        (${table.enabled} = false AND ${table.policy} = 'preview')
        OR (${table.enabled} = true AND ${table.policy} = 'approved_rule')
        OR (
          ${table.enabled} = true
          AND ${table.policy} = 'preview'
          AND ${table.condition} IS NULL
          AND ${table.actions} IS NULL
        )
      `,
    ),
    check("mail_rules_exact_match_confidence_check", sql`${table.confidenceThreshold} IS NULL`),
  ],
);

export const mailRuleWorkItems = pgTable(
  "mail_rule_work_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => calendarAccounts.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => mailRules.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").references(() => domainProfiles.id, { onDelete: "set null" }),
    threadId: uuid("thread_id").references(() => mailThreads.id, { onDelete: "set null" }),
    remoteThreadId: text("remote_thread_id").notNull(),
    ruleVersion: integer("rule_version").notNull(),
    profileVersion: integer("profile_version").notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }).notNull(),
    action: jsonb("action").$type<MailRuleAction>().notNull(),
    actionFingerprint: text("action_fingerprint").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    status: text("status").$type<MailRuleWorkStatus>().notNull().default("pending"),
    claimId: uuid("claim_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimMode: text("claim_mode").$type<"execute" | "reconcile">(),
    attemptCount: integer("attempt_count").notNull().default(0),
    providerEffect: text("provider_effect")
      .$type<MailRuleProviderEffect>()
      .notNull()
      .default("none"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("mail_rule_work_identity_idx").on(
      table.accountId,
      table.remoteThreadId,
      table.ruleId,
      table.ruleVersion,
      table.profileVersion,
      table.actionFingerprint,
    ),
    index("mail_rule_work_due_idx").on(table.status, table.nextAttemptAt, table.dueAt),
    index("mail_rule_work_account_idx").on(table.accountId, table.status),
    index("mail_rule_work_thread_status_idx").on(table.threadId, table.status),
    index("mail_rule_work_user_status_idx").on(table.userId, table.accountId, table.status),
    check(
      "mail_rule_work_revision_check",
      sql`${table.ruleVersion} > 0 AND ${table.profileVersion} > 0`,
    ),
    check(
      "mail_rule_work_action_fingerprint_check",
      sql`${table.actionFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "mail_rule_work_attempt_count_check",
      sql`${table.attemptCount} >= 0 AND ${table.attemptCount} <= 5`,
    ),
    check(
      "mail_rule_work_provider_effect_check",
      sql`${table.providerEffect} IN ('none', 'rejected', 'indeterminate', 'applied')`,
    ),
    check(
      "mail_rule_work_claim_mode_check",
      sql`${table.claimMode} IS NULL OR ${table.claimMode} IN ('execute', 'reconcile')`,
    ),
    check(
      "mail_rule_work_claim_state_check",
      sql`
        (
          ${table.status} = 'claimed'
          AND ${table.claimId} IS NOT NULL
          AND ${table.claimedAt} IS NOT NULL
          AND ${table.claimMode} IS NOT NULL
          AND ${table.completedAt} IS NULL
        )
        OR (
          ${table.status} IN ('pending', 'reconcile')
          AND ${table.claimId} IS NULL
          AND ${table.claimedAt} IS NULL
          AND ${table.claimMode} IS NULL
          AND ${table.completedAt} IS NULL
        )
        OR (
          ${table.status} IN ('succeeded', 'failed')
          AND ${table.claimId} IS NULL
          AND ${table.claimedAt} IS NULL
          AND ${table.claimMode} IS NULL
          AND ${table.completedAt} IS NOT NULL
        )
      `,
    ),
  ],
);

export const calendars = pgTable(
  "calendars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => calendarAccounts.id, { onDelete: "cascade" }),
    provider: text("provider").$type<CalendarProvider>().notNull(),
    remoteCalendarId: text("remote_calendar_id"),
    name: text("name").notNull(),
    color: text("color"),
    timezone: text("timezone").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    isSelected: boolean("is_selected").notNull().default(true),
    isWritable: boolean("is_writable").notNull().default(true),
    syncToken: text("sync_token"),
    syncStartedAt: timestamp("sync_started_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("calendars_user_idx").on(table.userId),
    uniqueIndex("calendars_remote_idx").on(table.accountId, table.remoteCalendarId),
  ],
);

export const connectorSubscriptions = pgTable(
  "connector_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => calendarAccounts.id, { onDelete: "cascade" }),
    provider: text("provider").$type<"google" | "icloud">().notNull(),
    kind: text("kind").$type<ConnectorSubscriptionKind>().notNull(),
    calendarId: uuid("calendar_id").references(() => calendars.id, { onDelete: "cascade" }),
    channelId: text("channel_id"),
    remoteResourceId: text("remote_resource_id"),
    remoteIdentityHash: text("remote_identity_hash"),
    verificationTokenHash: text("verification_token_hash"),
    providerCursor: text("provider_cursor"),
    status: text("status").$type<ConnectorSubscriptionStatus>().notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    renewAfter: timestamp("renew_after", { withTimezone: true }),
    lastNotificationAt: timestamp("last_notification_at", { withTimezone: true }),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    failureCount: integer("failure_count").notNull().default(0),
    safeFailureCode: text("safe_failure_code"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    leaseClaimId: uuid("lease_claim_id"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("connector_subscriptions_identity_idx").on(
      table.accountId,
      table.kind,
      sql`COALESCE(${table.calendarId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    uniqueIndex("connector_subscriptions_channel_idx").on(table.channelId),
    index("connector_subscriptions_due_idx").on(table.status, table.nextAttemptAt),
    check("connector_subscriptions_provider_check", sql`${table.provider} IN ('google', 'icloud')`),
    check(
      "connector_subscriptions_kind_check",
      sql`${table.kind} IN ('gmail_mailbox', 'google_calendar_list', 'google_calendar_events', 'icloud_mail_idle')`,
    ),
    check(
      "connector_subscriptions_status_check",
      sql`${table.status} IN ('pending', 'active', 'renewing', 'expired', 'failed', 'stopped')`,
    ),
    check("connector_subscriptions_failure_count_check", sql`${table.failureCount} >= 0`),
    check(
      "connector_subscriptions_lease_check",
      sql`(${table.leaseClaimId} IS NULL) = (${table.leaseExpiresAt} IS NULL)`,
    ),
  ],
);

export const connectorSyncTriggers = pgTable(
  "connector_sync_triggers",
  {
    accountId: uuid("account_id")
      .primaryKey()
      .references(() => calendarAccounts.id, { onDelete: "cascade" }),
    reason: text("reason").$type<ConnectorSyncTriggerReason>().notNull(),
    firstTriggeredAt: timestamp("first_triggered_at", { withTimezone: true }).notNull(),
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }).notNull(),
    notificationCount: integer("notification_count").notNull().default(1),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    claimId: uuid("claim_id"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("connector_sync_triggers_due_idx").on(table.availableAt),
    check(
      "connector_sync_triggers_reason_check",
      sql`${table.reason} IN ('initial', 'notification', 'reconciliation', 'manual', 'retry', 'recovery')`,
    ),
    check(
      "connector_sync_triggers_count_check",
      sql`${table.notificationCount} BETWEEN 1 AND 1000000`,
    ),
    check(
      "connector_sync_triggers_time_check",
      sql`${table.firstTriggeredAt} <= ${table.lastTriggeredAt}`,
    ),
    check(
      "connector_sync_triggers_claim_check",
      sql`(${table.claimId} IS NULL) = (${table.claimExpiresAt} IS NULL)`,
    ),
  ],
);

export type RawCalendarEvent = Record<string, unknown>;

export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => calendars.id, { onDelete: "cascade" }),
    provider: text("provider").$type<CalendarProvider>().notNull(),
    blockSourceEventId: uuid("block_source_event_id").references(
      (): AnyPgColumn => calendarEvents.id,
      { onDelete: "cascade" },
    ),
    blockMode: text("block_mode").$type<"busy" | "details">(),
    remoteEventId: text("remote_event_id"),
    remoteEtag: text("remote_etag"),
    title: text("title").notNull(),
    notes: text("notes"),
    location: text("location"),
    conferenceUrl: text("conference_url"),
    url: text("url"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull(),
    allDay: boolean("all_day").notNull().default(false),
    status: text("status")
      .$type<"confirmed" | "tentative" | "cancelled">()
      .notNull()
      .default("confirmed"),
    recurrence: jsonb("recurrence").$type<string[]>().notNull().default([]),
    eventType: text("event_type")
      .$type<"default" | "focus" | "out_of_office">()
      .notNull()
      .default("default"),
    transparency: text("transparency").$type<"busy" | "free">().notNull().default("busy"),
    visibility: text("visibility")
      .$type<"default" | "private" | "public">()
      .notNull()
      .default("default"),
    reminders: jsonb("reminders").$type<Array<{ minutes: number }>>().notNull().default([]),
    attendees: jsonb("attendees")
      .$type<
        Array<{
          email: string;
          name: string | null;
          response: "needs_action" | "accepted" | "declined" | "tentative";
          isOrganizer: boolean;
        }>
      >()
      .notNull()
      .default([]),
    raw: jsonb("raw").$type<RawCalendarEvent>(),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("calendar_events_user_time_idx").on(table.userId, table.startsAt, table.endsAt),
    index("calendar_events_calendar_time_idx").on(table.calendarId, table.startsAt),
    index("calendar_events_block_source_idx").on(table.blockSourceEventId),
    uniqueIndex("calendar_events_block_destination_idx")
      .on(table.blockSourceEventId, table.calendarId)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("calendar_events_remote_idx").on(table.calendarId, table.remoteEventId),
  ],
);

export const calendarFindings = pgTable(
  "calendar_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    kind: text("kind").$type<CalendarFindingKind>().notNull(),
    severity: text("severity").$type<CalendarFindingSeverity>().notNull(),
    status: text("status").$type<CalendarFindingStatus>().notNull().default("open"),
    summary: text("summary").notNull(),
    evidence: jsonb("evidence").$type<CalendarFindingEvidence>().notNull(),
    sourceReferences: jsonb("source_references")
      .$type<MaterialSourceReference[]>()
      .notNull()
      .default([]),
    evidenceCutoff: timestamp("evidence_cutoff", { withTimezone: true }).notNull(),
    playbookVersion: text("playbook_version").notNull(),
    rulebookVersion: text("rulebook_version").notNull(),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }).notNull(),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("calendar_findings_identity_idx").on(table.userId, table.fingerprint),
    index("calendar_findings_user_status_idx").on(table.userId, table.status, table.lastObservedAt),
    check("calendar_findings_fingerprint_check", sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
    check("calendar_findings_status_check", sql`${table.status} IN ('open', 'resolved')`),
    check(
      "calendar_findings_resolution_check",
      sql`(${table.status} = 'resolved') = (${table.resolvedAt} IS NOT NULL)`,
    ),
  ],
);

export const calendarReviews = pgTable(
  "calendar_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    state: text("state").$type<CalendarReviewState>().notNull(),
    scope: jsonb("scope").$type<CalendarMaintenanceScope>().notNull(),
    scopeStart: timestamp("scope_start", { withTimezone: true }).notNull(),
    scopeEnd: timestamp("scope_end", { withTimezone: true }).notNull(),
    evidenceCutoff: timestamp("evidence_cutoff", { withTimezone: true }).notNull(),
    nextMaintenanceAt: timestamp("next_maintenance_at", { withTimezone: true }).notNull(),
    playbookVersion: text("playbook_version").notNull(),
    rulebookVersion: text("rulebook_version").notNull(),
    profileVersion: integer("profile_version"),
    ledgerFingerprint: text("ledger_fingerprint").notNull(),
    sourceFreshness: jsonb("source_freshness").$type<CalendarSourceFreshness[]>().notNull(),
    health: jsonb("health").$type<CalendarHealthAssessment[]>().notNull(),
    findingSnapshots: jsonb("finding_snapshots").$type<CalendarFinding[]>().notNull(),
    recommendations: jsonb("recommendations").$type<CalendarRecommendation[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("calendar_reviews_user_created_idx").on(table.userId, table.createdAt),
    check("calendar_reviews_fingerprint_check", sql`${table.ledgerFingerprint} ~ '^[0-9a-f]{64}$'`),
    check(
      "calendar_reviews_state_check",
      sql`${table.state} IN ('maintained', 'maintained_with_questions', 'blocked')`,
    ),
    check(
      "calendar_reviews_scope_check",
      sql`${table.scopeStart} <= ${table.evidenceCutoff} AND ${table.evidenceCutoff} <= ${table.scopeEnd}`,
    ),
  ],
);

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    notes: text("notes"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    timezone: text("timezone"),
    priority: text("priority").$type<"low" | "medium" | "high">().notNull().default("medium"),
    kind: text("kind").$type<"reminder" | "task">().notNull().default("reminder"),
    status: text("status")
      .$type<"inbox" | "next" | "scheduled" | "completed" | "cancelled">()
      .notNull()
      .default("inbox"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    estimateMinutes: integer("estimate_minutes"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("reminders_user_due_idx").on(table.userId, table.completedAt, table.dueAt),
    index("reminders_user_task_idx").on(table.userId, table.kind, table.status, table.scheduledAt),
  ],
);

export const financeProviderItems = pgTable(
  "finance_provider_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<"plaid">().notNull(),
    providerItemId: text("provider_item_id"),
    legacyGroupingKey: text("legacy_grouping_key"),
    encryptedCredentials: jsonb("encrypted_credentials").$type<EncryptedCredentials>().notNull(),
    syncCursor: text("sync_cursor"),
    syncState: text("sync_state")
      .$type<"current" | "stale" | "retrying" | "blocked">()
      .notNull()
      .default("stale"),
    syncClaimId: uuid("sync_claim_id"),
    syncClaimOwner: text("sync_claim_owner"),
    syncClaimGeneration: integer("sync_claim_generation"),
    syncClaimStartedAt: timestamp("sync_claim_started_at", { withTimezone: true }),
    syncClaimExpiresAt: timestamp("sync_claim_expires_at", { withTimezone: true }),
    lastSyncAttemptAt: timestamp("last_sync_attempt_at", { withTimezone: true }),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true }),
    syncError: text("sync_error"),
    syncErrorCode: text("sync_error_code"),
    syncErrorCategory: text("sync_error_category").$type<ConnectorFailureCategory>(),
    syncRecovery: text("sync_recovery").$type<ConnectorSyncRecovery>(),
    syncFailureCount: integer("sync_failure_count").notNull().default(0),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("finance_provider_items_user_idx").on(table.userId),
    uniqueIndex("finance_provider_items_remote_identity_idx")
      .on(table.userId, table.provider, table.providerItemId)
      .where(sql`${table.providerItemId} IS NOT NULL`),
    uniqueIndex("finance_provider_items_legacy_identity_idx")
      .on(table.userId, table.provider, table.legacyGroupingKey)
      .where(sql`${table.legacyGroupingKey} IS NOT NULL`),
    index("finance_provider_items_sync_due_idx")
      .on(table.nextSyncAt, table.updatedAt)
      .where(sql`${table.nextSyncAt} IS NOT NULL`),
    index("finance_provider_items_sync_claim_recovery_idx")
      .on(table.syncClaimExpiresAt)
      .where(sql`${table.syncClaimId} IS NOT NULL`),
    check("finance_provider_items_provider_check", sql`${table.provider} = 'plaid'`),
    check(
      "finance_provider_items_identity_check",
      sql`${table.providerItemId} IS NOT NULL OR ${table.legacyGroupingKey} IS NOT NULL`,
    ),
    check(
      "finance_provider_items_sync_state_check",
      sql`${table.syncState} IN ('current', 'stale', 'retrying', 'blocked')`,
    ),
    check(
      "finance_provider_items_sync_claim_check",
      sql`num_nonnulls(${table.syncClaimId}, ${table.syncClaimOwner}, ${table.syncClaimGeneration}, ${table.syncClaimStartedAt}, ${table.syncClaimExpiresAt}) IN (0, 5)`,
    ),
    check(
      "finance_provider_items_sync_claim_generation_check",
      sql`${table.syncClaimGeneration} IS NULL OR ${table.syncClaimGeneration} >= 0`,
    ),
    check("finance_provider_items_sync_failure_count_check", sql`${table.syncFailureCount} >= 0`),
    check(
      "finance_provider_items_sync_failure_check",
      sql`(
        (${table.syncState} IN ('current', 'stale') AND ${table.syncFailureCount} = 0 AND ${table.syncError} IS NULL AND ${table.syncErrorCode} IS NULL AND ${table.syncErrorCategory} IS NULL AND ${table.syncRecovery} IS NULL)
        OR
        (${table.syncState} = 'retrying' AND ${table.syncFailureCount} > 0 AND ${table.syncError} IS NOT NULL AND ${table.syncErrorCode} IS NOT NULL AND ${table.syncErrorCategory} IS NOT NULL AND ${table.syncRecovery} IS NOT NULL AND ${table.syncErrorCategory} IN ('authorization', 'configuration', 'invalid_response', 'not_found', 'rate_limited', 'rejected', 'temporary', 'transport', 'unknown') AND ${table.syncRecovery} = 'automatic')
        OR
        (${table.syncState} = 'blocked' AND ${table.syncFailureCount} > 0 AND ${table.syncError} IS NOT NULL AND ${table.syncErrorCode} IS NOT NULL AND ${table.syncErrorCategory} IS NOT NULL AND ${table.syncRecovery} IS NOT NULL AND ${table.syncErrorCategory} IN ('authorization', 'configuration', 'invalid_response', 'not_found', 'rate_limited', 'rejected', 'temporary', 'transport', 'unknown') AND ${table.syncRecovery} IN ('operator', 'reconnect'))
      )`,
    ),
  ],
);

export const financeAutomationSettings = pgTable("finance_automation_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  reviewBypassEnabled: boolean("review_bypass_enabled").notNull().default(false),
  ...timestamps,
});

export const financeAccounts = pgTable(
  "finance_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<FinanceProvider>().notNull(),
    institution: text("institution").notNull(),
    name: text("name").notNull(),
    kind: text("kind").$type<"cash" | "investment" | "debt" | "other">().notNull().default("cash"),
    balance: integer("balance_cents"),
    currencyCode: text("currency_code"),
    status: text("status")
      .$type<"connected" | "needs_reauth" | "manual">()
      .notNull()
      .default("manual"),
    encryptedCredentials: jsonb("encrypted_credentials").$type<EncryptedCredentials>(),
    providerAccountId: text("provider_account_id"),
    providerItemId: text("provider_item_id"),
    providerItemRecordId: uuid("provider_item_record_id").references(
      () => financeProviderItems.id,
      {
        onDelete: "set null",
      },
    ),
    syncCursor: text("sync_cursor"),
    syncState: text("sync_state")
      .$type<"current" | "stale" | "retrying" | "blocked">()
      .notNull()
      .default("stale"),
    syncClaimId: uuid("sync_claim_id"),
    syncClaimExpiresAt: timestamp("sync_claim_expires_at", { withTimezone: true }),
    lastSyncAttemptAt: timestamp("last_sync_attempt_at", { withTimezone: true }),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true }),
    syncError: text("sync_error"),
    syncErrorCode: text("sync_error_code"),
    syncErrorCategory: text("sync_error_category").$type<ConnectorFailureCategory>(),
    syncRecovery: text("sync_recovery").$type<ConnectorSyncRecovery>(),
    syncFailureCount: integer("sync_failure_count").notNull().default(0),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("finance_accounts_user_idx").on(table.userId),
    index("finance_accounts_provider_item_record_id_idx").on(table.providerItemRecordId),
    index("finance_accounts_sync_claim_idx")
      .on(table.syncClaimExpiresAt)
      .where(sql`${table.syncClaimId} IS NOT NULL`),
    index("finance_accounts_sync_due_idx")
      .on(table.nextSyncAt, table.updatedAt)
      .where(sql`${table.provider} = 'plaid' AND ${table.nextSyncAt} IS NOT NULL`),
    index("finance_accounts_sync_initialization_idx")
      .on(table.id)
      .where(sql`(
        (${table.provider} = 'manual' AND ${table.syncState} = 'stale' AND ${table.nextSyncAt} IS NULL)
        OR
        (${table.provider} = 'plaid' AND ${table.status} = 'connected' AND ${table.syncState} = 'stale' AND ${table.nextSyncAt} IS NULL)
      )`),
    uniqueIndex("finance_accounts_provider_idx").on(
      table.userId,
      table.provider,
      table.providerAccountId,
    ),
    check(
      "finance_accounts_sync_state_check",
      sql`${table.syncState} IN ('current', 'stale', 'retrying', 'blocked')`,
    ),
    check(
      "finance_accounts_currency_code_check",
      sql`${table.currencyCode} IS NULL OR ${table.currencyCode} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "finance_accounts_sync_claim_check",
      sql`(${table.syncClaimId} IS NULL) = (${table.syncClaimExpiresAt} IS NULL)`,
    ),
    check("finance_accounts_sync_failure_count_check", sql`${table.syncFailureCount} >= 0`),
    check(
      "finance_accounts_sync_failure_check",
      sql`(
        (${table.syncState} IN ('current', 'stale') AND ${table.syncFailureCount} = 0 AND ${table.syncError} IS NULL AND ${table.syncErrorCode} IS NULL AND ${table.syncErrorCategory} IS NULL AND ${table.syncRecovery} IS NULL)
        OR
        (${table.syncState} = 'retrying' AND ${table.syncFailureCount} > 0 AND ${table.syncError} IS NOT NULL AND ${table.syncErrorCode} IS NOT NULL AND ${table.syncErrorCategory} IN ('authorization', 'configuration', 'invalid_response', 'not_found', 'rate_limited', 'rejected', 'temporary', 'transport', 'unknown') AND ${table.syncRecovery} = 'automatic')
        OR
        (${table.syncState} = 'blocked' AND ${table.syncFailureCount} > 0 AND ${table.syncError} IS NOT NULL AND ${table.syncErrorCode} IS NOT NULL AND ${table.syncErrorCategory} IN ('authorization', 'configuration', 'invalid_response', 'not_found', 'rate_limited', 'rejected', 'temporary', 'transport', 'unknown') AND ${table.syncRecovery} IN ('operator', 'reconnect'))
      )`,
    ),
  ],
);

export const financeCategories = pgTable(
  "finance_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    group: text("group").notNull(),
    color: text("color"),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("finance_categories_id_user_id_unique").on(table.id, table.userId),
    index("finance_categories_user_idx").on(table.userId),
    uniqueIndex("finance_categories_user_slug_idx").on(table.userId, table.slug),
  ],
);

export const financeMerchants = pgTable(
  "finance_merchants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    behavior: text("behavior")
      .$type<"unknown" | "consistent" | "mixed">()
      .notNull()
      .default("unknown"),
    isUserConfirmed: boolean("is_user_confirmed").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("finance_merchants_user_idx").on(table.userId),
    uniqueIndex("finance_merchants_user_normalized_idx").on(table.userId, table.normalizedName),
  ],
);

export const financeMerchantAliases = pgTable(
  "finance_merchant_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => financeMerchants.id, { onDelete: "cascade" }),
    rawName: text("raw_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    confidence: integer("confidence_basis_points").notNull().default(10_000),
    source: text("source").$type<"agent" | "provider" | "user">().notNull(),
    ...timestamps,
  },
  (table) => [
    index("finance_merchant_aliases_merchant_idx").on(table.merchantId),
    uniqueIndex("finance_merchant_aliases_user_normalized_idx").on(
      table.userId,
      table.normalizedName,
    ),
  ],
);

export const financeTransactions = pgTable(
  "finance_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => financeAccounts.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id").references(() => financeMerchants.id, { onDelete: "set null" }),
    categoryId: uuid("category_id").references(() => financeCategories.id, {
      onDelete: "set null",
    }),
    providerTransactionId: text("provider_transaction_id"),
    pendingTransactionId: text("pending_transaction_id"),
    providerCategory: text("provider_category"),
    providerCategoryDetailed: text("provider_category_detailed"),
    providerCategoryConfidence: text("provider_category_confidence"),
    providerDirection: text("provider_direction").$type<"expense" | "income">(),
    merchant: text("merchant").notNull(),
    amount: integer("amount_cents").notNull(),
    currencyCode: text("currency_code"),
    direction: text("direction").$type<TransactionDirection>().notNull(),
    transactionDate: text("transaction_date").notNull(),
    category: text("category"),
    categoryConfidence: integer("category_confidence_basis_points"),
    categorySource: text("category_source").$type<"agent" | "provider" | "rule" | "user">(),
    categoryRationale: text("category_rationale"),
    categoryDecidedAt: timestamp("category_decided_at", { withTimezone: true }),
    needsReview: boolean("needs_review").notNull().default(true),
    pending: boolean("pending").notNull().default(false),
    reconciliationStatus: text("reconciliation_status")
      .$type<"candidate" | "confirmed" | "matched" | "not_applicable">()
      .notNull()
      .default("not_applicable"),
    transferGroupId: uuid("transfer_group_id"),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("finance_transactions_id_user_id_unique").on(table.id, table.userId),
    index("finance_transactions_user_date_idx").on(table.userId, table.transactionDate),
    index("finance_transactions_review_idx").on(table.userId, table.needsReview),
    index("finance_transactions_merchant_idx").on(table.userId, table.merchantId),
    index("finance_transactions_reconciliation_idx").on(table.userId, table.reconciliationStatus),
    uniqueIndex("finance_transactions_provider_idx").on(
      table.accountId,
      table.providerTransactionId,
    ),
    check(
      "finance_transactions_provider_direction_check",
      sql`${table.providerDirection} IS NULL OR ${table.providerDirection} IN ('expense', 'income')`,
    ),
    check(
      "finance_transactions_currency_code_check",
      sql`${table.currencyCode} IS NULL OR ${table.currencyCode} ~ '^[A-Z]{3}$'`,
    ),
  ],
);

export const financeTransactionAllocations = pgTable(
  "finance_transaction_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => financeTransactions.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => financeCategories.id, { onDelete: "restrict" }),
    amount: integer("amount_cents").notNull(),
    allocationOrder: integer("allocation_order").notNull(),
    treatment: text("treatment").$type<"personal" | "reimbursable">().notNull().default("personal"),
    rationale: text("rationale"),
    revision: integer("revision").notNull().default(1),
    state: text("state").$type<"active" | "invalidated">().notNull().default("active"),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check("finance_transaction_allocations_amount_check", sql`${table.amount} > 0`),
    check("finance_transaction_allocations_order_check", sql`${table.allocationOrder} >= 0`),
    check(
      "finance_transaction_allocations_treatment_check",
      sql`${table.treatment} IN ('personal', 'reimbursable')`,
    ),
    check(
      "finance_transaction_allocations_state_check",
      sql`${table.state} IN ('active', 'invalidated')`,
    ),
    index("finance_transaction_allocations_user_category_idx").on(table.userId, table.categoryId),
    uniqueIndex("finance_transaction_allocations_id_user_id_unique").on(table.id, table.userId),
    uniqueIndex("finance_transaction_allocations_transaction_order_idx")
      .on(table.transactionId, table.allocationOrder)
      .where(sql`${table.state} = 'active'`),
    foreignKey({
      columns: [table.transactionId, table.userId],
      foreignColumns: [financeTransactions.id, financeTransactions.userId],
      name: "finance_transaction_allocations_transaction_user_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.categoryId, table.userId],
      foreignColumns: [financeCategories.id, financeCategories.userId],
      name: "finance_transaction_allocations_category_user_fk",
    }).onDelete("restrict"),
  ],
);

/** Money owed for a reimbursable allocation; bank cash remains on its transaction. */
export const financeReimbursements = pgTable(
  "finance_reimbursements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    allocationId: uuid("allocation_id")
      .notNull()
      .references(() => financeTransactionAllocations.id, { onDelete: "restrict" }),
    expectedAmount: integer("expected_amount_cents").notNull(),
    receivedAmount: integer("received_amount_cents").notNull().default(0),
    payer: text("payer"),
    dueDate: text("due_date"),
    evidence: jsonb("evidence").notNull().default({}),
    rationale: text("rationale").notNull(),
    status: text("status")
      .$type<
        "expected" | "partially_received" | "received" | "overdue" | "cancelled" | "needs_input"
      >()
      .notNull()
      .default("expected"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledEvidence: jsonb("cancelled_evidence"),
    cancelledRationale: text("cancelled_rationale"),
    revision: integer("revision").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    check("finance_reimbursements_expected_amount_check", sql`${table.expectedAmount} > 0`),
    check(
      "finance_reimbursements_received_amount_check",
      sql`${table.receivedAmount} >= 0 AND ${table.receivedAmount} <= ${table.expectedAmount}`,
    ),
    check(
      "finance_reimbursements_status_check",
      sql`${table.status} IN ('expected', 'partially_received', 'received', 'overdue', 'cancelled', 'needs_input')`,
    ),
    foreignKey({
      columns: [table.allocationId, table.userId],
      foreignColumns: [financeTransactionAllocations.id, financeTransactionAllocations.userId],
      name: "finance_reimbursements_allocation_user_fk",
    }).onDelete("restrict"),
    uniqueIndex("finance_reimbursements_id_user_id_unique").on(table.id, table.userId),
    index("finance_reimbursements_user_status_due_idx").on(
      table.userId,
      table.status,
      table.dueDate,
    ),
    index("finance_reimbursements_user_allocation_idx").on(table.userId, table.allocationId),
  ],
);

/** A credit may settle several reimbursements and a reimbursement may receive several credits. */
export const financeReimbursementMatches = pgTable(
  "finance_reimbursement_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reimbursementId: uuid("reimbursement_id")
      .notNull()
      .references(() => financeReimbursements.id, { onDelete: "cascade" }),
    creditTransactionId: uuid("credit_transaction_id")
      .notNull()
      .references(() => financeTransactions.id, { onDelete: "restrict" }),
    amount: integer("amount_cents").notNull(),
    evidence: jsonb("evidence").notNull().default({}),
    rationale: text("rationale").notNull(),
    ...timestamps,
  },
  (table) => [
    check("finance_reimbursement_matches_amount_check", sql`${table.amount} > 0`),
    foreignKey({
      columns: [table.reimbursementId, table.userId],
      foreignColumns: [financeReimbursements.id, financeReimbursements.userId],
      name: "finance_reimbursement_matches_reimbursement_user_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.creditTransactionId, table.userId],
      foreignColumns: [financeTransactions.id, financeTransactions.userId],
      name: "finance_reimbursement_matches_credit_user_fk",
    }).onDelete("restrict"),
    uniqueIndex("finance_reimbursement_matches_reimbursement_credit_idx").on(
      table.reimbursementId,
      table.creditTransactionId,
    ),
    index("finance_reimbursement_matches_user_credit_idx").on(
      table.userId,
      table.creditTransactionId,
    ),
  ],
);

/** A real-world movement that can group transfers, refunds, reimbursements, and splits. */
export const financeEconomicEvents = pgTable(
  "finance_economic_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind")
      .$type<
        | "duplicate"
        | "income"
        | "other"
        | "purchase"
        | "refund"
        | "reimbursement"
        | "reversal"
        | "split"
        | "transfer"
      >()
      .notNull(),
    stableKey: text("stable_key").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("finance_economic_events_user_stable_key_idx").on(table.userId, table.stableKey),
    index("finance_economic_events_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

export const financeEventTransactions = pgTable(
  "finance_event_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    economicEventId: uuid("economic_event_id")
      .notNull()
      .references(() => financeEconomicEvents.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => financeTransactions.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("finance_event_transactions_event_transaction_idx").on(
      table.economicEventId,
      table.transactionId,
    ),
    uniqueIndex("finance_event_transactions_transaction_idx").on(table.transactionId),
  ],
);

export const financeTransactionRevisions = pgTable(
  "finance_transaction_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => financeTransactions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    changes: jsonb("changes").$type<Record<string, unknown>>().notNull(),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("finance_transaction_revisions_transaction_version_idx").on(
      table.transactionId,
      table.version,
    ),
    index("finance_transaction_revisions_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const financeTransactionRelationships = pgTable(
  "finance_transaction_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    economicEventId: uuid("economic_event_id")
      .notNull()
      .references(() => financeEconomicEvents.id, { onDelete: "cascade" }),
    relationship: text("relationship")
      .$type<"duplicate" | "refund" | "reimbursement" | "reversal" | "split" | "transfer">()
      .notNull(),
    transactionIds: jsonb("transaction_ids").$type<string[]>().notNull(),
    rationale: text("rationale").notNull(),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("finance_transaction_relationships_event_idx").on(table.economicEventId)],
);

export const financeClassificationDecisions = pgTable(
  "finance_classification_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => financeTransactions.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id").references(() => financeMerchants.id, { onDelete: "set null" }),
    categoryId: uuid("category_id").references(() => financeCategories.id, {
      onDelete: "set null",
    }),
    categoryName: text("category_name").notNull(),
    source: text("source").$type<"agent" | "provider" | "rule" | "user">().notNull(),
    confidence: integer("confidence_basis_points").notNull(),
    rationale: text("rationale"),
    outcome: text("outcome").$type<"applied" | "confirmed" | "corrected" | "deferred">().notNull(),
    ...timestamps,
  },
  (table) => [
    index("finance_classification_decisions_transaction_idx").on(table.transactionId),
    index("finance_classification_decisions_merchant_idx").on(table.userId, table.merchantId),
  ],
);

export const financeReviewCases = pgTable(
  "finance_review_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => financeTransactions.id, { onDelete: "cascade" }),
    economicEventId: uuid("economic_event_id").references(() => financeEconomicEvents.id, {
      onDelete: "set null",
    }),
    stableKey: text("stable_key").notNull().default(sql`'legacy:' || gen_random_uuid()::text`),
    status: text("status").$type<"deferred" | "open" | "resolved">().notNull().default("open"),
    reason: text("reason")
      .$type<
        | "ambiguous_merchant"
        | "amount_changed"
        | "low_confidence"
        | "one_time"
        | "possible_duplicate"
        | "possible_reimbursement"
        | "possible_transfer"
        | "refund_or_reversal"
        | "unknown_merchant"
      >()
      .notNull()
      .default("low_confidence"),
    reasonCode: text("reason_code")
      .$type<
        | "budget_variance"
        | "category_ambiguity"
        | "merchant_identity"
        | "missing_provenance"
        | "possible_duplicate"
        | "possible_transfer"
        | "profile_fact"
        | "recurring_status"
        | "refund_or_reversal"
        | "reimbursement"
        | "source_freshness"
        | "unusual_amount"
      >()
      .notNull()
      .default("missing_provenance"),
    suggestedCategoryId: uuid("suggested_category_id").references(() => financeCategories.id, {
      onDelete: "set null",
    }),
    rationale: text("rationale"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    proposedResolution: jsonb("proposed_resolution").$type<Record<string, unknown>>(),
    impactAmount: integer("impact_amount_cents").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    reopenedFromId: uuid("reopened_from_id").references((): AnyPgColumn => financeReviewCases.id, {
      onDelete: "set null",
    }),
    resolution: jsonb("resolution").$type<Record<string, unknown>>(),
    resolvedByActorType: text("resolved_by_actor_type").$type<ActorType>(),
    resolvedByActorId: text("resolved_by_actor_id"),
    resolutionProvenance: jsonb("resolution_provenance").$type<Record<string, unknown>>(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("finance_review_cases_user_status_idx").on(table.userId, table.status),
    uniqueIndex("finance_review_cases_active_stable_key_unique")
      .on(table.userId, table.stableKey)
      .where(sql`${table.status} in ('open', 'deferred')`),
    index("finance_review_cases_event_idx").on(table.economicEventId),
    index("finance_review_cases_reopened_idx").on(table.reopenedFromId),
  ],
);

/** Synchronous, caller-resumable maintenance protocol state; never a background job queue. */
export const financeMaintenanceRuns = pgTable(
  "finance_maintenance_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stage: text("stage")
      .$type<
        | "agent_audit"
        | "agent_reasoning"
        | "deterministic_processing"
        | "failed"
        | "reconciliation"
        | "settled"
      >()
      .notNull()
      .default("deterministic_processing"),
    scope: jsonb("scope").$type<Record<string, unknown>>().notNull(),
    version: integer("version").notNull().default(1),
    error: jsonb("error").$type<Record<string, unknown>>(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index("finance_maintenance_runs_user_stage_idx").on(table.userId, table.stage)],
);

export const financeMaintenanceJudgments = pgTable(
  "finance_maintenance_judgments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => financeMaintenanceRuns.id, { onDelete: "cascade" }),
    judgmentKey: text("judgment_key").notNull(),
    type: text("type")
      .$type<"classify_transaction" | "link_transactions" | "needs_user_review">()
      .notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    provenance: jsonb("provenance").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("finance_maintenance_judgments_run_key_idx").on(table.runId, table.judgmentKey),
  ],
);

export const financeAuditFindings = pgTable(
  "finance_audit_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => financeMaintenanceRuns.id, { onDelete: "cascade" }),
    economicEventId: uuid("economic_event_id")
      .notNull()
      .references(() => financeEconomicEvents.id, { onDelete: "cascade" }),
    stableKey: text("stable_key").notNull(),
    reasonCode: text("reason_code").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    impactAmount: integer("impact_amount_cents").notNull(),
    rationale: text("rationale").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("finance_audit_findings_run_stable_key_idx").on(table.runId, table.stableKey),
  ],
);

export const financeMutationRecords = pgTable(
  "finance_mutation_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    operation: text("operation").notNull(),
    requestHash: text("request_hash").notNull(),
    actorType: text("actor_type").$type<ActorType>().notNull(),
    actorId: text("actor_id"),
    status: text("status").$type<"completed" | "failed" | "started">().notNull(),
    response: jsonb("response").$type<Record<string, unknown>>(),
    error: jsonb("error").$type<Record<string, unknown>>(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("finance_mutation_records_user_key_idx").on(table.userId, table.idempotencyKey),
    index("finance_mutation_records_user_operation_idx").on(table.userId, table.operation),
    index("finance_mutation_records_started_lease_idx")
      .on(table.leaseExpiresAt)
      .where(sql`${table.status} = 'started'`),
  ],
);

export const financeAccountConnections = pgTable(
  "finance_account_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: text("status")
      .$type<"connected" | "disconnected" | "failed" | "needs_reauth" | "pending">()
      .notNull()
      .default("pending"),
    accountIds: jsonb("account_ids").$type<string[]>().notNull().default([]),
    externalHandoffUrl: text("external_handoff_url"),
    externalHandoffExpiresAt: timestamp("external_handoff_expires_at", { withTimezone: true }),
    lastError: jsonb("last_error").$type<Record<string, unknown>>(),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [index("finance_account_connections_user_status_idx").on(table.userId, table.status)],
);

export const financeCategoryRules = pgTable(
  "finance_category_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    merchantNormalized: text("merchant_normalized").notNull(),
    category: text("category").notNull(),
    rationale: text("rationale"),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    index("finance_category_rules_user_idx").on(table.userId),
    uniqueIndex("finance_category_rules_merchant_idx").on(table.userId, table.merchantNormalized),
  ],
);

export const financeBudgets = pgTable(
  "finance_budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    month: text("month").notNull(),
    limit: integer("limit_cents").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("finance_budgets_user_category_month_idx").on(
      table.userId,
      table.category,
      table.month,
    ),
  ],
);

/** Per-user controls for agent-initiated Finance mutations. */
export const financeAgentSettings = pgTable("finance_agent_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  reviewBypassEnabled: boolean("review_bypass_enabled").notNull().default(false),
  version: integer("version").notNull().default(1),
  ...timestamps,
});

/** Immutable snapshots of the facts used to give financial guidance. */
export const financeProfileVersions = pgTable(
  "finance_profile_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    jurisdiction: text("jurisdiction"),
    householdSize: integer("household_size"),
    dependents: integer("dependents"),
    expectedMonthlyTakeHome: integer("expected_monthly_take_home_cents"),
    incomeStability: text("income_stability")
      .$type<"seasonal" | "stable" | "unknown" | "variable">()
      .notNull()
      .default("unknown"),
    liquidReserves: integer("liquid_reserves_cents"),
    debts: jsonb("debts").$type<Record<string, unknown>[]>().notNull().default([]),
    insurance: jsonb("insurance").$type<Record<string, unknown>[]>().notNull().default([]),
    preferences: jsonb("preferences")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({ notes: [] }),
    employment: jsonb("employment").$type<Record<string, unknown>>(),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
    sourceLegacyProfileId: uuid("source_legacy_profile_id").references(() => financeProfiles.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("finance_profile_versions_user_version_idx").on(table.userId, table.version),
    index("finance_profile_versions_user_created_idx").on(table.userId, table.createdAt),
  ],
);

/** Stable identity for a budget; revisions are stored in finance_budget_versions. */
export const financeBudgetPlans = pgTable(
  "finance_budget_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    month: text("month").notNull().default(sql`'canonical-' || gen_random_uuid()::text`),
    goalIds: jsonb("goal_ids").$type<string[]>().notNull().default([]),
    assumptions: jsonb("assumptions").$type<string[]>().notNull().default([]),
    rationale: text("rationale").notNull().default(""),
    replace: boolean("replace_existing").notNull().default(true),
    scenarioFingerprint: text("scenario_fingerprint"),
    version: integer("version").notNull().default(1),
    name: text("name").notNull().default("Monthly plan"),
    status: text("status").$type<"active" | "archived">().notNull().default("active"),
    ...timestamps,
  },
  (table) => [
    index("finance_budget_plans_user_status_idx").on(table.userId, table.status),
    uniqueIndex("finance_budget_plans_user_month_idx").on(table.userId, table.month),
  ],
);

export const financeGoals = pgTable(
  "finance_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    targetAmount: integer("target_amount_cents").notNull(),
    currentAmount: integer("current_amount_cents").notNull().default(0),
    deadline: text("deadline"),
    priority: text("priority").$type<"high" | "low" | "medium">().notNull().default("medium"),
    status: text("status")
      .$type<"active" | "completed" | "paused" | "removed">()
      .notNull()
      .default("active"),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [index("finance_goals_user_status_idx").on(table.userId, table.status)],
);

export const financeBudgetVersions = pgTable(
  "finance_budget_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => financeBudgetPlans.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status")
      .$type<"active" | "incomplete" | "proposed" | "retired">()
      .notNull()
      .default("incomplete"),
    effectiveFrom: text("effective_from").notNull(),
    expectedResources: integer("expected_resources_cents").notNull(),
    allocatedTotal: integer("allocated_total_cents").notNull(),
    balanceDelta: integer("balance_delta_cents").notNull(),
    resources: jsonb("resources").$type<Record<string, unknown>[]>().notNull().default([]),
    assumptions: jsonb("assumptions").$type<string[]>().notNull().default([]),
    rationale: text("rationale").notNull(),
    createdByActorType: text("created_by_actor_type").$type<ActorType>(),
    createdByActorId: text("created_by_actor_id"),
    approvedByActorType: text("approved_by_actor_type").$type<ActorType>(),
    approvedByActorId: text("approved_by_actor_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("finance_budget_versions_plan_version_idx").on(table.planId, table.version),
    index("finance_budget_versions_user_status_idx").on(
      table.userId,
      table.status,
      table.effectiveFrom,
    ),
    uniqueIndex("finance_budget_versions_user_active_month_idx")
      .on(table.userId, table.effectiveFrom)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const financeBudgetAllocations = pgTable(
  "finance_budget_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    budgetVersionId: uuid("budget_version_id")
      .notNull()
      .references(() => financeBudgetVersions.id, { onDelete: "cascade" }),
    allocationKey: text("allocation_key").notNull(),
    kind: text("kind").$type<"buffer" | "debt" | "goal" | "savings" | "spending">().notNull(),
    amount: integer("amount_cents").notNull(),
    description: text("description"),
    categoryId: uuid("category_id").references(() => financeCategories.id, {
      onDelete: "set null",
    }),
    accountId: uuid("account_id").references(() => financeAccounts.id, {
      onDelete: "set null",
    }),
    goalId: uuid("goal_id").references(() => financeGoals.id, { onDelete: "set null" }),
    legacyCategory: text("legacy_category"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("finance_budget_allocations_version_key_idx").on(
      table.budgetVersionId,
      table.allocationKey,
    ),
    index("finance_budget_allocations_user_idx").on(table.userId),
  ],
);

/** Resumable chat setup state. It does not represent a scheduled or background job. */
export const financeSetupSessions = pgTable(
  "finance_setup_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<
        | "budget_approval"
        | "budget_proposal"
        | "collecting_profile"
        | "initial_maintenance"
        | "settled"
      >()
      .notNull()
      .default("collecting_profile"),
    currentQuestionKey: text("current_question_key"),
    budgetVersionId: uuid("budget_version_id").references(() => financeBudgetVersions.id, {
      onDelete: "set null",
    }),
    maintenanceRunId: uuid("maintenance_run_id").references(() => financeMaintenanceRuns.id, {
      onDelete: "set null",
    }),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("finance_setup_sessions_user_status_idx").on(table.userId, table.status),
    uniqueIndex("finance_setup_sessions_user_active_idx")
      .on(table.userId)
      .where(sql`${table.status} <> 'settled'`),
  ],
);

/** User-authored baseline for financial inference. Effective-dated rather than overwritten. */
export const financeProfiles = pgTable(
  "finance_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    employer: text("employer"),
    role: text("role"),
    employmentType: text("employment_type").$type<
      "contract" | "full_time" | "part_time" | "self_employed" | "unemployed"
    >(),
    grossAnnualIncome: integer("gross_annual_income_cents"),
    expectedNetPay: integer("expected_net_pay_cents"),
    payFrequency: text("pay_frequency").$type<
      "biweekly" | "irregular" | "monthly" | "semimonthly" | "weekly"
    >(),
    nextPayday: text("next_payday"),
    payAccountId: uuid("pay_account_id").references(() => financeAccounts.id, {
      onDelete: "set null",
    }),
    effectiveDate: text("effective_date").notNull(),
    householdSize: integer("household_size"),
    dependents: integer("dependents"),
    housingStatus: text("housing_status").$type<"owning" | "renting" | "shared" | "other">(),
    monthlyHousingCost: integer("monthly_housing_cost_cents"),
    reserveTargetMonths: integer("reserve_target_months"),
    investmentRiskWillingness: text("investment_risk_willingness").$type<
      "conservative" | "balanced" | "growth"
    >(),
    investmentRiskCapacity: text("investment_risk_capacity").$type<"low" | "moderate" | "high">(),
    ...timestamps,
  },
  (table) => [
    index("finance_profiles_user_effective_idx").on(table.userId, table.effectiveDate),
    uniqueIndex("finance_profiles_user_effective_idx_unique").on(table.userId, table.effectiveDate),
  ],
);

/**
 * Durable, user-owned approval records for prepared Finance actions. The
 * private payload stays in this Finance-only record; review surfaces receive
 * only the bounded `safeChanges` projection.
 */
export const financeAgentActionReviews = pgTable(
  "finance_agent_action_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestingAgentId: text("requesting_agent_id").notNull(),
    sourceRefs: jsonb("source_refs").$type<Array<Record<string, unknown>>>().notNull().default([]),
    actionKind: text("action_kind").notNull(),
    privatePayload: jsonb("private_payload").$type<Record<string, unknown>>().notNull(),
    safeChanges: jsonb("safe_changes")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    semanticTargetKeys: jsonb("semantic_target_keys").$type<string[]>().notNull().default([]),
    maintenanceRunId: uuid("maintenance_run_id").references(() => workspaceMaintenanceRuns.id, {
      onDelete: "set null",
    }),
    expectedRevision: text("expected_revision"),
    fingerprint: text("fingerprint").notNull(),
    status: text("status")
      .$type<"pending" | "applied" | "dismissed" | "superseded">()
      .notNull()
      .default("pending"),
    ...timestamps,
  },
  (table) => [
    index("finance_agent_action_reviews_user_status_idx").on(
      table.userId,
      table.status,
      table.createdAt,
    ),
    uniqueIndex("finance_agent_action_reviews_pending_fingerprint_idx")
      .on(table.userId, table.fingerprint)
      .where(sql`${table.status} = 'pending'`),
    index("finance_agent_action_reviews_target_keys_idx").using("gin", table.semanticTargetKeys),
  ],
);

export const financeIncomeStreams = pgTable(
  "finance_income_streams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => financeAccounts.id, { onDelete: "set null" }),
    payer: text("payer").notNull(),
    displayName: text("display_name").notNull(),
    cadence: text("cadence")
      .$type<"biweekly" | "irregular" | "monthly" | "semimonthly" | "weekly">()
      .notNull(),
    expectedAmount: integer("expected_amount_cents").notNull(),
    amountTolerance: integer("amount_tolerance_cents").notNull(),
    nextExpectedDate: text("next_expected_date"),
    lastObservedDate: text("last_observed_date"),
    confidence: integer("confidence_basis_points").notNull(),
    source: text("source").$type<"inferred" | "user">().notNull(),
    status: text("status")
      .$type<"active" | "needs_review" | "paused">()
      .notNull()
      .default("needs_review"),
    ...timestamps,
  },
  (table) => [
    index("finance_income_streams_user_status_idx").on(table.userId, table.status),
    uniqueIndex("finance_income_streams_user_payer_idx").on(table.userId, table.payer),
  ],
);

export const financeRecurringObligations = pgTable(
  "finance_recurring_obligations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => financeAccounts.id, { onDelete: "set null" }),
    merchantId: uuid("merchant_id").references(() => financeMerchants.id, { onDelete: "set null" }),
    merchant: text("merchant").notNull(),
    displayName: text("display_name").notNull(),
    kind: text("kind").$type<"bill" | "savings" | "subscription">().notNull(),
    cadence: text("cadence")
      .$type<"biweekly" | "irregular" | "monthly" | "quarterly" | "weekly" | "yearly">()
      .notNull(),
    expectedAmount: integer("expected_amount_cents").notNull(),
    amountTolerance: integer("amount_tolerance_cents").notNull(),
    nextExpectedDate: text("next_expected_date"),
    lastObservedDate: text("last_observed_date"),
    confidence: integer("confidence_basis_points").notNull(),
    source: text("source").$type<"inferred" | "user">().notNull(),
    status: text("status")
      .$type<"active" | "cancelled" | "needs_review" | "paused">()
      .notNull()
      .default("needs_review"),
    ...timestamps,
  },
  (table) => [
    index("finance_recurring_user_status_idx").on(table.userId, table.status),
    uniqueIndex("finance_recurring_user_merchant_idx").on(table.userId, table.merchant),
  ],
);

export const financeAlerts = pgTable(
  "finance_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    incomeStreamId: uuid("income_stream_id").references(() => financeIncomeStreams.id, {
      onDelete: "cascade",
    }),
    recurringObligationId: uuid("recurring_obligation_id").references(
      () => financeRecurringObligations.id,
      { onDelete: "cascade" },
    ),
    transactionId: uuid("transaction_id").references(() => financeTransactions.id, {
      onDelete: "set null",
    }),
    type: text("type")
      .$type<
        | "income_changed"
        | "income_missing"
        | "recurring_amount_changed"
        | "recurring_missing"
        | "subscription_price_changed"
      >()
      .notNull(),
    severity: text("severity").$type<"info" | "warning">().notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<"dismissed" | "open" | "resolved">().notNull().default("open"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("finance_alerts_user_status_idx").on(table.userId, table.status, table.createdAt),
    uniqueIndex("finance_alerts_open_fingerprint_idx").on(
      table.userId,
      table.type,
      table.incomeStreamId,
      table.recurringObligationId,
      table.status,
    ),
  ],
);

export const textingConnections = pgTable(
  "texting_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    encryptedPhoneNumber: jsonb("encrypted_phone_number").$type<EncryptedCredentials>().notNull(),
    phoneFingerprint: text("phone_fingerprint").notNull(),
    phoneLastFour: text("phone_last_four").notNull(),
    country: text("country").$type<TextingCountry>().notNull(),
    state: text("state").$type<TextingConnectionState>().notNull().default("active"),
    consentVersion: text("consent_version").notNull(),
    consentEpoch: integer("consent_epoch").notNull().default(1),
    conversationRevision: integer("conversation_revision").notNull().default(0),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("texting_connections_user_idx").on(table.userId),
    uniqueIndex("texting_connections_active_phone_idx")
      .on(table.phoneFingerprint)
      .where(sql`${table.state} <> 'disconnected'`),
  ],
);

export const textingVerificationChallenges = pgTable(
  "texting_verification_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    encryptedPhoneNumber: jsonb("encrypted_phone_number").$type<EncryptedCredentials>().notNull(),
    phoneFingerprint: text("phone_fingerprint").notNull(),
    phoneLastFour: text("phone_last_four").notNull(),
    country: text("country").$type<TextingCountry>().notNull(),
    providerVerificationSid: text("provider_verification_sid"),
    consentVersion: text("consent_version").notNull(),
    status: text("status")
      .$type<
        "starting" | "pending" | "approved" | "expired" | "failed" | "uncertain" | "cancelled"
      >()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("texting_verification_user_idx").on(table.userId, table.createdAt)],
);

export const textMessages = pgTable(
  "text_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => textingConnections.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerMessageSid: text("provider_message_sid"),
    direction: text("direction").$type<TextMessageDirection>().notNull(),
    status: text("status").$type<TextMessageStatus>().notNull(),
    body: text("body").notNull(),
    contentKind: text("content_kind").$type<TextContentKind>(),
    predictedSegments: integer("predicted_segments"),
    actualSegments: integer("actual_segments"),
    seriesId: uuid("series_id"),
    seriesPart: integer("series_part"),
    seriesTotal: integer("series_total"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    occurredAtSource: text("occurred_at_source").$type<TextOccurredAtSource>().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("text_messages_provider_sid_idx").on(table.providerMessageSid),
    index("text_messages_conversation_idx").on(table.connectionId, table.occurredAt, table.id),
    index("text_messages_user_outbound_idx").on(table.userId, table.direction, table.createdAt),
  ],
);

export const textingConsentEvents = pgTable(
  "texting_consent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id").references(() => textingConnections.id, {
      onDelete: "set null",
    }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    phoneFingerprint: text("phone_fingerprint").notNull(),
    kind: text("kind")
      .$type<
        "verified_opt_in" | "provider_stop" | "provider_start" | "provider_block" | "disconnected"
      >()
      .notNull(),
    source: text("source").$type<"ilo" | "twilio">().notNull(),
    providerEventId: text("provider_event_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("texting_consent_phone_idx").on(table.phoneFingerprint, table.occurredAt),
    uniqueIndex("texting_consent_provider_event_idx")
      .on(table.providerEventId)
      .where(sql`${table.providerEventId} IS NOT NULL`),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorType: text("actor_type").$type<ActorType>().notNull(),
    actorId: text("actor_id"),
    requestId: text("request_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_events_user_time_idx").on(table.userId, table.createdAt),
    index("audit_events_entity_idx").on(table.entityType, table.entityId),
  ],
);
