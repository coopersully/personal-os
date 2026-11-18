# Finance manual tool coverage

This is the current integrated setup/manual candidate inventory, not a claim of complete manual
parity or executed browser acceptance. The canonical API/MCP writers keep ownership, revision,
approval and execution policy; visibility and setup-task markers grant no authority.

| Operation or MCP tool | Manual destination | Candidate coverage and remaining limit |
| --- | --- | --- |
| `list_finance_accounts`, `update_finance_account` | `/finances/accounts` | Linking, include/exclude, ownership/share, kind, balance and existing-account edits remain available. |
| Manual account creation | Accounts → Add account → Track account manually | Secondary entry follows Auto/Show/Hide. Explicit currency is optional; unknown never becomes USD. Existing account currency correction is not exposed by the update contract. |
| `add_finance_transaction` | Transactions → Add transaction | Capture follows actual server readiness and visibility; a hash cannot reopen hidden capture. |
| `import_finance_transactions` | Transactions → Import; setup import task | Supported PayPal/Venmo/Zelle CSV import retains its account/provider contract. The setup task renders only import material. No general bank CSV or provider connection is invented. |
| `update_finance_transaction`, categorization decisions | Transactions row/context menu; setup correction task | Single category/context correction and bounded current-page bulk categorization retain exact IDs/revisions and per-item outcomes. |
| Exact Spending source records | Spending source link → Transactions | Producer descriptor, contribution/native-amount distinction, stale-snapshot rejection and scope-preserving recovery remain intact when capture is hidden. |
| `split_finance_transaction` / canonical breakdown writer | Transaction context menu → Split purchase | Existing breakdown dialog calls the canonical writer. This slice preserves it; complete split/reimbursement parity belongs to the relevant owner and still needs live acceptance. |
| `remove_finance_transaction` | No dedicated manual action found in this candidate | API/tool exists; a bounded deletion/recovery UI is still needed. Do not present categorization or source disconnection as deletion. |
| `link_finance_transactions` | No dedicated relationship editor found in this candidate | Transfer/refund/reversal/duplicate/reimbursement relationship editing remains a manual-parity gap; the source graph must remain canonical. |
| Reimbursement inspection and reconciliation | Transaction review/reimbursement list | Current list is inspection, not proof of a correction/matching action. Finance reimbursement correction/occurrence work has separate source ownership and acceptance. |
| `list_finance_merchants`, `update_finance_merchant`, `merge_finance_merchants` | No dedicated merchant management destination found | Rename/merge controls remain a manual-parity gap; category correction never implies merchant learning. |
| `list_finance_rules`, `manage_finance_rule` | No dedicated persistent-rule editor found | Tool support is not UI support. A reviewable permanent-rule workflow remains separate. |
| `list_finance_recurring_items`, `manage_finance_recurring_item` | Cash flow; retained supporting recurring controls | Existing recurring review/edit behavior is preserved. Full income/obligation/cost/occurrence coverage is owned by the Cash flow workstream, not inferred from this slice. |
| `get_financial_profile`, `update_financial_profile` | Setup profile editor and Finance settings | Canonical values stay in the profile. Explicit review unknown/none receipts are separate and survive unrelated profile revisions. |
| `setup_finances`, `get_finance_playbook` | Setup → initial agent instructions | Initial guidance points to actual tool flow. Manual later remains valid; optional budget creation/approval does not block workspace completion. |
| Budget create/revise/approve tools | Budget/Plan; setup approval task | Existing exact-version human approval is preserved. The setup approval task omits unrelated plan creation; pending/needs-input never claims activation. |
| `get_finance_inbox`, `answer_finance_review` | Review/questions | Questions and approvals remain reachable while capture is hidden and during setup repair. |
| `export_finance_data` | Transactions export menu | Export remains available in the correction task and ordinary accessible workspace; it is not a creation control. |
| `maintain_finances` and host tools | Automations, Chat, Activity/Review | An external host owns recurring execution. Human corrections remain independent; registration alone never proves Chat or successful maintenance. |

Ordinary new-owner routes use actual completion or a migration-time legacy grant. Explicit setup,
account repair, correction/import/approval tasks and question evidence remain reachable with a
clear return to setup. Existing access is not a completion timestamp or messaging capability.

The browser matrix covers new/manual, unknown/none, interruption, canonical-source changes,
registration pending, actual message challenge proof, revocation and genuine pre-migration legacy
eligibility. Authored tests, focused source checks and prior PostgreSQL receipts are separate from
executed integrated desktop/mobile and complete verifier evidence. The gaps above keep the broader
manual-workflow issue open.
