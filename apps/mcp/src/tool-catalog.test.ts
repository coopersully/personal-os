import { availableToolNames, iloToolCatalog } from "./tool-catalog.js";

describe("Finance maintenance MCP catalog", () => {
  it("declares the complete-workspace Finance intents with least-privilege metadata", () => {
    expect(iloToolCatalog.get_finance_status).toMatchObject({
      domain: "finances",
      idempotent: true,
      openWorld: false,
      policy: "read_only",
      readOnly: true,
      requiredScopes: ["finances:read"],
      stage: "inspect",
    });
    expect(iloToolCatalog.maintain_finances).toMatchObject({
      domain: "finances",
      idempotent: false,
      openWorld: false,
      policy: "approved_rule",
      readOnly: false,
      requiredScopes: ["finances:maintain"],
      stage: "commit",
    });
    expect(iloToolCatalog.answer_finance_question).toMatchObject({
      destructive: true,
      policy: "approve_each",
      readOnly: false,
      requiredScopes: ["finances:write"],
      stage: "commit",
    });
  });

  it("advertises Finance intents only to authorized writable connections", () => {
    expect(availableToolNames(new Set(["finances:read"]), false)).toContain("get_finance_status");
    expect(availableToolNames(new Set(["finances:read"]), false)).not.toContain(
      "maintain_finances",
    );
    expect(availableToolNames(new Set(["finances:write"]), false)).not.toContain(
      "maintain_finances",
    );
    expect(availableToolNames(new Set(["finances:maintain"]), false)).toContain(
      "maintain_finances",
    );
    expect(availableToolNames(new Set(["finances:maintain"]), true)).not.toContain(
      "maintain_finances",
    );
    expect(availableToolNames(new Set(), false)).not.toEqual(
      expect.arrayContaining(["get_finance_status", "maintain_finances"]),
    );
  });
});
