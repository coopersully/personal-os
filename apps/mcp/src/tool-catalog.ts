import { type AccessScope, accessScopeSchema } from "@personal-os/domain";

export const iloToolStages = [
  "context",
  "inspect",
  "prepare",
  "commit",
  "verify",
  "recover",
] as const;
export type IloToolStage = (typeof iloToolStages)[number];

export const iloToolPolicies = ["read_only", "preview", "approve_each", "approved_rule"] as const;
export type IloToolPolicy = (typeof iloToolPolicies)[number];

export type IloToolDefinition = {
  compatibility?: boolean;
  destructive?: boolean;
  domain: string;
  idempotent?: boolean;
  openWorld?: boolean;
  policy: IloToolPolicy;
  readOnly: boolean;
  requiredScopes: readonly AccessScope[];
  stage: IloToolStage;
  ui?: boolean;
};

const allScopes = accessScopeSchema.options;
const assistantDomains = ["mail", "calendar", "reminders", "tasks", "finances", "goals"];
const domainReadScopes = allScopes.filter(
  (scope) =>
    scope.endsWith(":read") && assistantDomains.includes(scope.slice(0, scope.indexOf(":"))),
);
const domainWriteScopes = allScopes.filter(
  (scope) =>
    scope.endsWith(":write") && assistantDomains.includes(scope.slice(0, scope.indexOf(":"))),
);

function read(
  domain: string,
  requiredScopes: readonly AccessScope[],
  stage: IloToolStage = "inspect",
  options: Pick<IloToolDefinition, "openWorld" | "ui"> = {},
): IloToolDefinition {
  return { domain, policy: "read_only", readOnly: true, requiredScopes, stage, ...options };
}

function preview(
  domain: string,
  requiredScopes: readonly AccessScope[],
  options: Pick<IloToolDefinition, "openWorld" | "ui"> = {},
): IloToolDefinition {
  return {
    domain,
    idempotent: true,
    policy: "preview",
    readOnly: true,
    requiredScopes,
    stage: "prepare",
    ...options,
  };
}

function write(
  domain: string,
  requiredScopes: readonly AccessScope[],
  options: Partial<
    Pick<IloToolDefinition, "destructive" | "idempotent" | "openWorld" | "policy" | "stage" | "ui">
  > = {},
): IloToolDefinition {
  return {
    domain,
    policy: options.policy ?? "approve_each",
    readOnly: false,
    requiredScopes,
    stage: options.stage ?? "commit",
    ...(options.destructive === undefined ? {} : { destructive: options.destructive }),
    ...(options.idempotent === undefined ? {} : { idempotent: options.idempotent }),
    ...(options.openWorld === undefined ? {} : { openWorld: options.openWorld }),
    ...(options.ui === undefined ? {} : { ui: options.ui }),
  };
}

/**
 * The single discoverability and safety registry for Ilo's MCP surface.
 * Feature modules own behavior; this catalog owns how that behavior is exposed.
 */
