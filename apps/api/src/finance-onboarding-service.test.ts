import { describe, expect, it } from "vitest";
import type { FinanceMutationContext } from "./finance/context.js";
import {
  createFinanceOnboardingService,
  type FinanceOnboardingRead,
  type FinanceOnboardingReceipt,
  type FinanceOnboardingRepository,
} from "./finance-onboarding-service.js";

const context: FinanceMutationContext = {
  actorId: "owner",
  actorType: "user",
  userId: "owner",
  requestId: "request",
  bypassEnabled: false,
  canMutate: true,
  canSelfApprove: false,
};
function fixture() {
  const rows = new Map<string, FinanceOnboardingRead>();
  const receipts = new Map<string, FinanceOnboardingReceipt>();
  let writes = 0;
  let failWrite = false;
  const initial = (): FinanceOnboardingRead => ({
    state: {
      revision: 0,
      completedAt: null,
      answers: [],
      displayPreferencesReviewed: false,
      automationChoice: null,
      updatedAt: null,
    },
    evidence: {
      existingAccess: false,
      source: { state: "usable", summary: "Owned account", recoveryHref: null },
      contextReview: "reviewed",
      questions: [
        {
          questionId: "profile:income",
          label: "Income",
          disposition: "unreviewed",
          answerSummary: null,
          allowsNone: false,
        },
      ],
      displayPreferences: { summary: ["Monthly"] },
      manualVisibility: "auto",
      automation: {
        registrationCount: 0,
        authorizedRegistrationWithCadence: false,
        chatVerification: "pending",
        canSendChat: false,
        historyAvailable: false,
      },
    },
  });
  rows.set("owner", initial());
  rows.set("other", initial());
  const repository: FinanceOnboardingRepository = {
    async read(owner) {
      const row = rows.get(owner);
      if (!row) throw new Error("No owner");
      return structuredClone(row);
    },
    async withOwnerTransaction(ctx, action) {
      if (!rows.has(ctx.userId)) throw new Error("No owner");
      return action({
        read: () => repository.read(ctx.userId),
        async readReceipt(key) {
          return receipts.get(`${ctx.userId}:${key}`) ?? null;
        },
        async write(input) {
          if (failWrite) throw new Error("Storage failed");
          const row = rows.get(ctx.userId);
          if (!row || row.state.revision !== input.expectedRevision) throw new Error("CAS failed");
          writes++;
          rows.set(ctx.userId, { ...row, state: structuredClone(input.state) });
          receipts.set(
            `${ctx.userId}:${input.receipt.idempotencyKey}`,
            structuredClone(input.receipt),
          );
        },
      });
    },
  };
  const service = createFinanceOnboardingService({
    repository,
    now: () => new Date("2026-10-18T12:00:00Z"),
  });
  const save = {
    expectedRevision: 0,
    idempotencyKey: "save",
    answers: [{ questionId: "profile:income", disposition: "unknown" }],
    displayPreferencesReviewed: true,
    automationChoice: "later",
  };
  const row = rows.get("owner");
  if (!row) throw new Error("Missing fixture");
  return {
    service,
    rows,
    row,
    save,
    receipts,
    writes: () => writes,
    failWrite: () => {
      failWrite = true;
    },
  };
}

