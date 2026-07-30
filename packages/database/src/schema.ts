import type {
  AccessScope,
  AccountSetupStatus,
  AccountSetupStep,
  AccountSetupWorkspace,
  ActorType,
  AgentMutationPolicy,
  AssistantDomain,
  AttentionItemImportance,
  AttentionItemKind,
  AttentionItemStatus,
  AutomationRunStatus,
  AutomationTemplate,
  CalendarProvider,
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
  MaterialSourceReference,
  Theme,
  TransactionDirection,
} from "@personal-os/domain";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
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
    template: text("template").$type<AutomationTemplate>().notNull(),
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
    status: text("status").$type<AutomationRunStatus>().notNull(),
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
  key: text("key").primaryKey(),
  categoriesComplete: boolean("categories_complete").notNull().default(false),
  profileCursor: uuid("profile_cursor"),
  profilesComplete: boolean("profiles_complete").notNull().default(false),
  userCursor: uuid("user_cursor"),
  ...timestamps,
});

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
    targetAccountId: uuid("target_account_id"),
    requestedServices: jsonb("requested_services").$type<GoogleConnectionService[]>(),
    returnPath: text("return_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("oauth_states_token_hash_idx").on(table.tokenHash),
    index("oauth_states_user_idx").on(table.userId),
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
    syncStatus: text("sync_status").$type<"idle" | "syncing" | "error">().notNull().default("idle"),
    syncGeneration: integer("sync_generation").notNull().default(0),
    syncClaimId: uuid("sync_claim_id"),
    syncError: text("sync_error"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("calendar_accounts_user_idx").on(table.userId),
    uniqueIndex("calendar_accounts_remote_idx").on(
      table.userId,
      table.provider,
      table.providerAccountId,
    ),
    check("calendar_accounts_sync_generation_check", sql`${table.syncGeneration} >= 0`),
    check(
      "calendar_accounts_sync_claim_check",
      sql`(${table.syncStatus} = 'syncing') = (${table.syncClaimId} IS NOT NULL)`,
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
    status: text("status")
      .$type<"connected" | "needs_reauth" | "manual">()
      .notNull()
      .default("manual"),
    encryptedCredentials: jsonb("encrypted_credentials").$type<EncryptedCredentials>(),
    providerAccountId: text("provider_account_id"),
    providerItemId: text("provider_item_id"),
    syncCursor: text("sync_cursor"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("finance_accounts_user_idx").on(table.userId),
    uniqueIndex("finance_accounts_provider_idx").on(
      table.userId,
      table.provider,
      table.providerAccountId,
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
  ],
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
    status: text("status").$type<"deferred" | "open" | "resolved">().notNull().default("open"),
    reason: text("reason")
      .$type<
        | "ambiguous_merchant"
        | "low_confidence"
        | "one_time"
        | "possible_duplicate"
        | "possible_transfer"
        | "refund_or_reversal"
        | "unknown_merchant"
      >()
      .notNull(),
    suggestedCategoryId: uuid("suggested_category_id").references(() => financeCategories.id, {
      onDelete: "set null",
    }),
    rationale: text("rationale"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("finance_review_cases_user_status_idx").on(table.userId, table.status),
    uniqueIndex("finance_review_cases_open_transaction_idx").on(table.transactionId, table.status),
  ],
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
    ...timestamps,
  },
  (table) => [
    index("finance_profiles_user_effective_idx").on(table.userId, table.effectiveDate),
    uniqueIndex("finance_profiles_user_effective_idx_unique").on(table.userId, table.effectiveDate),
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
