import type { FinanceOnboardingSnapshot } from "@personal-os/domain";
import { createFinanceApi, type FinanceRequest } from "./finances.js";

const snapshot: FinanceOnboardingSnapshot = {
  revision: 0,
  completedAt: null,
  existingAccess: false,
  source: { state: "missing", summary: "Add a source", recoveryHref: null },
  contextReview: "reviewed",
  questions: [],
  displayPreferences: { reviewed: false, summary: [] },
  automationChoice: null,
  manualVisibility: "auto",
  automation: {
    registrationCount: 0,
    authorizedRegistrationWithCadence: false,
    chatVerification: "pending",
    canSendChat: false,
    historyAvailable: true,
  },
};
it("uses owner-free durable setup endpoints and validates every response", async () => {
  const request = vi.fn().mockResolvedValue(snapshot);
  const api = createFinanceApi(request as unknown as FinanceRequest);
  await expect(api.getFinanceOnboarding()).resolves.toEqual(snapshot);
  const save = {
    expectedRevision: 0,
    idempotencyKey: "save",
    answers: [{ questionId: "income", disposition: "unknown" as const }],
    displayPreferencesReviewed: true,
    automationChoice: "later" as const,
  };
  await api.saveFinanceOnboardingAnswers(save);
  const finish = {
    expectedRevision: 1,
    idempotencyKey: "finish",
    automationChoice: "later" as const,
  };
  await api.completeFinanceOnboarding(finish);
  expect(request.mock.calls).toEqual([
    ["/v1/finances/onboarding"],
    ["/v1/finances/onboarding/answers", { method: "POST", body: JSON.stringify(save) }],
    ["/v1/finances/onboarding/complete", { method: "POST", body: JSON.stringify(finish) }],
  ]);
  request.mockResolvedValue({ completedAt: "pretend" });
  await expect(api.getFinanceOnboarding()).rejects.toThrow();
  await expect(api.saveFinanceOnboardingAnswers(save)).rejects.toThrow();
  await expect(api.completeFinanceOnboarding(finish)).rejects.toThrow();
});
