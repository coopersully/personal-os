import type { FinancePlaybookResponse } from "@personal-os/domain";
import { assessFinancePlaybook, PERSONAL_OS_FINANCE_PLAYBOOK } from "@personal-os/domain";
import type { createFinanceService } from "./finance-service.js";

export function createFinancePlaybookService({
  finances,
  now,
}: {
  finances: ReturnType<typeof createFinanceService>;
  now: () => Date;
}) {
  return {
    async get(userId: string): Promise<FinancePlaybookResponse> {
      const profile = await finances.getFinancialProfile(userId);
      return {
        assessment: assessFinancePlaybook({
          now: now().toISOString(),
          profile: profile.data
            ? {
                ...profile.data,
                reserveTargetMonths: profile.data.preferences.emergencyReserveMonths,
              }
            : null,
        }),
        playbook: PERSONAL_OS_FINANCE_PLAYBOOK,
      };
    },
  };
}
