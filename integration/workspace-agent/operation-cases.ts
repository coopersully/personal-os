/** Explicit semantic equivalences and owner boundaries for the typed workspace API audit.
 * A missing ordinary operation must get an adapter; it cannot be waived by the inventory test.
 */
export const workspaceApiExceptions = {
  saveAutomationHostFireToken: {
    kind: "owner_consent",
    reason:
      "External-host trigger credentials are owner-managed secrets; agents cannot replace their own host credentials.",
  },
  listFinanceAnswerContinuations: {
    kind: "equivalent",
    tool: "list_finance_answer_continuations",
    reason:
      "The MCP adapter uses the bounded cursor page method instead of the UI helper that drains all pages.",
  },
  getFinancePeriodReview: {
    kind: "equivalent",
    tool: "get_finance_period_review",
    reason:
      "The presentation endpoint carries the same complete typed FinancePeriodReview plus text and visual metadata.",
  },
  getPlaidLinkToken: {
    kind: "provider_consent",
    tool: "start_finance_account_connection",
    reason:
      "Web-only raw-token bootstrap; MCP returns a hosted provider URL. Provider login and MFA belong to the owner.",
  },
  exchangePlaidToken: {
    kind: "equivalent",
    tool: "complete_finance_account_connection",
    reason:
      "MCP polls provider-confirmed consent and exchanges the token server-side; no provider secrets enter agent arguments.",
  },
  importFinanceCsv: {
    kind: "equivalent",
    tool: "import_finance_transactions",
    reason: "Canonical preview and import commit preserve column mapping and source identity.",
  },
  mergeFinanceMerchants: {
    kind: "equivalent",
    tool: "merge_finance_merchants",
    reason: "Canonical merger wraps the same domain service with an idempotency key.",
  },
  updateFinanceMerchant: {
    kind: "equivalent",
    tool: "update_finance_merchant",
    reason: "Canonical merchant update delegates to the same owned merchant service.",
  },
  updateFinanceTransaction: {
    kind: "equivalent",
    tool: "update_finance_transaction",
    reason:
      "Canonical ledger edit and classification operations replace the portal compatibility endpoint; category learning remains an explicit separate decision.",
  },
  deleteEvent: {
    kind: "equivalent",
    tool: "delete_event",
    reason:
      "Tool uses revision-aware trash; legacy delete client method delegates to that same recoverable deletion API.",
  },
  deleteReminder: {
    kind: "equivalent",
    tool: "delete_reminder",
    reason: "Tool uses revision-aware trash instead of the legacy client shortcut.",
  },
  startTextingVerification: {
    kind: "owner_consent",
    reason:
      "Phone possession verification initiates an SMS and establishes a new messaging destination. The owner controls this consent.",
  },
  checkTextingVerification: {
    kind: "owner_consent",
    reason: "Phone possession challenge codes must not be supplied by an agent.",
  },
} as const;

export const runtimeScenarios = [
  {
    id: "finance-ledger",
    file: "ledger.integration.test.ts",
    purpose:
      "Canonical edits, classification, splits, imports, merchant merge, reimbursements and goal lifecycles",
  },
  {
    id: "finance-planning",
    file: "planning.integration.test.ts",
    purpose: "Profiles, scenarios, budget plans/buckets, setup and recurring income/obligations",
  },
  {
    id: "finance-maintenance",
    file: "maintenance.integration.test.ts",
    purpose:
      "Prepared challenge read/submit, stale/replay checks and immutable historical period reports",
  },
  {
    id: "texting",
    file: "texting.integration.test.ts",
    purpose: "Controlled outbound SMS, receipt replay denial and private inbound claim projection",
  },
  {
    id: "query-discovery",
    file: "queries.integration.test.ts",
    purpose: "Every no-required-argument read, with real API authentication and migrated SQL",
  },
  {
    id: "authorization",
    file: "authorization.integration.test.ts",
    purpose: "Personal/OAuth credentials, bypass on/off, missing execute grant, expiry and refresh",
  },
  {
    id: "calendar",
    file: "calendar.integration.test.ts",
    purpose:
      "Local calendar creation, rename, selection, deletion, status/review and read-only discovery",
  },
  {
    id: "tasks",
    file: "tasks.integration.test.ts",
    purpose:
      "Task/list/project lifecycle, guarded move and mixed reminder reads under both bypass states",
  },
  {
    id: "mail",
    file: "mail.integration.test.ts",
    purpose: "Persisted draft CRUD and revision readback",
  },
  {
    id: "mail-send",
    file: "mail-send.integration.test.ts",
    purpose:
      "Controlled provider send, uncertain receipt reconciliation, no duplicate send, attachment transfer and isolation",
  },
  {
    id: "mail-stewardship",
    file: "mail-stewardship.integration.test.ts",
    purpose: "Populated obligations, disposition, question, brief and feedback queries",
  },
  {
    id: "finance",
    file: "finances.integration.test.ts",
    purpose: "Reporting, accounts, categories, exact budget activation and audit",
  },
  {
    id: "finance-review",
    file: "finance-review.integration.test.ts",
    purpose: "Explicit transfer review with preserved agent identity and stale replay rejection",
  },
  {
    id: "finance-policy",
    file: "budget-policy.integration.test.ts",
    purpose: "Baseline, policy lifecycle, proposals, persisted evaluation and withdrawal",
  },
  {
    id: "finance-sync",
    file: "finance-sync.integration.test.ts",
    purpose: "Controlled bank synchronization, persisted cursor and partial failure",
  },
  {
    id: "bank-consent",
    file: "bank-handoff.integration.test.ts",
    purpose: "Hosted URL, pending consent, completion, protected tokens and safe replay",
  },
  {
    id: "guidance",
    file: "guidance.integration.test.ts",
    purpose: "Active guidance provenance and owner approval distinction",
  },
  {
    id: "settings",
    file: "controls.integration.test.ts",
    purpose:
      "Four workspace settings/search APIs, revision conflicts and notification privacy inheritance",
  },
  {
    id: "host-recovery",
    file: "recovery.integration.test.ts",
    purpose: "Original-connection ownership, host metadata lifecycle and bypass denial",
  },
  {
    id: "sources",
    file: "sources.integration.test.ts",
    purpose: "Cross-workspace source ownership, effect grants and disconnection audit",
  },
] as const;
