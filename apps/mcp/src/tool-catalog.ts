import {
  type AccessScope,
  accessScopeSchema,
  type FinancePresentationKind,
} from "@personal-os/domain";

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
  presentation?: FinancePresentationKind;
  readOnly: boolean;
  requiredScopes: readonly AccessScope[];
  scopeMatch?: "any" | "all";
  stage: IloToolStage;
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
  options: Pick<IloToolDefinition, "openWorld" | "presentation"> = {},
): IloToolDefinition {
  return {
    domain,
    scopeMatch: domain === "assistant" ? "any" : "all",
    policy: "read_only",
    readOnly: true,
    requiredScopes,
    stage,
    ...options,
  };
}

function preview(
  domain: string,
  requiredScopes: readonly AccessScope[],
  options: Pick<IloToolDefinition, "openWorld" | "presentation"> = {},
): IloToolDefinition {
  return {
    domain,
    scopeMatch: domain === "assistant" ? "any" : "all",
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
    Pick<
      IloToolDefinition,
      "destructive" | "idempotent" | "openWorld" | "policy" | "presentation" | "stage"
    >
  > = {},
): IloToolDefinition {
  return {
    domain,
    scopeMatch: domain === "assistant" ? "any" : "all",
    policy: options.policy ?? "approve_each",
    readOnly: false,
    requiredScopes,
    stage: options.stage ?? "commit",
    ...(options.destructive === undefined ? {} : { destructive: options.destructive }),
    ...(options.idempotent === undefined ? {} : { idempotent: options.idempotent }),
    ...(options.openWorld === undefined ? {} : { openWorld: options.openWorld }),
    ...(options.presentation === undefined ? {} : { presentation: options.presentation }),
  };
}

/**
 * The single discoverability and safety registry for nohmi's MCP surface.
 * Feature modules own behavior; this catalog owns how that behavior is exposed.
 */
export const iloToolCatalog = {
  get_finance_profile: read("finances", ["finances:read"]),
  disconnect_texting: write("texting", ["texting:write", "texting:execute"], {
    policy: "approved_rule",
    destructive: true,
  }),
  list_workspace_sources: {
    ...read("assistant", ["mail:read", "calendar:read", "reminders:read"]),
    scopeMatch: "all",
  },
  sync_workspace_source: {
    ...write(
      "assistant",
      [
        "mail:write",
        "mail:execute",
        "calendar:write",
        "calendar:execute",
        "reminders:write",
        "tasks:write",
        "tasks:execute",
      ],
      { openWorld: true, policy: "approved_rule" },
    ),
    scopeMatch: "all",
  },
  disconnect_workspace_source: {
    ...write(
      "assistant",
      [
        "mail:write",
        "mail:execute",
        "calendar:write",
        "calendar:execute",
        "reminders:write",
        "tasks:write",
        "tasks:execute",
      ],
      { destructive: true, policy: "approved_rule" },
    ),
    scopeMatch: "all",
  },
  list_automation_host_connections: read("finances", ["finances:read", "finances:maintain"]),
  list_automation_host_schedules: read("finances", ["finances:read", "finances:maintain"]),
  create_automation_host_schedule: write(
    "finances",
    ["finances:read", "finances:maintain", "finances:write", "finances:execute"],
    { policy: "approved_rule" },
  ),
  bind_automation_host_schedule: write(
    "finances",
    ["finances:read", "finances:maintain", "finances:write", "finances:execute"],
    { policy: "approved_rule" },
  ),
  update_automation_host_schedule: write(
    "finances",
    ["finances:read", "finances:maintain", "finances:write", "finances:execute"],
    { policy: "approved_rule" },
  ),
  cancel_automation_host_schedule: write(
    "finances",
    ["finances:read", "finances:maintain", "finances:write", "finances:execute"],
    { policy: "approved_rule" },
  ),
  revoke_automation_host_schedule: write(
    "finances",
    ["finances:read", "finances:maintain", "finances:write", "finances:execute"],
    { policy: "approved_rule" },
  ),
  list_finance_host_runs: read("finances", ["finances:read", "finances:maintain"]),
  list_finance_answer_continuations: read("finances", ["finances:read", "finances:maintain"]),
  bind_finance_answer_continuation: write(
    "finances",
    ["finances:read", "finances:maintain", "finances:write", "finances:execute"],
    { policy: "approved_rule", stage: "recover" },
  ),
  recover_finance_host_run: write(
    "finances",
    ["finances:read", "finances:maintain", "finances:write", "finances:execute"],
    { policy: "approved_rule", stage: "recover" },
  ),
  reconcile_finance_host_delivery: write(
    "finances",
    ["finances:read", "finances:maintain", "finances:write", "finances:execute"],
    { policy: "approved_rule", stage: "recover" },
  ),
  get_notification_settings: read("texting", ["texting:read", "finances:read"]),
  get_texting_connection: read("texting", ["texting:read"]),
  update_notification_settings: write(
    "texting",
    ["texting:read", "finances:read", "texting:write", "texting:execute"],
    { policy: "approved_rule" },
  ),
  reset_finance_notification_settings: write(
    "texting",
    ["texting:read", "finances:read", "texting:write", "texting:execute"],
    { policy: "approved_rule" },
  ),
  download_mail_attachment: read("mail", ["mail:read"], "inspect", { openWorld: true }),
  get_finance_budget_policy_preview: read("finances", ["finances:read"]),
  get_calendar_settings: read("calendar", ["calendar:read"]),
  update_calendar_settings: write("calendar", ["calendar:write", "calendar:execute"], {
    policy: "approved_rule",
  }),
  search_calendar: read("calendar", ["calendar:read"]),
  get_task_settings: read("tasks", ["tasks:read"]),
  update_task_settings: write("tasks", ["tasks:write", "tasks:execute"], {
    policy: "approved_rule",
  }),
  search_tasks: read("tasks", ["tasks:read", "reminders:read"]),
  get_mail_settings: read("mail", ["mail:read"]),
  update_mail_settings: write("mail", ["mail:write", "mail:execute"], { policy: "approved_rule" }),
  search_mail: read("mail", ["mail:read"]),
  get_finance_settings: read("finances", ["finances:read"]),
  update_finance_settings: write("finances", ["finances:write", "finances:execute"], {
    policy: "approved_rule",
  }),
  search_finance: read("finances", ["finances:read"]),
  get_finance_budget_policy: read("finances", ["finances:read"]),
  create_finance_budget_policy: write("finances", ["finances:write", "finances:execute"], {
    policy: "approved_rule",
  }),
  revise_finance_budget_policy: write("finances", ["finances:write", "finances:execute"], {
    policy: "approved_rule",
  }),
  disable_finance_budget_policy: write("finances", ["finances:write", "finances:execute"], {
    policy: "approved_rule",
  }),
  designate_finance_budget_baseline: write("finances", ["finances:write", "finances:execute"], {
    policy: "approved_rule",
  }),
  preview_finance_budget_policy: preview("finances", ["finances:read"]),
  create_finance_budget_revision_proposal: write(
    "finances",
    ["finances:write", "finances:execute"],
    { policy: "approved_rule" },
  ),
  get_finance_budget_revision_proposal: read("finances", ["finances:read"]),
  withdraw_finance_budget_revision_proposal: write(
    "finances",
    ["finances:write", "finances:execute"],
    { policy: "approved_rule" },
  ),
  save_finance_budget_policy_preview: write("finances", ["finances:write", "finances:execute"], {
    policy: "approved_rule",
  }),
  create_finance_contextual_question: write("finances", ["finances:write", "finances:execute"], {
    policy: "approved_rule",
  }),
  get_finance_contextual_question: read("finances", ["finances:read"]),
  answer_finance_contextual_question: write("finances", ["finances:write"], {
    policy: "approved_rule",
  }),
  approve_finance_action_review: write("finances", ["finances:write", "finances:execute"], {
    policy: "approved_rule",
  }),
  dismiss_finance_action_review: write("finances", ["finances:write", "finances:execute"], {
    policy: "approved_rule",
  }),
  list_mail_drafts: read("mail", ["mail:read"]),
  create_mail_draft: write("mail", ["mail:write"], { policy: "approved_rule" }),
  update_mail_draft: write("mail", ["mail:write"], { policy: "approved_rule" }),
  delete_mail_draft: write("mail", ["mail:write"], { policy: "approved_rule", destructive: true }),
  send_mail_draft: write("mail", ["mail:write", "mail:execute"], {
    policy: "approved_rule",
    destructive: true,
    openWorld: true,
    idempotent: false,
  }),
  reconcile_mail_draft: write("mail", ["mail:write", "mail:execute"], { policy: "approved_rule" }),
  activate_mail_rule: write("mail", ["mail:write", "mail:execute"], { policy: "approved_rule" }),
  get_mail_maintenance_run: read("mail", ["mail:read"]),
  get_mail_review: read("mail", ["mail:read"]),
  get_mail_thread_stewardship: read("mail", ["mail:read"]),
  preview_mail_response_brief: write("mail", ["mail:write"], { policy: "approved_rule" }),
  set_mail_disposition: write("mail", ["mail:write", "mail:execute"], { policy: "approved_rule" }),
  create_mail_obligation: write("mail", ["mail:write", "mail:execute"], {
    policy: "approved_rule",
  }),
  update_mail_obligation: write("mail", ["mail:write", "mail:execute"], {
    policy: "approved_rule",
  }),
  get_mail_question: read("mail", ["mail:read"]),
  answer_mail_question: write("mail", ["mail:write", "mail:execute"], { policy: "approved_rule" }),
  create_mail_stewardship_feedback: write("mail", ["mail:write", "mail:execute"], {
    policy: "approved_rule",
  }),
  get_ilo_context: read("assistant", [], "context"),
  get_ilo_setup: read("assistant", [], "context"),
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
  list_task_workspace: { ...read("tasks", ["tasks:read", "reminders:read"]), scopeMatch: "all" },
  get_task: read("tasks", ["tasks:read"]),
  create_task: write("tasks", ["tasks:write"], { idempotent: true }),
  update_task: write("tasks", ["tasks:write"]),
  complete_task: write("tasks", ["tasks:write"]),
  reopen_task: write("tasks", ["tasks:write"]),
  cancel_task: write("tasks", ["tasks:write"]),
  trash_task: write("tasks", ["tasks:write"], { destructive: true }),
  restore_task: write("tasks", ["tasks:write"]),
  preview_task_move: preview("tasks", ["tasks:read"]),
  move_task: write("tasks", ["tasks:write"], { destructive: true }),
  list_goals: read("goals", ["goals:read"]),
  create_goal: write("goals", ["goals:write"]),
  update_goal: write("goals", ["goals:write"]),
  list_motives: read("goals", ["goals:read"]),
  create_motive: write("goals", ["goals:write"]),
  list_activity: read("activity", ["audit:read"], "verify"),
  get_daily_brief: read("today", ["automations:read"], "context"),

  create_calendar: write("calendar", ["calendar:write"], { policy: "approved_rule" }),
  update_calendar: write("calendar", ["calendar:write"], { policy: "approved_rule" }),
  delete_calendar: write("calendar", ["calendar:write"], {
    policy: "approved_rule",
    destructive: true,
  }),
  set_calendar_selection: write("calendar", ["calendar:write"], { policy: "approved_rule" }),
  get_calendar_status: read("calendar", ["calendar:read"]),
  get_calendar_review: read("calendar", ["calendar:read"]),
  list_calendars: read("calendar", ["calendar:read"]),
  list_events: read("calendar", ["calendar:read"]),
  get_event: read("calendar", ["calendar:read"]),
  preview_calendar_commitment: preview("calendar", ["calendar:read"]),
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
  preview_mail_rule: preview("mail", ["mail:read"]),
  review_mail_rule: read("mail", ["mail:read"], "verify"),
  update_mail: write("mail", ["mail:write"], { openWorld: true }),
  bulk_update_mail: write("mail", ["mail:write"], { openWorld: true }),
  snooze_mail: write("mail", ["mail:write"]),
  create_mail_attention_item: write("mail", ["mail:write"]),
  create_mail_rule: write("mail", ["mail:write"], { openWorld: true }),
  update_mail_rule: write("mail", ["mail:write"]),
  get_mail_status: {
    ...read("mail", ["mail:read"]),
    idempotent: true,
    openWorld: false,
  },
  maintain_mail: write("mail", ["mail:write"], {
    idempotent: false,
    openWorld: true,
    policy: "approved_rule",
    stage: "commit",
  }),

  list_reminders: read("reminders", ["reminders:read"]),
  get_reminder: read("reminders", ["reminders:read"]),
  preview_overdue_reminder_deferral: preview("reminders", ["reminders:read"]),
  create_reminder: write("reminders", ["reminders:write"]),
  create_reminder_attention_item: write("reminders", ["reminders:write"]),
  update_reminder: write("reminders", ["reminders:write"]),
  complete_reminder: write("reminders", ["reminders:write"]),
  delete_reminder: write("reminders", ["reminders:write"], {
    destructive: true,
  }),
  restore_reminder: write("reminders", ["reminders:write"]),

  get_finance_configuration: read("finances", ["finances:read"]),
  get_finance_budget_pace: read("finances", ["finances:read"]),
  get_finance_position: read("finances", ["finances:read"]),
  list_finance_review_history: read("finances", ["finances:read"]),
  get_finance_review_history_item: read("finances", ["finances:read"]),
  get_finance_maintenance_run: read("finances", ["finances:read"]),
  list_finance_questions: read("finances", ["finances:read"]),
  list_finance_action_reviews: read("finances", ["finances:read"]),
  list_finance_budget_policies: read("finances", ["finances:read"]),
  create_finance_account: write("finances", ["finances:write", "finances:execute"], {
    policy: "approved_rule",
  }),
  create_finance_category: write("finances", ["finances:write", "finances:execute"], {
    policy: "approved_rule",
  }),
  disconnect_finance_account: write("finances", ["finances:write", "finances:execute"], {
    policy: "approved_rule",
    destructive: true,
  }),
  delete_finance_account: write("finances", ["finances:write", "finances:execute"], {
    policy: "approved_rule",
    destructive: true,
  }),
  get_finance_guided_setup: read("finances", ["finances:read"], "context"),
  get_finance_playbook: read("finances", ["finances:read"], "context"),
  get_finance_automation_settings: read("finances", ["finances:read"]),
  get_finance_status: {
    ...read("finances", ["finances:read"]),
    idempotent: true,
    openWorld: false,
  },
  compare_finance_scenarios: preview("finances", ["finances:read"]),
  set_finance_budget_plan: write("finances", ["finances:write"], { policy: "approved_rule" }),
  set_finance_transaction_breakdown: write("finances", ["finances:write"]),
  list_finance_reimbursements: read("finances", ["finances:read"]),
  reconcile_finance_reimbursement: write("finances", ["finances:write"], {
    destructive: true,
    policy: "approve_each",
  }),
  get_finance_continuations: read("finances", ["finances:maintain"]),
  get_finance_conversation_batch: write(
    "finances",
    ["finances:maintain", "finances:write", "finances:execute"],
    { policy: "approved_rule", stage: "inspect", idempotent: true, openWorld: false },
  ),
  acknowledge_finance_conversation_batch: write(
    "finances",
    ["finances:maintain", "finances:write", "finances:execute"],
    { policy: "approved_rule", stage: "verify", idempotent: true, openWorld: false },
  ),
  reply_to_finance_conversation_batch: write(
    "finances",
    ["finances:maintain", "finances:write", "finances:execute"],
    { policy: "approved_rule", stage: "commit", idempotent: true, openWorld: false },
  ),
  exchange_finance_conversation_challenge: write(
    "finances",
    ["finances:maintain", "finances:write", "finances:execute"],
    { policy: "approved_rule", stage: "verify", idempotent: true, openWorld: false },
  ),
  get_finance_host_prompt_history: read("finances", ["finances:maintain"], "inspect", {
    openWorld: false,
  }),
  get_finance_host_prompt: read("finances", ["finances:maintain"], "inspect", { openWorld: false }),
  issue_finance_host_prompt: write(
    "finances",
    ["finances:maintain", "finances:write", "finances:execute"],
    {
      policy: "approved_rule",
      idempotent: true,
      openWorld: false,
      stage: "prepare",
    },
  ),
  observe_finance_host_schedule: write("finances", ["finances:maintain"], {
    policy: "approved_rule",
  }),
  maintain_finances: write("finances", ["finances:maintain"], {
    idempotent: false,
    openWorld: false,
    policy: "approved_rule",
    stage: "commit",
  }),
  get_finance_ledger_challenge: read("finances", ["finances:maintain"]),
  submit_finance_ledger_challenge: write("finances", ["finances:maintain"], {
    idempotent: true,
    openWorld: false,
    policy: "approved_rule",
    stage: "commit",
  }),
  get_finance_period_review: read("finances", ["finances:read"], "inspect", {
    presentation: "finance_period_verification",
  }),
  get_finance_wealth_summary: read("finances", ["finances:read"]),
  get_finance_cashflow: read("finances", ["finances:read"]),
  get_finance_ledger_health: read("finances", ["finances:read"]),
  review_finance_receipt: read("finances", ["finances:read"]),
  list_finance_transactions: read("finances", ["finances:read"]),
  get_finance_categories: read("finances", ["finances:read"]),
  get_finance_budget_status: read("finances", ["finances:read"]),
  list_finance_merchants: read("finances", ["finances:read"]),
  get_finance_review_queue: read("finances", ["finances:read"], "inspect"),
  propose_finance_categorizations: preview("finances", ["finances:read"]),
  apply_finance_categorizations: write("finances", ["finances:write"], {
    policy: "approved_rule",
  }),
  // A bounded answer can conditionally replace allocations or create/match a
  // reimbursement case. The API still chooses applied versus pending review.
  answer_finance_question: write("finances", ["finances:write"], {
    destructive: true,
    policy: "approve_each",
  }),
  // Deprecated compatibility alias for answer_finance_question.
  resolve_finance_review: write("finances", ["finances:write"], {
    destructive: true,
    policy: "approve_each",
  }),
  update_finance_recurring_obligation: write("finances", ["finances:write"], {
    policy: "approved_rule",
  }),
  resolve_finance_alert: write("finances", ["finances:write"], { policy: "approved_rule" }),
  update_finance_merchant: write("finances", ["finances:write"], { policy: "approved_rule" }),
  merge_finance_merchants: write("finances", ["finances:write"], { policy: "approved_rule" }),
  create_finance_budget: write("finances", ["finances:write"], { policy: "approved_rule" }),
  manage_finance_budget_bucket: write("finances", ["finances:write"], { policy: "approved_rule" }),
  update_finance_transaction: write("finances", ["finances:write", "finances:execute"], {
    policy: "approved_rule",
  }),
  update_finance_income_stream: write("finances", ["finances:write"], {
    policy: "approved_rule",
  }),
  update_finance_profile: write("finances", ["finances:write"], { policy: "approved_rule" }),
  refresh_finance_insights: write("finances", ["finances:write"], {
    policy: "approved_rule",
  }),
  get_finance_overview: read("finances", ["finances:read"], "context"),
  create_finance_attention_item: write("finances", ["finances:write"]),
  setup_finances: write("finances", ["finances:write"], { policy: "approved_rule" }),
  get_finance_maintenance_history: read("finances", ["finances:read"]),
  get_financial_profile: read("finances", ["finances:read"]),
  update_financial_profile: write("finances", ["finances:write"], {
    idempotent: true,
    policy: "approved_rule",
  }),
  get_finance_budget: read("finances", ["finances:read"], "inspect", {
    presentation: "finance_budget",
  }),
  revise_finance_budget: write("finances", ["finances:write"], {
    idempotent: true,
    policy: "approved_rule",
  }),
  approve_finance_budget: write("finances", ["finances:write", "finances:execute"], {
    idempotent: true,
    policy: "approved_rule",
  }),
  list_finance_goals: read("finances", ["finances:read"]),
  manage_finance_goal: write("finances", ["finances:write"], {
    idempotent: true,
    policy: "approved_rule",
  }),
  get_finance_inbox: read("finances", ["finances:read"], "inspect", {
    presentation: "finance_review",
  }),
  answer_finance_review: write("finances", ["finances:write"], {
    idempotent: true,
    policy: "approved_rule",
  }),
  get_finance_snapshot: read("finances", ["finances:read"], "context", {
    presentation: "finance_snapshot",
  }),
  export_finance_data: read("finances", ["finances:read"]),
  list_finance_accounts: read("finances", ["finances:read"]),
  list_finance_budget_buckets: read("finances", ["finances:read"]),
  get_finance_category_budget_status: read("finances", ["finances:read"]),
  get_finance_connection_capabilities: read("finances", ["finances:read"]),
  resolve_finance_transaction_review: write(
    "finances",
    ["finances:read", "finances:write", "finances:execute"],
    { policy: "approved_rule" },
  ),
  complete_finance_account_connection: write("finances", ["finances:write", "finances:execute"], {
    openWorld: true,
    idempotent: true,
    policy: "approved_rule",
  }),
  start_finance_account_connection: write("finances", ["finances:write", "finances:execute"], {
    idempotent: true,
    openWorld: true,
    policy: "approved_rule",
  }),
  sync_finance_accounts: write("finances", ["finances:write", "finances:execute"], {
    openWorld: true,
    policy: "approved_rule",
  }),
  get_finance_account_connection: read("finances", ["finances:read"]),
  update_finance_account: write("finances", ["finances:write"], {
    idempotent: true,
    policy: "approved_rule",
  }),
  add_finance_transaction: write("finances", ["finances:write"], {
    policy: "approved_rule",
  }),
  get_finance_transaction: read("finances", ["finances:read"]),
  remove_finance_transaction: write("finances", ["finances:write"], {
    destructive: true,
    idempotent: true,
    policy: "approved_rule",
  }),
  split_finance_transaction: write("finances", ["finances:write"], {
    idempotent: true,
    policy: "approved_rule",
  }),
  classify_finance_transactions: write("finances", ["finances:write"], {
    idempotent: true,
    policy: "approved_rule",
  }),
  link_finance_transactions: write("finances", ["finances:write"], {
    idempotent: true,
    policy: "approved_rule",
  }),
  import_finance_transactions: write("finances", ["finances:write"], {
    idempotent: true,
    policy: "approved_rule",
  }),
  list_finance_rules: read("finances", ["finances:read"]),
  manage_finance_rule: write("finances", ["finances:write"], {
    idempotent: true,
    policy: "approved_rule",
  }),
  list_finance_recurring_items: read("finances", ["finances:read"]),
  manage_finance_recurring_item: write("finances", ["finances:write"], {
    idempotent: true,
    policy: "approved_rule",
  }),

  list_x_bookmarks: read("bookmarks", ["bookmarks:read"]),
  sync_x_bookmarks: write("bookmarks", ["bookmarks:read"], { openWorld: true }),

  read_text_conversation: read("texting", ["texting:read"]),
  get_texting_finance_reply_status: {
    ...read("texting", ["texting:read", "finances:read"]),
    scopeMatch: "all",
  },
  send_text_message: write("texting", ["texting:write"], {
    openWorld: true,
    policy: "approved_rule",
  }),
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
  if (definition.scopeMatch === "all")
    return definition.requiredScopes.every((scope) => scopes.has(scope));
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
