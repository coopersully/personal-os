import { createHash } from "node:crypto";
import {
  answerFinanceReviewInputSchema,
  financeBudgetVersionSchema,
  financeReviewBatchDecisionSchema,
} from "@personal-os/domain";
import { describe, expect, it, vi } from "vitest";
import { auditValues } from "../audit.js";
import type { Principal } from "../types.js";
import {
  admitFinanceCompletionOwner,
  captureFinanceCompletionBacklog,
  deriveFinanceCompletionBatchTargets,
  qualifyFinanceCompletionTarget,
  validateFinanceCompletionBatch,
  validateFinanceCompletionBudget,
} from "./completion-service.js";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const owner = uuid(1);
const other = uuid(2);
const stamp = "2026-10-01T12:00:00.000Z";
const beforeStamp = "2026-10-01T11:00:00.000Z";
const principal: Principal = {
  userId: owner,
  actorId: owner,
  actorType: "user",
  scopes: new Set(),
};
function budgetFixture() {
  const requirement = {
    versionId: uuid(10),
    planId: uuid(11),
    version: 7,
    effectiveFrom: "2026-10",
  };
  const budget = {
    id: requirement.versionId,
    userId: owner,
    planId: requirement.planId,
    version: 7,
    effectiveFrom: requirement.effectiveFrom,
    profileVersionId: null,
    status: "active",
    approvedAt: stamp,
    approvedByActorType: "user",
    approvedByActorId: owner,
  };
  const audit = {
    id: uuid(12),
    userId: owner,
    actorId: owner,
    actorType: "user",
    requestId: "approval-request",
    action: "finance.budget.user_instruction_approved",
    entityId: budget.id,
    entityType: "finance_budget_version",
    before: { status: "proposed" },
    createdAt: stamp,
    after: {
      approvalSource: "user_instruction",
      status: "active",
      profileVersionId: null,
      budgetVersionId: budget.id,
      budgetVersion: 7,
    },
  };
  return { ownerId: owner, requirement, budget, audit };
}
function categorizationFixture(review = false) {
  const transaction = {
    id: uuid(30),
    userId: owner,
    contextualRevision: "8",
    updatedAt: stamp,
    categoryId: uuid(31),
    categorySource: "user",
    direction: "expense",
    reconciliationStatus: "not_applicable",
    pending: false,
    needsReview: false,
  };
  const target = {
    kind: review ? "review_case" : "transaction_flag",
    id: review ? uuid(32) : transaction.id,
    transactionId: transaction.id,
    capturedRevision: "5",
  };
  const reviewCase = {
    id: uuid(32),
    userId: owner,
    transactionId: transaction.id,
    contextualRevision: "6",
    status: "resolved",
    resolution: null,
  };
  const audit = {
    id: uuid(33),
    userId: owner,
    actorType: "user",
    actorId: owner,
    requestId: "batch-execution",
    entityType: "finance_transaction",
    entityId: transaction.id,
    action: "finance.transaction_categorized",
    createdAt: stamp,
    before: { needsReview: true, updatedAt: beforeStamp },
    after: {
      categoryId: transaction.categoryId,
      categorySource: "user",
      direction: "expense",
      pending: false,
      needsReview: false,
      reconciliationStatus: "not_applicable",
      updatedAt: stamp,
    },
  };
  const basis = {
    transactionId: transaction.id,
    expectedTransactionUpdatedAt: beforeStamp,
    expectedTransactionRevision: "5",
    rationale: "Recorded supported category",
    evidence: "Saved review evidence",
    confidence: 1,
    learnMerchant: "never",
  };
  const decision = financeReviewBatchDecisionSchema.parse(
    review
      ? {
          ...basis,
          kind: "review",
          reviewId: reviewCase.id,
          expectedReviewUpdatedAt: beforeStamp,
          expectedReviewRevision: "5",
          expectedActionRevision: "1",
          action: "approve",
          categoryId: transaction.categoryId,
        }
      : { ...basis, kind: "categorization", categoryId: transaction.categoryId },
  );
  const manifest = [decision];
  const fingerprint = `sha256:${createHash("sha256").update(JSON.stringify(manifest)).digest("hex")}`;
  const batch = {
    id: uuid(34),
    userId: owner,
    actorType: "user",
    actorId: owner,
    authorizationConnectionId: null,
    manifest,
    fingerprint,
    outcomes: [
      {
        index: 0,
        transactionId: transaction.id,
        status: "applied",
        error: null,
        recovery: "none",
        completedAt: stamp,
      },
    ],
  };
  return {
    ownerId: owner,
    target,
    transaction,
    reviewCase,
    audits: [audit],
    batchItem: { batch, fingerprint, index: 0 },
  };
}

