import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { ApiClientError, createApiClient, type PersonalOsApiClient } from "@personal-os/api-client";
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
    const approveFinanceBudget = vi.fn(async (): Promise<unknown> => {
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
    ).toContain("persisted review bypass");
    const setupDescription = tools.tools.find(
      (tool) => tool.name === "setup_finances",
    )?.description;
    expect(setupDescription).toContain("enabled review bypass using agent_self_approval");
    const bypassInput = {
      ...input,
      approvalSource: "agent_self_approval",
      idempotencyKey: "bypassed-decision",
    };
    approveFinanceBudget.mockResolvedValueOnce({ ...base, data: {} });
    const applied = await client.callTool({
      name: "approve_finance_budget",
      arguments: bypassInput,
    });
    expect(approveFinanceBudget).toHaveBeenLastCalledWith(bypassInput);
    expect(applied.isError).not.toBe(true);
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

it("uses durable setup revisions and forwards current authority failures without inventing completion", async () => {
  const getFinanceOnboarding = vi.fn(async () => ({
    revision: 0,
    completedAt: null,
    existingAccess: true,
  }));
  const saveFinanceOnboardingAnswers = vi.fn(async () => ({ revision: 1, completedAt: null }));
  const completeFinanceOnboarding = vi.fn(async () => {
    throw new ApiClientError({
      status: 403,
      code: "forbidden",
      message: "Current execution authority is required.",
    });
  });
  const server = new McpServer({ name: "durable-onboarding", version: "1" });
  registerFinanceTools(server, {
    getFinanceOnboarding,
    saveFinanceOnboardingAnswers,
    completeFinanceOnboarding,
  } as unknown as PersonalOsApiClient);
  const client = new Client({ name: "test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  const input = {
    expectedRevision: 0,
    idempotencyKey: "exact-review",
    answers: [{ questionId: "rent", disposition: "unknown" }],
    displayPreferencesReviewed: true,
    automationChoice: "later",
  };
  try {
    const read = await client.callTool({ name: "get_finance_onboarding", arguments: {} });
    expect(read.structuredContent).toEqual({
      result: { revision: 0, completedAt: null, existingAccess: true },
    });
    await client.callTool({ name: "save_finance_onboarding_answers", arguments: input });
    expect(saveFinanceOnboardingAnswers).toHaveBeenCalledExactlyOnceWith(input);
    const spoof = await client.callTool({
      name: "save_finance_onboarding_answers",
      arguments: { ...input, userId: id },
    });
    expect(spoof.isError).toBe(true);
    expect(saveFinanceOnboardingAnswers).toHaveBeenCalledTimes(1);
    const completion = {
      expectedRevision: 1,
      idempotencyKey: "exact-complete",
      automationChoice: "later",
    };
    const denied = await client.callTool({
      name: "complete_finance_onboarding",
      arguments: completion,
    });
    expect(completeFinanceOnboarding).toHaveBeenCalledExactlyOnceWith(completion);
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({ error: { status: 403, code: "forbidden" } });
    expect(
      (
        await client.callTool({
          name: "complete_finance_onboarding",
          arguments: { ...completion, completedAt: "2026-10-18T00:00:00Z" },
        })
      ).isError,
    ).toBe(true);
    expect(completeFinanceOnboarding).toHaveBeenCalledTimes(1);
  } finally {
    await client.close();
    await server.close();
  }
});

it.each([
  { withWindow: false, accountIds: undefined, expectedIds: [] },
  { withWindow: true, accountIds: [id], expectedIds: ["scoped"] },
  { withWindow: true, accountIds: [], expectedIds: [] },
  { withWindow: true, accountIds: undefined, expectedIds: ["scoped", "other", "unknown"] },
])("reads qualified cash-flow window evidence with exact optional account scope: %j", async ({
  withWindow,
  accountIds,
  expectedIds,
}) => {
  const window = {
    from: "2026-10-01",
    to: "2026-10-31",
    ...(accountIds === undefined ? {} : { accountIds }),
    selectedIncomeStreamId: null,
  };
  const qualified = {
    schedule: {
      from: window.from,
      to: window.to,
      occurrences: [],
      matchEvents: [],
      unavailableSources: [],
    },
    projection: {
      status: "unavailable",
      reasons: [{ code: "balance_basis_unavailable", evidenceId: null }],
    },
  };
  const api = {
    listFinanceAlerts: vi.fn(async () => []),
    getFinanceForecast: vi.fn(async () => ({ legacy: true })),
    listFinanceIncomeStreams: vi.fn(async () => []),
    listFinanceRecurringObligations: vi.fn(async () => []),
    getFinanceCashflowProjection: vi.fn(async () => qualified),
    listFinanceRecurringSchedules: vi.fn(async () => [
      { id: "scoped", accountId: id },
      { id: "other", accountId: "22222222-2222-4222-8222-222222222222" },
      { id: "unknown", accountId: null },
    ]),
    listFinanceBalanceBases: vi.fn(async () => []),
    listFinanceBalanceBasisSources: vi.fn(async () => ({
      accounts: [],
      transactions: [],
      coverage: { complete: false, truncated: true, transactionLimit: 1000 },
    })),
    listFinanceCashflowSources: vi.fn(async () => ({
      from: window.from,
      to: window.to,
      accounts: [],
      income: [],
      obligations: [],
      transactions: [],
      coverage: { truncated: true, transactionLimit: 1000 },
    })),
  };
  const server = new McpServer({ name: "cash-flow-window", version: "1" });
  registerFinanceTools(server, api as unknown as PersonalOsApiClient);
  const client = new Client({ name: "test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  try {
    const result = await client.callTool({
      name: "get_finance_cashflow",
      arguments: withWindow ? { window } : {},
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      data: { alerts: [], forecast: { legacy: true }, incomeStreams: [], recurringItems: [] },
    });
    if (withWindow) {
      expect(api.getFinanceCashflowProjection).toHaveBeenCalledExactlyOnceWith(window);
      expect(result.structuredContent).toMatchObject({
        data: {
          qualifiedCashflow: qualified,
          rawCashflowContext: {
            recurringSchedules: expectedIds.map((id) => ({ id })),
            balanceBases: [],
            balanceStatementSources: {
              coverage: { complete: false, truncated: true, transactionLimit: 1000 },
            },
            cashflowSources: {
              from: window.from,
              to: window.to,
              coverage: { truncated: true, transactionLimit: 1000 },
            },
          },
        },
      });
      expect(api.listFinanceBalanceBases).toHaveBeenCalledExactlyOnceWith(accountIds);
      expect(api.listFinanceBalanceBasisSources).toHaveBeenCalledExactlyOnceWith(
        accountIds === undefined ? {} : { accountIds },
      );
      expect(api.listFinanceCashflowSources).toHaveBeenCalledExactlyOnceWith({
        from: window.from,
        to: window.to,
        ...(accountIds === undefined ? {} : { accountIds }),
      });
    } else {
      expect(api.getFinanceCashflowProjection).not.toHaveBeenCalled();
      expect(api.listFinanceRecurringSchedules).not.toHaveBeenCalled();
      expect(api.listFinanceBalanceBases).not.toHaveBeenCalled();
      expect(api.listFinanceBalanceBasisSources).not.toHaveBeenCalled();
      expect(api.listFinanceCashflowSources).not.toHaveBeenCalled();
      expect((result.structuredContent as { data: object }).data).not.toHaveProperty(
        "qualifiedCashflow",
      );
    }
  } finally {
    await client.close();
    await server.close();
  }
});

it("rejects invalid or spoofed cash-flow windows before canonical projection reads", async () => {
  const getFinanceCashflowProjection = vi.fn();
  const server = new McpServer({ name: "cash-flow-validation", version: "1" });
  const legacyReads = {
    listFinanceAlerts: vi.fn(),
    getFinanceForecast: vi.fn(),
    listFinanceIncomeStreams: vi.fn(),
    listFinanceRecurringObligations: vi.fn(),
  };
  registerFinanceTools(server, {
    ...legacyReads,
    getFinanceCashflowProjection,
  } as unknown as PersonalOsApiClient);
  const client = new Client({ name: "test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  try {
    for (const window of [
      { from: "2026-10-31", to: "2026-10-01", selectedIncomeStreamId: null },
      { from: "2026-01-01", to: "2027-01-02", selectedIncomeStreamId: null },
      { from: "2026-10-01", to: "2026-10-31", selectedIncomeStreamId: null, userId: id },
    ])
      expect(
        (await client.callTool({ name: "get_finance_cashflow", arguments: { window } })).isError,
      ).toBe(true);
    expect(getFinanceCashflowProjection).not.toHaveBeenCalled();
    for (const read of Object.values(legacyReads)) expect(read).not.toHaveBeenCalled();
  } finally {
    await client.close();
    await server.close();
  }
});

it("returns a cash-flow window authority failure without falling back to legacy or partial context", async () => {
  const api = {
    listFinanceAlerts: vi.fn(async () => []),
    getFinanceForecast: vi.fn(async () => ({ legacy: true })),
    listFinanceIncomeStreams: vi.fn(async () => []),
    listFinanceRecurringObligations: vi.fn(async () => []),
    getFinanceCashflowProjection: vi.fn(async () => {
      throw new ApiClientError({
        status: 403,
        code: "forbidden",
        message: "Cash-flow scope unavailable.",
      });
    }),
    listFinanceRecurringSchedules: vi.fn(async () => []),
    listFinanceBalanceBases: vi.fn(async () => []),
    listFinanceBalanceBasisSources: vi.fn(async () => ({})),
    listFinanceCashflowSources: vi.fn(async () => ({})),
  };
  const server = new McpServer({ name: "cash-flow-denial", version: "1" });
  registerFinanceTools(server, api as unknown as PersonalOsApiClient);
  const client = new Client({ name: "test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  try {
    const response = await client.callTool({
      name: "get_finance_cashflow",
      arguments: { window: { from: "2026-10-01", to: "2026-10-31", selectedIncomeStreamId: null } },
    });
    expect(response.isError).toBe(true);
    expect(response.structuredContent).toMatchObject({ error: { status: 403, code: "forbidden" } });
    expect(response.structuredContent).not.toHaveProperty("data");
  } finally {
    await client.close();
    await server.close();
  }
});

it("preserves typed pending recovery and strips only run routing from the strict command", async () => {
  const input = {
    operationId: id,
    candidateId: id,
    candidateRevision: `sha256:${"a".repeat(64)}`,
    expectedCurrentActorId: id,
    expectedBindingRevision: "1",
    expectedRunUpdatedAt: "2026-10-18T12:00:00.000Z",
  };
  const pending = {
    state: "pending",
    operationId: id,
    reason: "active_claim",
    retryAt: "2026-10-18T12:02:00.000Z",
  };
  const refresh = vi.fn(async () => pending);
  const observe = vi.fn(async () => ({ state: "unavailable", reason: "binding_unavailable" }));
  const server = new McpServer({ name: "recovery-command", version: "1" });
  registerFinanceTools(server, {
    refreshFinanceMaintenanceExecutionAuthorization: refresh,
    getFinanceMaintenanceExecutionAuthorization: observe,
  } as unknown as PersonalOsApiClient);
  const client = new Client({ name: "recovery-client", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  try {
    for (let i = 0; i < 2; i++) {
      const response = await client.callTool({
        name: "refresh_finance_maintenance_execution_authorization",
        arguments: { runId: id, ...input },
      });
      expect(response.isError).not.toBe(true);
      expect(JSON.stringify(response)).toContain('"active_claim"');
      expect(JSON.stringify(response)).toContain(pending.retryAt);
    }
    expect(refresh).toHaveBeenNthCalledWith(1, id, input);
    expect(refresh).toHaveBeenNthCalledWith(2, id, input);
    const invalid = await client.callTool({
      name: "refresh_finance_maintenance_execution_authorization",
      arguments: { runId: id, ...input, claimId: id },
    });
    expect(invalid.isError).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(2);
    await client.callTool({
      name: "get_finance_maintenance_execution_authorization",
      arguments: { runId: id },
    });
    expect(observe).toHaveBeenCalledWith(id);
  } finally {
    await client.close();
    await server.close();
  }
});

it("keeps category and bucket icon choices automatic in agent discovery", async () => {
  const { registerFinanceManagementTools } = await import("./finances-management.js");
  const server = new McpServer({ name: "finance-appearance", version: "1" });
  const api = {} as PersonalOsApiClient;
  registerFinanceTools(server, api);
  registerFinanceManagementTools(server, api);
  const client = new Client({ name: "appearance-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.listTools();
    for (const name of ["create_finance_category", "manage_finance_budget_bucket"]) {
      expect(result.tools.find((tool) => tool.name === name)?.description).toContain(
        "do not ask about or narrate cosmetic icon choices",
      );
    }
  } finally {
    await client.close();
    await server.close();
  }
});

describe("Finance budget HTTP-to-MCP approval readiness", () => {
  it("preserves additive readiness in text and structured results, including null budgets", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const api = createApiClient({ baseUrl: "https://example.test", token: "budget-token", fetch });
    const server = new McpServer({ name: "budget-readiness", version: "1" });
    registerFinanceTools(server, api);
    const client = new Client({ name: "budget-reader", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      for (const [code, recovery] of [
        ["ready", "approve"],
        ["no_budget", "create_proposal"],
        ["profile_changed", "revise_proposal"],
        ["superseded", "refresh_plan"],
      ] as const) {
        const payload = {
          ...base,
          data: code === "no_budget" ? null : { id, status: "proposed" },
          approvalReadiness: {
            ready: code === "ready",
            code,
            recovery,
            message: "Review current prerequisites",
            budgetVersionId: code === "no_budget" ? null : id,
            latestBudgetVersionId: id,
            currentProfileVersionId: id,
          },
        };
        fetch.mockResolvedValueOnce(Response.json(payload));
        const output = await client.callTool({
          name: "get_finance_budget",
          arguments: { planId: id },
        });
        expect(output.isError).not.toBe(true);
        expect(output.structuredContent).toEqual(payload);
        expect(output.content).toEqual([{ type: "text", text: JSON.stringify(payload, null, 2) }]);
      }
      for (const [url, init] of fetch.mock.calls) {
        expect(url).toBe(`https://example.test/v1/finances/budget-plans?planId=${id}`);
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer budget-token");
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preserves HTTP permission errors and approval conflict recovery through MCP", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const api = createApiClient({ baseUrl: "https://example.test", token: "budget-token", fetch });
    const server = new McpServer({ name: "budget-errors", version: "1" });
    registerFinanceTools(server, api);
    const client = new Client({ name: "budget-reader", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    try {
      for (const status of [403, 409]) {
        const error = {
          code: status === 403 ? "forbidden" : "conflict",
          message: "Budget requires a fresh decision",
          details: {
            approvalReadiness: {
              ready: false,
              code: "profile_changed",
              recovery: "revise_proposal",
            },
          },
          requestId: "budget-error",
        };
        fetch.mockResolvedValueOnce(Response.json({ error }, { status }));
        const output = await client.callTool({
          name: "approve_finance_budget",
          arguments: {
            approvalSource: "user_instruction",
            budgetVersionId: id,
            expectedProfileVersionId: id,
            expectedVersion: 3,
            idempotencyKey: "approval-request",
          },
        });
        expect(output.isError).toBe(true);
        expect(output.structuredContent).toMatchObject({ error: { ...error, status } });
        const text = output.content
          .filter((item) => item.type === "text")
          .map((item) => item.text)
          .join("\n");
        expect(JSON.parse(text)).toEqual(output.structuredContent);
      }
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
