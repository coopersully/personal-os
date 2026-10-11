# Workspace MCP execution evidence

Generated from actual Vitest results joined to MCP calls made inside passing real API/PostgreSQL fixture tests. A call in a failing test is not passing evidence. This reports tool-level execution, not exhaustive input-variant coverage or real-provider verification.

Tests: 77 passed; 0 failed.

Successful execution observed for 232 of 232 normal-discovery tools in the audited domains. Unexecuted rows remain explicit verification gaps; adapter registration or service-only tests are not counted here.

| Tool | Successful calls in passing workflows | Expected error calls in passing workflows | Evidence suites |
| --- | ---: | ---: | --- |
| `activate_mail_rule` | 1 | 2 | mail-stewardship.integration.test.ts |
| `add_finance_transaction` | 4 | 0 | ledger.integration.test.ts, finance-review.integration.test.ts |
| `answer_finance_contextual_question` | 1 | 0 | finance-review.integration.test.ts |
| `answer_finance_question` | 1 | 0 | ledger.integration.test.ts |
| `answer_finance_review` | 1 | 0 | ledger.integration.test.ts |
| `answer_mail_question` | 1 | 0 | mail-stewardship.integration.test.ts |
| `apply_finance_categorizations` | 1 | 0 | ledger.integration.test.ts |
| `approve_finance_action_review` | 1 | 1 | finance-review.integration.test.ts |
| `approve_finance_budget` | 2 | 1 | finances.integration.test.ts, budget-policy.integration.test.ts |
| `archive_task_list` | 2 | 0 | tasks.integration.test.ts |
| `archive_task_project` | 2 | 0 | tasks.integration.test.ts |
| `bind_automation_host_schedule` | 1 | 0 | recovery.integration.test.ts |
| `bind_finance_answer_continuation` | 1 | 1 | recovery.integration.test.ts |
| `block_event` | 1 | 0 | calendar.integration.test.ts |
| `bulk_update_mail` | 1 | 0 | mail-send.integration.test.ts |
| `cancel_automation_host_schedule` | 1 | 1 | recovery.integration.test.ts |
| `cancel_task` | 2 | 0 | tasks.integration.test.ts |
| `cancel_task_project` | 2 | 0 | tasks.integration.test.ts |
| `classify_finance_transactions` | 1 | 0 | ledger.integration.test.ts |
| `compare_finance_scenarios` | 1 | 0 | planning.integration.test.ts |
| `complete_finance_account_connection` | 5 | 5 | bank-handoff.integration.test.ts |
| `complete_reminder` | 4 | 0 | tasks.integration.test.ts |
| `complete_task` | 2 | 0 | tasks.integration.test.ts |
| `complete_task_project` | 2 | 0 | tasks.integration.test.ts |
| `create_attention_item` | 4 | 0 | controls.integration.test.ts |
| `create_automation_host_schedule` | 2 | 0 | recovery.integration.test.ts |
| `create_calendar` | 4 | 0 | calendar.integration.test.ts |
| `create_calendar_attention_item` | 1 | 0 | calendar.integration.test.ts |
| `create_event` | 2 | 0 | calendar.integration.test.ts |
| `create_finance_account` | 4 | 0 | authorization.integration.test.ts, finances.integration.test.ts, ledger.integration.test.ts, queries.integration.test.ts |
| `create_finance_attention_item` | 1 | 0 | finance-review.integration.test.ts |
| `create_finance_budget` | 2 | 0 | finances.integration.test.ts, budget-policy.integration.test.ts |
| `create_finance_budget_policy` | 1 | 0 | budget-policy.integration.test.ts |
| `create_finance_budget_revision_proposal` | 1 | 0 | budget-policy.integration.test.ts |
| `create_finance_category` | 4 | 0 | finances.integration.test.ts, ledger.integration.test.ts, planning.integration.test.ts |
| `create_finance_contextual_question` | 1 | 0 | finance-review.integration.test.ts |
| `create_mail_attention_item` | 1 | 0 | mail-stewardship.integration.test.ts |
| `create_mail_draft` | 3 | 0 | mail-send.integration.test.ts, mail.integration.test.ts |
| `create_mail_obligation` | 1 | 0 | mail-stewardship.integration.test.ts |
| `create_mail_rule` | 1 | 0 | mail-stewardship.integration.test.ts |
| `create_mail_stewardship_feedback` | 1 | 0 | mail-stewardship.integration.test.ts |
| `create_reminder` | 2 | 0 | tasks.integration.test.ts |
| `create_reminder_attention_item` | 2 | 0 | tasks.integration.test.ts |
| `create_task` | 2 | 0 | tasks.integration.test.ts |
| `create_task_list` | 4 | 0 | tasks.integration.test.ts |
| `create_task_project` | 4 | 0 | tasks.integration.test.ts |
| `delete_calendar` | 1 | 0 | calendar.integration.test.ts |
| `delete_event` | 1 | 0 | calendar.integration.test.ts |
| `delete_finance_account` | 1 | 1 | finances.integration.test.ts, finance-review.integration.test.ts |
| `delete_mail_draft` | 1 | 0 | mail.integration.test.ts |
| `delete_reminder` | 2 | 0 | tasks.integration.test.ts |
| `designate_finance_budget_baseline` | 1 | 0 | budget-policy.integration.test.ts |
| `disable_finance_budget_policy` | 1 | 0 | budget-policy.integration.test.ts |
| `disconnect_finance_account` | 1 | 1 | finances.integration.test.ts, finance-review.integration.test.ts |
| `disconnect_texting` | 1 | 1 | controls.integration.test.ts |
| `disconnect_workspace_source` | 1 | 2 | sources.integration.test.ts |
| `dismiss_finance_action_review` | 2 | 0 | finance-review.integration.test.ts |
| `download_mail_attachment` | 1 | 1 | mail-send.integration.test.ts |
| `export_finance_data` | 1 | 0 | queries.integration.test.ts |
| `get_calendar_review` | 2 | 0 | calendar.integration.test.ts, queries.integration.test.ts |
| `get_calendar_settings` | 3 | 0 | controls.integration.test.ts, queries.integration.test.ts |
| `get_calendar_status` | 2 | 0 | calendar.integration.test.ts, queries.integration.test.ts |
| `get_domain_profile` | 1 | 0 | guidance.integration.test.ts |
| `get_event` | 2 | 0 | calendar.integration.test.ts |
| `get_finance_account_connection` | 3 | 0 | bank-handoff.integration.test.ts |
| `get_finance_automation_settings` | 1 | 0 | queries.integration.test.ts |
| `get_finance_budget` | 1 | 0 | queries.integration.test.ts |
| `get_finance_budget_pace` | 1 | 0 | finances.integration.test.ts |
| `get_finance_budget_policy` | 1 | 0 | budget-policy.integration.test.ts |
| `get_finance_budget_policy_preview` | 1 | 0 | budget-policy.integration.test.ts |
| `get_finance_budget_revision_proposal` | 1 | 0 | budget-policy.integration.test.ts |
| `get_finance_budget_status` | 1 | 0 | queries.integration.test.ts |
| `get_finance_cashflow` | 1 | 0 | queries.integration.test.ts |
| `get_finance_categories` | 1 | 0 | queries.integration.test.ts |
| `get_finance_category_budget_status` | 2 | 0 | queries.integration.test.ts, planning.integration.test.ts |
| `get_finance_configuration` | 2 | 0 | finances.integration.test.ts, queries.integration.test.ts |
| `get_finance_connection_capabilities` | 1 | 0 | queries.integration.test.ts |
| `get_finance_contextual_question` | 1 | 0 | finance-review.integration.test.ts |
| `get_finance_continuations` | 1 | 0 | recovery.integration.test.ts |
| `get_finance_guided_setup` | 1 | 0 | queries.integration.test.ts |
| `get_finance_inbox` | 1 | 0 | queries.integration.test.ts |
| `get_finance_ledger_challenge` | 1 | 0 | maintenance.integration.test.ts |
| `get_finance_ledger_health` | 1 | 0 | queries.integration.test.ts |
| `get_finance_maintenance_history` | 4 | 0 | queries.integration.test.ts |
| `get_finance_maintenance_run` | 2 | 0 | queries.integration.test.ts |
| `get_finance_overview` | 1 | 0 | queries.integration.test.ts |
| `get_finance_period_review` | 1 | 0 | maintenance.integration.test.ts |
| `get_finance_playbook` | 1 | 0 | queries.integration.test.ts |
| `get_finance_position` | 1 | 0 | finances.integration.test.ts |
| `get_finance_profile` | 2 | 0 | queries.integration.test.ts, planning.integration.test.ts |
| `get_finance_review_history_item` | 1 | 0 | finance-review.integration.test.ts |
| `get_finance_review_queue` | 1 | 0 | queries.integration.test.ts |
| `get_finance_settings` | 3 | 0 | controls.integration.test.ts, queries.integration.test.ts |
| `get_finance_snapshot` | 1 | 0 | queries.integration.test.ts |
| `get_finance_status` | 1 | 0 | queries.integration.test.ts |
| `get_finance_transaction` | 4 | 0 | ledger.integration.test.ts, finance-review.integration.test.ts |
| `get_finance_wealth_summary` | 1 | 0 | queries.integration.test.ts |
| `get_financial_profile` | 1 | 0 | queries.integration.test.ts |
| `get_ilo_context` | 1 | 0 | queries.integration.test.ts |
| `get_ilo_setup` | 1 | 0 | queries.integration.test.ts |
| `get_mail_maintenance_run` | 1 | 0 | mail-stewardship.integration.test.ts |
| `get_mail_question` | 1 | 0 | mail-stewardship.integration.test.ts |
| `get_mail_review` | 1 | 0 | mail-stewardship.integration.test.ts |
| `get_mail_settings` | 3 | 0 | controls.integration.test.ts, queries.integration.test.ts |
| `get_mail_setup_context` | 1 | 0 | queries.integration.test.ts |
| `get_mail_status` | 1 | 0 | queries.integration.test.ts |
| `get_mail_thread_stewardship` | 1 | 1 | mail-stewardship.integration.test.ts |
| `get_notification_settings` | 2 | 0 | controls.integration.test.ts, queries.integration.test.ts |
| `get_reminder` | 2 | 0 | tasks.integration.test.ts |
| `get_task` | 2 | 2 | tasks.integration.test.ts |
| `get_task_list` | 2 | 0 | tasks.integration.test.ts |
| `get_task_project` | 2 | 0 | tasks.integration.test.ts |
| `get_task_settings` | 3 | 0 | controls.integration.test.ts, queries.integration.test.ts |
| `get_texting_connection` | 1 | 0 | queries.integration.test.ts |
| `get_texting_finance_reply_status` | 1 | 0 | texting.integration.test.ts |
| `import_finance_transactions` | 2 | 0 | ledger.integration.test.ts |
| `link_finance_transactions` | 1 | 0 | ledger.integration.test.ts |
| `list_attention_items` | 4 | 0 | controls.integration.test.ts |
| `list_automation_host_connections` | 2 | 0 | queries.integration.test.ts, recovery.integration.test.ts |
| `list_automation_host_schedules` | 2 | 0 | queries.integration.test.ts, recovery.integration.test.ts |
| `list_calendars` | 1 | 1 | calendar.integration.test.ts, queries.integration.test.ts |
| `list_events` | 2 | 0 | calendar.integration.test.ts |
| `list_finance_accounts` | 1 | 0 | queries.integration.test.ts |
| `list_finance_action_reviews` | 2 | 0 | finances.integration.test.ts, queries.integration.test.ts |
| `list_finance_answer_continuations` | 1 | 0 | queries.integration.test.ts |
| `list_finance_budget_buckets` | 3 | 0 | queries.integration.test.ts, planning.integration.test.ts |
| `list_finance_budget_policies` | 1 | 0 | finances.integration.test.ts |
| `list_finance_goals` | 2 | 0 | ledger.integration.test.ts, queries.integration.test.ts |
| `list_finance_host_runs` | 1 | 0 | queries.integration.test.ts |
| `list_finance_merchants` | 1 | 0 | queries.integration.test.ts |
| `list_finance_questions` | 2 | 0 | finances.integration.test.ts, queries.integration.test.ts |
| `list_finance_recurring_items` | 1 | 0 | queries.integration.test.ts |
| `list_finance_reimbursements` | 2 | 0 | ledger.integration.test.ts, queries.integration.test.ts |
| `list_finance_review_history` | 2 | 0 | finances.integration.test.ts, queries.integration.test.ts |
| `list_finance_rules` | 3 | 0 | queries.integration.test.ts, planning.integration.test.ts |
| `list_finance_transactions` | 3 | 0 | ledger.integration.test.ts, queries.integration.test.ts |
| `list_mail` | 3 | 0 | queries.integration.test.ts, mail-stewardship.integration.test.ts |
| `list_mail_drafts` | 3 | 0 | queries.integration.test.ts, mail.integration.test.ts |
| `list_mail_rules` | 1 | 0 | queries.integration.test.ts |
| `list_mailboxes` | 1 | 0 | queries.integration.test.ts |
| `list_reminders` | 1 | 0 | queries.integration.test.ts |
| `list_task_lists` | 1 | 0 | queries.integration.test.ts |
| `list_task_projects` | 1 | 0 | queries.integration.test.ts |
| `list_task_workspace` | 3 | 0 | queries.integration.test.ts, tasks.integration.test.ts |
| `list_tasks` | 1 | 0 | queries.integration.test.ts |
| `list_workspace_sources` | 2 | 0 | queries.integration.test.ts, sources.integration.test.ts |
| `maintain_finances` | 1 | 0 | queries.integration.test.ts |
| `maintain_mail` | 1 | 0 | mail-stewardship.integration.test.ts |
| `manage_finance_budget_bucket` | 2 | 0 | planning.integration.test.ts |
| `manage_finance_goal` | 6 | 0 | ledger.integration.test.ts |
| `manage_finance_recurring_item` | 3 | 0 | planning.integration.test.ts |
| `manage_finance_rule` | 3 | 0 | planning.integration.test.ts |
| `merge_finance_merchants` | 1 | 0 | ledger.integration.test.ts |
| `move_task` | 2 | 0 | tasks.integration.test.ts |
| `move_task_project` | 2 | 0 | tasks.integration.test.ts |
| `observe_finance_host_schedule` | 1 | 0 | recovery.integration.test.ts |
| `preview_calendar_commitment` | 1 | 0 | calendar.integration.test.ts |
| `preview_finance_budget_policy` | 2 | 0 | budget-policy.integration.test.ts |
| `preview_mail_response_brief` | 1 | 0 | mail-stewardship.integration.test.ts |
| `preview_mail_rule` | 1 | 0 | mail-stewardship.integration.test.ts |
| `preview_overdue_reminder_deferral` | 2 | 0 | tasks.integration.test.ts |
| `preview_task_move` | 2 | 0 | tasks.integration.test.ts |
| `preview_task_project_move` | 2 | 0 | tasks.integration.test.ts |
| `propose_finance_categorizations` | 2 | 0 | queries.integration.test.ts, finance-review.integration.test.ts |
| `read_mail` | 2 | 0 | mail-send.integration.test.ts, mail-stewardship.integration.test.ts |
| `read_text_conversation` | 2 | 0 | queries.integration.test.ts, texting.integration.test.ts |
| `reconcile_finance_host_delivery` | 1 | 1 | recovery.integration.test.ts |
| `reconcile_finance_reimbursement` | 2 | 0 | ledger.integration.test.ts |
| `reconcile_mail_draft` | 1 | 0 | mail-send.integration.test.ts |
| `recover_finance_host_run` | 1 | 0 | recovery.integration.test.ts |
| `refresh_finance_insights` | 1 | 0 | planning.integration.test.ts |
| `remove_finance_transaction` | 1 | 0 | ledger.integration.test.ts |
| `reopen_task` | 4 | 0 | tasks.integration.test.ts |
| `reset_finance_notification_settings` | 1 | 0 | controls.integration.test.ts |
| `resolve_finance_alert` | 1 | 0 | planning.integration.test.ts |
| `resolve_finance_review` | 1 | 0 | ledger.integration.test.ts |
| `resolve_finance_transaction_review` | 1 | 4 | finance-review.integration.test.ts |
| `restore_event` | 1 | 0 | calendar.integration.test.ts |
| `restore_reminder` | 2 | 0 | tasks.integration.test.ts |
| `restore_task` | 2 | 0 | tasks.integration.test.ts |
| `review_finance_receipt` | 1 | 0 | ledger.integration.test.ts |
| `review_mail_rule` | 1 | 0 | mail-stewardship.integration.test.ts |
| `revise_finance_budget` | 1 | 0 | finances.integration.test.ts |
| `revise_finance_budget_policy` | 1 | 0 | budget-policy.integration.test.ts |
| `revoke_automation_host_schedule` | 1 | 0 | recovery.integration.test.ts |
| `save_domain_profile` | 2 | 1 | mail-stewardship.integration.test.ts, guidance.integration.test.ts |
| `save_finance_budget_policy_preview` | 1 | 0 | budget-policy.integration.test.ts |
| `search_calendar` | 1 | 0 | controls.integration.test.ts |
| `search_finance` | 1 | 0 | controls.integration.test.ts |
| `search_mail` | 1 | 0 | controls.integration.test.ts |
| `search_tasks` | 1 | 0 | controls.integration.test.ts |
| `send_mail_draft` | 1 | 5 | mail-send.integration.test.ts |
| `send_text_message` | 1 | 1 | texting.integration.test.ts |
| `set_calendar_selection` | 1 | 0 | calendar.integration.test.ts |
| `set_event_block_privacy` | 1 | 0 | calendar.integration.test.ts |
| `set_finance_budget_plan` | 1 | 0 | planning.integration.test.ts |
| `set_finance_transaction_breakdown` | 1 | 0 | ledger.integration.test.ts |
| `set_mail_disposition` | 1 | 0 | mail-stewardship.integration.test.ts |
| `setup_finances` | 2 | 0 | planning.integration.test.ts |
| `snooze_mail` | 1 | 0 | mail-stewardship.integration.test.ts |
| `split_finance_transaction` | 1 | 1 | ledger.integration.test.ts |
| `start_finance_account_connection` | 16 | 1 | bank-handoff.integration.test.ts |
| `submit_finance_ledger_challenge` | 2 | 1 | maintenance.integration.test.ts |
| `sync_finance_accounts` | 4 | 0 | finance-sync.integration.test.ts |
| `sync_workspace_source` | 1 | 2 | sources.integration.test.ts |
| `trash_task` | 2 | 0 | tasks.integration.test.ts |
| `unblock_event` | 1 | 0 | calendar.integration.test.ts |
| `update_attention_item` | 4 | 0 | controls.integration.test.ts |
| `update_automation_host_schedule` | 1 | 1 | recovery.integration.test.ts |
| `update_calendar` | 1 | 0 | calendar.integration.test.ts |
| `update_calendar_settings` | 1 | 1 | controls.integration.test.ts |
| `update_event` | 1 | 1 | calendar.integration.test.ts |
| `update_finance_account` | 1 | 0 | ledger.integration.test.ts |
| `update_finance_income_stream` | 1 | 0 | planning.integration.test.ts |
| `update_finance_merchant` | 1 | 0 | ledger.integration.test.ts |
| `update_finance_profile` | 1 | 0 | planning.integration.test.ts |
| `update_finance_recurring_obligation` | 1 | 0 | planning.integration.test.ts |
| `update_finance_settings` | 1 | 1 | controls.integration.test.ts |
| `update_finance_transaction` | 3 | 1 | ledger.integration.test.ts |
| `update_financial_profile` | 2 | 0 | finances.integration.test.ts, budget-policy.integration.test.ts |
| `update_mail` | 1 | 0 | mail-send.integration.test.ts |
| `update_mail_draft` | 1 | 0 | mail.integration.test.ts |
| `update_mail_obligation` | 1 | 0 | mail-stewardship.integration.test.ts |
| `update_mail_rule` | 1 | 0 | mail-stewardship.integration.test.ts |
| `update_mail_settings` | 1 | 1 | controls.integration.test.ts |
| `update_notification_settings` | 2 | 1 | controls.integration.test.ts |
| `update_reminder` | 2 | 0 | tasks.integration.test.ts |
| `update_task` | 2 | 0 | tasks.integration.test.ts |
| `update_task_list` | 2 | 0 | tasks.integration.test.ts |
| `update_task_project` | 2 | 0 | tasks.integration.test.ts |
| `update_task_settings` | 1 | 1 | controls.integration.test.ts |
| `withdraw_finance_budget_revision_proposal` | 1 | 0 | budget-policy.integration.test.ts |

## Workspace execution totals

| Workspace | Exposed tools | Executed successfully | Provider verification |
| --- | ---: | ---: | --- |
| Mail | 36 | 36 | Controlled provider only |
| Tasks and Reminders | 38 | 38 | Local operations; no external provider claim |
| Calendar | 21 | 21 | Local calendar execution; provider suites are separate |
| Finances | 119 | 119 | Controlled bank provider only |
| Shared and Texting | 18 | 18 | Controlled SMS provider only |
