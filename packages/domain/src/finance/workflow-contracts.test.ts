import { describe, expect, it } from "vitest";
import {
  decideFinanceReviewActionTransition,
  financeBudgetEvaluationCheckpointSchema,
  financeDomainOutcomeSchema,
  financeHumanWorkRefSchema,
  financeMoneyFactReasonCodeSchema,
  financeMoneyFactSchema,
  financePositionEvidenceCheckpointSchema,
  financePositionReadScopeSchema,
  financeReviewActionCandidateSchema,
  financeReviewActionIssueResultSchema,
  financeReviewActionRequestSchema,
  financeReviewActionTerminalResultSchema,
  financeReviewSmsClarifyCommandSchema,
  financeRevisionRefSchema,
  financeWorkflowPortManifest,
  financeWorkflowPortResultSchema,
  finishFinanceReviewAction,
  issueFinanceReviewAction,
} from "./workflow-contracts.js";

const ids = {
  operation: "00000000-0000-4000-8000-000000000001",
  review: "00000000-0000-4000-8000-000000000002",
  transaction: "00000000-0000-4000-8000-000000000003",
  request1: "00000000-0000-4000-8000-000000000004",
  request2: "00000000-0000-4000-8000-000000000005",
  request3: "00000000-0000-4000-8000-000000000006",
  inbound: "00000000-0000-4000-8000-000000000007",
  binding: "00000000-0000-4000-8000-000000000008",
  authority1: "00000000-0000-4000-8000-000000000009",
  authority2: "00000000-0000-4000-8000-00000000000a",
  authority3: "00000000-0000-4000-8000-00000000000b",
  terminal1: "00000000-0000-4000-8000-00000000000c",
  review2: "00000000-0000-4000-8000-00000000000d",
  transaction2: "00000000-0000-4000-8000-00000000000e",
  retirement2: "00000000-0000-4000-8000-00000000000f",
} as const;

function reviewCandidate(
  reason: "missing_provenance" | "category_ambiguity" = "missing_provenance",
  revision = reason === "category_ambiguity" ? "2" : "1",
) {
  return {
    action: {
      version: 1 as const,
      kind: "question" as const,
      answerMode: "free_text" as const,
      purpose: "maintenance_clarification" as const,
    },
    basis: {
      subject: { kind: "transaction" as const, id: ids.transaction },
      source: { kind: "finance_review_case" as const, id: ids.review },
      reason,
      consequence: {
        kind: "resume_finance_maintenance" as const,
        target: "same_review_case" as const,
      },
    },
    work: {
      id: ids.review,
      domain: "finances" as const,
      kind: "question" as const,
      revision,
    },
  };
}

function reviewRequest(
  requestId = ids.request1,
  actionRevision = "1",
  reason: "missing_provenance" | "category_ambiguity" = "missing_provenance",
  authorityOperationId = ids.authority1,
) {
  const candidate = reviewCandidate(reason);
  return {
    ...candidate,
    authorityOperationId,
    requestId,
    work: { ...candidate.work, actionRevision },
  };
}

function terminalState(
  state: "consumed" | "withdrawn",
  request = reviewRequest(),
  operationId = ids.terminal1,
) {
  return {
    state,
    request,
    terminal: { requestId: request.requestId, operationId },
  };
}

