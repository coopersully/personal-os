import { describe, expect, it } from "vitest";
import {
  deriveFinanceOnboardingReadiness,
  type FinanceOnboardingSnapshot,
} from "./onboarding-readiness.js";

function ready(): FinanceOnboardingSnapshot {
  return {
    revision: 4,
    completedAt: null,
    existingAccess: false,
    source: { state: "usable", summary: "Owned account", recoveryHref: null },
    contextReview: "reviewed",
    questions: [
      {
        questionId: "income",
        label: "Income",
        disposition: "unknown",
        answerSummary: null,
        allowsNone: false,
      },
    ],
    displayPreferences: { reviewed: true, summary: [] },
    automationChoice: "later",
    manualVisibility: "auto",
    automation: {
      registrationCount: 0,
      authorizedRegistrationWithCadence: false,
      chatVerification: "pending",
      canSendChat: false,
      historyAvailable: false,
    },
  };
}

describe("Finance onboarding readiness", () => {
  it.each([
    "usable",
    "syncing",
  ] as const)("allows manual-later completion with %s source and explicit unknown, without granting access early", (state) => {
    const snapshot = ready();
    snapshot.source.state = state;
    const before = structuredClone(snapshot);
    expect(deriveFinanceOnboardingReadiness(snapshot)).toEqual({
      workspaceAccessible: false,
      canComplete: true,
      blockers: [],
      chat: { canSend: false, historyReadable: false, reason: "verification_required" },
      manualCreationVisible: true,
    });
    expect(snapshot).toEqual(before);
  });

  it.each([
    ["missing", "source_required"],
    ["ownership_required", "ownership_required"],
    ["unavailable", "source_unavailable"],
  ] as const)("keeps source %s distinct", (state, blocker) => {
    const snapshot = ready();
    snapshot.source.state = state;
    expect(deriveFinanceOnboardingReadiness(snapshot)).toMatchObject({
      canComplete: false,
      blockers: [blocker],
    });
    snapshot.existingAccess = true;
    expect(deriveFinanceOnboardingReadiness(snapshot)).toMatchObject({
      workspaceAccessible: true,
      canComplete: true,
      blockers: [],
    });
  });

  it("requires context, permitted question dispositions, display review, and an explicit choice", () => {
    const snapshot = ready();
    snapshot.contextReview = "needs_review";
    snapshot.displayPreferences.reviewed = false;
    snapshot.automationChoice = null;
    expect(deriveFinanceOnboardingReadiness(snapshot).blockers).toEqual([
      "context_review_required",
      "display_review_required",
      "automation_choice_required",
    ]);
    snapshot.contextReview = "unavailable";
    expect(deriveFinanceOnboardingReadiness(snapshot).blockers[0]).toBe("context_unavailable");
    snapshot.contextReview = "reviewed";
    const question = snapshot.questions[0];
    if (!question) throw new Error("Missing question fixture");
    question.disposition = "unreviewed";
    expect(deriveFinanceOnboardingReadiness(snapshot).blockers[0]).toBe("context_review_required");
    question.disposition = "none";
    expect(deriveFinanceOnboardingReadiness(snapshot).blockers[0]).toBe("context_review_required");
    question.allowsNone = true;
    expect(deriveFinanceOnboardingReadiness(snapshot).blockers).not.toContain(
      "context_review_required",
    );
    question.disposition = "answered";
    expect(deriveFinanceOnboardingReadiness(snapshot).blockers).not.toContain(
      "context_review_required",
    );
  });

  it("allows automated completion before verification only with real authorized registration and cadence", () => {
    const snapshot = ready();
    snapshot.automationChoice = "now";
    snapshot.automation.authorizedRegistrationWithCadence = true;
    expect(deriveFinanceOnboardingReadiness(snapshot).blockers).toEqual(["registration_required"]);
    snapshot.automation.registrationCount = 1;
    snapshot.automation.authorizedRegistrationWithCadence = false;
    expect(deriveFinanceOnboardingReadiness(snapshot).canComplete).toBe(false);
    snapshot.automation.authorizedRegistrationWithCadence = true;
    snapshot.automation.canSendChat = true;
    expect(deriveFinanceOnboardingReadiness(snapshot)).toMatchObject({
      canComplete: true,
      chat: { canSend: false, reason: "verification_required" },
      manualCreationVisible: false,
    });
  });

  it("preserves completion and readable history through lost sources, reviews, and registration", () => {
    const snapshot = ready();
    snapshot.completedAt = "2026-10-18T12:00:00Z";
    snapshot.source.state = "unavailable";
    snapshot.contextReview = "unavailable";
    snapshot.displayPreferences.reviewed = false;
    snapshot.automationChoice = "now";
    snapshot.automation.chatVerification = "verified";
    snapshot.automation.canSendChat = true;
    snapshot.automation.historyAvailable = true;
    expect(deriveFinanceOnboardingReadiness(snapshot)).toEqual({
      workspaceAccessible: true,
      canComplete: false,
      blockers: [],
      chat: { canSend: false, historyReadable: true, reason: "connection_unavailable" },
      manualCreationVisible: true,
    });
  });

  it("requires verified, currently send-capable registration for Chat", () => {
    const snapshot = ready();
    snapshot.automation.registrationCount = 1;
    snapshot.automation.chatVerification = "unavailable";
    snapshot.automation.canSendChat = true;
    expect(deriveFinanceOnboardingReadiness(snapshot).chat.reason).toBe("verification_required");
    snapshot.automation.chatVerification = "verified";
    expect(deriveFinanceOnboardingReadiness(snapshot).chat).toMatchObject({
      canSend: true,
      reason: null,
    });
    snapshot.automation.canSendChat = false;
    expect(deriveFinanceOnboardingReadiness(snapshot).chat).toMatchObject({
      canSend: false,
      reason: "connection_unavailable",
    });
    expect(deriveFinanceOnboardingReadiness(snapshot).manualCreationVisible).toBe(false);
  });

  it.each([
    0, 1,
  ])("honors explicit Show and Hide independently of registration count %s", (count) => {
    const snapshot = ready();
    snapshot.automation.registrationCount = count;
    snapshot.manualVisibility = "show";
    expect(deriveFinanceOnboardingReadiness(snapshot).manualCreationVisible).toBe(true);
    snapshot.manualVisibility = "hide";
    expect(deriveFinanceOnboardingReadiness(snapshot).manualCreationVisible).toBe(false);
  });
});
