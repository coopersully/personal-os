import { describe, expect, it } from "vitest";
import {
  type FinanceGoalPlanningEvidence,
  type FinanceGoalPlanningSource,
  type FinanceObligationPlanningEvidence,
  type FinanceObligationPlanningSource,
  financePlanningEvidenceApplicability,
  financePlanningEvidenceSchema,
} from "./planning-evidence.js";

const owner = "f2000000-0000-4000-8000-000000000001";
const other = "f2000000-0000-4000-8000-000000000002";
const id = "f2000000-0000-4000-8000-000000000003";
const account = "f2000000-0000-4000-8000-000000000004";
const common = {
  evidenceId: "f2000000-0000-4000-8000-000000000005",
  ownerUserId: owner,
  actor: { type: "user" as const, userId: owner },
  provenance: "explicit_user" as const,
  currencyCode: "EUR",
  asOf: "2026-03-08",
  recordedAt: "2026-03-09T00:15:00+01:00",
};
const obligation: FinanceObligationPlanningEvidence = {
  ...common,
  kind: "obligation",
  sourceId: id,
  sourceRevision: 3,
  expectedAmountCents: 12345,
  cadence: "monthly",
  accountId: account,
  fixedness: "fixed",
};
const obligationSource: FinanceObligationPlanningSource = {
  kind: "obligation",
  id,
  ownerUserId: owner,
  revision: 3,
  expectedAmountCents: 12345,
  cadence: "monthly",
  accountId: account,
  currencyCode: "EUR",
  obligationKind: "bill",
  status: "active",
};
const goal: FinanceGoalPlanningEvidence = {
  ...common,
  kind: "goal",
  goalId: id,
  goalVersion: 4,
  progressAmountCents: 0,
};
const goalSource: FinanceGoalPlanningSource = {
  kind: "goal",
  id,
  ownerUserId: owner,
  version: 4,
  progressAmountCents: null,
  currencyCode: null,
  status: "active",
};
const apply = (
  source: FinanceObligationPlanningSource | FinanceGoalPlanningSource,
  evidence: unknown,
) =>
  financePlanningEvidenceApplicability({
    ownerUserId: owner,
    today: "2026-03-09",
    source,
    evidence,
  });
const unknown = (reason: string) => ({ state: "unknown", reason });