describe("Finance workflow contracts", () => {
  it("advertises only the implemented position and resume ports", () => {
    expect(financeWorkflowPortManifest).toHaveLength(7);
    expect(
      financeWorkflowPortManifest.filter((registration) => registration.state === "available"),
    ).toEqual([
      {
        port: "readPosition",
        state: "available",
        producer: "finances",
        route: { method: "GET", path: "/v1/finances/position" },
      },
      {
        port: "resumeFinance",
        state: "available",
        producer: "finances",
        route: { method: "POST", path: "/v1/finances/maintenance" },
      },
    ]);
    expect(
      financeWorkflowPortManifest
        .filter((registration) => registration.state === "unavailable")
        .every((registration) => registration.reasonCode === "producer_not_registered"),
    ).toBe(true);
  });

  it("validates bounded position read scopes without accepting tenant authority", () => {
    const scope = { from: "2026-09-01", through: "2026-09-30" };
    expect(financePositionReadScopeSchema.parse(scope)).toEqual(scope);
    expect(financePositionReadScopeSchema.parse({ ...scope, accountIds: [] })).toEqual({
      ...scope,
      accountIds: [],
    });
    expect(financePositionReadScopeSchema.safeParse({ ...scope, from: "2026-10-01" }).success).toBe(
      false,
    );
    expect(
      financePositionReadScopeSchema.safeParse({
        ...scope,
        userId: "00000000-0000-4000-8000-000000000001",
      }).success,
    ).toBe(false);
    expect(
      financePositionReadScopeSchema.safeParse({
        ...scope,
        accountIds: Array.from(
          { length: 101 },
          (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
      }).success,
    ).toBe(false);
  });

  it("limits durable position checkpoints to evidence identity and public quality metadata", () => {
    const fact = { quality: "verified", reasons: [] };
    const checkpoint = {
      revision: "position-revision",
      scope: { accountIds: [], from: "2026-09-01", through: "2026-09-30" },
      facts: {
        cash: fact,
        postedSpend: fact,
        pendingExposure: fact,
        committed: fact,
        protected: fact,
        spendable: fact,
        debt: fact,
        investments: fact,
        netWorth: fact,
      },
    };
    expect(financePositionEvidenceCheckpointSchema.parse(checkpoint)).toEqual(checkpoint);
    expect(
      financePositionEvidenceCheckpointSchema.safeParse({
        ...checkpoint,
        facts: { ...checkpoint.facts, cash: { ...fact, cents: 100 } },
      }).success,
    ).toBe(false);
    expect(
      financePositionEvidenceCheckpointSchema.safeParse({
        ...checkpoint,
        facts: { ...checkpoint.facts, cash: { ...fact, sources: [] } },
      }).success,
    ).toBe(false);
  });

  it("limits durable budget checkpoints to identity and decision metadata", () => {
    const checkpoint = {
      positionRevision: "position-revision",
      state: "evaluated" as const,
      reasonCode: null,
      evaluations: [
        {
          proposal: { id: "00000000-0000-4000-8000-000000000001", revision: "1" },
          policy: { id: "00000000-0000-4000-8000-000000000002", revision: "2" },
          plan: { id: "00000000-0000-4000-8000-000000000003", revision: "3" },
          outcome: "denied" as const,
          reasons: ["usage_unavailable" as const],
          executionAvailable: false as const,
          executionUnavailableReasons: [
            "authority_not_wired" as const,
            "position_commit_fence_not_wired" as const,
          ],
        },
      ],
    };
    expect(financeBudgetEvaluationCheckpointSchema.parse(checkpoint)).toEqual(checkpoint);
    expect(
      financeBudgetEvaluationCheckpointSchema.safeParse({
        ...checkpoint,
        evaluations: [{ ...checkpoint.evaluations[0], grossMovedCents: 500 }],
      }).success,
    ).toBe(false);
    expect(
      financeBudgetEvaluationCheckpointSchema.safeParse({
        ...checkpoint,
        evaluations: [{ ...checkpoint.evaluations[0], sourceText: "private" }],
      }).success,
    ).toBe(false);
    for (const invalid of [
      { ...checkpoint, evaluations: [] },
      { ...checkpoint, state: "not_applicable", evaluations: checkpoint.evaluations },
      { ...checkpoint, state: "unavailable", evaluations: [], reasonCode: null },
      {
        ...checkpoint,
        state: "not_applicable",
        evaluations: [],
        reasonCode: "dependency_unavailable",
      },
    ]) {
      expect(financeBudgetEvaluationCheckpointSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("rejects tenant authority smuggled across a producer boundary", () => {
    const reference = { id: "00000000-0000-4000-8000-000000000001", revision: "revision-1" };
    expect(financeRevisionRefSchema.safeParse(reference).success).toBe(true);
    expect(
      financeRevisionRefSchema.safeParse({
        ...reference,
        userId: "another-user",
      }).success,
    ).toBe(false);
  });

  it("accepts only canonical reason codes at the money evidence boundary", () => {
    const fact = { cents: null, currency: "USD", quality: "unavailable", sources: [] };
    for (const reason of financeMoneyFactReasonCodeSchema.options) {
      expect(financeMoneyFactSchema.safeParse({ ...fact, reasons: [reason] }).success).toBe(true);
    }
    for (const reason of ["future_unknown_code", "Provider error: private account 123", ""]) {
      expect(financeMoneyFactSchema.safeParse({ ...fact, reasons: [reason] }).success).toBe(false);
    }
    expect(
      financeMoneyFactSchema.safeParse({
        ...fact,
        reasons: ["stale_evidence"],
        providerText: "private",
      }).success,
    ).toBe(false);
  });

  it("represents stale and replayed operations with stable reason codes", () => {
    for (const reasonCode of ["stale_revision", "operation_replayed"] as const) {
      expect(
        financeDomainOutcomeSchema.parse({
          operationId: "00000000-0000-4000-8000-000000000001",
          state: "blocked",
          work: [],
          resultRevision: null,
          reasonCode,
        }),
      ).toMatchObject({
        operationId: "00000000-0000-4000-8000-000000000001",
        reasonCode,
      });
    }
  });

  it("gives producers a validating available-or-unavailable adapter", () => {
    const resultSchema = financeWorkflowPortResultSchema(financeRevisionRefSchema);
    expect(
      resultSchema.parse({
        state: "unavailable",
        reasonCode: "dependency_unavailable",
        retryable: true,
      }),
    ).toEqual({
      state: "unavailable",
      reasonCode: "dependency_unavailable",
      retryable: true,
    });
    expect(
      resultSchema.safeParse({
        state: "available",
        value: {
          id: "00000000-0000-4000-8000-000000000001",
          revision: "revision-1",
          userId: "other-user",
        },
      }).success,
    ).toBe(false);
  });
});

describe("Finance review action requests", () => {
  it("preserves open and consumed requests across rediscovery and evidence-only drift", () => {
    const request = reviewRequest();
    const desired = { ...reviewCandidate(), work: { ...reviewCandidate().work, revision: "2" } };
    expect(
      decideFinanceReviewActionTransition({
        current: { state: "open", request },
        desired,
        intent: "observe",
      }),
    ).toEqual({ decision: "preserve", current: { state: "open", request } });

    const consumed = terminalState("consumed", request);
    expect(
      decideFinanceReviewActionTransition({ current: consumed, desired, intent: "observe" }),
    ).toEqual({ decision: "preserve", current: consumed });
  });

  it("enforces monotonic review revisions independently of semantic identity", () => {
    const base = reviewRequest();
    const request = { ...base, work: { ...base.work, revision: "2" } };
    const open = { state: "open" as const, request };

    expect(
      decideFinanceReviewActionTransition({
        current: open,
        desired: reviewCandidate("missing_provenance", "1"),
        intent: "observe",
      }),
    ).toEqual({ decision: "rejected", reason: "invalid_transition" });
    for (const revision of ["2", "3"]) {
      expect(
        decideFinanceReviewActionTransition({
          current: open,
          desired: reviewCandidate("missing_provenance", revision),
          intent: "observe",
        }),
      ).toEqual({ decision: "preserve", current: open });
    }
    for (const revision of ["1", "2"]) {
      expect(
        decideFinanceReviewActionTransition({
          current: open,
          desired: reviewCandidate("category_ambiguity", revision),
          intent: "observe",
        }),
      ).toEqual({ decision: "rejected", reason: "invalid_transition" });
    }

    const changed = decideFinanceReviewActionTransition({
      current: open,
      desired: reviewCandidate("category_ambiguity", "3"),
      intent: "observe",
    });
    expect(changed).toMatchObject({ decision: "needs_issue", cause: "basis_changed" });
    expect(
      issueFinanceReviewAction({
        decision: {
          ...changed,
          desired: reviewCandidate("category_ambiguity", "2"),
        },
        authorityOperationId: ids.authority2,
        requestId: ids.request2,
        retirementOperationId: ids.terminal1,
        actionRevision: "2",
      }),
    ).toEqual({ decision: "rejected", reason: "invalid_transition" });

    const consumed = terminalState("consumed", request);
    for (const revision of ["2", "3"]) {
      expect(
        decideFinanceReviewActionTransition({
          current: consumed,
          desired: reviewCandidate("missing_provenance", revision),
          intent: "reissue",
        }),
      ).toMatchObject({ decision: "needs_issue", cause: "explicit_reissue" });
    }
  });

  it("issues only for changed authority or an explicit terminal reissue", () => {
    const request = reviewRequest();
    const consumed = terminalState("consumed", request);
    expect(
      decideFinanceReviewActionTransition({
        current: consumed,
        desired: reviewCandidate("category_ambiguity"),
        intent: "observe",
      }),
    ).toMatchObject({
      decision: "needs_issue",
      prior: consumed,
      cause: "basis_changed",
    });
    for (const state of [consumed, terminalState("withdrawn", request)] as const) {
      expect(
        decideFinanceReviewActionTransition({
          current: state,
          desired: reviewCandidate(),
          intent: "reissue",
        }),
      ).toMatchObject({
        decision: "needs_issue",
        prior: state,
        cause: "explicit_reissue",
      });
    }
    expect(
      decideFinanceReviewActionTransition({
        current: { state: "open", request },
        desired: reviewCandidate(),
        intent: "reissue",
      }),
    ).toEqual({ decision: "rejected", reason: "invalid_transition" });
    for (const invalid of [
      { current: { state: "absent" }, desired: reviewCandidate(), intent: "reissue" },
      { current: { state: "open", request }, desired: null, intent: "reissue" },
      { current: consumed, desired: null, intent: "reissue" },
    ]) {
      expect(decideFinanceReviewActionTransition(invalid)).toEqual({
        decision: "rejected",
        reason: "invalid_transition",
      });
    }
  });

  it("never advances an action revision across a different Finance review case", () => {
    const request = reviewRequest();
    const differentCase = {
      ...reviewCandidate("category_ambiguity"),
      basis: {
        ...reviewCandidate("category_ambiguity").basis,
        source: { kind: "finance_review_case" as const, id: ids.review2 },
      },
      work: { ...reviewCandidate("category_ambiguity").work, id: ids.review2 },
    };
    expect(
      decideFinanceReviewActionTransition({
        current: { state: "open", request },
        desired: differentCase,
        intent: "observe",
      }),
    ).toEqual({ decision: "rejected", reason: "invalid_transition" });

    const validDecision = decideFinanceReviewActionTransition({
      current: { state: "open", request },
      desired: reviewCandidate("category_ambiguity"),
      intent: "observe",
    });
    expect(
      issueFinanceReviewAction({
        decision: { ...validDecision, desired: differentCase },
        authorityOperationId: ids.authority2,
        requestId: ids.request2,
        retirementOperationId: ids.terminal1,
        actionRevision: "2",
      }),
    ).toEqual({ decision: "rejected", reason: "invalid_transition" });
  });

  it("withdraws by exact request and retains terminal operation identity", () => {
    const request = reviewRequest();
    expect(
      decideFinanceReviewActionTransition({
        current: { state: "open", request },
        desired: null,
        intent: "observe",
      }),
    ).toEqual({ decision: "needs_withdraw", request });
    const withdrawn = finishFinanceReviewAction({
      current: { state: "open", request },
      expectedRequestId: request.requestId,
      operationId: ids.terminal1,
      transition: "withdraw",
    });
    expect(withdrawn).toEqual({
      decision: "withdraw",
      state: {
        state: "withdrawn",
        request,
        terminal: { requestId: request.requestId, operationId: ids.terminal1 },
      },
    });
    if (withdrawn.decision !== "withdraw") throw new Error("Expected a withdrawal.");
    expect(
      decideFinanceReviewActionTransition({
        current: withdrawn.state,
        desired: null,
        intent: "observe",
      }),
    ).toEqual({ decision: "preserve", current: withdrawn.state });
  });

  it("retires an open changed-basis request atomically with replacement issuance", () => {
    const request1 = reviewRequest();
    const decision = decideFinanceReviewActionTransition({
      current: { state: "open", request: request1 },
      desired: reviewCandidate("category_ambiguity"),
      intent: "observe",
    });
    expect(decision).toMatchObject({
      decision: "needs_issue",
      prior: { state: "open", request: request1 },
      cause: "basis_changed",
    });
    const issued = issueFinanceReviewAction({
      decision,
      authorityOperationId: ids.authority2,
      requestId: ids.request2,
      retirementOperationId: ids.terminal1,
      actionRevision: "2",
    });
    expect(issued).toMatchObject({
      decision: "issue",
      request: {
        authorityOperationId: ids.authority2,
        requestId: ids.request2,
        work: { actionRevision: "2" },
      },
      previous: {
        state: "withdrawn",
        request: request1,
        terminal: { requestId: request1.requestId, operationId: ids.terminal1 },
      },
    });
    expect(
      issueFinanceReviewAction({
        decision: { ...decision, cause: "explicit_reissue" },
        authorityOperationId: ids.authority2,
        requestId: ids.request2,
        retirementOperationId: ids.terminal1,
        actionRevision: "2",
      }),
    ).toEqual({ decision: "rejected", reason: "malformed_input" });
    expect(
      issueFinanceReviewAction({
        decision,
        authorityOperationId: ids.request2,
        requestId: ids.request2,
        retirementOperationId: ids.terminal1,
        actionRevision: "2",
      }),
    ).toEqual({ decision: "rejected", reason: "malformed_input" });
    expect(
      issueFinanceReviewAction({
        decision,
        authorityOperationId: ids.authority2,
        requestId: ids.request2,
        retirementOperationId: null,
        actionRevision: "2",
      }),
    ).toEqual({ decision: "rejected", reason: "malformed_input" });
    expect(
      issueFinanceReviewAction({
        decision,
        authorityOperationId: ids.authority2,
        requestId: ids.request2,
        retirementOperationId: ids.authority2,
        actionRevision: "2",
      }),
    ).toEqual({ decision: "rejected", reason: "malformed_input" });
    expect(
      issueFinanceReviewAction({
        decision,
        authorityOperationId: ids.authority2,
        requestId: ids.request2,
        retirementOperationId: request1.requestId,
        actionRevision: "2",
      }),
    ).toEqual({ decision: "rejected", reason: "request_identity_reused" });
  });

  it("represents A to B to A as fresh current identities without claiming ledger history", () => {
    const request1 = reviewRequest();
    const toB = decideFinanceReviewActionTransition({
      current: { state: "open", request: request1 },
      desired: reviewCandidate("category_ambiguity"),
      intent: "observe",
    });
    const issued2 = issueFinanceReviewAction({
      decision: toB,
      authorityOperationId: ids.authority2,
      requestId: ids.request2,
      retirementOperationId: ids.terminal1,
      actionRevision: "2",
    });
    if (issued2.decision !== "issue") throw new Error("Expected request two to be issued.");

    const toA = decideFinanceReviewActionTransition({
      current: { state: "open", request: issued2.request },
      desired: reviewCandidate("missing_provenance", "3"),
      intent: "observe",
    });
    const issued3 = issueFinanceReviewAction({
      decision: toA,
      authorityOperationId: ids.authority3,
      requestId: ids.request3,
      retirementOperationId: ids.retirement2,
      actionRevision: "3",
    });
    expect(issued3).toMatchObject({
      decision: "issue",
      request: {
        authorityOperationId: ids.authority3,
        requestId: ids.request3,
        work: { actionRevision: "3" },
      },
      previous: {
        state: "withdrawn",
        request: issued2.request,
        terminal: { requestId: issued2.request.requestId, operationId: ids.retirement2 },
      },
    });
    for (const reused of [
      { authorityOperationId: ids.authority3, requestId: ids.request2 },
      { authorityOperationId: ids.authority2, requestId: ids.request3 },
      { authorityOperationId: ids.request2, requestId: ids.request3 },
      { authorityOperationId: ids.authority3, requestId: ids.authority2 },
    ]) {
      expect(
        issueFinanceReviewAction({
          decision: toA,
          ...reused,
          retirementOperationId: ids.retirement2,
          actionRevision: "3",
        }),
      ).toEqual({ decision: "rejected", reason: "request_identity_reused" });
    }
  });

  it("rejects either new identity when it reuses a retained terminal operation", () => {
    const request = reviewRequest();
    const consumed = terminalState("consumed", request);
    const decision = decideFinanceReviewActionTransition({
      current: consumed,
      desired: reviewCandidate("category_ambiguity"),
      intent: "observe",
    });
    for (const identities of [
      { authorityOperationId: ids.terminal1.toUpperCase(), requestId: ids.request2 },
      { authorityOperationId: ids.authority2, requestId: ids.terminal1.toUpperCase() },
    ]) {
      expect(
        issueFinanceReviewAction({
          decision,
          ...identities,
          retirementOperationId: null,
          actionRevision: "2",
        }),
      ).toEqual({ decision: "rejected", reason: "request_identity_reused" });
    }
    expect(
      issueFinanceReviewAction({
        decision,
        authorityOperationId: ids.authority2,
        requestId: ids.request2,
        retirementOperationId: ids.retirement2,
        actionRevision: "2",
      }),
    ).toEqual({ decision: "rejected", reason: "malformed_input" });
  });

  it("validates issue result invariants against direct schema forgery", () => {
    const prior = reviewRequest();
    const initialDecision = decideFinanceReviewActionTransition({
      current: { state: "absent" },
      desired: reviewCandidate(),
      intent: "observe",
    });
    const initial = issueFinanceReviewAction({
      decision: initialDecision,
      authorityOperationId: ids.authority1,
      requestId: ids.request1,
      retirementOperationId: null,
      actionRevision: "1",
    });
    expect(financeReviewActionIssueResultSchema.safeParse(initial).success).toBe(true);
    if (initial.decision !== "issue") throw new Error("Expected initial issuance.");

    const openDecision = decideFinanceReviewActionTransition({
      current: { state: "open", request: prior },
      desired: reviewCandidate("category_ambiguity"),
      intent: "observe",
    });
    const replacement = issueFinanceReviewAction({
      decision: openDecision,
      authorityOperationId: ids.authority2,
      requestId: ids.request2,
      retirementOperationId: ids.terminal1,
      actionRevision: "2",
    });
    expect(financeReviewActionIssueResultSchema.safeParse(replacement).success).toBe(true);
    if (replacement.decision !== "issue") throw new Error("Expected replacement issuance.");

    const terminalDecision = decideFinanceReviewActionTransition({
      current: terminalState("consumed", prior),
      desired: reviewCandidate(),
      intent: "reissue",
    });
    const terminalReissue = issueFinanceReviewAction({
      decision: terminalDecision,
      authorityOperationId: ids.authority2,
      requestId: ids.request2,
      retirementOperationId: null,
      actionRevision: "2",
    });
    expect(financeReviewActionIssueResultSchema.safeParse(terminalReissue).success).toBe(true);
    if (terminalReissue.decision !== "issue") throw new Error("Expected terminal reissue.");

    const differentCaseRequest = {
      ...replacement.request,
      basis: {
        ...replacement.request.basis,
        source: { kind: "finance_review_case" as const, id: ids.review2 },
      },
      work: { ...replacement.request.work, id: ids.review2 },
    };
    for (const forged of [
      { ...replacement, previous: { state: "open", request: prior } },
      {
        ...initial,
        request: { ...initial.request, work: { ...initial.request.work, actionRevision: "2" } },
      },
      { ...replacement, request: differentCaseRequest },
      {
        ...replacement,
        request: {
          ...replacement.request,
          work: { ...replacement.request.work, actionRevision: "3" },
        },
      },
      {
        ...terminalReissue,
        request: { ...terminalReissue.request, authorityOperationId: ids.terminal1 },
      },
    ]) {
      expect(financeReviewActionIssueResultSchema.safeParse(forged).success).toBe(false);
    }
  });

  it("binds terminal result decisions to their exact terminal states", () => {
    const request = reviewRequest();
    const consumed = finishFinanceReviewAction({
      current: { state: "open", request },
      expectedRequestId: request.requestId,
      operationId: ids.terminal1,
      transition: "consume",
    });
    expect(financeReviewActionTerminalResultSchema.safeParse(consumed).success).toBe(true);
    if (consumed.decision !== "consume") throw new Error("Expected consumption.");
    expect(
      financeReviewActionTerminalResultSchema.safeParse({
        decision: "withdraw",
        state: consumed.state,
      }).success,
    ).toBe(false);
  });

  it("normalizes lifecycle UUIDs before transition and reuse comparisons", () => {
    const candidate = reviewCandidate();
    const upperCandidate = {
      ...candidate,
      basis: {
        ...candidate.basis,
        subject: { ...candidate.basis.subject, id: ids.transaction2.toUpperCase() },
        source: { ...candidate.basis.source, id: ids.review2.toUpperCase() },
      },
      work: { ...candidate.work, id: ids.review2.toUpperCase() },
    };
    const initial = decideFinanceReviewActionTransition({
      current: { state: "absent" },
      desired: upperCandidate,
      intent: "observe",
    });
    expect(initial).toMatchObject({
      decision: "needs_issue",
      desired: {
        basis: {
          subject: { id: ids.transaction2 },
          source: { id: ids.review2 },
        },
        work: { id: ids.review2 },
      },
    });

    const request = reviewRequest();
    const changed = decideFinanceReviewActionTransition({
      current: { state: "open", request },
      desired: reviewCandidate("category_ambiguity"),
      intent: "observe",
    });
    expect(
      issueFinanceReviewAction({
        decision: changed,
        authorityOperationId: ids.authority1.toUpperCase(),
        requestId: ids.request2,
        retirementOperationId: ids.terminal1,
        actionRevision: "2",
      }),
    ).toEqual({ decision: "rejected", reason: "request_identity_reused" });
  });

  it("keeps lifecycle identities disjoint from subject and review-case roles", () => {
    const request = reviewRequest();
    for (const alias of [
      { ...request, requestId: request.basis.subject.id.toUpperCase() },
      { ...request, authorityOperationId: request.basis.source.id.toUpperCase() },
    ]) {
      expect(financeReviewActionRequestSchema.safeParse(alias).success).toBe(false);
    }
    for (const operationId of [
      request.basis.subject.id.toUpperCase(),
      request.basis.source.id.toUpperCase(),
    ]) {
      expect(
        financeReviewActionTerminalResultSchema.safeParse({
          decision: "consume",
          state: {
            state: "consumed",
            request,
            terminal: { requestId: request.requestId, operationId },
          },
        }).success,
      ).toBe(false);
    }

    const decision = decideFinanceReviewActionTransition({
      current: { state: "open", request },
      desired: reviewCandidate("category_ambiguity"),
      intent: "observe",
    });
    expect(
      issueFinanceReviewAction({
        decision: {
          ...decision,
          desired: {
            ...reviewCandidate("category_ambiguity"),
            basis: {
              ...reviewCandidate("category_ambiguity").basis,
              subject: { kind: "transaction", id: ids.terminal1.toUpperCase() },
            },
          },
        },
        authorityOperationId: ids.authority2,
        requestId: ids.request2,
        retirementOperationId: ids.terminal1,
        actionRevision: "2",
      }),
    ).toEqual({ decision: "rejected", reason: "malformed_input" });

    const valid = issueFinanceReviewAction({
      decision,
      authorityOperationId: ids.authority2,
      requestId: ids.request2,
      retirementOperationId: ids.terminal1,
      actionRevision: "2",
    });
    if (valid.decision !== "issue") throw new Error("Expected replacement issuance.");
    expect(
      financeReviewActionIssueResultSchema.safeParse({
        ...valid,
        request: {
          ...valid.request,
          basis: {
            ...valid.request.basis,
            subject: {
              ...valid.request.basis.subject,
              id:
                valid.previous.state === "withdrawn"
                  ? valid.previous.terminal.operationId.toUpperCase()
                  : ids.terminal1,
            },
          },
        },
      }).success,
    ).toBe(false);
  });

  it("forms a valid SMS clarification command from an issued request", () => {
    const decision = decideFinanceReviewActionTransition({
      current: { state: "absent" },
      desired: reviewCandidate(),
      intent: "observe",
    });
    const issued = issueFinanceReviewAction({
      decision,
      authorityOperationId: ids.authority1,
      requestId: ids.request1,
      retirementOperationId: null,
      actionRevision: "1",
    });
    if (issued.decision !== "issue") throw new Error("Expected initial issuance.");
    expect(
      financeReviewSmsClarifyCommandSchema.safeParse({
        operationId: ids.authority2,
        expectedRequestId: issued.request.requestId,
        work: issued.request.work,
        text: "This was a reimbursable business expense.",
        inboundMessageId: ids.inbound,
        replyBindingId: ids.binding,
      }).success,
    ).toBe(true);
  });

  it("rejects stale terminal operations, malformed terminal identity, and terminal reopening", () => {
    const request = reviewRequest();
    expect(
      finishFinanceReviewAction({
        current: { state: "open", request },
        expectedRequestId: ids.request2,
        operationId: ids.terminal1,
        transition: "consume",
      }),
    ).toEqual({ decision: "rejected", reason: "stale_request" });
    expect(
      finishFinanceReviewAction({
        current: { state: "open", request },
        expectedRequestId: request.requestId,
        operationId: request.requestId,
        transition: "consume",
      }),
    ).toEqual({ decision: "rejected", reason: "malformed_input" });
    expect(
      finishFinanceReviewAction({
        current: { state: "open", request },
        expectedRequestId: request.requestId,
        operationId: request.authorityOperationId,
        transition: "consume",
      }),
    ).toEqual({ decision: "rejected", reason: "request_identity_reused" });
    for (const operationId of [
      request.basis.subject.id.toUpperCase(),
      request.basis.source.id.toUpperCase(),
    ]) {
      expect(
        finishFinanceReviewAction({
          current: { state: "open", request },
          expectedRequestId: request.requestId,
          operationId,
          transition: "consume",
        }),
      ).toEqual({ decision: "rejected", reason: "malformed_input" });
    }
    const consumed = finishFinanceReviewAction({
      current: { state: "open", request },
      expectedRequestId: request.requestId,
      operationId: ids.terminal1,
      transition: "consume",
    });
    expect(consumed).toEqual({
      decision: "consume",
      state: {
        state: "consumed",
        request,
        terminal: { requestId: request.requestId, operationId: ids.terminal1 },
      },
    });
    expect(financeReviewActionTerminalResultSchema.safeParse(consumed).success).toBe(true);
    if (consumed.decision !== "consume") throw new Error("Expected consumption.");
    expect(
      finishFinanceReviewAction({
        current: consumed.state,
        expectedRequestId: request.requestId,
        operationId: ids.operation,
        transition: "withdraw",
      }),
    ).toEqual({ decision: "rejected", reason: "invalid_transition" });
    expect(
      decideFinanceReviewActionTransition({
        current: {
          ...consumed.state,
          terminal: { ...consumed.state.terminal, requestId: ids.request2 },
        },
        desired: reviewCandidate(),
        intent: "observe",
      }),
    ).toEqual({ decision: "rejected", reason: "malformed_input" });
  });

  it("rejects bigint overflow and non-monotonic revisions without number coercion", () => {
    const maximum = reviewRequest(ids.request1, "9223372036854775807");
    const overflowDecision = decideFinanceReviewActionTransition({
      current: { state: "open", request: maximum },
      desired: reviewCandidate("category_ambiguity"),
      intent: "observe",
    });
    expect(
      issueFinanceReviewAction({
        decision: overflowDecision,
        authorityOperationId: ids.authority2,
        requestId: ids.request2,
        retirementOperationId: ids.terminal1,
        actionRevision: "9223372036854775807",
      }),
    ).toEqual({ decision: "rejected", reason: "action_revision_overflow" });

    const firstDecision = decideFinanceReviewActionTransition({
      current: { state: "absent" },
      desired: reviewCandidate(),
      intent: "observe",
    });
    expect(
      issueFinanceReviewAction({
        decision: firstDecision,
        authorityOperationId: ids.authority1,
        requestId: ids.request1,
        retirementOperationId: null,
        actionRevision: "2",
      }),
    ).toEqual({ decision: "rejected", reason: "action_revision_mismatch" });
    expect(
      financeReviewActionRequestSchema.safeParse({
        ...reviewRequest(),
        work: { ...reviewRequest().work, actionRevision: Number.MAX_SAFE_INTEGER },
      }).success,
    ).toBe(false);
  });

  it("fails closed for presentation, evidence, candidate lineage, and unsupported authority", () => {
    const candidate = reviewCandidate();
    for (const malformed of [
      { ...candidate, action: { ...candidate.action, prompt: "What was this for?" } },
      { ...candidate, action: { type: "approval", prompt: "Approve this" } },
      { ...candidate, evidence: { candidateId: ids.operation } },
      { ...candidate, basis: { ...candidate.basis, candidateRevision: "1" } },
      { ...candidate, work: { ...candidate.work, id: ids.transaction } },
      {
        ...candidate,
        basis: {
          ...candidate.basis,
          subject: { ...candidate.basis.subject, id: ids.review.toUpperCase() },
        },
      },
    ]) {
      expect(financeReviewActionCandidateSchema.safeParse(malformed).success).toBe(false);
      expect(
        decideFinanceReviewActionTransition({
          current: { state: "absent" },
          desired: malformed,
          intent: "observe",
        }),
      ).toEqual({ decision: "rejected", reason: "malformed_input" });
    }
  });

  it("keeps legacy work refs compatible while narrowing revision-bound SMS clarification", () => {
    expect(
      financeHumanWorkRefSchema.safeParse({
        id: ids.review,
        domain: "finances",
        kind: "approval",
        revision: "legacy-revision",
        actionRevision: "legacy-action",
      }).success,
    ).toBe(true);
    const command = {
      operationId: ids.operation,
      expectedRequestId: ids.request1,
      work: reviewRequest().work,
      text: "This was a reimbursable business expense.",
      inboundMessageId: ids.inbound,
      replyBindingId: ids.binding,
    };
    expect(financeReviewSmsClarifyCommandSchema.parse(command)).toEqual(command);
    expect(
      financeReviewSmsClarifyCommandSchema.safeParse({
        ...command,
        work: { ...command.work, kind: "approval" },
      }).success,
    ).toBe(false);
    expect(
      financeReviewSmsClarifyCommandSchema.safeParse({ ...command, providerSid: "SM-private" })
        .success,
    ).toBe(false);
    for (const alias of [
      { expectedRequestId: command.operationId.toUpperCase() },
      { inboundMessageId: command.work.id.toUpperCase() },
      { replyBindingId: command.inboundMessageId.toUpperCase() },
    ]) {
      expect(financeReviewSmsClarifyCommandSchema.safeParse({ ...command, ...alias }).success).toBe(
        false,
      );
    }
  });
});