describe("durable Finance onboarding service", () => {
  it("reads without mutation and saves stable unknown reviews without changing canonical values", async () => {
    const f = fixture();
    expect((await f.service.getFinanceOnboarding("owner")).revision).toBe(0);
    expect(f.writes()).toBe(0);
    const result = await f.service.saveFinanceOnboardingAnswers(f.save, context);
    expect(result.questions[0]).toMatchObject({ disposition: "unknown", answerSummary: null });
    expect(f.rows.get("owner")?.evidence.questions[0]?.disposition).toBe("unreviewed");
    expect(f.rows.get("other")?.state.revision).toBe(0);
    const finished = await f.service.completeFinanceOnboarding(
      { expectedRevision: 1, idempotencyKey: "finish", automationChoice: "later" },
      context,
    );
    expect(finished.completedAt).toBe("2026-10-18T12:00:00.000Z");
  });

  it("replays exact receipts before stale revision checks and rejects changed payloads or actors", async () => {
    const f = fixture();
    const result = await f.service.saveFinanceOnboardingAnswers(f.save, context);
    expect(await f.service.saveFinanceOnboardingAnswers(f.save, context)).toEqual(result);
    expect(f.writes()).toBe(1);
    await expect(
      f.service.saveFinanceOnboardingAnswers({ ...f.save, automationChoice: "now" }, context),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.service.saveFinanceOnboardingAnswers(f.save, { ...context, actorId: "different" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.service.saveFinanceOnboardingAnswers({ ...f.save, idempotencyKey: "fresh" }, context),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.service.saveFinanceOnboardingAnswers(f.save, { ...context, canMutate: false }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it.each([
    { questionId: "forged", disposition: "unknown" },
    { questionId: "profile:income", disposition: "none" },
    { questionId: "profile:income", disposition: "answered" },
  ])("rejects unsupported reviews $disposition for $questionId atomically", async (answer) => {
    const f = fixture();
    await expect(
      f.service.saveFinanceOnboardingAnswers({ ...f.save, answers: [answer] }, context),
    ).rejects.toThrow();
    expect(f.writes()).toBe(0);
    expect(f.receipts.size).toBe(0);
    expect(f.row.state.revision).toBe(0);
  });

  it("accepts canonical answered facts and allowed none without a second profile write", async () => {
    const f = fixture();
    const question = f.row.evidence.questions[0];
    if (!question) throw new Error("Missing question");
    question.disposition = "answered";
    question.answerSummary = "$1000";
    expect(
      (
        await f.service.saveFinanceOnboardingAnswers(
          { ...f.save, answers: [{ questionId: question.questionId, disposition: "answered" }] },
          context,
        )
      ).questions[0]?.answerSummary,
    ).toBe("$1000");
    question.allowsNone = true;
    expect(
      (
        await f.service.saveFinanceOnboardingAnswers(
          {
            ...f.save,
            expectedRevision: 1,
            idempotencyKey: "none",
            answers: [{ questionId: question.questionId, disposition: "none" }],
          },
          context,
        )
      ).questions[0]?.disposition,
    ).toBe("none");
  });

  it("server-validates all essential reviews and registered cadence without requiring Chat verification", async () => {
    const f = fixture();
    await expect(
      f.service.completeFinanceOnboarding(
        { expectedRevision: 0, idempotencyKey: "premature", automationChoice: "later" },
        context,
      ),
    ).rejects.toMatchObject({
      details: { blockers: ["context_review_required", "display_review_required"] },
    });
    await f.service.saveFinanceOnboardingAnswers(f.save, context);
    await expect(
      f.service.completeFinanceOnboarding(
        { expectedRevision: 1, idempotencyKey: "now", automationChoice: "now" },
        context,
      ),
    ).rejects.toMatchObject({ details: { blockers: ["registration_required"] } });
    f.row.evidence.automation.registrationCount = 1;
    f.row.evidence.automation.authorizedRegistrationWithCadence = true;
    const result = await f.service.completeFinanceOnboarding(
      { expectedRevision: 1, idempotencyKey: "now-ready", automationChoice: "now" },
      context,
    );
    expect(result.completedAt).not.toBeNull();
    expect(result.automation.chatVerification).toBe("pending");
    expect(result.automation.canSendChat).toBe(false);
  });

  it("preserves completed and grandfathered access through disconnected source evidence", async () => {
    const f = fixture();
    f.row.evidence.existingAccess = true;
    f.row.evidence.source.state = "missing";
    await f.service.saveFinanceOnboardingAnswers(f.save, context);
    await f.service.completeFinanceOnboarding(
      { expectedRevision: 1, idempotencyKey: "finish", automationChoice: "later" },
      context,
    );
    f.row.evidence.contextReview = "unavailable";
    const result = await f.service.completeFinanceOnboarding(
      { expectedRevision: 2, idempotencyKey: "again", automationChoice: "now" },
      context,
    );
    expect(result.completedAt).toBe("2026-10-18T12:00:00.000Z");
    expect(result.existingAccess).toBe(true);
  });

  it("blocks new completion for unavailable evidence and preserves completed review invariants", async () => {
    const f = fixture();
    await f.service.saveFinanceOnboardingAnswers(f.save, context);
    f.row.evidence.source.state = "unavailable";
    await expect(
      f.service.completeFinanceOnboarding(
        { expectedRevision: 1, idempotencyKey: "unavailable", automationChoice: "later" },
        context,
      ),
    ).rejects.toMatchObject({ details: { blockers: ["source_unavailable"] } });
    f.row.evidence.source.state = "syncing";
    await f.service.completeFinanceOnboarding(
      { expectedRevision: 1, idempotencyKey: "finish", automationChoice: "later" },
      context,
    );
    await expect(
      f.service.saveFinanceOnboardingAnswers(
        {
          ...f.save,
          expectedRevision: 2,
          idempotencyKey: "clear-review",
          displayPreferencesReviewed: false,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await f.service.getFinanceOnboarding("owner")).displayPreferences.reviewed).toBe(true);
  });

  it("scopes identical idempotency keys and revisions to the admitted owner", async () => {
    const f = fixture();
    await f.service.saveFinanceOnboardingAnswers(f.save, context);
    const result = await f.service.saveFinanceOnboardingAnswers(
      { ...f.save, automationChoice: "now" },
      { ...context, userId: "other", actorId: "other" },
    );
    expect(result.automationChoice).toBe("now");
    expect(f.receipts.size).toBe(2);
    expect((await f.service.getFinanceOnboarding("owner")).automationChoice).toBe("later");
  });

  it("requires canonical answered evidence to remain present after a durable answered review", async () => {
    const f = fixture();
    const question = f.row.evidence.questions[0];
    if (!question) throw new Error("Missing question");
    question.disposition = "answered";
    question.answerSummary = "$1000";
    await f.service.saveFinanceOnboardingAnswers(
      { ...f.save, answers: [{ questionId: question.questionId, disposition: "answered" }] },
      context,
    );
    question.disposition = "unknown";
    question.answerSummary = null;
    expect((await f.service.getFinanceOnboarding("owner")).questions[0]?.disposition).toBe(
      "unreviewed",
    );
    await expect(
      f.service.completeFinanceOnboarding(
        { expectedRevision: 1, idempotencyKey: "cleared", automationChoice: "later" },
        context,
      ),
    ).rejects.toMatchObject({ details: { blockers: ["context_review_required"] } });
    expect(f.writes()).toBe(1);
    expect(f.receipts.size).toBe(1);
    question.disposition = "answered";
    question.answerSummary = " ";
    expect((await f.service.getFinanceOnboarding("owner")).questions[0]?.disposition).toBe(
      "unreviewed",
    );
    question.answerSummary = "$1000";
    await f.service.completeFinanceOnboarding(
      { expectedRevision: 1, idempotencyKey: "restored", automationChoice: "later" },
      context,
    );
    question.disposition = "unknown";
    question.answerSummary = null;
    const completed = await f.service.getFinanceOnboarding("owner");
    expect(completed.completedAt).toBe("2026-10-18T12:00:00.000Z");
    expect(completed.questions[0]?.disposition).toBe("unreviewed");
  });

  it("propagates durable write failures without inventing a successful receipt", async () => {
    const f = fixture();
    f.failWrite();
    await expect(f.service.saveFinanceOnboardingAnswers(f.save, context)).rejects.toThrow(
      "Storage failed",
    );
    expect(f.receipts.size).toBe(0);
    expect(f.row.state.revision).toBe(0);
  });
});
