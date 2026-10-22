import type { FinanceOnboardingAdapter } from "@personal-os/domain";
import { api } from "../../api.js";

/** Server receipts only. Application activation is separate from the global setup gate. */
export const financeOnboardingApiAdapter: FinanceOnboardingAdapter = {
  getFinanceOnboarding: () => api.getFinanceOnboarding(),
  saveFinanceOnboardingAnswers: (input) => api.saveFinanceOnboardingAnswers(input),
  completeFinanceOnboarding: (input) => api.completeFinanceOnboarding(input),
};
