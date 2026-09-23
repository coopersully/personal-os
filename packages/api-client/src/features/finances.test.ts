import { createFinanceApi, type FinanceRequest } from "./finances.js";

describe("Finance position client", () => {
  it("maps bounded scopes without adding tenant identity", async () => {
    const position = { revision: "position-1" };
    const request = vi.fn(async () => ({ position })) as unknown as FinanceRequest;
    const api = createFinanceApi(request);

    await expect(
      api.getFinancePosition({
        accountIds: [
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
        ],
        from: "2026-09-01",
        through: "2026-09-30",
      }),
    ).resolves.toEqual(position);
    await api.getFinancePosition({ accountIds: [], from: "2026-09-01", through: "2026-09-30" });

    expect(vi.mocked(request).mock.calls).toEqual([
      [
        "/v1/finances/position?from=2026-09-01&through=2026-09-30&accountIds=11111111-1111-4111-8111-111111111111%2C22222222-2222-4222-8222-222222222222",
      ],
      ["/v1/finances/position?from=2026-09-01&through=2026-09-30&accountIds="],
    ]);
  });
});

describe("Finance budget policy client", () => {
  it("maps every human management operation onto the budget policy route family", async () => {
    const record = {
      executionAvailable: false,
      executionUnavailableReasons: ["authority_not_wired", "position_commit_fence_not_wired"],
    };
    const request = vi.fn(async (path: string) => {
      if (path.includes("/previews/")) return { preview: record };
      if (path.endsWith("/previews")) return { preview: record };
      if (path.includes("/proposals")) return { proposal: record };
      if (path.endsWith("/preview")) return { evaluation: record };
      if (path.endsWith("/baselines")) return { baseline: record };
      if (path.includes("?")) return { policies: [record] };
      return { policy: record };
    }) as unknown as FinanceRequest;
    const finances = createFinanceApi(request);

    await expect(
      finances.listFinanceBudgetPolicies({ beforeId: "before/id", limit: 25 }),
    ).resolves.toEqual([record]);
    await expect(finances.getFinanceBudgetPolicy("policy/id")).resolves.toEqual(record);
    await expect(finances.createFinanceBudgetPolicy({} as never)).resolves.toEqual(record);
    await expect(finances.reviseFinanceBudgetPolicy("policy/id", {} as never)).resolves.toEqual(
      record,
    );
    await expect(finances.disableFinanceBudgetPolicy("policy/id", {} as never)).resolves.toEqual(
      record,
    );
    await expect(finances.designateFinanceBudgetBaseline({} as never)).resolves.toEqual(record);
    await expect(finances.previewFinanceBudgetPolicy({} as never)).resolves.toEqual(record);
    await expect(finances.createFinanceBudgetRevisionProposal({} as never)).resolves.toEqual(
      record,
    );
    await expect(finances.getFinanceBudgetRevisionProposal("proposal/id")).resolves.toEqual(record);
    await expect(
      finances.withdrawFinanceBudgetRevisionProposal("proposal/id", {} as never),
    ).resolves.toEqual(record);
    await expect(
      finances.saveFinanceBudgetPolicyPreview("proposal/id", {} as never),
    ).resolves.toEqual(record);
    await expect(
      finances.getFinanceBudgetPolicyPreview("proposal/id", "preview/id"),
    ).resolves.toEqual(record);

    expect(vi.mocked(request).mock.calls).toEqual([
      ["/v1/finances/budget-policies?limit=25&beforeId=before%2Fid"],
      ["/v1/finances/budget-policies/policy%2Fid"],
      ["/v1/finances/budget-policies", { body: "{}", method: "POST" }],
      ["/v1/finances/budget-policies/policy%2Fid/revisions", { body: "{}", method: "POST" }],
      ["/v1/finances/budget-policies/policy%2Fid/disable", { body: "{}", method: "POST" }],
      ["/v1/finances/budget-policies/baselines", { body: "{}", method: "POST" }],
      ["/v1/finances/budget-policies/preview", { body: "{}", method: "POST" }],
      ["/v1/finances/budget-policies/proposals", { body: "{}", method: "POST" }],
      ["/v1/finances/budget-policies/proposals/proposal%2Fid"],
      [
        "/v1/finances/budget-policies/proposals/proposal%2Fid/withdraw",
        { body: "{}", method: "POST" },
      ],
      [
        "/v1/finances/budget-policies/proposals/proposal%2Fid/previews",
        { body: "{}", method: "POST" },
      ],
      ["/v1/finances/budget-policies/proposals/proposal%2Fid/previews/preview%2Fid"],
    ]);
  });
});

describe("contextual question client", () => {
  it("preserves canonical references and encodes the real creation and answer routes", async () => {
    const unavailable = {
      state: "unavailable",
      reasonCode: "producer_not_registered",
      retryable: false,
    };
    const request = vi.fn(async () => unavailable) as unknown as FinanceRequest;
    const api = createFinanceApi(request);
    await expect(
      api.createFinanceContextualQuestion("transaction/id", {
        operationId: "11111111-1111-4111-8111-111111111111",
      }),
    ).resolves.toEqual(unavailable);
    await expect(api.getFinanceContextualQuestion("question/id")).resolves.toEqual(unavailable);
    expect(vi.mocked(request).mock.calls).toEqual([
      [
        "/v1/finances/transactions/transaction%2Fid/contextual-question",
        {
          method: "POST",
          body: JSON.stringify({ operationId: "11111111-1111-4111-8111-111111111111" }),
        },
      ],
      ["/v1/finances/contextual-questions/question%2Fid"],
    ]);
  });
  it("sends the exact canonical answer without converting opaque revisions", async () => {
    const request = vi.fn(async () => ({ state: "accepted" })) as unknown as FinanceRequest;
    const answer = {
      operationId: "11111111-1111-4111-8111-111111111111",
      work: {
        domain: "finances" as const,
        kind: "question" as const,
        id: "22222222-2222-4222-8222-222222222222",
        revision: "9007199254740993",
        actionRevision: "1",
      },
      text: "Lunch",
      source: { kind: "app" as const, messageId: null },
    };
    await createFinanceApi(request).answerFinanceContextualQuestion(answer);
    expect(request).toHaveBeenCalledWith("/v1/finances/contextual-questions/answer", {
      method: "POST",
      body: JSON.stringify(answer),
    });
  });
});