describe("owner completion admission", () => {
  it("retains a labelled relay under an owner session without asserting physical-human proof", () => {
    expect(admitFinanceCompletionOwner(principal, "labelled_relay", "session")).toMatchObject({
      actorId: owner,
      sourceClassification: "labelled_relay",
      humanProof: "not_established",
    });
    expect(
      admitFinanceCompletionOwner(principal, "owner_endpoint_request", "session").humanProof,
    ).toBe("not_established");
    expect(() => admitFinanceCompletionOwner(principal, "labelled_relay", "access_token")).toThrow(
      "owner session",
    );
    expect(() =>
      admitFinanceCompletionOwner(principal, "owner_endpoint_request", "unknown"),
    ).toThrow("owner session");
  });
  it("does not convert finance execution/bypass or another user's actor identity into admission", () => {
    expect(() =>
      admitFinanceCompletionOwner(
        { ...principal, actorType: "agent", scopes: new Set(["finances:execute"]) },
        "labelled_relay",
        "session",
      ),
    ).toThrow("Only the authenticated owner");
    expect(() =>
      admitFinanceCompletionOwner({ ...principal, actorId: other }, "labelled_relay", "session"),
    ).toThrow();
  });
});

describe("exact completion budget evidence", () => {
  it("qualifies an exact canonical serialized October budget with its persisted approval audit", () => {
    const f = budgetFixture();
    // Matches budgetValue's public version projection; retained row actor/owner evidence
    // is loaded separately by the eventual integration, never inferred from this DTO.
    const serialized = JSON.parse(
      JSON.stringify(
        financeBudgetVersionSchema.parse({
          id: f.budget.id,
          planId: f.budget.planId,
          profileVersionId: null,
          version: 7,
          effectiveFrom: "2026-10",
          status: "active",
          approvedAt: stamp,
          createdAt: beforeStamp,
          expectedResources: 100,
          allocatedTotal: 100,
          balanceDelta: 0,
          resources: [{ kind: "income", key: "income", amount: 100 }],
          allocations: [{ kind: "buffer", key: "buffer", amount: 100 }],
          assumptions: [],
          rationale: "Synthetic balanced October budget",
        }),
      ),
    );
    const approval = {
      ...auditValues({
        action: "finance.budget.user_instruction_approved",
        principal,
        requestId: "canonical-october-approval",
        entityType: "finance_budget_version",
        entityId: serialized.id,
        before: { status: "proposed" },
        after: {
          approvalSource: "user_instruction",
          status: "active",
          profileVersionId: serialized.profileVersionId,
          budgetVersionId: serialized.id,
          budgetVersion: serialized.version,
        },
      }),
      id: f.audit.id,
      createdAt: new Date(stamp),
    };
    expect(
      validateFinanceCompletionBudget({
        ...f,
        budget: { ...f.budget, ...serialized },
        audits: [approval],
      }),
    ).toMatchObject({
      state: "qualified",
      effectiveFrom: "2026-10",
      version: 7,
      approvalAuditId: f.audit.id,
    });
  });
  it("rejects malformed months independently in stored budget and exact requirement", () => {
    const f = budgetFixture();
    for (const effectiveFrom of [
      "2026-10-01",
      "2026-00",
      "2026-13",
      "2026-1",
      "26-10",
      "2026-10T00:00:00Z",
      " 2026-10",
      "2026-10 ",
      "",
      null,
    ]) {
      expect(
        validateFinanceCompletionBudget({
          ...f,
          budget: { ...f.budget, effectiveFrom },
          audits: [f.audit],
        }),
      ).toMatchObject({ state: "unavailable", reason: "approval_evidence_missing" });
      expect(() =>
        validateFinanceCompletionBudget({
          ...f,
          requirement: { ...f.requirement, effectiveFrom },
          audits: [f.audit],
        }),
      ).toThrow();
    }
    expect(
      validateFinanceCompletionBudget({
        ...f,
        budget: { ...f.budget, effectiveFrom: "2026-11" },
        audits: [f.audit],
      }),
    ).toMatchObject({ reason: "source_inconsistent" });
  });
  it("accepts the production auditValues envelope and native Drizzle approval timestamps", () => {
    const f = budgetFixture();
    const committedAudit = {
      ...auditValues({
        action: "finance.budget.user_instruction_approved",
        principal,
        requestId: "real-writer-envelope",
        entityType: "finance_budget_version",
        entityId: f.budget.id,
        before: { status: "proposed" },
        after: {
          approvalSource: "user_instruction",
          status: "active",
          profileVersionId: f.budget.profileVersionId,
          budgetVersionId: f.budget.id,
          budgetVersion: f.budget.version,
        },
      }),
      id: f.audit.id,
      createdAt: new Date(stamp),
    };
    expect(
      validateFinanceCompletionBudget({
        ...f,
        budget: { ...f.budget, approvedAt: new Date(stamp) },
        audits: [committedAudit],
      }),
    ).toMatchObject({ state: "qualified", approvalAuditId: f.audit.id, approvedAt: stamp });
  });
  it("selects and rechecks an actual exact approval audit without invoking a financial writer", () => {
    const f = budgetFixture();
    expect(validateFinanceCompletionBudget({ ...f, audits: [f.audit] })).toMatchObject({
      state: "qualified",
      approvalAuditId: f.audit.id,
    });
    expect(
      validateFinanceCompletionBudget({ ...f, approvalAuditId: f.audit.id, audits: [f.audit] })
        .state,
    ).toBe("qualified");
  });
  it("does not substitute another approval when the sealed audit is missing", () => {
    const f = budgetFixture();
    expect(
      validateFinanceCompletionBudget({ ...f, approvalAuditId: uuid(99), audits: [f.audit] }),
    ).toMatchObject({ reason: "approval_evidence_missing" });
    expect(
      validateFinanceCompletionBudget({ ...f, audits: [f.audit, { ...f.audit, id: uuid(98) }] }),
    ).toMatchObject({ reason: "source_inconsistent" });
  });
  it("rejects superseded, foreign, actor-mismatched and malformed approval facts", () => {
    const f = budgetFixture();
    expect(
      validateFinanceCompletionBudget({
        ...f,
        budget: { ...f.budget, status: "retired" },
        audits: [f.audit],
      }),
    ).toMatchObject({ reason: "budget_not_active" });
    for (const audit of [
      { ...f.audit, userId: other },
      { ...f.audit, actorId: other },
      { ...f.audit, after: { ...f.audit.after, budgetVersion: 8 } },
      { ...f.audit, after: { ...f.audit.after, approvalSource: "agent_self_approval" } },
    ])
      expect(validateFinanceCompletionBudget({ ...f, audits: [audit] }).state).toBe("unavailable");
  });
});

