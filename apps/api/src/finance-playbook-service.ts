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
      const [profile, wealth] = await Promise.all([
        finances.getFinancialProfile(userId),
        finances.getWealthSummary(userId),
      ]);
      return {
        assessment: assessFinancePlaybook({
          now: now().toISOString(),
          profile: profile.data,
          wealth,
        }),
        playbook: ILO_FINANCE_PLAYBOOK,
      };
    },
  };
}
