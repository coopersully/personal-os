import { readdir, readFile } from "node:fs/promises";
import * as domain from "@personal-os/domain";
import { canDiscoverTool } from "../../apps/mcp/src/tool-catalog.js";
import { runtimeScenarios, workspaceApiExceptions } from "./operation-cases.js";
import { discoverToolDictionary, renderToolDictionary } from "./tool-dictionary.js";

it("exposes domain input fields instead of silently narrowing workspace mutations", async () => {
  const mappings = {
    list_events: domain.eventListQuerySchema,
    list_mail: domain.mailListQuerySchema,
    list_reminders: domain.reminderListQuerySchema,
    list_tasks: domain.taskListQuerySchema,
    list_task_workspace: domain.taskWorkspaceQuerySchema,
    list_finance_accounts: domain.financeAccountQuerySchema,
    list_finance_transactions: domain.financeTransactionQuerySchema,
    list_finance_budget_buckets: domain.financeBudgetBucketQuerySchema,
    list_finance_review_history: domain.financeReviewHistoryQuerySchema,
    get_finance_maintenance_history: domain.financeMaintenanceHistoryQuerySchema,
    create_calendar: domain.createLocalCalendarInputSchema,
    update_calendar: domain.updateLocalCalendarInputSchema,
    create_event: domain.createEventInputSchema,
    update_event: domain.updateEventInputSchema,
    create_reminder: domain.createReminderInputSchema,
    update_reminder: domain.updateReminderInputSchema,
    create_task: domain.createTaskInputSchema,
    update_task: domain.updateTaskInputSchema,
    create_task_list: domain.createTaskListInputSchema,
    update_task_list: domain.updateTaskListInputSchema,
    create_task_project: domain.createTaskProjectInputSchema,
    update_task_project: domain.updateTaskProjectInputSchema,
    create_mail_draft: domain.createMailDraftInputSchema,
    update_mail_draft: domain.updateMailDraftInputSchema,
    update_mail: domain.updateMailThreadInputSchema,
    bulk_update_mail: domain.bulkUpdateMailInputSchema,
    create_mail_obligation: domain.createMailObligationInputSchema,
    update_mail_obligation: domain.updateMailObligationInputSchema,
    create_finance_account: domain.createFinanceAccountInputSchema,
    update_finance_account: domain.updateFinanceAccountInputSchema,
    create_finance_category: domain.createFinanceCategoryInputSchema,
    update_finance_transaction: domain.updateFinanceTransactionInputSchema,
    update_financial_profile: domain.updateFinancialProfileInputSchema,
    update_finance_profile: domain.updateFinanceProfileInputSchema,
    update_finance_income_stream: domain.updateFinanceIncomeStreamInputSchema,
    update_finance_recurring_obligation: domain.updateFinanceRecurringObligationInputSchema,
    manage_finance_goal: domain.manageFinanceGoalInputSchema,
    manage_finance_rule: domain.manageFinanceRuleInputSchema,
    manage_finance_recurring_item: domain.manageFinanceRecurringItemInputSchema,
    manage_finance_budget_bucket: domain.manageFinanceBudgetBucketInputSchema,
  };
  function fields(schema: unknown): Set<string> {
    if (!schema || typeof schema !== "object") return new Set();
    const node = schema as {
      properties?: Record<string, unknown>;
      allOf?: unknown[];
      anyOf?: unknown[];
      oneOf?: unknown[];
    };
    return new Set([
      ...Object.keys(node.properties ?? {}),
      ...[...(node.allOf ?? []), ...(node.anyOf ?? []), ...(node.oneOf ?? [])].flatMap((part) => [
        ...fields(part),
      ]),
    ]);
  }
  const dictionary = new Map((await discoverToolDictionary()).map(({ tool }) => [tool.name, tool]));
  const missing: string[] = [];
  for (const [name, schema] of Object.entries(mappings)) {
    const tool = dictionary.get(name);
    expect(tool, name).toBeDefined();
    const actual = fields(tool?.inputSchema);
    for (const field of fields(schema.toJSONSchema({ io: "input" })))
      if (!actual.has(field)) missing.push(`${name}.${field}`);
  }
  expect(missing).toEqual([]);
});

it("keeps every documented schema and scope equal to actual MCP discovery", async () => {
  expect(await readFile("docs/engineering/workspace-agent-tools.md", "utf8")).toBe(
    await renderToolDictionary(),
  );
}, 30_000);
it("accounts for every typed workspace operation with an adapter or named semantic boundary", async () => {
  const sourceFiles = (await readdir("apps/mcp/src/tools")).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
  );
  const source = (
    await Promise.all(sourceFiles.map((name) => readFile(`apps/mcp/src/tools/${name}`, "utf8")))
  ).join("\n");
  const methods = new Set([...source.matchAll(/api\.([A-Za-z0-9_]+)\(/g)].map((m) => m[1]));
  const missing: string[] = [];
  for (const feature of [
    "finances",
    "mail",
    "mail-stewardship",
    "calendar",
    "tasks",
    "task-workspace",
    "reminders",
    "automation-hosts",
    "texting",
  ]) {
    const text = await readFile(`packages/api-client/src/features/${feature}.ts`, "utf8");
    for (const match of text.matchAll(
      /(?:async ([A-Za-z0-9_]+)\(|^ {4}([A-Za-z0-9_]+): (?:async )?\()/gm,
    )) {
      const name = match[1] ?? match[2];
      if (name && !methods.has(name) && !(name in workspaceApiExceptions))
        missing.push(`${feature}.${name}`);
    }
  }
  expect(missing).toEqual([]);
  const discovered = new Set((await discoverToolDictionary()).map(({ tool }) => tool.name));
  for (const entry of Object.values(workspaceApiExceptions))
    if ("tool" in entry) expect(discovered.has(entry.tool), entry.tool).toBe(true);
  for (const scenario of runtimeScenarios)
    expect(await readFile(`integration/workspace-agent/${scenario.file}`, "utf8")).toContain(
      "createMcpWorkspaceFixture",
    );
});
it("requires every listed grant for multi-scope tools and hides all mutations from read-only discovery", async () => {
  for (const { tool, definition } of await discoverToolDictionary()) {
    const grants = new Set(definition.requiredScopes);
    if (!definition.compatibility)
      expect(canDiscoverTool(definition, grants, false), tool.name).toBe(true);
    if (!definition.readOnly)
      expect(canDiscoverTool(definition, grants, true), tool.name).toBe(false);
    if (definition.scopeMatch === "all")
      for (const scope of grants) {
        const fewer = new Set(grants);
        fewer.delete(scope);
        expect(canDiscoverTool(definition, fewer, false), `${tool.name} without ${scope}`).toBe(
          false,
        );
      }
  }
});

it("does not publish strict intersections that forbid their own sibling arguments", async () => {
  function inspect(schema: unknown) {
    if (!schema || typeof schema !== "object") return;
    const node = schema as {
      allOf?: Array<{ properties?: Record<string, unknown>; additionalProperties?: boolean }>;
    };
    if (node.allOf) {
      const keys = new Set(node.allOf.flatMap((part) => Object.keys(part.properties ?? {})));
      for (const part of node.allOf)
        if (part.additionalProperties === false)
          for (const key of keys) expect(part.properties).toHaveProperty(key);
    }
    for (const value of Object.values(schema))
      if (Array.isArray(value)) value.forEach(inspect);
      else inspect(value);
  }
  for (const { tool } of await discoverToolDictionary()) inspect(tool.inputSchema);
});
