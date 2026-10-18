import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { ApiClientError, type PersonalOsApiClient } from "@personal-os/api-client";
import { financeCapabilityManifest } from "@personal-os/domain";
import { registerFinanceTools } from "./finances.js";

const id = "11111111-1111-4111-8111-111111111111";
const base = {
  changes: [],
  communication: { headline: "One answer needed.", optionalDetails: [], requiredDisclosures: [] },
  outcome: "user_input_required" as const,
  remainingWork: { categories: ["collecting_profile"], count: 1 },
  schemaVersion: 1 as const,
};

describe("Finance MCP workflows", () => {
  it.each([
    { items: [{ id, merchant: "Market", amount: 12.5, currency: "USD" }], nextCursor: "next-page" },
    { items: [], nextCursor: null },
  ])("returns transaction rows and pagination to text-only clients: %j", async (page) => {
    const server = new McpServer({ name: "finance-text-results", version: "1" });
    registerFinanceTools(server, {
      listFinanceTransactions: vi.fn(async () => page),
    } as unknown as PersonalOsApiClient);
    const client = new Client({ name: "text-only-client", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const response = await client.callTool({ name: "list_finance_transactions", arguments: {} });
      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      expect(JSON.parse(text)).toMatchObject({ data: page, outcome: "completed" });
      expect(JSON.parse(text)).toEqual(response.structuredContent);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("forwards exact approval profile evidence and setup skips without hiding agent denial", async () => {
    const approveFinanceBudget = vi.fn(async () => {
      throw new ApiClientError({
        status: 403,
        code: "forbidden",
        message: "Budget activation requires an authenticated user decision.",
      });
    });
    const setupFinances = vi.fn(async () => ({ ...base, data: {} }));
    const server = new McpServer({ name: "finance-approval-parity", version: "1" });
    registerFinanceTools(server, {
      approveFinanceBudget,
      setupFinances,
    } as unknown as PersonalOsApiClient);
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const input = {
      approvalSource: "user_instruction",
      budgetVersionId: id,
      expectedProfileVersionId: id,
      expectedVersion: 3,
      idempotencyKey: "exact-decision",
    };
    const result = await client.callTool({ name: "approve_finance_budget", arguments: input });
    expect(approveFinanceBudget).toHaveBeenCalledWith(input);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("authenticated user decision");
    const skip = {
      operation: "skip",
      sessionId: id,
      expectedVersion: 2,
      questionId: "planning:obligations",
      idempotencyKey: "skip-unknown",
    };
    await client.callTool({ name: "setup_finances", arguments: skip });
    expect(setupFinances).toHaveBeenCalledWith(skip);
    const tools = await client.listTools();
    expect(
      tools.tools.find((tool) => tool.name === "approve_finance_budget")?.description,
    ).toContain("exact authenticated human approval");
    const setupDescription = tools.tools.find(
      (tool) => tool.name === "setup_finances",
    )?.description;
    expect(setupDescription).toContain("requires exact authenticated human approval in nohmi");
    expect(setupDescription).toContain(
      "cannot activate budgets, even with execution or review bypass",
    );
    expect(setupDescription).not.toContain("agent_self_approval");
    await client.close();
    await server.close();
  });
  it("forwards ledger search and versioned ownership corrections without dropping fields", async () => {
    const api = {
      listFinanceTransactions: vi.fn(async () => ({ items: [], nextCursor: null })),
      updateFinanceAccount: vi.fn(async () => ({ ...base, outcome: "completed", data: { id } })),
    };
    const server = new McpServer({ name: "finance-portal-parity", version: "1" });
    registerFinanceTools(server, api as unknown as PersonalOsApiClient);
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    await client.callTool({
      name: "list_finance_transactions",
      arguments: { search: "market", accountId: id },
    });
    expect(api.listFinanceTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ search: "market", accountId: id }),
    );
    const input = {
      accountId: id,
      expectedUpdatedAt: "2026-09-03T12:00:00.000Z",
      includeInPlanning: true,
      ownershipType: "joint",
      ownershipShare: 0.5,
      idempotencyKey: "ownership-correction",
    };
    expect(
      (await client.callTool({ name: "update_finance_account", arguments: input })).isError,
    ).not.toBe(true);
    const { accountId, ...changes } = input;
    expect(api.updateFinanceAccount).toHaveBeenCalledWith(accountId, changes);
    await client.close();
    await server.close();
  });

  it("forwards account filters to the typed API and returns planning disclosures", async () => {
    const listFinanceAccounts = vi.fn(async () => ({
      accounts: [],
      accountSemantics: {
        excludedAccountIds: [],
        possibleDuplicateGroups: [],
        trustworthy: false,
        unresolvedOwnershipAccountIds: [id],
      },
      totals: { cash: 0, debt: 0, investments: 0, netWorth: 0, otherAssets: 0 },
    }));
    const server = new McpServer({ name: "finance-accounts-test", version: "1" });
    registerFinanceTools(server, { listFinanceAccounts } as unknown as PersonalOsApiClient);
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({
      arguments: { includeExcluded: false, kind: "investment", query: "IRA" },
      name: "list_finance_accounts",
    });
    expect(listFinanceAccounts).toHaveBeenCalledWith({
      includeExcluded: false,
      kind: "investment",
      query: "IRA",
    });
    expect(response.structuredContent).toMatchObject({
      data: {
        accountSemantics: { unresolvedOwnershipAccountIds: [id] },
        totals: { investments: 0 },
      },
    });
  });

  it("delivers saved Inbox notes and account context to the next maintenance caller", async () => {
    const inboxCases = [
      {
        id,
        transactionId: id,
        resolution: { type: "clarify", clarification: "A weekly transfer to savings" },
        context: {
          date: "2026-09-08",
          accountName: "Checking",
          amount: 99,
          direction: "expense",
          pending: false,
        },
      },
    ];
    const api = {
      maintainFinances: vi.fn(async () => ({
        ...base,
        data: {
          runId: id,
          version: 1,
          stage: "agent_reasoning",
          reasoningBatch: [],
          auditContext: null,
          reviewQuestion: null,
          inboxCases,
        },
      })),
    };
    const server = new McpServer({ name: "finance-notes-test", version: "1" });
    registerFinanceTools(server, api as unknown as PersonalOsApiClient);
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const called = await client.callTool({
      name: "maintain_finances",
      arguments: { operation: "start", scope: { type: "all_outstanding" } },
    });
    expect(called.structuredContent).toMatchObject({ data: { inboxCases } });
    await client.close();
    await server.close();
  });

  it("routes natural setup intent and returns one concise question without queue state", async () => {
    const api = {
      setupFinances: vi.fn(async () => ({
        ...base,
        communication: {
          ...base.communication,
          nextQuestion: {
            answerType: "location",
            id: "profile:location",
            prompt: "Where do you live for tax and cost-of-living purposes?",
          },
        },
        data: {
          budgetVersionId: null,
          maintenanceRunId: null,
          question: null,
          sessionId: id,
          stage: "collecting_profile",
          version: 1,
        },
      })),
    } as unknown as PersonalOsApiClient;
    const server = new McpServer({ name: "finance-test", version: "1" });
    registerFinanceTools(server, api);
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    const setup = tools.tools.find((tool) => tool.name === "setup_finances");
    expect(setup?.description).toContain("when the user asks to set up");
    expect(setup?.description).toContain("Do not ask the user to name a tool");
    const maintenance = tools.tools.find((tool) => tool.name === "maintain_finances");
    expect(maintenance?.description).toContain("never queues an automation");
    expect(tools.tools.map((tool) => tool.name)).not.toContain("get_finance_review_queue");
    expect(tools.tools.map((tool) => tool.name)).not.toContain("apply_finance_categorizations");
    expect(tools.tools.map((tool) => tool.name)).not.toContain("disconnect_finance_account");
    expect(tools.tools.map((tool) => tool.name).toSorted()).toEqual(
      financeCapabilityManifest.map((capability) => capability.mcpTool).toSorted(),
    );
    expect(tools.tools.find((tool) => tool.name === "sync_finance_accounts")?.inputSchema).toEqual(
      expect.not.objectContaining({ required: expect.arrayContaining(["idempotencyKey"]) }),
    );
    for (const toolName of [
      "update_finance_transaction",
      "import_finance_transactions",
      "update_finance_merchant",
      "merge_finance_merchants",
      "manage_finance_rule",
      "manage_finance_recurring_item",
    ]) {
      const tool = tools.tools.find((candidate) => candidate.name === toolName);
      const variants = tool?.inputSchema.oneOf ?? tool?.inputSchema.anyOf ?? [tool?.inputSchema];
      expect(variants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ required: expect.arrayContaining(["idempotencyKey"]) }),
        ]),
      );
    }

    const called = await client.callTool({
      name: "setup_finances",
      arguments: { operation: "start" },
    });
    expect(called.structuredContent).toMatchObject({
      communication: { nextQuestion: { id: "profile:location" } },
      outcome: "user_input_required",
    });
    expect(called.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining("Where do you live") }),
    ]);
  });

  it("rejects an incomplete budget bucket update before calling the API", async () => {
    const api = {
      updateFinanceBudgetBucket: vi.fn(),
    } as unknown as PersonalOsApiClient;
    const server = new McpServer({ name: "finance-bucket-test", version: "1" });
    registerFinanceTools(server, api);
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({
      arguments: { idempotencyKey: "bucket-update", name: "Care", operation: "update" },
      name: "manage_finance_budget_bucket",
    });
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      expect.objectContaining({
        text: expect.stringContaining("bucketId: Invalid input"),
      }),
    ]);
    expect(response.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining("expectedVersion: Invalid input") }),
    ]);
    expect(api.updateFinanceBudgetBucket).not.toHaveBeenCalled();
  });

  it("rejects a budget bucket create without a name before calling the API", async () => {
    const api = {
      createFinanceBudgetBucket: vi.fn(),
    } as unknown as PersonalOsApiClient;
    const server = new McpServer({ name: "finance-bucket-create-test", version: "1" });
    registerFinanceTools(server, api);
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({
      arguments: { idempotencyKey: "bucket-create", operation: "create" },
      name: "manage_finance_budget_bucket",
    });
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining("name: Invalid input") }),
    ]);
    expect(api.createFinanceBudgetBucket).not.toHaveBeenCalled();
  });

  it("routes both budget bucket operations through the typed API", async () => {
    const api = {
      createFinanceBudgetBucket: vi.fn(async () => ({ buckets: [] })),
      updateFinanceBudgetBucket: vi.fn(async () => ({ buckets: [] })),
    } as unknown as PersonalOsApiClient;
    const server = new McpServer({ name: "finance-bucket-operations-test", version: "1" });
    registerFinanceTools(server, api);
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    await client.callTool({
      arguments: {
        idempotencyKey: "bucket-create",
        name: "Care",
        operation: "create",
      },
      name: "manage_finance_budget_bucket",
    });
    await client.callTool({
      arguments: {
        bucketId: id,
        categoryIds: [],
        description: null,
        expectedVersion: 1,
        idempotencyKey: "bucket-update",
        operation: "update",
      },
      name: "manage_finance_budget_bucket",
    });
    expect(api.createFinanceBudgetBucket).toHaveBeenCalledWith({
      description: null,
      idempotencyKey: "bucket-create",
      name: "Care",
    });
    expect(api.updateFinanceBudgetBucket).toHaveBeenCalledWith(id, {
      categoryIds: [],
      description: null,
      expectedVersion: 1,
      idempotencyKey: "bucket-update",
      name: undefined,
      position: undefined,
    });
  });

  it("preserves agent dispositions for both budget bucket operations", async () => {
    const pending = { review: { id, status: "pending" }, status: "pending_review" };
    const needsInput = { question: { id, prompt: "Choose categories." }, status: "needs_input" };
    const api = {
      createFinanceBudgetBucket: vi.fn(async () => pending),
      updateFinanceBudgetBucket: vi.fn(async () => needsInput),
    } as unknown as PersonalOsApiClient;
    const server = new McpServer({ name: "finance-bucket-disposition-test", version: "1" });
    registerFinanceTools(server, api);
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const created = await client.callTool({
      arguments: {
        idempotencyKey: "bucket-create-disposition",
        name: "Care",
        operation: "create",
      },
      name: "manage_finance_budget_bucket",
    });
    const updated = await client.callTool({
      arguments: {
        bucketId: id,
        expectedVersion: 1,
        idempotencyKey: "bucket-update-disposition",
        name: "Care",
        operation: "update",
      },
      name: "manage_finance_budget_bucket",
    });

    expect(created.structuredContent).toEqual({ result: pending });
    expect(updated.structuredContent).toEqual({ result: needsInput });
  });

  it("rejects create-only membership and ordering fields before calling the API", async () => {
    const api = {
      createFinanceBudgetBucket: vi.fn(),
    } as unknown as PersonalOsApiClient;
    const server = new McpServer({ name: "finance-bucket-create-test", version: "1" });
    registerFinanceTools(server, api);
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({
      arguments: {
        categoryIds: [id],
        idempotencyKey: "bucket-create-membership",
        name: "Care",
        operation: "create",
        position: 1,
      },
      name: "manage_finance_budget_bucket",
    });

    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      expect.objectContaining({
        text: expect.stringContaining('Unrecognized keys: "categoryIds", "position"'),
      }),
    ]);
    expect(api.createFinanceBudgetBucket).not.toHaveBeenCalled();
  });

  it("projects an unresolved receipt review as a person-directed question", async () => {
    const question = "What did you buy or pay for at Amazon?";
    const api = {
      reviewFinanceReceipt: vi.fn(async () => ({
        evidence: {
          confidence: 0,
          matches: [],
          nextAction: "ask_person",
          question,
          status: "no_match",
        },
        transaction: { id, merchant: "Amazon" },
      })),
    } as unknown as PersonalOsApiClient;
    const server = new McpServer({ name: "finance-receipt-test", version: "1" });
    registerFinanceTools(server, api);
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({
      arguments: { id, searchMail: true, windowDays: 7 },
      name: "review_finance_receipt",
    });

    expect(response.structuredContent).toMatchObject({
      communication: { nextQuestion: { prompt: question } },
      outcome: "user_input_required",
    });
    expect(response.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining(question) }),
    ]);
  });

  it("leaves resolved receipt reviews without a follow-up question", async () => {
    const api = {
      reviewFinanceReceipt: vi.fn(async () => ({
        evidence: {
          confidence: 1,
          matches: [],
          nextAction: "none",
          question: null,
          status: "matched",
        },
        transaction: { id, merchant: "Amazon" },
      })),
    } as unknown as PersonalOsApiClient;
    const server = new McpServer({ name: "finance-resolved-receipt-test", version: "1" });
    registerFinanceTools(server, api);
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({
      arguments: { id, searchMail: false, windowDays: 7 },
      name: "review_finance_receipt",
    });
    expect(response.structuredContent).toMatchObject({
      data: { evidence: { nextAction: "none", status: "matched" } },
    });
    expect(response.structuredContent).not.toHaveProperty("communication.nextQuestion");
  });
});

