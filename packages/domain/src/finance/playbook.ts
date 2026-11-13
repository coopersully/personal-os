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

const playbookRubricCheckIdSchema = z.enum([
  "spending_within_income",
  "plan_current",
  "reserve_months",
  "costly_debt",
  "protection",
  "housing_share",
  "retirement_saving",
  "employer_match",
]);
export type FinancePlaybookRubricCheckId = z.infer<typeof playbookRubricCheckIdSchema>;

const playbookRubricCheckSchema = z.object({
  id: playbookRubricCheckIdSchema,
  title: z.string().trim().min(1).max(160),
  measure: z.string().trim().min(1).max(500),
  healthy: z.string().trim().min(1).max(240),
  watch: z.string().trim().min(1).max(240),
  gap: z.string().trim().min(1).max(240),
  /** False when nohmi does not yet record the facts this check needs. */
  assessable: z.boolean(),
  sourceIds: z.array(z.string().trim().min(1).max(120)).max(8),
});

const playbookLedgerRuleSchema = z.object({
  id: z.string().trim().min(1).max(80),
  rule: z.string().trim().min(1).max(600),
});

const playbookReferenceLimitSchema = z.object({
  id: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(240),
  taxYear: z.number().int().min(2024).max(2100).nullable(),
  amount: z.string().trim().min(1).max(120),
  sourceId: z.string().trim().min(1).max(120),
});

export const FINANCE_PLAYBOOK_VERSION = "1.1.0";

export const financePlaybookSchema = z.object({
  id: z.literal("nohmi-finance"),
  version: z.literal(FINANCE_PLAYBOOK_VERSION),
  owner: z.literal("nohmi-finance"),
  status: z.literal("approved"),
  defaultBias: z.literal("healthy_wealth_building"),
  steps: z.array(playbookStepSchema).length(8),
  rubric: z.array(playbookRubricCheckSchema).min(1),
  ledgerRules: z.array(playbookLedgerRuleSchema).min(1),
  alertTiers: z.object({
    principle: z.string().trim().min(1).max(600),
    interrupt: z.array(z.string().trim().min(1).max(300)).min(1),
    digest: z.array(z.string().trim().min(1).max(300)).min(1),
    silent: z.array(z.string().trim().min(1).max(300)).min(1),
  }),
  referenceLimits: z.array(playbookReferenceLimitSchema),
  researchSources: z.array(playbookSourceSchema).min(1),
  webResearchPolicy: z.object({
    useNativeSearchWhen: z.array(z.string().trim().min(1).max(500)).min(1),
    neverClaimResearchWithoutEvidence: z.literal(true),
    prefer: z.array(z.string().trim().min(1).max(240)).min(1),
    record: z.array(z.string().trim().min(1).max(240)).min(1),
  }),
});
export type FinancePlaybook = z.infer<typeof financePlaybookSchema>;

export const financePlaybookRubricResultSchema = z.object({
  id: playbookRubricCheckIdSchema,
  status: z.enum(["healthy", "watch", "gap", "not_assessed"]),
  /** The arithmetic or the missing fact, in plain words. Never advice. */
  detail: z.string().trim().min(1).max(500),
});
export type FinancePlaybookRubricResult = z.infer<typeof financePlaybookRubricResultSchema>;

export const financePlaybookAssessmentSchema = z.object({
  asOf: z.iso.datetime(),
  blockers: z.array(z.string().trim().min(1).max(500)),
  nextActions: z.array(z.string().trim().min(1).max(500)),
  readiness: z.enum(["not_ready", "incomplete", "on_track"]),
  rubric: z.array(financePlaybookRubricResultSchema),
  uncertainty: z.array(z.string().trim().min(1).max(500)),
  playbookVersion: z.literal(FINANCE_PLAYBOOK_VERSION),
});
export type FinancePlaybookAssessment = z.infer<typeof financePlaybookAssessmentSchema>;

export const financePlaybookResponseSchema = z.object({
  assessment: financePlaybookAssessmentSchema,
  playbook: financePlaybookSchema,
});
export type FinancePlaybookResponse = z.infer<typeof financePlaybookResponseSchema>;

