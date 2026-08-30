import { z } from "zod";

const playbookSourceSchema = z.object({
  id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(240),
  url: z.url(),
  observedAt: z.iso.datetime(),
  scope: z.string().trim().min(1).max(500),
  stability: z.enum(["stable", "time_sensitive"]),
});
export type FinancePlaybookSource = z.infer<typeof playbookSourceSchema>;

const playbookStepSchema = z.object({
  id: z.string().trim().min(1).max(80),
  rank: z.number().int().positive(),
  title: z.string().trim().min(1).max(160),
  why: z.string().trim().min(1).max(1_000),
  actions: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
});

export const financePlaybookSchema = z.object({
  id: z.literal("ilo-finance"),
  version: z.literal("1.0.0"),
  owner: z.literal("ilo-finance"),
  status: z.literal("approved"),
  defaultBias: z.literal("healthy_wealth_building"),
  steps: z.array(playbookStepSchema).length(8),
  researchSources: z.array(playbookSourceSchema).min(1),
  webResearchPolicy: z.object({
    useNativeSearchWhen: z.array(z.string().trim().min(1).max(500)).min(1),
    neverClaimResearchWithoutEvidence: z.literal(true),
    prefer: z.array(z.string().trim().min(1).max(240)).min(1),
    record: z.array(z.string().trim().min(1).max(240)).min(1),
  }),
});
export type FinancePlaybook = z.infer<typeof financePlaybookSchema>;

export const financePlaybookAssessmentSchema = z.object({
  asOf: z.iso.datetime(),
  blockers: z.array(z.string().trim().min(1).max(500)),
  nextActions: z.array(z.string().trim().min(1).max(500)),
  readiness: z.enum(["not_ready", "incomplete", "on_track"]),
  uncertainty: z.array(z.string().trim().min(1).max(500)),
  playbookVersion: z.literal("1.0.0"),
});
export type FinancePlaybookAssessment = z.infer<typeof financePlaybookAssessmentSchema>;

export const financePlaybookResponseSchema = z.object({
  assessment: financePlaybookAssessmentSchema,
  playbook: financePlaybookSchema,
});
export type FinancePlaybookResponse = z.infer<typeof financePlaybookResponseSchema>;