describe("explicit user planning evidence", () => {
  it("accepts exact source binding and preserves variable/fixed statements without manufacturing source currency", () => {
    expect(apply(obligationSource, obligation)).toEqual({
      state: "applicable",
      evidence: obligation,
    });
    const variable = { ...obligation, fixedness: "variable" };
    expect(apply({ ...obligationSource, currencyCode: null }, variable)).toEqual({
      state: "applicable",
      evidence: variable,
    });
    expect(
      apply(
        { ...obligationSource, status: "needs_review", obligationKind: "subscription" },
        obligation,
      ).state,
    ).toBe("applicable");
  });

  it("keeps missing evidence unknown even for legacy default zero", () => {
    expect(apply({ ...goalSource, progressAmountCents: 0 }, null)).toEqual(
      unknown("missing_evidence"),
    );
    expect(apply(obligationSource, undefined)).toEqual(unknown("missing_evidence"));
    expect(apply(goalSource, goal)).toEqual({ state: "applicable", evidence: goal });
    expect(apply({ ...goalSource, progressAmountCents: 0 }, goal).state).toBe("applicable");
    expect(apply({ ...goalSource, progressAmountCents: 1 }, goal)).toEqual(
      unknown("source_changed"),
    );
  });

  it("does not revive evidence after amount A to B to A at a later revision", () => {
    expect(apply({ ...obligationSource, revision: 5 }, obligation)).toEqual(
      unknown("source_changed"),
    );
    expect(apply({ ...goalSource, version: 6 }, goal)).toEqual(unknown("source_changed"));
  });

  it.each([
    { expectedAmountCents: 12346 },
    { cadence: "weekly" as const },
    { accountId: null },
  ])("invalidates exact obligation content or a deleted account even without revision change: %j", (change) => {
    expect(apply({ ...obligationSource, ...change }, obligation)).toEqual(
      unknown("source_changed"),
    );
  });

  it("rejects cross-owner, impersonated-user and cross-source evidence", () => {
    expect(apply({ ...goalSource, ownerUserId: other }, goal)).toEqual(unknown("owner_mismatch"));
    expect(apply(goalSource, { ...goal, ownerUserId: other })).toEqual(unknown("owner_mismatch"));
    expect(apply(goalSource, { ...goal, actor: { type: "user", userId: other } })).toEqual(
      unknown("owner_mismatch"),
    );
    expect(apply(goalSource, { ...goal, goalId: other })).toEqual(unknown("source_mismatch"));
    expect(apply(obligationSource, { ...obligation, sourceId: other })).toEqual(
      unknown("source_mismatch"),
    );
    expect(apply(goalSource, obligation)).toEqual(unknown("source_mismatch"));
  });

  it.each([
    "agent",
    "system",
    "connector",
  ])("does not treat %s actor evidence as explicit user confirmation", (type) => {
    expect(apply(goalSource, { ...goal, actor: { type, userId: owner } })).toEqual(
      unknown("invalid_evidence"),
    );
  });

  it("keeps future evidence and a known different currency unavailable", () => {
    expect(apply(goalSource, { ...goal, asOf: "2026-03-10" })).toEqual(unknown("future_as_of"));
    expect(apply({ ...goalSource, currencyCode: "USD" }, goal)).toEqual(
      unknown("currency_mismatch"),
    );
    expect(apply({ ...obligationSource, currencyCode: "USD" }, obligation)).toEqual(
      unknown("currency_mismatch"),
    );
  });

  it("preserves nonremoved goal facts but excludes inactive obligations and removed goals", () => {
    for (const status of ["active", "paused", "completed"] as const)
      expect(apply({ ...goalSource, status }, goal).state).toBe("applicable");
    expect(apply({ ...goalSource, status: "removed" }, goal)).toEqual(unknown("ineligible_source"));
    for (const status of ["paused", "cancelled"] as const)
      expect(apply({ ...obligationSource, status }, obligation)).toEqual(
        unknown("ineligible_source"),
      );
    expect(apply({ ...obligationSource, obligationKind: "savings" }, obligation)).toEqual(
      unknown("ineligible_source"),
    );
  });

  it.each([
    "JPY",
    "KWD",
    "CLF",
    "XAU",
    "XDR",
    "ZZZ",
    "eur",
  ])("rejects unsupported currency %s", (currencyCode) => {
    expect(financePlanningEvidenceSchema.safeParse({ ...goal, currencyCode }).success).toBe(false);
  });

  it.each([
    "USD",
    "EUR",
    "GBP",
    "CAD",
    "CHF",
  ])("accepts recognized two-minor-unit currency %s", (currencyCode) => {
    expect(financePlanningEvidenceSchema.safeParse({ ...goal, currencyCode }).success).toBe(true);
  });

  it.each([
    { progressAmountCents: -1 },
    { progressAmountCents: 1.5 },
    { progressAmountCents: 10_000_000_001 },
    { goalVersion: 0 },
    { goalVersion: 1.5 },
    { asOf: "2026-02-30" },
    { recordedAt: "2026-03-09" },
    { evidenceId: "missing" },
    { provenance: "inferred" },
    { extraClaim: "bank fresh" },
  ])("rejects malformed or overclaiming evidence: %j", (change) => {
    expect(apply(goalSource, { ...goal, ...change })).toEqual(unknown("invalid_evidence"));
  });

  it("validates caller date explicitly and never substitutes server receipt time for as-of", () => {
    expect(() =>
      financePlanningEvidenceApplicability({
        ownerUserId: owner,
        today: "bad",
        source: goalSource,
        evidence: goal,
      }),
    ).toThrow();
    expect(apply(goalSource, { ...goal, recordedAt: "2027-01-01T00:00:00Z" }).state).toBe(
      "applicable",
    );
  });
});
