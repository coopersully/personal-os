/** Stable reviews of canonical financial context; unknown never implies none or zero. */
export type FinanceOnboardingDisposition = "unreviewed" | "answered" | "none" | "unknown";

export interface FinanceOnboardingQuestionReview {
  questionId: string;
  label: string;
  disposition: FinanceOnboardingDisposition;
  answerSummary: string | null;
  allowsNone: boolean;
}

/** A durable server snapshot, independent of unrelated financial-profile revisions. */
export interface FinanceOnboardingSnapshot {
  revision: number;
  completedAt: string | null;
  existingAccess: boolean;
  source: {
    state: "usable" | "syncing" | "missing" | "ownership_required" | "unavailable";
    summary: string;
    recoveryHref: string | null;
  };
  contextReview: "reviewed" | "needs_review" | "unavailable";
  questions: FinanceOnboardingQuestionReview[];
  displayPreferences: { reviewed: boolean; summary: string[] };
  automationChoice: "later" | "now" | null;
  manualVisibility: "auto" | "show" | "hide";
  automation: {
    registrationCount: number;
    authorizedRegistrationWithCadence: boolean;
    chatVerification: "pending" | "verified" | "unavailable";
    canSendChat: boolean;
    historyAvailable: boolean;
  };
}

export interface FinanceOnboardingSaveInput {
  expectedRevision: number;
  idempotencyKey: string;
  answers: Array<{
    questionId: string;
    disposition: Exclude<FinanceOnboardingDisposition, "unreviewed">;
  }>;
  displayPreferencesReviewed: boolean;
  automationChoice: "later" | "now";
}

export interface FinanceOnboardingCompleteInput {
  expectedRevision: number;
  idempotencyKey: string;
  automationChoice: "later" | "now";
}

/** Implementations persist review receipts, while financial values retain their canonical owner. */
export interface FinanceOnboardingAdapter {
  getFinanceOnboarding(): Promise<FinanceOnboardingSnapshot>;
  saveFinanceOnboardingAnswers(
    input: FinanceOnboardingSaveInput,
  ): Promise<FinanceOnboardingSnapshot>;
  completeFinanceOnboarding(
    input: FinanceOnboardingCompleteInput,
  ): Promise<FinanceOnboardingSnapshot>;
}

export type FinanceOnboardingBlocker =
  | "source_required"
  | "ownership_required"
  | "source_unavailable"
  | "context_review_required"
  | "context_unavailable"
  | "display_review_required"
  | "automation_choice_required"
  | "registration_required";

/** Presentation readiness only; this projection grants no mutation or Chat authority. */
export function deriveFinanceOnboardingReadiness(snapshot: FinanceOnboardingSnapshot): {
  workspaceAccessible: boolean;
  canComplete: boolean;
  blockers: FinanceOnboardingBlocker[];
  chat: {
    canSend: boolean;
    historyReadable: boolean;
    reason: null | "verification_required" | "connection_unavailable";
  };
  manualCreationVisible: boolean;
} {
  const completed = snapshot.completedAt !== null;
  const blockers: FinanceOnboardingBlocker[] = [];
  if (!completed) {
    if (!snapshot.existingAccess) {
      switch (snapshot.source.state) {
        case "missing":
          blockers.push("source_required");
          break;
        case "ownership_required":
          blockers.push("ownership_required");
          break;
        case "unavailable":
          blockers.push("source_unavailable");
          break;
      }
    }
    if (snapshot.contextReview === "unavailable") {
      blockers.push("context_unavailable");
    } else if (
      snapshot.contextReview !== "reviewed" ||
      snapshot.questions.some(
        (question) =>
          question.disposition === "unreviewed" ||
          (question.disposition === "none" && !question.allowsNone),
      )
    ) {
      blockers.push("context_review_required");
    }
    if (!snapshot.displayPreferences.reviewed) blockers.push("display_review_required");
    if (snapshot.automationChoice === null) {
      blockers.push("automation_choice_required");
    } else if (
      snapshot.automationChoice === "now" &&
      !(
        snapshot.automation.registrationCount > 0 &&
        snapshot.automation.authorizedRegistrationWithCadence
      )
    ) {
      blockers.push("registration_required");
    }
  }

  const verified = snapshot.automation.chatVerification === "verified";
  const canSend =
    snapshot.automation.registrationCount > 0 && verified && snapshot.automation.canSendChat;
  return {
    workspaceAccessible: completed || snapshot.existingAccess,
    canComplete: !completed && blockers.length === 0,
    blockers,
    chat: {
      canSend,
      historyReadable: snapshot.automation.historyAvailable,
      reason: canSend ? null : verified ? "connection_unavailable" : "verification_required",
    },
    manualCreationVisible:
      snapshot.manualVisibility === "show" ||
      (snapshot.manualVisibility === "auto" && snapshot.automation.registrationCount <= 0),
  };
}