export const PERSONAL_OS_FINANCE_PLAYBOOK: FinancePlaybook = {
  id: "nohmi-finance",
  version: FINANCE_PLAYBOOK_VERSION,
  owner: "nohmi-finance",
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
  rubric: [
    {
      id: "spending_within_income",
      title: "Planned spending fits take-home income",
      measure: "Planned monthly spending divided by expected monthly take-home pay.",
      healthy: "At or below 90%.",
      watch: "Above 90% and at or below 100%.",
      gap: "Above 100%.",
      assessable: true,
      sourceIds: ["finhealth-score"],
    },
    {
      id: "plan_current",
      title: "This month has an approved plan",
      measure: "Whether an approved budget version covers the current month.",
      healthy: "Approved for the current month.",
      watch: "Not used.",
      gap: "No approved plan for the current month.",
      assessable: true,
      sourceIds: ["cfp-planning-process"],
    },
    {
      id: "reserve_months",
      title: "Emergency reserves cover the target",
      measure:
        "Liquid reserves divided by planned monthly spending, against the person's reserve target in months (three when none is recorded).",
      healthy: "At or above the target.",
      watch: "At least half the target.",
      gap: "Below half the target.",
      assessable: true,
      sourceIds: ["finhealth-score", "investor-build-wealth"],
    },
    {
      id: "costly_debt",
      title: "No costly debt without a payoff plan",
      measure: "Recorded debts and their verified interest rates.",
      healthy: "No recorded debt at or above 6% APR.",
      watch: "Not used.",
      gap: "At least one recorded debt at or above 6% APR.",
      assessable: true,
      sourceIds: ["fidelity-debt-vs-invest"],
    },
    {
      id: "protection",
      title: "Core insurance is in force",
      measure: "Recorded policies and their status.",
      healthy: "Health coverage is active and no recorded policy has lapsed.",
      watch: "Policies are active but health coverage is not recorded.",
      gap: "A recorded policy is lapsed, cancelled or unknown.",
      assessable: true,
      sourceIds: ["finhealth-score", "cfp-planning-process"],
    },
    {
      id: "housing_share",
      title: "Housing cost is a sustainable share of income",
      measure: "The person's own annual housing cost divided by gross annual income.",
      healthy: "At or below 28%.",
      watch: "Above 28% and at or below 33%.",
      gap: "Above 33%.",
      assessable: true,
      sourceIds: ["cfpb-debt-to-income"],
    },
    {
      id: "retirement_saving",
      title: "Retirement saving rate",
      measure: "Retirement contributions including employer money, divided by gross income.",
      healthy: "At or above 15%.",
      watch: "At least 10%.",
      gap: "Below 10%.",
      assessable: false,
      sourceIds: ["fidelity-retirement-guideline"],
    },
    {
      id: "employer_match",
      title: "Employer match is captured",
      measure: "Whether contributions reach the employer's full match.",
      healthy: "Full match captured.",
      watch: "Partial match captured.",
      gap: "Match available and not captured.",
      assessable: false,
      sourceIds: ["fidelity-debt-vs-invest"],
    },
  ],
  ledgerRules: [
    {
      id: "internal_transfer",
      rule: "Money moving between the person's own accounts is a transfer. Match both sides by ownership, opposite direction, amount and nearby date, and count neither side as income or spending. Equal amounts alone do not prove a transfer; leave an unmatched side unconfirmed.",
    },
    {
      id: "card_payment",
      rule: "A payment to the person's own credit card is a transfer. Spending is recognised when the card purchase happens. Only interest and fees on the card are expenses.",
    },
    {
      id: "refund",
      rule: "A refund reduces spending in the original category. It is never income.",
    },
    {
      id: "reimbursement",
      rule: "When someone repays the person for a shared cost, count only the person's own share as spending. The repayment is never income. Raise a repayment that has not arrived when it is unusually late for that arrangement.",
    },
    {
      id: "roundup_and_sweep",
      rule: "Roundups and automatic savings sweeps are transfers into savings. A roundup description is a clue, not proof; confirm the destination account.",
    },
    {
      id: "savings_contribution",
      rule: "Contributions to retirement, brokerage or savings accounts are saving, not spending.",
    },
    {
      id: "pending",
      rule: "Count pending transactions toward pace and balance forecasts. Do not learn rules from pending rows, and expect the amount or name to change when they post.",
    },
    {
      id: "person_to_person",
      rule: "A person-to-person payment does not establish its own purpose. Use the counterparty's recorded history; otherwise ask.",
    },
    {
      id: "provider_category",
      rule: "A provider category is evidence, not a decision. The person's confirmed merchant rules override it, and a low- or medium-confidence provider category is an open question.",
    },
    {
      id: "protected_preferences",
      rule: "Notes and preferences in the financial profile are standing constraints. Never propose reducing, repurposing or questioning an allocation the person has marked as protected.",
    },
  ],
  alertTiers: {
    principle:
      "Judge unusual against the person's own history, not a fixed amount. Interrupt only when acting now changes the outcome, with one clear question per message. Handle routine bookkeeping without a message.",
    interrupt: [
      "Suspected fraud, an unrecognised merchant, or a duplicate charge.",
      "A projected balance below zero or below the person's buffer before the next paycheck.",
      "A failed automatic payment, or a bill due within three days that is not funded.",
      "An unexpected fee or interest charge.",
      "A charge far above the person's normal for that merchant or category, or more than looks reasonable for the household size.",
      "A paycheck that is missing or materially different from the expected amount.",
    ],
    digest: [
      "A category pacing well ahead of its plan with at least a week left in the month.",
      "A subscription price change, a new recurring charge, or a trial converting to paid.",
      "An expected repayment that has not arrived.",
      "Person-to-person payments that need a purpose.",
    ],
    silent: [
      "Categorisation covered by the person's confirmed rules.",
      "Matched transfers, card payments and roundups.",
      "Pending transactions posting, and refunds matched to their purchase.",
    ],
  },
  referenceLimits: [
    {
      id: "401k-deferral-2026",
      label: "401(k), 403(b), 457 and TSP employee deferral",
      taxYear: 2026,
      amount: "$24,500",
      sourceId: "irs-limits-2026",
    },
    {
      id: "401k-deferral-2027",
      label: "401(k), 403(b), 457 and TSP employee deferral",
      taxYear: 2027,
      amount: "$25,500",
      sourceId: "irs-limits-2027",
    },
    {
      id: "ira-2026",
      label: "IRA contribution limit",
      taxYear: 2026,
      amount: "$7,500",
      sourceId: "irs-limits-2026",
    },
    {
      id: "ira-2027",
      label: "IRA contribution limit",
      taxYear: 2027,
      amount: "$7,500",
      sourceId: "irs-limits-2027",
    },
    {
      id: "roth-ira-phase-out-single-2026",
      label: "Roth IRA income phase-out, single filer",
      taxYear: 2026,
      amount: "$153,000 to $168,000",
      sourceId: "irs-limits-2026",
    },
    {
      id: "roth-ira-phase-out-single-2027",
      label: "Roth IRA income phase-out, single filer",
      taxYear: 2027,
      amount: "$158,000 to $173,000",
      sourceId: "irs-limits-2027",
    },
    {
      id: "fdic-coverage",
      label: "FDIC deposit insurance per depositor, per bank, per ownership category",
      taxYear: null,
      amount: "$250,000",
      sourceId: "fdic-deposit-insurance",
    },
    {
      id: "sipc-coverage",
      label: "SIPC protection per customer, including up to $250,000 cash",
      taxYear: null,
      amount: "$500,000",
      sourceId: "sipc-protection",
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
    {
      id: "cfp-planning-process",
      title: "CFP Board Guide to the 7-Step Financial Planning Process",
      url: "https://www.cfp.net/-/media/files/cfp-board/standards-and-ethics/compliance-resources/guide-to-financial-planning-process.pdf",
      observedAt: "2026-11-13T00:00:00.000Z",
      scope:
        "Understanding circumstances, selecting goals, analysing alternatives, recommending, implementing and monitoring; quantitative and qualitative facts to gather.",
      stability: "stable",
    },
    {
      id: "finhealth-score",
      title: "Financial Health Network FinHealth Score Toolkit",
      url: "https://finhealthnetwork.org/wp-content/uploads/2021/11/FinHealthScoreToolkit-2021.pdf",
      observedAt: "2026-11-13T00:00:00.000Z",
      scope:
        "Eight indicators across spend, save, borrow and plan, including spending against income, liquid savings in months, manageable debt and appropriate insurance.",
      stability: "stable",
    },
    {
      id: "fidelity-debt-vs-invest",
      title: "Fidelity: Should you pay down debt or invest?",
      url: "https://www.fidelity.com/learning-center/personal-finance/pay-down-debt-vs-invest",
      observedAt: "2026-11-13T00:00:00.000Z",
      scope:
        "Order of minimum payments, emergency buffer, employer match, then debt at 6% or higher before further investing; the threshold moves with the investment mix.",
      stability: "time_sensitive",
    },
    {
      id: "fidelity-retirement-guideline",
      title: "Fidelity: How much do I need to retire?",
      url: "https://www.fidelity.com/viewpoints/retirement/how-much-do-i-need-to-retire",
      observedAt: "2026-11-13T00:00:00.000Z",
      scope: "Saving at least 15% of pre-tax income including employer money; age-based multiples.",
      stability: "time_sensitive",
    },
    {
      id: "cfpb-debt-to-income",
      title: "CFPB: What is a debt-to-income ratio?",
      url: "https://www.consumerfinance.gov/ask-cfpb/what-is-a-debt-to-income-ratio-en-1791/",
      observedAt: "2026-11-13T00:00:00.000Z",
      scope:
        "Definition of debt-to-income. The 28% and 33% housing bands used here are lending convention, not a regulator rule.",
      stability: "stable",
    },
    {
      id: "irs-limits-2026",
      title: "IRS: 401(k) limit increases to $24,500 for 2026, IRA limit increases to $7,500",
      url: "https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500",
      observedAt: "2026-11-13T00:00:00.000Z",
      scope: "2026 retirement contribution limits and income phase-outs.",
      stability: "time_sensitive",
    },
    {
      id: "irs-limits-2027",
      title: "IRS: 401(k) limit increases to $25,500 for 2027, IRA limit remains $7,500",
      url: "https://www.irs.gov/newsroom/401k-limit-increases-to-25500-for-2027-ira-limit-remains-7500",
      observedAt: "2026-11-13T00:00:00.000Z",
      scope: "2027 retirement contribution limits and income phase-outs.",
      stability: "time_sensitive",
    },
    {
      id: "fdic-deposit-insurance",
      title: "FDIC: Deposit Insurance at a Glance",
      url: "https://www.fdic.gov/resources/deposit-insurance/brochures/deposits-at-a-glance",
      observedAt: "2026-11-13T00:00:00.000Z",
      scope: "Coverage per depositor, per insured bank, per ownership category.",
      stability: "stable",
    },
    {
      id: "sipc-protection",
      title: "SIPC: What SIPC Protects",
      url: "https://www.sipc.org/for-investors/what-sipc-protects",
      observedAt: "2026-11-13T00:00:00.000Z",
      scope: "Customer protection limits; market losses are not covered.",
      stability: "stable",
    },
    {
      id: "consumer-liability-clocks",
      title: "FTC: Lost or Stolen Credit, ATM, and Debit Cards",
      url: "https://consumer.ftc.gov/articles/lost-or-stolen-credit-atm-and-debit-cards",
      observedAt: "2026-11-13T00:00:00.000Z",
      scope:
        "Liability for unauthorised use grows with reporting delay, which is why suspected fraud interrupts immediately.",
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

export type FinancePlaybookEvidence = {
  /** Spending allocations in the plan that applies to the current month. */
  plannedMonthlySpending?: number | null;
  currentMonthPlanApproved?: boolean | null;
  /** The person's own share of housing cost per month. */
  monthlyHousingCost?: number | null;
  grossAnnualIncome?: number | null;
};

type RubricProfile = NonNullable<Parameters<typeof assessFinancePlaybook>[0]["profile"]> & {
  insurance: Array<{ status: string; kind?: string }>;
};

const DEFAULT_RESERVE_TARGET_MONTHS = 3;
const COSTLY_DEBT_RATE = 6;

function usd(value: number) {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function percent(ratio: number) {
  return `${Math.round(ratio * 100)}%`;
}

function positive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Scores the assessable rubric checks. Reports arithmetic, not advice. */
export function scoreFinancePlaybookRubric(
  profile: RubricProfile | null,
  evidence: FinancePlaybookEvidence,
): FinancePlaybookRubricResult[] {
  const results: FinancePlaybookRubricResult[] = [];
  const add = (
    id: FinancePlaybookRubricCheckId,
    status: FinancePlaybookRubricResult["status"],
    detail: string,
  ) => results.push({ id, status, detail });
  const takeHome = profile?.expectedMonthlyTakeHome;
  const spending = evidence.plannedMonthlySpending;

  if (positive(takeHome) && positive(spending)) {
    const ratio = spending / takeHome;
    add(
      "spending_within_income",
      ratio <= 0.9 ? "healthy" : ratio <= 1 ? "watch" : "gap",
      `Planned spending ${usd(spending)} is ${percent(ratio)} of expected take-home ${usd(takeHome)}.`,
    );
  } else {
    add(
      "spending_within_income",
      "not_assessed",
      "Needs expected monthly take-home and a plan with spending allocations.",
    );
  }

  if (typeof evidence.currentMonthPlanApproved === "boolean") {
    add(
      "plan_current",
      evidence.currentMonthPlanApproved ? "healthy" : "gap",
      evidence.currentMonthPlanApproved
        ? "An approved plan covers the current month."
        : "No approved plan covers the current month.",
    );
  } else {
    add("plan_current", "not_assessed", "The current month's plan state was unavailable.");
  }

  const reserves = profile?.liquidReserves;
  if (typeof reserves === "number" && positive(spending)) {
    const target = profile?.reserveTargetMonths ?? DEFAULT_RESERVE_TARGET_MONTHS;
    const months = reserves / spending;
    const basis =
      profile?.reserveTargetMonths === null || profile?.reserveTargetMonths === undefined
        ? `the default ${DEFAULT_RESERVE_TARGET_MONTHS}-month target (none is recorded)`
        : `the recorded ${target}-month target`;
    add(
      "reserve_months",
      months >= target ? "healthy" : months >= target / 2 ? "watch" : "gap",
      `Liquid reserves ${usd(reserves)} cover ${months.toFixed(1)} months of planned spending against ${basis}.`,
    );
  } else {
    add(
      "reserve_months",
      "not_assessed",
      "Needs liquid reserves and a plan with spending allocations.",
    );
  }

  if (!profile) {
    add("costly_debt", "not_assessed", "No financial profile exists yet.");
  } else if (profile.debts.some((debt) => debt.interestRate === null)) {
    add("costly_debt", "not_assessed", "At least one recorded debt has no verified interest rate.");
  } else {
    const costly = profile.debts.filter((debt) => (debt.interestRate ?? 0) >= COSTLY_DEBT_RATE);
    add(
      "costly_debt",
      costly.length > 0 ? "gap" : "healthy",
      costly.length > 0
        ? `${costly.length} recorded debt(s) at or above ${COSTLY_DEBT_RATE}% APR.`
        : profile.debts.length > 0
          ? `No recorded debt is at or above ${COSTLY_DEBT_RATE}% APR.`
          : "No debt is recorded in the profile.",
    );
  }

  if (!profile || profile.insurance.length === 0) {
    add("protection", "not_assessed", "No insurance policies are recorded.");
  } else if (profile.insurance.some((policy) => policy.status !== "active")) {
    add("protection", "gap", "A recorded policy is lapsed, cancelled or of unknown status.");
  } else {
    const health = profile.insurance.some((policy) => policy.kind === "health");
    add(
      "protection",
      health ? "healthy" : "watch",
      health
        ? "Health coverage is recorded as active and no recorded policy has lapsed."
        : "Recorded policies are active; health coverage is not recorded.",
    );
  }

  if (positive(evidence.monthlyHousingCost) && positive(evidence.grossAnnualIncome)) {
    const ratio = (evidence.monthlyHousingCost * 12) / evidence.grossAnnualIncome;
    add(
      "housing_share",
      ratio <= 0.28 ? "healthy" : ratio <= 0.33 ? "watch" : "gap",
      `Housing ${usd(evidence.monthlyHousingCost)} a month is ${percent(ratio)} of gross income ${usd(evidence.grossAnnualIncome)} a year.`,
    );
  } else {
    add("housing_share", "not_assessed", "Needs monthly housing cost and gross annual income.");
  }

  add(
    "retirement_saving",
    "not_assessed",
    "nohmi does not yet record retirement contributions or employer money.",
  );
  add("employer_match", "not_assessed", "nohmi does not yet record an employer match.");
  return results;
}

export function assessFinancePlaybook(input: {
  now: string;
  profile: {
    expectedMonthlyTakeHome: number | null;
    liquidReserves: number | null;
    incomeStability: "stable" | "variable" | "seasonal" | "unknown";
    reserveTargetMonths: number | null;
    debts: Array<{ balance: number; interestRate: number | null }>;
    insurance: Array<{ status: string; kind?: string }>;
    jurisdiction: string | null;
  } | null;
  /** Optional corroborating facts. A missing fact leaves its check unassessed, never guessed. */
  evidence?: FinancePlaybookEvidence;
}): FinancePlaybookAssessment {
  const blockers: string[] = [];
  const uncertainty: string[] = [];
  const nextActions: string[] = [];
  if (!input.profile)
    blockers.push("Complete the financial profile before relying on personalized priorities.");
  if (!input.profile?.expectedMonthlyTakeHome)
    blockers.push("Verify monthly take-home income and its stability.");
  if (
    input.profile?.liquidReserves === null ||
    input.profile?.liquidReserves === undefined ||
    input.profile.reserveTargetMonths === null ||
    input.profile.incomeStability === "unknown"
  )
    blockers.push(
      "Establish a reserve target from essential outflows and income stability before assessing readiness.",
    );
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
    rubric: scoreFinancePlaybookRubric(input.profile, input.evidence ?? {}),
    uncertainty,
    playbookVersion: PERSONAL_OS_FINANCE_PLAYBOOK.version,
  });
}