export const iloToolCatalog = {
  get_ilo_context: read("assistant", [], "context", { ui: true }),
  get_ilo_setup: read("assistant", [], "context", { ui: true }),
  get_agent_setup_status: { ...read("assistant", [], "context"), compatibility: true },
  get_domain_profile: read("assistant", domainReadScopes),
  save_domain_profile: write("assistant", domainWriteScopes),
  list_attention_items: read("assistant", domainReadScopes),
  create_attention_item: write("assistant", domainWriteScopes),
  update_attention_item: write("assistant", domainWriteScopes),

  list_task_lists: read("tasks", ["tasks:read"]),
  get_task_list: read("tasks", ["tasks:read"]),
  create_task_list: write("tasks", ["tasks:write"], { idempotent: true }),
  update_task_list: write("tasks", ["tasks:write"]),
  archive_task_list: write("tasks", ["tasks:write"], { destructive: true }),
  list_task_projects: read("tasks", ["tasks:read"]),
  get_task_project: read("tasks", ["tasks:read"]),
  create_task_project: write("tasks", ["tasks:write"], { idempotent: true }),
  update_task_project: write("tasks", ["tasks:write"]),
  complete_task_project: write("tasks", ["tasks:write"]),
  cancel_task_project: write("tasks", ["tasks:write"]),
  archive_task_project: write("tasks", ["tasks:write"], { destructive: true }),
  preview_task_project_move: preview("tasks", ["tasks:read"]),
  move_task_project: write("tasks", ["tasks:write"], { destructive: true }),
  list_tasks: read("tasks", ["tasks:read"]),
  get_task: read("tasks", ["tasks:read"]),
  create_task: write("tasks", ["tasks:write"], { idempotent: true }),
  update_task: write("tasks", ["tasks:write"]),
  complete_task: write("tasks", ["tasks:write"]),
  reopen_task: write("tasks", ["tasks:write"]),
  cancel_task: write("tasks", ["tasks:write"]),
  trash_task: write("tasks", ["tasks:write"], { destructive: true }),
  restore_task: write("tasks", ["tasks:write"]),
  preview_task_move: preview("tasks", ["tasks:read"]),
  move_task: write("tasks", ["tasks:write"]),
  list_goals: read("goals", ["goals:read"]),
  create_goal: write("goals", ["goals:write"]),
  update_goal: write("goals", ["goals:write"]),
  list_motives: read("goals", ["goals:read"]),
  create_motive: write("goals", ["goals:write"]),
  list_activity: read("activity", ["audit:read"], "verify"),
  get_daily_brief: read("today", ["automations:read"], "context", { ui: true }),

  list_calendars: read("calendar", ["calendar:read"]),
  list_events: read("calendar", ["calendar:read"]),
  get_event: read("calendar", ["calendar:read"]),
  preview_calendar_commitment: preview("calendar", ["calendar:read"], {
    ui: true,
  }),
  create_event: write("calendar", ["calendar:write"], { openWorld: true }),
  update_event: write("calendar", ["calendar:write"], { openWorld: true }),
  block_event: write("calendar", ["calendar:write"], { openWorld: true }),
  set_event_block_privacy: write("calendar", ["calendar:write"], { openWorld: true }),
  unblock_event: write("calendar", ["calendar:write"], {
    destructive: true,
    openWorld: true,
  }),
  delete_event: write("calendar", ["calendar:write"], {
    destructive: true,
    openWorld: true,
  }),
  restore_event: write("calendar", ["calendar:write"], { openWorld: true }),
  create_calendar_attention_item: write("calendar", ["calendar:write"]),

  list_mailboxes: read("mail", ["mail:read"]),
  get_mail_setup_context: read("mail", ["mail:read"], "context"),
  list_mail: read("mail", ["mail:read"]),
  read_mail: read("mail", ["mail:read"]),
  list_mail_rules: read("mail", ["mail:read"]),
  preview_mail_rule: preview("mail", ["mail:read"], { ui: true }),
  review_mail_rule: read("mail", ["mail:read"], "verify", { ui: true }),
  update_mail: write("mail", ["mail:write"], { openWorld: true }),
  bulk_update_mail: write("mail", ["mail:write"], { openWorld: true }),
  snooze_mail: write("mail", ["mail:write"]),
  create_mail_draft: write("mail", ["mail:write"], { openWorld: true }),
  send_mail: write("mail", ["mail:write"], { openWorld: true }),
  create_mail_attention_item: write("mail", ["mail:write"]),
  create_mail_rule: write("mail", ["mail:write"], { openWorld: true }),
  update_mail_rule: write("mail", ["mail:write"]),

  list_reminders: read("reminders", ["reminders:read"]),
  get_reminder: read("reminders", ["reminders:read"]),
  preview_overdue_reminder_deferral: preview("reminders", ["reminders:read"], { ui: true }),
  create_reminder: write("reminders", ["reminders:write"]),
  create_reminder_attention_item: write("reminders", ["reminders:write"]),
  update_reminder: write("reminders", ["reminders:write"]),
  complete_reminder: write("reminders", ["reminders:write"]),
  delete_reminder: write("reminders", ["reminders:write"], {
    destructive: true,
  }),
  restore_reminder: write("reminders", ["reminders:write"]),

  get_finance_guided_setup: read("finances", ["finances:read"], "context", { ui: true }),
  get_finance_status: {
    ...read("finances", ["finances:read"]),
    idempotent: true,
    openWorld: false,
  },
  maintain_finances: write("finances", ["finances:maintain"], {
    idempotent: false,
    openWorld: false,
    policy: "approved_rule",
    stage: "commit",
  }),
  get_finance_wealth_summary: read("finances", ["finances:read"]),
  get_finance_cashflow: read("finances", ["finances:read"]),
  get_finance_ledger_health: read("finances", ["finances:read"]),
  list_finance_transactions: read("finances", ["finances:read"]),
  get_finance_categories: read("finances", ["finances:read"]),
  get_finance_budget_status: read("finances", ["finances:read"]),
  list_finance_merchants: read("finances", ["finances:read"]),
  get_finance_review_queue: read("finances", ["finances:read"], "inspect", { ui: true }),
  propose_finance_categorizations: preview("finances", ["finances:read"]),
  get_finance_overview: read("finances", ["finances:read"], "context", { ui: true }),
  create_finance_attention_item: write("finances", ["finances:write"]),

  list_x_bookmarks: read("bookmarks", ["bookmarks:read"]),
  sync_x_bookmarks: write("bookmarks", ["bookmarks:read"], { openWorld: true }),
} satisfies Record<string, IloToolDefinition>;

export type IloToolName = keyof typeof iloToolCatalog;

export function canDiscoverTool(
  definition: IloToolDefinition,
  scopes: ReadonlySet<AccessScope>,
  readOnly: boolean,
  includeCompatibility = false,
): boolean {
  if (definition.compatibility && !includeCompatibility) return false;
  if (readOnly && !definition.readOnly) return false;
  if (definition.requiredScopes.length === 0) return true;
  return definition.requiredScopes.some((scope) => scopes.has(scope));
}

export function availableToolNames(
  scopes: ReadonlySet<AccessScope>,
  readOnly: boolean,
  includeCompatibility = false,
): IloToolName[] {
  return (Object.entries(iloToolCatalog) as [IloToolName, IloToolDefinition][])
    .filter(([, definition]) => canDiscoverTool(definition, scopes, readOnly, includeCompatibility))
    .map(([name]) => name);
}
