import type { AccessScope } from "@personal-os/domain";
import { Hono } from "hono";
import type { FinanceMaintenanceService } from "../finance-maintenance-service.js";
import type { FinancePeriodReviewService } from "../finance-period-review-service.js";
import type { createFinanceService } from "../finance-service.js";
import type { FinanceStatusService } from "../finance-status-service.js";
import type { AppEnv } from "../types.js";
import { registerFinanceRoutes } from "./finances.js";

const id = "11111111-1111-4111-8111-111111111111";

describe("finance routes", () => {
<<<<<<< HEAD
=======
  it("does not serialize an absent playbook dependency and disables caching", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "user",
        scopes: new Set(["finances:read"]),
        userId: id,
      });
      await next();
    });
    registerFinanceRoutes({
      app,
      financeMaintenance: {} as FinanceMaintenanceService,
      financeStatus: { getFinanceStatus: vi.fn() } as unknown as FinanceStatusService,
      finances: {} as ReturnType<typeof createFinanceService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: "playbook-route",
      }),
    });

    const response = await app.request("/v1/finances/playbook");

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "Finance playbook unavailable." });
  });

  it("returns a private playbook response when its service is registered", async () => {
    const app = new Hono<AppEnv>();
    const get = vi.fn(async () => ({ playbook: { version: "1.0.0" } }));
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "user",
        scopes: new Set(["finances:read"]),
        userId: id,
      });
      await next();
    });
    registerFinanceRoutes({
      app,
      financeMaintenance: {} as FinanceMaintenanceService,
      financePlaybook: { get } as never,
      financeStatus: { getFinanceStatus: vi.fn() } as unknown as FinanceStatusService,
      finances: {} as ReturnType<typeof createFinanceService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: "playbook-route",
      }),
    });

    const response = await app.request("/v1/finances/playbook");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ playbook: { version: "1.0.0" } });
    expect(get).toHaveBeenCalledWith(id);
  });

