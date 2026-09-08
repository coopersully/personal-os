import type { FinancePlaybookResponse } from "@personal-os/domain";
import { assessFinancePlaybook, ILO_FINANCE_PLAYBOOK } from "@personal-os/domain";
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
        playbook: ILO_FINANCE_PLAYBOOK,
      };
    },
  };
}