describe("real saved batch evidence and known-target satisfaction", () => {
  it("parses JSONB-reordered saved manifests and native row revisions without changing their fingerprint", () => {
    const f = categorizationFixture(true);
    const batch = f.batchItem.batch;
    const storedManifest = batch.manifest.map((decision) =>
      Object.fromEntries(Object.entries(decision).reverse()),
    );
    const projected = {
      ...batch,
      manifest: storedManifest,
      createdAt: new Date(stamp),
      updatedAt: new Date(stamp),
    };
    expect(validateFinanceCompletionBatch(owner, projected, batch.fingerprint).fingerprint).toBe(
      batch.fingerprint,
    );
    const original = f.audits[0];
    if (!original) throw new Error("Missing audit");
    const committedAudit = {
      ...auditValues({
        principal,
        requestId: original.requestId,
        action: original.action,
        entityType: original.entityType,
        entityId: original.entityId,
        before: original.before,
        after: { ...original.after, categoryConfidence: 1, id: f.transaction.id },
      }),
      id: original.id,
      createdAt: new Date(stamp),
    };
    expect(
      qualifyFinanceCompletionTarget({
        ...f,
        transaction: { ...f.transaction, contextualRevision: 8n, updatedAt: new Date(stamp) },
        reviewCase: { ...f.reviewCase, contextualRevision: 6n },
        audits: [committedAudit],
        batchItem: { ...f.batchItem, batch: projected },
      }).state,
    ).toBe("qualified");
  });
  it("retains historical target revisions from a real saved manifest, not today's revision", () => {
    const f = categorizationFixture(true);
    const targets = deriveFinanceCompletionBatchTargets({
      ownerId: owner,
      batch: f.batchItem.batch,
      fingerprint: f.batchItem.fingerprint,
      knownFlagIds: [f.transaction.id],
    });
    expect(targets.map((target) => target.kind).sort()).toEqual([
      "review_case",
      "transaction_flag",
    ]);
    expect(targets.every((target) => target.capturedRevision === "5")).toBe(true);
    expect(
      deriveFinanceCompletionBatchTargets({
        ownerId: owner,
        batch: f.batchItem.batch,
        fingerprint: f.batchItem.fingerprint,
        knownFlagIds: [],
      }),
    ).toHaveLength(1);
  });
  it("qualifies old committed category effects and exact saved review outcomes without replay", () => {
    expect(qualifyFinanceCompletionTarget(categorizationFixture())).toMatchObject({
      state: "qualified",
      observedRevision: "8",
    });
    expect(qualifyFinanceCompletionTarget(categorizationFixture(true))).toMatchObject({
      state: "qualified",
      observedRevision: "6",
    });
  });
  it("accepts an exactly linked categorization after a later nonconflicting merchant update only", () => {
    const f = categorizationFixture();
    const later = {
      ...f.transaction,
      contextualRevision: "9",
      updatedAt: "2026-10-01T14:00:00.000Z",
      merchantId: uuid(900),
    };
    expect(qualifyFinanceCompletionTarget({ ...f, transaction: later }).state).toBe("qualified");
    const { batchItem: _batch, ...auditOnly } = f;
    expect(qualifyFinanceCompletionTarget({ ...auditOnly, transaction: later }).state).toBe(
      "unavailable",
    );
    expect(qualifyFinanceCompletionTarget(auditOnly).state).toBe("qualified");
    for (const conflict of [
      { categoryId: uuid(901) },
      { categorySource: "agent" },
      { direction: "income" },
      { reconciliationStatus: "confirmed" },
      { pending: true },
      { needsReview: true },
    ])
      expect(
        qualifyFinanceCompletionTarget({ ...f, transaction: { ...later, ...conflict } }).state,
      ).not.toBe("qualified");
    expect(
      qualifyFinanceCompletionTarget({
        ...f,
        transaction: later,
        batchItem: { ...f.batchItem, fingerprint: `sha256:${"a".repeat(64)}` },
      }).state,
    ).toBe("unavailable");
  });
  it("accepts the exact persisted Inbox classification writer object", () => {
    const f = categorizationFixture(true);
    for (const resolution of [
      { type: "confirm_classification", categoryId: f.transaction.categoryId },
      {
        type: "classify_transaction",
        categoryId: f.transaction.categoryId,
        meaning: "Supported category",
      },
    ]) {
      const input = answerFinanceReviewInputSchema.parse({
        answer: "Confirmed the classification",
        idempotencyKey: "completion-writer-regression",
        resolution,
      });
      // inbox-service.ts persists this exact object, not input.resolution alone.
      const persisted = { answer: input.answer, ...input.resolution };
      expect(
        qualifyFinanceCompletionTarget({
          ...f,
          reviewCase: { ...f.reviewCase, resolution: persisted },
        }).state,
      ).toBe("qualified");
    }
  });
  it("uses batch resolution fallback only for actual null and rejects malformed persisted resolutions", () => {
    const f = categorizationFixture(true);
    expect(qualifyFinanceCompletionTarget(f).state).toBe("qualified");
    const valid = {
      type: "confirm_classification",
      categoryId: f.transaction.categoryId,
      answer: "Confirmed",
    };
    for (const resolution of [
      {},
      { categoryId: f.transaction.categoryId },
      { type: "unknown", answer: "Confirmed" },
      { type: "confirm_classification", answer: "Confirmed" },
      { ...valid, categoryId: "not-a-uuid" },
      { ...valid, type: "classify_transaction" },
      { ...valid, hidden: true },
      { type: "confirm_classification", categoryId: f.transaction.categoryId },
      {
        type: "classify_transaction",
        categoryId: f.transaction.categoryId,
        meaning: "Supported category",
      },
      { ...valid, answer: "" },
      { ...valid, answer: "   " },
      { ...valid, answer: 42 },
      { ...valid, answer: "a".repeat(10_001) },
      { ...valid, type: "classify_transaction", meaning: "" },
      { ...valid, type: "classify_transaction", meaning: "m".repeat(501) },
    ])
      expect(
        qualifyFinanceCompletionTarget({ ...f, reviewCase: { ...f.reviewCase, resolution } }),
      ).toMatchObject({ reason: "source_inconsistent" });
    expect(
      qualifyFinanceCompletionTarget({
        ...f,
        reviewCase: { ...f.reviewCase, resolution: { ...valid, answer: "a".repeat(10_000) } },
      }).state,
    ).toBe("qualified");
    const { resolution: _resolution, ...missing } = f.reviewCase;
    expect(qualifyFinanceCompletionTarget({ ...f, reviewCase: missing }).state).not.toBe(
      "qualified",
    );
  });
  it("does not treat empty current backlog, deletion or a cleared boolean as proof", () => {
    const f = categorizationFixture();
    expect(qualifyFinanceCompletionTarget({ ...f, audits: [] }).state).toBe("unavailable");
    expect(qualifyFinanceCompletionTarget({ ...f, transaction: null }).state).toBe("unavailable");
    expect(
      qualifyFinanceCompletionTarget({
        ...f,
        transaction: { ...f.transaction, needsReview: true },
      }),
    ).toMatchObject({ reason: "flag_still_set" });
    expect(
      qualifyFinanceCompletionTarget({ ...f, target: { ...f.target, capturedRevision: null } }),
    ).toMatchObject({ reason: "historical_revision_unavailable" });
  });
  it("does not infer case satisfaction from a generic transaction audit or a dismissal", () => {
    const f = categorizationFixture(true);
    const { batchItem: _batch, ...withoutBatch } = f;
    expect(qualifyFinanceCompletionTarget(withoutBatch)).toMatchObject({
      reason: "exact_case_effect_unavailable",
    });
    expect(
      qualifyFinanceCompletionTarget({
        ...f,
        reviewCase: {
          ...f.reviewCase,
          resolution: {
            type: "dismiss",
            answer: "Dismiss",
            rationale: "Dismissal is not reconciliation",
          },
        },
      }),
    ).toMatchObject({ reason: "nonqualifying_resolution" });
    expect(
      qualifyFinanceCompletionTarget({
        ...f,
        reviewCase: {
          ...f.reviewCase,
          resolution: {
            type: "confirm_classification",
            answer: "Confirmed",
            categoryId: uuid(999),
          },
        },
      }),
    ).toMatchObject({ reason: "source_inconsistent" });
    expect(
      qualifyFinanceCompletionTarget({ ...f, reviewCase: { ...f.reviewCase, status: "deferred" } }),
    ).toMatchObject({ reason: "unresolved_case" });
    expect(
      qualifyFinanceCompletionTarget({ ...f, reviewCase: { ...f.reviewCase, userId: other } })
        .state,
    ).toBe("unavailable");
  });
  it("fails closed on foreign/changed audits and ambiguous matching effects", () => {
    const f = categorizationFixture();
    const audit = f.audits[0];
    if (!audit) throw new Error("Missing test audit");
    for (const audits of [
      [{ ...audit, userId: other }],
      [{ ...audit, after: { ...audit.after, categoryId: uuid(999) } }],
      [audit, { ...audit, id: uuid(998) }],
    ])
      expect(qualifyFinanceCompletionTarget({ ...f, audits }).state).toBe("unavailable");
    expect(
      qualifyFinanceCompletionTarget({
        ...f,
        transaction: { ...f.transaction, direction: "transfer" },
      }),
    ).toMatchObject({ reason: "requires_financial_effect_validator" });
    expect(
      qualifyFinanceCompletionTarget({
        ...f,
        transaction: { ...f.transaction, contextualRevision: "5" },
      }),
    ).toMatchObject({ reason: "source_inconsistent" });
  });
  it("rejects forged fingerprints, duplicate outcomes and detached batch targets", () => {
    const f = categorizationFixture();
    const batch = f.batchItem.batch;
    expect(() => validateFinanceCompletionBatch(other, batch, batch.fingerprint)).toThrow();
    expect(() =>
      validateFinanceCompletionBatch(
        owner,
        { ...batch, fingerprint: `sha256:${"a".repeat(64)}` },
        `sha256:${"a".repeat(64)}`,
      ),
    ).toThrow();
    expect(() =>
      validateFinanceCompletionBatch(
        owner,
        { ...batch, outcomes: [...batch.outcomes, ...batch.outcomes] },
        batch.fingerprint,
      ),
    ).toThrow();
    const outcome = batch.outcomes[0];
    if (!outcome) throw new Error("Missing test outcome");
    const failed = {
      ...batch,
      outcomes: [
        {
          ...outcome,
          status: "failed",
          error: { code: "conflict", message: "changed" },
          recovery: "new_preview",
        },
      ],
    };
    expect(
      qualifyFinanceCompletionTarget({ ...f, batchItem: { ...f.batchItem, batch: failed } }),
    ).toMatchObject({ reason: "nonapplied_outcome" });
  });
});