>>>>>>> origin/main
  it("parses account discovery filters and returns the structured account list", async () => {
    const app = new Hono<AppEnv>();
    const listFinanceAccounts = vi.fn(async () => ({
      accounts: [],
      accountSemantics: {
        excludedAccountIds: [],
        possibleDuplicateGroups: [],
        trustworthy: true,
        unresolvedOwnershipAccountIds: [],
      },
      totals: { cash: 0, debt: 0, investments: 0, netWorth: 0, otherAssets: 0 },
    }));
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "agent",
        scopes: new Set(["finances:read"]),
        userId: id,
      });
      context.set("requestId", "request-accounts");
      await next();
    });
    registerFinanceRoutes({
      app,
      financeMaintenance: {} as FinanceMaintenanceService,
      financeStatus: { getFinanceStatus: vi.fn() } as unknown as FinanceStatusService,
      finances: { listFinanceAccounts } as unknown as ReturnType<typeof createFinanceService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });

    const response = await app.request(
      "/v1/finances/accounts?kind=investment&query=%20IRA%20&includeExcluded=false",
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ totals: { netWorth: 0 } });
    expect(listFinanceAccounts).toHaveBeenCalledWith(id, {
      includeExcluded: false,
      kind: "investment",
      query: "IRA",
    });
  });

  it("returns read-only Finance status for a parsed maintenance scope", async () => {
    const app = new Hono<AppEnv>();
    const getFinanceStatus = vi.fn(async () => ({ domain: "finances" }));
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "agent",
        scopes: new Set(["finances:read"]),
        userId: id,
      });
      context.set("requestId", "request-status");
      await next();
    });
    app.onError((error, context) =>
      context.json({ error: error instanceof Error ? error.message : "unknown" }, 403),
    );
    registerFinanceRoutes({
      app,
      financeMaintenance: {} as FinanceMaintenanceService,
      financeStatus: { getFinanceStatus } as unknown as FinanceStatusService,
      finances: {} as ReturnType<typeof createFinanceService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });

    const response = await app.request("/v1/finances/status?start=2026-08-01&end=2026-08-15");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: { domain: "finances" } });
    expect(getFinanceStatus).toHaveBeenCalledWith(id, {
      type: "window",
      start: "2026-08-01",
      end: "2026-08-15",
    });
  });

  it("lists buckets and routes bucket mutations through the Finance action boundary", async () => {
    const app = new Hono<AppEnv>();
    const listFinanceBudgetBuckets = vi.fn(async () => ({ taxonomy: null }));
    const performDirect = vi.fn(async () => ({ status: "pending_review" as const }));
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "agent",
        scopes: new Set(["finances:read", "finances:write"]),
        userId: id,
      });
      context.set("requestId", "bucket-route");
      await next();
    });
    registerFinanceRoutes({
      actions: { performDirect } as never,
      app,
      financeMaintenance: {} as FinanceMaintenanceService,
      financeStatus: { getFinanceStatus: vi.fn() } as unknown as FinanceStatusService,
      finances: { listFinanceBudgetBuckets } as unknown as ReturnType<typeof createFinanceService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });

    const listed = await app.request("/v1/finances/budget-buckets?month=2026-08");
    expect(listed.status).toBe(200);
    expect(listFinanceBudgetBuckets).toHaveBeenCalledWith(id, { month: "2026-08" });

    const created = await app.request("/v1/finances/budget-buckets", {
      body: JSON.stringify({
        description: "Core monthly spending",
        idempotencyKey: "bucket-create",
        name: "Core",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status).toBe(202);

    const updated = await app.request(`/v1/finances/budget-buckets/${id}`, {
      body: JSON.stringify({
        categoryIds: [],
        description: null,
        expectedVersion: 1,
        idempotencyKey: "bucket-update",
        name: "Core revised",
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    expect(updated.status).toBe(202);
    expect(performDirect).toHaveBeenCalledTimes(2);
  });

  it("compares scenarios on the read scope and forwards a complete budget plan", async () => {
    const app = new Hono<AppEnv>();
    const setBudgetPlan = vi.fn(async (input) => input);
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "user",
        scopes: new Set(["finances:read", "finances:write"]),
        userId: id,
      });
      context.set("requestId", "finance-plan");
      await next();
    });
    registerFinanceRoutes({
      app,
      financeMaintenance: {} as FinanceMaintenanceService,
      financeStatus: { getFinanceStatus: vi.fn() } as unknown as FinanceStatusService,
      finances: { setBudgetPlan } as unknown as ReturnType<typeof createFinanceService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });
    const scenario = await app.request("/v1/finances/scenarios/compare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        alternatives: [],
        asOf: "2026-08-01",
        baseline: { label: "Base", monthlyIncome: 1, startingCash: 0 },
        horizonMonths: 1,
      }),
    });
    expect(scenario.status).toBe(200);
    await expect(scenario.json()).resolves.toMatchObject({
      scenario: { baseline: { label: "Base" } },
    });
    const input = {
      allocations: [{ categoryId: id, limit: 1 }],
      month: "2026-08",
      rationale: "Plan.",
    };
    const plan = await app.request("/v1/finances/budget-plan", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    expect(plan.status).toBe(200);
    await expect(plan.json()).resolves.toMatchObject({ plan: input });
    expect(setBudgetPlan).toHaveBeenCalledWith(
      expect.objectContaining(input),
      expect.objectContaining({ requestId: "finance-plan" }),
    );
  });

  it("keeps setup and owned attention agent-accessible while provider, account, and approval actions stay human-only", async () => {
    const app = new Hono<AppEnv>();
    const finances = {
      createAccount: vi.fn(),
      createBudget: vi.fn(),
      createTransaction: vi.fn(),
      deleteAccount: vi.fn(),
      getAutomationSettings: vi.fn(async () => ({ reviewBypassEnabled: false })),
      getGuidedSetupContext: vi.fn(async () => ({ ready: true })),
      mergeMerchants: vi.fn(),
      proposeCategorizations: vi.fn(async () => ({ items: [], nextCursor: null })),
      resolveAlert: vi.fn(),
      resolveReview: vi.fn(),
      syncPlaidAccount: vi.fn(),
      updateMerchant: vi.fn(),
      updateRecurringObligation: vi.fn(),
      upsertAttentionItem: vi.fn(async () => ({ id })),
    };
    const performDirect = vi.fn(async () => ({
      review: {
        actionKind: "budget_plan",
        assumptions: [],
        changes: [{ entityId: null, entityType: "finance_budget_plan", summary: "Apply budget." }],
        expectedRevision: null,
        fingerprint: "pending-budget",
        id,
        rationale: "Requested budget.",
        requestedAt: "2026-08-17T00:00:00.000Z",
        requestingAgentId: id,
        runId: null,
        sourceRefs: [],
        status: "pending" as const,
      },
      status: "pending_review" as const,
    }));
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "agent",
        scopes: new Set(["finances:read", "finances:write"]),
        userId: id,
      });
      context.set("requestId", "request-1");
      await next();
    });
    app.onError((error, context) =>
      context.json({ error: error instanceof Error ? error.message : "unknown" }, 403),
    );
    registerFinanceRoutes({
      actions: { performDirect } as never,
      app,
      financeMaintenance: {} as FinanceMaintenanceService,
      financeStatus: { getFinanceStatus: vi.fn() } as unknown as FinanceStatusService,
      finances: finances as unknown as ReturnType<typeof createFinanceService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });
    const json = {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    };

    expect((await app.request("/v1/finances/guided-setup")).status).toBe(200);
    expect((await app.request("/v1/finances/categorizations/propose")).status).toBe(200);
    expect(
      (
        await app.request(`/v1/finances/transactions/${id}/attention`, {
          body: JSON.stringify({
            summary: "Review this transaction.",
            title: "Finance review",
          }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        })
      ).status,
    ).toBe(200);
    const humanOnlyResponses = await Promise.all([
      app.request("/v1/finances/accounts", json),
      app.request(`/v1/finances/accounts/${id}`, { method: "DELETE" }),
      app.request(`/v1/finances/accounts/${id}/sync`, json),
      app.request(`/v1/finances/review/${id}`, json),
    ]);
    for (const response of humanOnlyResponses) {
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringMatching(/interactive user session|waiting for review/),
      });
    }
    const queued = await app.request("/v1/finances/budgets", {
      body: JSON.stringify({ category: "Housing", limit: 2_000, month: "2026-08" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(queued.status).toBe(202);
    await expect(queued.json()).resolves.toMatchObject({ status: "pending_review" });
    expect(performDirect).toHaveBeenCalledWith(
      "budget_plan",
      expect.objectContaining({ category: "Housing" }),
      expect.objectContaining({ requestId: "request-1" }),
    );
    expect(finances.getGuidedSetupContext).toHaveBeenCalledWith(id);
    expect(finances.proposeCategorizations).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ limit: 50, review: "all" }),
    );
    expect(finances.upsertAttentionItem).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ importance: "high", kind: "important" }),
      expect.objectContaining({ requestId: "request-1" }),
    );
    expect(finances.createAccount).not.toHaveBeenCalled();
    expect(finances.deleteAccount).not.toHaveBeenCalled();
    expect(finances.createBudget).not.toHaveBeenCalled();
    expect(finances.syncPlaidAccount).not.toHaveBeenCalled();
    expect(finances.updateRecurringObligation).not.toHaveBeenCalled();
    expect(finances.resolveAlert).not.toHaveBeenCalled();
    expect(finances.updateMerchant).not.toHaveBeenCalled();
    expect(finances.mergeMerchants).not.toHaveBeenCalled();
    expect(finances.resolveReview).not.toHaveBeenCalled();
    expect(finances.createTransaction).not.toHaveBeenCalled();
  });

  it("returns the action service disposition and never accepts a bypass token or tool input", async () => {
    const app = new Hono<AppEnv>();
    const budget = { category: "Housing", id, limit: 2_000, month: "2026-08" };
    const finances = {
      createBudget: vi.fn(async () => budget),
      getAutomationSettings: vi.fn(async () => ({ reviewBypassEnabled: true })),
      updateAutomationSettings: vi.fn(),
    };
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "agent",
        scopes: new Set(["finances:read", "finances:write"]),
        userId: id,
      });
      context.set("requestId", "request-agent-budget");
      await next();
    });
    app.onError((error, context) =>
      context.json({ error: error instanceof Error ? error.message : "unknown" }, 403),
    );
    registerFinanceRoutes({
      actions: {
        performDirect: vi.fn(async () => ({ result: budget, status: "applied" as const })),
      } as never,
      app,
      financeMaintenance: {} as FinanceMaintenanceService,
      financeStatus: { getFinanceStatus: vi.fn() } as unknown as FinanceStatusService,
      finances: finances as unknown as ReturnType<typeof createFinanceService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });

    const created = await app.request("/v1/finances/budgets", {
      body: JSON.stringify({ category: "Housing", limit: 2_000, month: "2026-08" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status).toBe(200);
    await expect(created.json()).resolves.toEqual({ result: budget, status: "applied" });
    expect(finances.getAutomationSettings).not.toHaveBeenCalled();
    expect(finances.createBudget).not.toHaveBeenCalled();

    const selfEnable = await app.request("/v1/finances/automation-settings", {
      body: JSON.stringify({ reviewBypassEnabled: true }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    expect(selfEnable.status).toBe(403);
    expect(finances.updateAutomationSettings).not.toHaveBeenCalled();
  });

  it("keeps POST proposal compatibility on the Finance read scope", async () => {
    const app = new Hono<AppEnv>();
    const finances = {
      listTransactions: vi.fn(async () => ({ items: [], nextCursor: null })),
      proposeCategorizations: vi.fn(async () => ({ items: [], nextCursor: "opaque-next" })),
    };
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "agent",
        scopes: new Set(["finances:read"]),
        userId: id,
      });
      context.set("requestId", "request-read-only");
      await next();
    });
    registerFinanceRoutes({
      app,
      financeMaintenance: {} as FinanceMaintenanceService,
      financeStatus: { getFinanceStatus: vi.fn() } as unknown as FinanceStatusService,
      finances: finances as unknown as ReturnType<typeof createFinanceService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });

    const response = await app.request("/v1/finances/categorizations/propose?cursor=opaque", {
      method: "POST",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      nextCursor: "opaque-next",
      proposals: [],
    });
    expect(finances.proposeCategorizations).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ cursor: "opaque" }),
    );
    expect((await app.request("/v1/finances/transactions?pending=false")).status).toBe(200);
    expect(finances.listTransactions).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ pending: false }),
    );
    expect((await app.request("/v1/finances/transactions")).status).toBe(200);
    expect(finances.listTransactions).toHaveBeenLastCalledWith(
      id,
      expect.objectContaining({ limit: 50 }),
    );
    expect((await app.request("/v1/finances/categorizations/propose")).status).toBe(200);
    expect(finances.proposeCategorizations).toHaveBeenLastCalledWith(
      id,
      expect.objectContaining({ limit: 50, review: "all" }),
    );
  });

  it("allows a scoped agent to start and read its durable Finance maintenance run", async () => {
    const app = new Hono<AppEnv>();
    let grantedScopes: Set<AccessScope> = new Set(["finances:read", "finances:write"]);
    const run = { id, scope: { type: "all_outstanding" }, status: "queued", userId: id };
    const financeMaintenance = {
      dispatchRun: vi.fn(async () => ({ ...run, status: "completed" })),
      getRun: vi.fn(async () => ({ ...run, status: "completed" })),
      startOrResume: vi.fn(async () => run),
    };
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "agent",
        scopes: grantedScopes,
        userId: id,
      });
      context.set("requestId", "request-maintenance");
      await next();
    });
    app.onError((error, context) =>
      context.json({ error: error instanceof Error ? error.message : "unknown" }, 403),
    );
    registerFinanceRoutes({
      app,
      financeMaintenance: financeMaintenance as unknown as FinanceMaintenanceService,
      financeStatus: { getFinanceStatus: vi.fn() } as unknown as FinanceStatusService,
      finances: {} as ReturnType<typeof createFinanceService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });

    const legacyStart = await app.request("/v1/finances/maintenance", { method: "POST" });
    expect(legacyStart.status).toBe(403);
    expect(financeMaintenance.startOrResume).not.toHaveBeenCalled();

    grantedScopes = new Set(["finances:read", "finances:maintain"]);
    const started = await app.request("/v1/finances/maintenance", { method: "POST" });
    expect(started.status).toBe(202);
    await expect(started.json()).resolves.toEqual({ run });
    expect(financeMaintenance.startOrResume).toHaveBeenCalledWith(id, {
      type: "all_outstanding",
    });
    expect(financeMaintenance.dispatchRun).not.toHaveBeenCalled();

    const read = await app.request(`/v1/finances/maintenance/${id}`);
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.toEqual({ run: { ...run, status: "completed" } });
    expect(financeMaintenance.getRun).toHaveBeenCalledWith(id, id);
  });

  it("lists only public pending Finance questions and rejects malformed action IDs", async () => {
    const app = new Hono<AppEnv>();
    const questions = [
      {
        actionKind: "profile",
        choices: [],
        expectedAnswer: [{ name: "payAccountId", required: true, type: "string" }],
        id,
        prompt: "Choose a replacement account.",
        sourceRefs: [],
        why: "The selected account is unavailable.",
      },
    ];
    const listQuestions = vi.fn(async () => questions);
    const approve = vi.fn();
    const answerQuestion = vi.fn(async () => ({
      result: { reimbursementId: id },
      status: "applied",
    }));
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "user",
        scopes: new Set(["finances:read", "finances:write"]),
        userId: id,
      });
      context.set("requestId", "question-list");
      await next();
    });
    app.onError((error, context) =>
      context.json({ error: error instanceof Error ? error.message : "unknown" }, 400),
    );
    registerFinanceRoutes({
      actions: { answerQuestion, approve, listQuestions } as never,
      app,
      financeMaintenance: {} as FinanceMaintenanceService,
      financeStatus: { getFinanceStatus: vi.fn() } as unknown as FinanceStatusService,
      finances: {} as ReturnType<typeof createFinanceService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });

    const listed = await app.request("/v1/finances/questions?limit=2");
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toEqual({ questions });
    expect(listQuestions).toHaveBeenLastCalledWith(id, 2);
    const defaultListed = await app.request("/v1/finances/questions");
    expect(defaultListed.status).toBe(200);
    expect(listQuestions).toHaveBeenLastCalledWith(id, 50);
    const answered = await app.request(`/v1/finances/questions/${id}/answer`, {
      body: JSON.stringify({ answer: JSON.stringify({ answer: { kind: "not_reimbursement" } }) }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(answered.status).toBe(200);
    await expect(answered.json()).resolves.toEqual({
      outcome: { result: { reimbursementId: id }, status: "applied" },
    });
    expect(answerQuestion).toHaveBeenCalledWith(
      id,
      JSON.stringify({ answer: { kind: "not_reimbursement" } }),
      expect.objectContaining({ requestId: "question-list" }),
    );
    expect(
      (await app.request("/v1/finances/action-reviews/not-an-id/approve", { method: "POST" }))
        .status,
    ).toBe(400);
    expect(approve).not.toHaveBeenCalled();
    const approved = await app.request(`/v1/finances/action-reviews/${id}/approve`, {
      method: "POST",
    });
    expect(approved.status).toBe(200);
    expect(approve).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ requestId: "question-list" }),
    );
  });

  it("fails closed when a Finance mutation route has no action service", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "agent",
        scopes: new Set(["finances:read", "finances:write"]),
        userId: id,
      });
      context.set("requestId", "missing-actions");
      await next();
    });
    app.onError((error, context) =>
      context.json({ error: error instanceof Error ? error.message : "unknown" }, 500),
    );
    registerFinanceRoutes({
      app,
      financeMaintenance: {} as FinanceMaintenanceService,
      financeStatus: { getFinanceStatus: vi.fn() } as unknown as FinanceStatusService,
      finances: {} as ReturnType<typeof createFinanceService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });

    const response = await app.request("/v1/finances/budgets", {
      body: JSON.stringify({ category: "Housing", limit: 2_000, month: "2026-08" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("required"),
    });
  });

  it("returns an authoritative Finance snapshot from the status and budget reads", async () => {
    const app = new Hono<AppEnv>();
    const getFinanceStatus = vi.fn(async () => ({
      asOf: "2026-08-28T12:00:00.000Z",
      details: {
        accounts: { blocked: 0, current: 2, retrying: 0, stale: 0 },
        closeReadiness: {
          missingProvenance: 0,
          possibleDuplicates: 0,
          reconciledThrough: "2026-08-27",
          uncategorized: 0,
          unmatchedTransfers: 0,
        },
        month: { spending: 2_000 },
        plan: { capacity: 1_000 },
        review: { total: 0 },
        wealth: { cash: 12_000, debt: 2_000, investments: 10_000, netWorth: 20_000 },
      },
      freshness: { blockers: [], observedAt: "2026-08-28T12:00:00.000Z", state: "current" },
      recommendedNextOperation: null,
      work: { awaitingInput: 0 },
    }));
    const getFinanceBudget = vi.fn(async () => ({
      changes: [],
      communication: {
        headline: "No budget exists yet.",
        optionalDetails: [],
        requiredDisclosures: [],
      },
      data: null,
      outcome: "completed",
      remainingWork: { categories: [], count: 0 },
      schemaVersion: 1,
    }));
    const getWealthSummary = vi.fn(async () => ({
      accountSemantics: {
        excludedAccountIds: [],
        possibleDuplicateGroups: [],
        trustworthy: true,
        unresolvedOwnershipAccountIds: [],
      },
      annualIncome: 60_000,
      cash: 12_000,
      debt: 2_000,
      incomeBasis: "stated" as const,
      investments: 10_000,
      monthlyIncome: 5_000,
      monthlyPlanRemaining: 1_000,
      netWorth: 20_000,
      observedAnnualIncome: 60_000,
      otherAssets: 0,
      plannedThisMonth: 4_000,
      statedAnnualIncome: 60_000,
    }));
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "agent",
        scopes: new Set(["finances:read"]),
        userId: id,
      });
      context.set("requestId", "snapshot");
      await next();
    });
    registerFinanceRoutes({
      app,
      financeMaintenance: {} as FinanceMaintenanceService,
      financeStatus: { getFinanceStatus } as unknown as FinanceStatusService,
      finances: { getFinanceBudget, getWealthSummary } as unknown as ReturnType<
        typeof createFinanceService
      >,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });

    const response = await app.request("/v1/finances/snapshot");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { cash: 12_000, netWorth: 20_000 },
      presentation: { kind: "finance_snapshot", trust: { trustworthy: true } },
    });
    expect(getFinanceStatus).toHaveBeenCalledWith(id, { type: "all_outstanding" });
    expect(getFinanceBudget).toHaveBeenCalledWith(id);
    expect(getWealthSummary).toHaveBeenCalledWith(id);
  });

  it("keeps the raw period review while exposing its exact presentation route", async () => {
    const app = new Hono<AppEnv>();
    const review = {
      cutoff: "2026-08-28T12:00:00.000Z",
      id,
      monitoring: { href: `/finances/reviews/${id}`, responsibility: "Review changes." },
      period: { end: "2026-08-28", start: "2026-08-01" },
      recommendations: [],
      status: "completed",
      work: { approvals: 0, exceptions: 0, questions: 0, rulesAndActions: 1 },
    };
    const getOwned = vi.fn(async () => review);
    app.use("*", async (context, next) => {
      context.set("principal", {
        actorId: id,
        actorType: "agent",
        scopes: new Set(["finances:read"]),
        userId: id,
      });
      context.set("requestId", "period-presentation");
      await next();
    });
    registerFinanceRoutes({
      app,
      financeMaintenance: {} as FinanceMaintenanceService,
      financePeriodReviews: { getOwned } as unknown as FinancePeriodReviewService,
      financeStatus: { getFinanceStatus: vi.fn() } as unknown as FinanceStatusService,
      finances: {} as ReturnType<typeof createFinanceService>,
      mutationContext: (context) => ({
        principal: context.get("principal"),
        requestId: context.get("requestId"),
      }),
    });

    const presented = await app.request(`/v1/finances/period-reviews/${id}/presentation`);
    const raw = await app.request(`/v1/finances/period-reviews/${id}`);

    expect(presented.status).toBe(200);
    await expect(presented.json()).resolves.toMatchObject({
      data: review,
      presentation: { kind: "finance_period_verification" },
    });
    await expect(raw.json()).resolves.toEqual({ review });
    expect(getOwned).toHaveBeenCalledTimes(2);
  });
});
