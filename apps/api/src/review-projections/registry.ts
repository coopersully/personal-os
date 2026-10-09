import type { Database } from "@personal-os/database";
import {
  type AgentAccessDomain,
  type AgentAccessWorkItem,
  type AgentAccessWorkItemKind,
  agentAccessDomains,
} from "@personal-os/domain";
import { projectCalendarWork } from "../calendar-review-projection.js";
import { createFinanceWorkReaders, projectFinanceWork } from "../finance/work-item-projection.js";
import { createMailReviewReaders, projectMailWork } from "../mail-review-projection.js";
import { projectTaskWork } from "../task-review-projection.js";
import type { ProjectionInput, ReviewProjection, SourceKey, SourceReaders } from "./contract.js";
import { createSharedProjectionReaders } from "./helpers.js";

export const sourceImpact: Record<
  SourceKey,
  { domains: AgentAccessDomain[]; kinds: AgentAccessWorkItemKind[] }
> = {
  accounts: { domains: ["mail", "calendar"], kinds: ["attention"] },
  attention: {
    domains: [...agentAccessDomains],
    kinds: ["attention"],
  },
  financeEffects: { domains: ["finances"], kinds: ["review"] },
  financeAccounts: { domains: ["finances"], kinds: ["review"] },
  financeActions: { domains: ["finances"], kinds: ["review"] },
  financeContextual: { domains: ["finances"], kinds: ["review"] },
  financeReviews: { domains: ["finances"], kinds: ["review"] },
  mailQuestions: { domains: ["mail"], kinds: ["review"] },
  mailRules: { domains: ["mail"], kinds: ["review"] },
  mailRuns: { domains: ["mail"], kinds: ["review"] },
  profiles: {
    domains: [...agentAccessDomains],
    kinds: ["review"],
  },
};

const projections: Record<AgentAccessDomain, ReviewProjection> = {
  mail: projectMailWork,
  finances: projectFinanceWork,
  calendar: projectCalendarWork,
  tasks: projectTaskWork,
};

export function buildSourceReaders(db: Database, limit?: number): SourceReaders {
  const shared = createSharedProjectionReaders(db, limit);
  const finance = createFinanceWorkReaders(db, limit);
  const mail = createMailReviewReaders(db, limit);
  // Stable identities and order preserve overrides and partial-source failure reporting.
  return {
    accounts: shared.accounts,
    attention: shared.attention,
    financeEffects: finance.financeEffects,
    financeAccounts: finance.financeAccounts,
    financeActions: finance.financeActions,
    financeContextual: finance.financeContextual,
    financeReviews: finance.financeReviews,
    mailRules: mail.mailRules,
    mailQuestions: mail.mailQuestions,
    mailRuns: mail.mailRuns,
    profiles: shared.profiles,
  };
}

export function projectItems(
  input: ProjectionInput & { accessibleDomains: Set<AgentAccessDomain> },
): AgentAccessWorkItem[] {
  return [...input.accessibleDomains]
    .flatMap((domain) => projections[domain](input))
    // Domain providers cannot widen the caller's readable workspaces.
    .filter((item) => input.accessibleDomains.has(item.domain));
}
