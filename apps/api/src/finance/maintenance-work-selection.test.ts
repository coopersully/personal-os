import { selectFinanceMaintenanceWork } from "./maintenance-work-selection.js";

describe("Finance maintenance work selection", () => {
  it("keeps independent eligible work alongside every blocked item in source order", () => {
    const work = [
      { id: "source", sourceReady: false, evidenceReady: true, approvalReady: true },
      { id: "eligible", sourceReady: true, evidenceReady: true, approvalReady: true },
      { id: "evidence", sourceReady: true, evidenceReady: false, approvalReady: true },
      { id: "approval", sourceReady: true, evidenceReady: true, approvalReady: false },
    ] as const;

    expect(selectFinanceMaintenanceWork(work)).toEqual([
      { id: "source", state: "source_blocked" },
      { id: "eligible", state: "eligible" },
      { id: "evidence", state: "awaiting_evidence" },
      { id: "approval", state: "awaiting_approval" },
    ]);
  });

  it.each([
    [false, false, false, "source_blocked"],
    [false, false, true, "source_blocked"],
    [false, true, false, "source_blocked"],
    [false, true, true, "source_blocked"],
    [true, false, false, "awaiting_evidence"],
    [true, false, true, "awaiting_evidence"],
    [true, true, false, "awaiting_approval"],
    [true, true, true, "eligible"],
  ] as const)("requires source=%s evidence=%s approval=%s before considering eligibility", (sourceReady, evidenceReady, approvalReady, state) => {
    expect(
      selectFinanceMaintenanceWork([
        { id: "exact-work", sourceReady, evidenceReady, approvalReady },
      ]),
    ).toEqual([{ id: "exact-work", state }]);
  });

  it("does not change the supplied evidence or manufacture work when there is none", () => {
    const item = Object.freeze({
      id: "held",
      sourceReady: true,
      evidenceReady: false,
      approvalReady: false,
    });
    const work = Object.freeze([item]);
    expect(selectFinanceMaintenanceWork(work)).toEqual([
      { id: "held", state: "awaiting_evidence" },
    ]);
    expect(work[0]).toBe(item);
    expect(selectFinanceMaintenanceWork([])).toEqual([]);
  });
});