describe("complete current owner capture under a caller-owned snapshot", () => {
  function rows(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      userId: owner,
      kind: "transaction_flag",
      id: uuid(index + 100),
      transactionId: uuid(index + 100),
      contextualRevision: "1",
    }));
  }
  function reader(items: ReturnType<typeof rows>) {
    return vi.fn(async (after: string | null, limit: number) =>
      items.filter((item) => after === null || `${item.kind}:${item.id}` > after).slice(0, limit),
    );
  }
  it("captures every one of 2801 rows using bounded keyset pages", async () => {
    const readPage = reader(rows(2801));
    const captured = await captureFinanceCompletionBacklog({ ownerId: owner, readPage });
    expect(captured.targets).toHaveLength(2801);
    expect(captured).toMatchObject({
      complete: true,
      targetCount: 2801,
      pageCount: 6,
      queryVersion: "finance-completion-capture:v2",
      counts: { transactionFlags: 2801, reviewCases: 0 },
      terminalPage: { rowCount: 301 },
    });
    expect(readPage).toHaveBeenCalledTimes(6);
    expect(captured.targets.at(-1)?.id).toBe(uuid(2900));
  });
  it("supports 10000 and rejects 10001 without a partial returned capture", async () => {
    const captured = await captureFinanceCompletionBacklog({
      ownerId: owner,
      readPage: reader(rows(10_000)),
    });
    expect(captured.targets).toHaveLength(10_000);
    expect(captured).toMatchObject({
      pageCount: 21,
      terminalPage: { rowCount: 0 },
      complete: true,
    });
    await expect(
      captureFinanceCompletionBacklog({ ownerId: owner, readPage: reader(rows(10_001)) }),
    ).rejects.toThrow("scope_exceeds_limit");
  });
  it("returns a complete zero capture envelope and no partial envelope after a reader error", async () => {
    const readPage = vi.fn(async () => []);
    const capture = await captureFinanceCompletionBacklog({ ownerId: owner, readPage });
    const snapshot = createHash("sha256")
      .update(JSON.stringify(["finance-completion-capture:v2", owner, []]))
      .digest("hex");
    expect(capture).toEqual({
      queryVersion: "finance-completion-capture:v2",
      ownerId: owner,
      snapshot,
      complete: true,
      targetCount: 0,
      counts: { transactionFlags: 0, reviewCases: 0 },
      pageCount: 1,
      terminalPage: { after: null, rowCount: 0 },
      targets: [],
    });
    expect(readPage).toHaveBeenCalledTimes(1);
    let reads = 0;
    await expect(
      captureFinanceCompletionBacklog({
        ownerId: owner,
        readPage: async () => {
          if (reads++ === 0) return rows(500);
          throw new Error("snapshot read failed");
        },
      }),
    ).rejects.toThrow("snapshot read failed");
  });
  it("rejects another owner or a nonadvancing/duplicate page", async () => {
    const item = rows(1)[0];
    if (!item) throw new Error("Missing row");
    await expect(
      captureFinanceCompletionBacklog({
        ownerId: owner,
        readPage: async () => [{ ...item, userId: other }],
      }),
    ).rejects.toThrow();
    await expect(
      captureFinanceCompletionBacklog({ ownerId: owner, readPage: async () => [item, item] }),
    ).rejects.toThrow("keyset");
  });
});
