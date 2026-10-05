import type { SearchableWorkspace } from "@personal-os/domain";

/** SQL fragments below are static, domain-owned projections. Never interpolate request text here.
 * Each source MUST expose t.user_id, including joined-record owner checks in `where`.
 */
export type SearchSource = {
  from: string;
  kind: string;
  kindSql?: string;
  title: string;
  preview: string;
  text: string;
  href: string;
  state: string;
  where: string;
};
const source = (value: SearchSource) => value;
export const workspaceSearchSources: Record<SearchableWorkspace, SearchSource[]> = {
  calendar: [
    source({
      from: "calendar_events t JOIN calendars c ON c.id = t.calendar_id AND c.user_id = t.user_id JOIN users u ON u.id = t.user_id",
      kind: "Event",
      title: "t.title",
      preview:
        "concat(to_char(t.starts_at AT TIME ZONE u.planning_timezone, 'Mon DD, YYYY HH24:MI'), ' · ', c.name, ' · ', coalesce(t.location, t.notes, ''))",
      text: "concat(t.title, ' ', t.notes, ' ', t.location, ' ', c.name)",
      href: "'/calendar?follow=0&date=' || to_char(t.starts_at AT TIME ZONE u.planning_timezone, 'YYYY-MM-DD') || '&event=' || t.id",
      state: "CASE WHEN NOT c.is_selected THEN 'Hidden calendar' ELSE NULL END",
      where: "t.deleted_at IS NULL AND c.deleted_at IS NULL AND t.status <> 'cancelled'",
    }),
    source({
      from: "calendars t",
      kind: "Calendar",
      title: "t.name",
      preview: "'Calendar settings'",
      text: "t.name",
      href: "'/settings?section=calendar'",
      state: "CASE WHEN NOT t.is_selected THEN 'Hidden calendar' ELSE NULL END",
      where: "t.deleted_at IS NULL",
    }),
  ],
  tasks: [
    source({
      from: "reminders t LEFT JOIN task_lists l ON l.id = t.task_list_id AND l.user_id = t.user_id",
      kind: "Task",
      kindSql: "CASE WHEN t.kind = 'task' THEN 'Task' ELSE 'Reminder' END",
      title: "t.title",
      preview:
        "concat(CASE WHEN t.kind = 'task' THEN 'Task' ELSE 'Reminder' END, ' · ', coalesce(l.name, ''), ' · ', coalesce(t.notes, ''), CASE WHEN t.due_at IS NOT NULL THEN ' · Due ' || to_char(t.due_at, 'Mon DD, YYYY') ELSE '' END)",
      text: "concat(t.title, ' ', t.notes, ' ', t.tags::text, ' ', t.task_why)",
      href: "CASE WHEN t.kind = 'task' THEN '/tasks?task=' || t.id ELSE '/reminders?reminder=' || t.id END",
      state:
        "CASE WHEN l.availability = 'archived' THEN 'Archived list' WHEN t.completed_at IS NOT NULL OR t.status = 'completed' THEN 'Completed' WHEN t.status = 'cancelled' THEN 'Cancelled' ELSE NULL END",
      where:
        "t.deleted_at IS NULL AND (t.task_list_id IS NULL OR (l.id IS NOT NULL AND l.deleted_at IS NULL))",
    }),
    source({
      from: "task_lists t",
      kind: "List",
      title: "t.name",
      preview: "coalesce(t.description, 'Task list')",
      text: "concat(t.name, ' ', t.description)",
      href: "'/tasks?list=' || t.id || CASE WHEN t.availability = 'archived' THEN '&archive=list' ELSE '' END",
      state: "CASE WHEN t.availability = 'archived' THEN 'Archived' ELSE NULL END",
      where: "t.deleted_at IS NULL",
    }),
    source({
      from: "task_projects t JOIN task_lists l ON l.id = t.list_id AND l.user_id = t.user_id",
      kind: "Project",
      title: "t.name",
      preview: "concat(l.name, ' · ', coalesce(t.notes, t.why, ''))",
      text: "concat(t.name, ' ', t.notes, ' ', t.why)",
      href: "'/tasks?project=' || t.id || CASE WHEN t.availability = 'archived' OR t.lifecycle <> 'open' THEN '&archive=project' ELSE '' END",
      state:
        "CASE WHEN t.availability = 'archived' OR l.availability = 'archived' THEN 'Archived' WHEN t.lifecycle <> 'open' THEN initcap(t.lifecycle) ELSE NULL END",
      where: "t.deleted_at IS NULL AND l.deleted_at IS NULL",
    }),
  ],
  mail: [
    source({
      from: "mail_rules t",
      kind: "Rule",
      title: "t.name",
      preview: "t.description",
      text: "concat(t.name, ' ', t.description, ' ', t.condition::text)",
      href: "'/settings?section=mail&reviewRule=' || t.id",
      state: "CASE WHEN NOT t.enabled THEN 'Inactive' ELSE NULL END",
      where: "TRUE",
    }),
    source({
      from: "mail_threads t JOIN calendar_accounts a ON a.id = t.account_id AND a.user_id = t.user_id",
      kind: "Conversation",
      title: "t.subject",
      preview: "concat(t.from_address->>'name', ' ', t.from_address->>'address', ' · ', t.snippet)",
      text: "concat(t.subject, ' ', t.snippet, ' ', t.body_text, ' ', t.from_address::text, ' ', t.to_addresses::text, ' ', (SELECT string_agg(concat(m.body_text, ' ', m.from_address::text, ' ', m.to_addresses::text), ' ') FROM mail_messages m WHERE m.thread_id = t.id))",
      href: "'/mail?view=all&thread=' || t.id",
      state:
        "CASE WHEN NOT EXISTS (SELECT 1 FROM mailboxes b WHERE b.account_id = t.account_id AND b.user_id = t.user_id AND b.role IN ('inbox', 'sent', 'drafts') AND t.remote_mailbox_ids ? b.remote_mailbox_id) THEN 'Archived' ELSE NULL END",
      where:
        "t.deleted_at IS NULL AND a.mail_enabled AND NOT EXISTS (SELECT 1 FROM mailboxes b WHERE b.account_id = t.account_id AND b.user_id = t.user_id AND b.role = 'trash' AND t.remote_mailbox_ids ? b.remote_mailbox_id)",
    }),
    source({
      from: "mailboxes t JOIN calendar_accounts a ON a.id = t.account_id AND a.user_id = t.user_id",
      kind: "Mailbox",
      title: "t.name",
      preview: "'Mail folder'",
      text: "t.name",
      href: "'/mail?mailbox=' || t.id",
      state: "NULL::text",
      where: "t.deleted_at IS NULL AND t.role <> 'trash' AND a.mail_enabled",
    }),
  ],
  finances: [
    source({
      from: "finance_transactions t JOIN finance_accounts a ON a.id = t.account_id AND a.user_id = t.user_id",
      kind: "Transaction",
      title: "t.merchant",
      preview:
        "concat(coalesce(t.currency_code, 'USD'), ' ', to_char(t.amount_cents / 100.0, 'FM999999999990.00'), ' · ', t.transaction_date, ' · ', a.name, ' · ', coalesce(t.category, 'Uncategorized'))",
      text: "concat(t.merchant, ' ', t.notes, ' ', t.category, ' ', t.transaction_date, ' ', (t.amount_cents / 100.0)::text, ' ', a.name)",
      href: "'/finances/transactions?transactionId=' || t.id",
      state: "CASE WHEN t.pending THEN 'Pending' ELSE NULL END",
      where: "TRUE",
    }),
    source({
      from: "finance_accounts t",
      kind: "Account",
      title: "t.name",
      preview: "concat(t.institution, ' · ', t.kind)",
      text: "concat(t.name, ' ', t.institution, ' ', t.kind)",
      href: "'/finances/accounts'",
      state: "NULL::text",
      where: "TRUE",
    }),
    source({
      from: "finance_categories t",
      kind: "Category",
      title: "t.name",
      preview: 't."group"',
      text: "concat(t.name, ' ', t.\"group\")",
      href: "'/settings?section=finances'",
      state: "NULL::text",
      where: "TRUE",
    }),
    source({
      from: "finance_budget_plans t",
      kind: "Plan",
      title: "t.name",
      preview: "t.rationale",
      text: "concat(t.name, ' ', t.rationale, ' ', t.assumptions::text)",
      href: "'/finances/plan?planId=' || t.id",
      state: "CASE WHEN t.status = 'archived' THEN 'Archived' ELSE NULL END",
      where: "TRUE",
    }),
  ],
};
