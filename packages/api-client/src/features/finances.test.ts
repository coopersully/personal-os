import { createFinanceApi, type FinanceRequest } from "./finances.js";

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