export const ILO_FINANCE_PLAYBOOK: FinancePlaybook = {
  id: "ilo-finance",
  version: "1.0.0",
  owner: "ilo-finance",
  status: "approved",
  defaultBias: "healthy_wealth_building",
  steps: [
    {
      id: "cash_flow",
      rank: 1,
      title: "Stabilize cash flow",
      why: "A plan cannot compound if ordinary bills do not clear.",
      actions: [
        "Verify recurring income and essential outflows.",
        "Keep the monthly plan balanced and observable.",
      ],
    },
    {
      id: "reserve",
      rank: 2,
      title: "Build emergency reserves",
      why: "Liquidity prevents routine shocks from becoming expensive debt or forced sales.",
      actions: [
        "Set a reserve floor from essential outflows and income stability.",
        "Hold near-term reserves in appropriate cash or short-duration vehicles.",
      ],
    },
    {
      id: "taxes",
      rank: 3,
      title: "Reserve for tax obligations",
      why: "Known tax liabilities are real obligations, not investable surplus.",
      actions: [
        "Separate estimated taxes and withholding gaps from discretionary cash.",
        "Refresh jurisdiction-specific rules before using a current limit or deadline.",
      ],
    },
    {
      id: "risk",
      rank: 4,
      title: "Close insurance and risk gaps",
      why: "A catastrophic loss can dominate years of investment returns.",
      actions: [
        "Check health, disability, life, property, and liability coverage against dependents and earning power.",
        "Escalate regulated or coverage-specific conclusions to a qualified professional.",
      ],
    },
    {
      id: "debt",
      rank: 5,
      title: "Remove costly debt",
      why: "High-cost interest is a reliable drag and can exceed uncertain investment returns.",
      actions: [
        "Pay required minimums first.",
        "Prioritize high-cost balances unless a documented constraint changes the order.",
      ],
    },
    {
      id: "retirement",
      rank: 6,
      title: "Capture retirement advantages",
      why: "Employer matches and tax-advantaged capacity are valuable, subject to current rules.",
      actions: [
        "Capture available employer match when cash stability permits.",
        "Verify current contribution limits and eligibility before recommending a numeric maximum.",
      ],
    },
    {
      id: "invest",
      rank: 7,
      title: "Invest diversified long-term surplus",
      why: "Long-horizon wealth benefits from regular, low-cost, diversified exposure matched to capacity and horizon.",
      actions: [
        "Assign money to goals by horizon before selecting investments.",
        "Control fees, concentration, taxes, and unnecessary trading.",
      ],
    },
    {
      id: "life",
      rank: 8,
      title: "Protect a sustainable good life",
      why: "A plan is successful when it funds resilience and meaningful life, not only a larger balance.",
      actions: [
        "Reserve room for flexible spending and valued goals.",
        "Review when facts or goals change, not merely because markets moved.",
      ],
    },
  ],
  researchSources: [
    {
      id: "investor-build-wealth",
      title: "Build Wealth Over Time Through Saving and Investing",
      url: "https://www.investor.gov/build-wealth-over-time-through-saving-and-investing",
      observedAt: "2026-08-30T00:00:00.000Z",
      scope:
        "Emergency savings, high-interest debt, regular investing, retirement accounts, diversification, and fraud warnings.",
      stability: "stable",
    },
    {
      id: "irs-retirement-contributions",
      title: "IRS Retirement Topics: Contributions",
      url: "https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-topics-contributions",
      observedAt: "2026-08-30T00:00:00.000Z",
      scope:
        "Contribution limits and plan rules are time-sensitive and must be rechecked for the applicable tax year.",
      stability: "time_sensitive",
    },
    {
      id: "cfp-standards",
      title: "CFP Board Code of Ethics and Standards of Conduct",
      url: "https://www.cfp.net/ethics/code-of-ethics-and-standards-of-conduct",
      observedAt: "2026-08-30T00:00:00.000Z",
      scope:
        "Client-first care, prudence, diligence, disclosure, implementation, monitoring, and updating.",
      stability: "stable",
    },
  ],
  webResearchPolicy: {
    useNativeSearchWhen: [
      "A recommendation depends on current tax law, contribution limits, deadlines, rates, insurance rules, or product facts.",
      "The user's jurisdiction or situation makes a stable rule insufficient.",
      "The agent needs direct quotes, links, or precise current source attribution.",
    ],
    neverClaimResearchWithoutEvidence: true,
    prefer: [
      "Primary government and regulator sources",
      "The user's plan documents and authenticated account evidence",
    ],
    record: [
      "Source identity and URL",
      "Research date, scope, and whether the fact is stable or time-sensitive",
    ],
  },
};

export function assessFinancePlaybook(input: {
  now: string;
  profile: {
    expectedMonthlyTakeHome: number | null;
    liquidReserves: number | null;
    debts: Array<{ balance: number; interestRate: number | null }>;
    insurance: Array<{ status: string }>;
    jurisdiction: string | null;
  } | null;
  wealth: { debt: number; investments: number; netWorth: number } | null;
}): FinancePlaybookAssessment {
  const blockers: string[] = [];
  const uncertainty: string[] = [];
  const nextActions: string[] = [];
  if (!input.profile)
    blockers.push("Complete the financial profile before relying on personalized priorities.");
  if (!input.profile?.expectedMonthlyTakeHome)
    blockers.push("Verify monthly take-home income and its stability.");
  if (input.profile?.liquidReserves === null || input.profile?.liquidReserves === undefined)
    blockers.push("Establish a reserve target from essential outflows and income stability.");
  if (!input.profile?.jurisdiction)
    uncertainty.push(
      "Tax obligations and retirement rules cannot be assessed without jurisdiction.",
    );
  if (input.profile?.debts.some((debt) => debt.interestRate === null))
    uncertainty.push(
      "At least one debt lacks a verified interest rate; debt ordering is provisional.",
    );
  if (
    !input.profile?.insurance.length ||
    input.profile.insurance.some((policy) => policy.status !== "active")
  )
    blockers.push("Review insurance and risk coverage before treating surplus as investable.");
  if (input.profile?.debts.some((debt) => (debt.interestRate ?? 0) >= 15))
    nextActions.push("Prioritize verified high-cost debt after required minimums.");
  nextActions.push(
    "Capture available employer retirement match once cash flow and required reserves are sound.",
    "Invest remaining long-term surplus in a diversified, low-cost, tax-aware way matched to horizon and risk capacity.",
  );
  return financePlaybookAssessmentSchema.parse({
    asOf: input.now,
    blockers,
    nextActions,
    readiness: blockers.length === 0 ? "on_track" : input.profile ? "incomplete" : "not_ready",
    uncertainty,
    playbookVersion: ILO_FINANCE_PLAYBOOK.version,
  });
}