it("forwards bounded immutable host prompt reads/issuance and preserves API denials", async () => {
  const issue = {
    scheduleId: id,
    templateVersion: 2,
    scheduleVersionAtIssue: 3,
    text: `Exact issued instructions for ${id}`,
    issuedAt: "2026-10-18T15:00:00.000Z",
  };
  const api = {
    getAutomationHostPromptHistory: vi.fn(async () => ({
      issues: [issue],
      nextCursor: 2,
      currentTemplateVersion: 2,
    })),
    getAutomationHostPrompt: vi.fn(async () => issue),
    issueAutomationHostPrompt: vi.fn(async () => issue),
  };
  const server = new McpServer({ name: "finance-host-prompt-adapters", version: "1" });
  registerFinanceTools(server, api as unknown as PersonalOsApiClient);
  const client = new Client({ name: "prompt-adapter-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const history = await client.callTool({
      name: "get_finance_host_prompt_history",
      arguments: { scheduleId: id, beforeVersion: 3, limit: 1 },
    });
    expect(api.getAutomationHostPromptHistory).toHaveBeenCalledWith(id, {
      beforeVersion: 3,
      limit: 1,
    });
    expect(history.structuredContent).toEqual({
      result: { issues: [issue], nextCursor: 2, currentTemplateVersion: 2 },
    });
    const exact = await client.callTool({
      name: "get_finance_host_prompt",
      arguments: { scheduleId: id, templateVersion: 2 },
    });
    expect(api.getAutomationHostPrompt).toHaveBeenCalledWith(id, 2);
    expect(exact.structuredContent).toEqual({ result: issue });
    const issued = await client.callTool({
      name: "issue_finance_host_prompt",
      arguments: { scheduleId: id, templateVersion: 2, expectedScheduleVersion: 3 },
    });
    expect(api.issueAutomationHostPrompt).toHaveBeenCalledWith(id, 2, {
      expectedScheduleVersion: 3,
    });
    expect(issued.structuredContent).toEqual({ result: issue });
    const badPage = await client.callTool({
      name: "get_finance_host_prompt_history",
      arguments: { scheduleId: id, limit: 101 },
    });
    expect(badPage.isError).toBe(true);
    expect(api.getAutomationHostPromptHistory).toHaveBeenCalledTimes(1);
    const badVersion = await client.callTool({
      name: "issue_finance_host_prompt",
      arguments: { scheduleId: id, templateVersion: 0, expectedScheduleVersion: 3 },
    });
    expect(badVersion.isError).toBe(true);
    expect(api.issueAutomationHostPrompt).toHaveBeenCalledTimes(1);
    api.getAutomationHostPrompt.mockRejectedValueOnce(
      new ApiClientError({
        status: 403,
        code: "forbidden",
        message: "Use this schedule's original host connection.",
        requestId: "prompt-denied",
      }),
    );
    const denied = await client.callTool({
      name: "get_finance_host_prompt",
      arguments: { scheduleId: id, templateVersion: 2 },
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({
      error: {
        status: 403,
        code: "forbidden",
        requestId: "prompt-denied",
        message: "Use this schedule's original host connection.",
      },
    });
  } finally {
    await client.close();
    await server.close();
  }
});

it("reads and prepares exact baseline qualification without exposing human confirmation", async () => {
  const getFinanceBudgetBaselineQualification = vi.fn(async () => ({
    state: "unavailable",
    reason: "qualification_required",
    qualificationRequired: true,
    candidates: [],
  }));
  const prepareFinanceBudgetBaselineQualification = vi.fn(async () => ({
    id,
    fingerprint: "a".repeat(64),
    snapshot: { exact: "server evidence" },
  }));
  const server = new McpServer({ name: "baseline-qualification", version: "1" });
  registerFinanceTools(server, {
    getFinanceBudgetBaselineQualification,
    prepareFinanceBudgetBaselineQualification,
  } as unknown as PersonalOsApiClient);
  const client = new Client({ name: "test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  try {
    const read = await client.callTool({
      name: "get_finance_budget_baseline_qualification",
      arguments: { month: "2026-10" },
    });
    expect(read.isError).not.toBe(true);
    expect(getFinanceBudgetBaselineQualification).toHaveBeenCalledWith("2026-10");
    const input = {
      accountIds: [id],
      budgetVersionId: id,
      currency: "USD",
      idempotencyKey: "exact-review",
      month: "2026-10",
      timezone: "America/New_York",
    };
    const prepared = await client.callTool({
      name: "prepare_finance_budget_baseline_qualification",
      arguments: input,
    });
    expect(prepared.isError).not.toBe(true);
    expect(prepareFinanceBudgetBaselineQualification).toHaveBeenCalledWith(input);
    expect(JSON.stringify(prepared)).toContain("server evidence");
    prepareFinanceBudgetBaselineQualification.mockRejectedValueOnce(
      new ApiClientError({
        status: 409,
        code: "conflict",
        message: "Selected budget changed. Prepare again.",
        details: { reason: "stale_budget" },
        requestId: "baseline-stale",
      }),
    );
    const denied = await client.callTool({
      name: "prepare_finance_budget_baseline_qualification",
      arguments: { ...input, idempotencyKey: "stale-review" },
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({
      error: {
        status: 409,
        code: "conflict",
        details: { reason: "stale_budget" },
        requestId: "baseline-stale",
      },
    });
    const spoofed = await client.callTool({
      name: "prepare_finance_budget_baseline_qualification",
      arguments: { ...input, confirmedByActorId: id },
    });
    expect(spoofed.isError).toBe(true);
    expect(prepareFinanceBudgetBaselineQualification).toHaveBeenCalledTimes(2);
    const tools = await client.listTools();
    expect(
      tools.tools.some((tool) => tool.name === "confirm_finance_budget_baseline_qualification"),
    ).toBe(false);
    expect(
      tools.tools.find((tool) => tool.name === "prepare_finance_budget_baseline_qualification")
        ?.annotations?.readOnlyHint,
    ).toBe(false);
  } finally {
    await client.close();
    await server.close();
  }
});

it("forwards exact Spending selections and source revisions without mutation authority", async () => {
  const query = {
    scope: {
      from: "2026-10-01",
      through: "2026-10-18",
      timezone: "America/New_York",
      accountIds: [],
      categoryIds: [null],
      basis: "personal_cost",
      includePending: false,
      subtractRefunds: true,
    },
    grouping: "categories",
    includeUncategorized: true,
  };
  const filter = {
    query,
    referenceRevision: "a".repeat(64),
    groupId: null,
    from: "2026-10-02",
    through: "2026-10-04",
  };
  const getFinanceSpending = vi.fn(async () => ({ actual: "dashboard" }));
  const listFinanceSpendingTransactions = vi.fn(async () => {
    throw new ApiClientError({
      status: 409,
      code: "conflict",
      message: "Refresh the Spending reference.",
    });
  });
  const server = new McpServer({ name: "spending-parity", version: "1" });
  registerFinanceTools(server, {
    getFinanceSpending,
    listFinanceSpendingTransactions,
  } as unknown as PersonalOsApiClient);
  const client = new Client({ name: "test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  try {
    await client.callTool({ name: "get_finance_spending", arguments: query });
    expect(getFinanceSpending).toHaveBeenCalledExactlyOnceWith(query);
    const stale = await client.callTool({
      name: "list_finance_spending_transactions",
      arguments: { filter, cursor: "next", limit: 25 },
    });
    expect(listFinanceSpendingTransactions).toHaveBeenCalledExactlyOnceWith(filter, "next", 25);
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent).toMatchObject({ error: { status: 409, code: "conflict" } });
    const invalid = await client.callTool({
      name: "list_finance_spending_transactions",
      arguments: { filter: { ...filter, from: "2026-09-01" } },
    });
    expect(invalid.isError).toBe(true);
    expect(listFinanceSpendingTransactions).toHaveBeenCalledTimes(1);
    const spoof = await client.callTool({
      name: "list_finance_spending_transactions",
      arguments: { filter, ownerId: id },
    });
    expect(spoof.isError).toBe(true);
    expect(listFinanceSpendingTransactions).toHaveBeenCalledTimes(1);
  } finally {
    await client.close();
    await server.close();
  }
});

it("reads exact committed run evidence without replaying financial effects", async () => {
  const getFinanceConversationEvidence = vi.fn(async () => ({
    state: "unavailable",
    reason: "no_committed_effect_receipt",
  }));
  const server = new McpServer({ name: "effect-evidence", version: "1" });
  registerFinanceTools(server, {
    getFinanceConversationEvidence,
  } as unknown as PersonalOsApiClient);
  const client = new Client({ name: "test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  const input = {
    candidateId: id,
    candidateRevision: `sha256:${"b".repeat(64)}`,
    cursor: "exact-signed-page",
  };
  try {
    const response = await client.callTool({
      name: "get_finance_conversation_evidence",
      arguments: { runId: id, ...input },
    });
    expect(response.structuredContent).toEqual({
      result: { state: "unavailable", reason: "no_committed_effect_receipt" },
    });
    expect(getFinanceConversationEvidence).toHaveBeenCalledExactlyOnceWith(id, input);
    expect(
      (
        await client.callTool({
          name: "get_finance_conversation_evidence",
          arguments: { runId: id, ...input, userId: id },
        })
      ).isError,
    ).toBe(true);
    expect(getFinanceConversationEvidence).toHaveBeenCalledTimes(1);
  } finally {
    await client.close();
    await server.close();
  }
});
