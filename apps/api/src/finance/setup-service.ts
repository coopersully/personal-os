import { createHash } from "node:crypto";
import {
  type Database,
  financeCategories,
  financeMaintenanceRuns,
  financeSetupSessions,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import type {
  FinanceInteractionQuestion,
  FinanceProfileVersion,
  FinanceSetupInput,
  FinanceSetupPayload,
  FinanceToolResult,
  UpdateFinancialProfileInput,
} from "@personal-os/domain";
import {
  financeSetupPlanningSchema,
  financeWorkflowUnavailableSchema,
  financialProfileChangesSchema,
  NOHMI_FINANCE_PLAYBOOK,
  nextFinancePlanningQuestion,
} from "@personal-os/domain";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import {
  executeFinanceIdempotently,
  type FinanceMutationContext,
  requireFinanceMutation,
} from "./context.js";
import { createProfileBudgetService } from "./profile-budget-service.js";

type FinanceTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Options = {
  executor?: FinanceTransaction;
  db: Database;
  now: () => Date;
  planning: ReturnType<typeof createProfileBudgetService>;
};

const questions = {
  "profile:income_stability": {
    answerType: "income_stability",
    id: "profile:income_stability",
    prompt: "Is your income stable, variable, seasonal, or unknown?",
  },
  "profile:debts": {
    answerType: "debts",
    id: "profile:debts",
    prompt: "Which debts and minimum monthly payments should this plan consider?",
  },
  "profile:buffer_target": {
    answerType: "currency",
    id: "profile:buffer_target",
    prompt:
      "How much monthly buffer would you like to plan for? Enter zero if you do not want one.",
  },
  "profile:household_size": {
    answerType: "positive_integer",
    id: "profile:household_size",
    prompt: "How many people are in your financial household, including you?",
  },
  "profile:liquid_reserves": {
    answerType: "currency",
    id: "profile:liquid_reserves",
    prompt: "About how much do you currently have in liquid cash reserves?",
  },
  "profile:location": {
    answerType: "location",
    id: "profile:location",
    prompt: "Where do you live for tax and cost-of-living purposes?",
  },
  "profile:monthly_take_home": {
    answerType: "currency",
    id: "profile:monthly_take_home",
    prompt: "What is your expected monthly take-home income?",
  },
} satisfies Record<string, FinanceInteractionQuestion>;

function nextQuestion(
  profile: FinanceProfileVersion | null,
  skipped: Array<{ questionId: string; profileVersion: number }> = [],
): FinanceInteractionQuestion | null {
  const version = profile?.version ?? 0;
  const isSkipped = (id: string) =>
    skipped.some((entry) => entry.questionId === id && entry.profileVersion === version);
  const missing = [
    ["profile:location", !profile?.jurisdiction],
    ["profile:household_size", profile?.householdSize == null],
    ["profile:monthly_take_home", profile?.expectedMonthlyTakeHome == null],
    ["profile:liquid_reserves", profile?.liquidReserves == null],
    ["profile:income_stability", !profile?.provenance.incomeStability],
    ["profile:debts", !profile?.provenance.debts],
    ["profile:buffer_target", profile?.preferences.bufferTarget == null],
  ] as const;
  for (const [key, absent] of missing) if (absent && !isSkipped(key)) return questions[key];
  const question = nextFinancePlanningQuestion(
    financeSetupPlanningSchema.parse(profile?.planning ?? {}),
    skipped.filter((entry) => entry.questionId.startsWith("planning:")) as Parameters<
      typeof nextFinancePlanningQuestion
    >[1],
    version,
  );
  return question ? { ...question, answerType: question.id } : null;
}

export function parseSetupMoney(answer: string): number {
  const normalized = answer.trim();
  if (!/^\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(normalized))
    throw new AppError(
      "invalid_request",
      "Enter a non-negative amount with at most two decimal places.",
    );
  const [whole = "0", fraction = ""] = normalized.replace(/[$,]/g, "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 10_000_000_000)
    throw new AppError("invalid_request", "Enter an amount no greater than 100,000,000.");
  return cents / 100;
}

export function parseSetupJurisdiction(answer: string): string {
  const normalized = answer.toLowerCase();
  if (normalized.includes("new york") || normalized.includes("brooklyn")) return "US-NY";
  if (normalized.includes("california")) return "US-CA";
  if (normalized.includes("texas")) return "US-TX";
  if (normalized.includes("florida")) return "US-FL";
  return answer.trim().slice(0, 120);
}

function parseStructuredAnswer(answer: string): unknown {
  try {
    return JSON.parse(answer);
  } catch {
    throw new AppError("invalid_request", "Check the structured setup answer.");
  }
}

export function setupProfileChange(
  questionId: string,
  answer: string,
  current?: FinanceProfileVersion | null,
  source?: import("@personal-os/domain").FinanceProvenance,
): UpdateFinancialProfileInput["changes"] {
  if (questionId.startsWith("planning:")) {
    const key = questionId.slice("planning:".length);
    if (
      ![
        "recurringIncome",
        "uncertainIncome",
        "exceptionalResources",
        "obligations",
        "contributions",
        "priorities",
      ].includes(key)
    )
      throw new AppError("invalid_request", "Unknown planning question.");
    const value: unknown = parseStructuredAnswer(answer);
    const sourced = Array.isArray(value)
      ? value.map((item) => ({ ...item, ...(source ? { provenance: source } : {}) }))
      : value && typeof value === "object"
        ? { ...value, ...(source ? { provenance: source } : {}) }
        : value;
    return {
      planning: financeSetupPlanningSchema.parse({
        ...financeSetupPlanningSchema.parse(current?.planning ?? {}),
        [key]: sourced,
      }),
    };
  }
  if (questionId === "profile:income_stability")
    return financialProfileChangesSchema.parse({ incomeStability: answer.trim().toLowerCase() });
  if (questionId === "profile:debts")
    return financialProfileChangesSchema.parse({ debts: parseStructuredAnswer(answer) });
  if (questionId === "profile:buffer_target")
    return {
      preferences: {
        debtPriority: null,
        emergencyReserveMonths: null,
        notes: [],
        ...current?.preferences,
        bufferTarget: parseSetupMoney(answer),
      },
    };
  if (questionId === "profile:location") return { jurisdiction: parseSetupJurisdiction(answer) };
  if (questionId === "profile:household_size") {
    const value = Number(answer);
    if (!Number.isInteger(value) || value < 1 || value > 100)
      throw new AppError("invalid_request", "Household size must be a positive whole number.");
    return { householdSize: value };
  }
  if (questionId === "profile:monthly_take_home") {
    const value = parseSetupMoney(answer);
    return { expectedMonthlyTakeHome: value };
  }
  if (questionId === "profile:liquid_reserves") return { liquidReserves: parseSetupMoney(answer) };
  throw new AppError("invalid_request", "Unknown setup question.");
}

export function setupResult(input: {
  budgetVersionId: string | null;
  profileVersionId?: string | null;
  disclosures?: Array<{ importance: "critical" | "important"; message: string }>;
  headline: string;
  maintenanceRunId?: string | null;
  canonicalMaintenanceRunId?: string | null;
  nextAction?: FinanceToolResult<unknown>["nextAction"];
  optionalDetails?: string[];
  question?: FinanceInteractionQuestion | null;
  sessionId: string;
  stage: FinanceSetupPayload["stage"];
  version: number;
}): FinanceToolResult<FinanceSetupPayload> {
  const payload: FinanceSetupPayload = {
    budgetVersionId: input.budgetVersionId,
    profileVersionId: input.profileVersionId ?? null,
    position: financeWorkflowUnavailableSchema.parse({
      state: "unavailable",
      reasonCode: "producer_not_registered",
      retryable: false,
    }),
    maintenanceRunId: input.maintenanceRunId ?? null,
    canonicalMaintenanceRunId: input.canonicalMaintenanceRunId ?? null,
    question: input.question ?? null,
    sessionId: input.sessionId,
    stage: input.stage,
    version: input.version,
  };
  return {
    changes: [],
    communication: {
      headline: input.headline,
      ...(input.question ? { nextQuestion: input.question } : {}),
      optionalDetails: [
        `Priorities follow approved nohmi Finance playbook ${NOHMI_FINANCE_PLAYBOOK.version}: cash-flow stability, resilience, risk protection, costly debt, retirement, diversified investing, and a sustainable good life.`,
        ...(input.optionalDetails ?? []),
      ],
      requiredDisclosures: input.disclosures ?? [],
    },
    data: payload,
    ...(input.nextAction ? { nextAction: input.nextAction } : {}),
    outcome: input.question
      ? "user_input_required"
      : input.nextAction
        ? "work_remaining"
        : input.stage === "budget_proposal"
          ? "work_remaining"
          : "completed",
    remainingWork: {
      categories: input.question
        ? [input.stage]
        : input.nextAction
          ? ["maintenance"]
          : input.stage === "budget_proposal"
            ? ["qualified_position"]
            : [],
      count: input.question || input.nextAction || input.stage === "budget_proposal" ? 1 : 0,
    },
    schemaVersion: 1,
  };
}

export function createSetupService({ db, now, planning, executor }: Options) {
  async function profile(userId: string) {
    return (await planning.getFinancialProfile(userId)).data;
  }

  async function activeSession(userId: string) {
    return db.query.financeSetupSessions.findFirst({
      orderBy: [desc(financeSetupSessions.updatedAt)],
      where: and(
        eq(financeSetupSessions.userId, userId),
        inArray(financeSetupSessions.status, [
          "collecting_profile",
          "budget_proposal",
          "budget_approval",
          "initial_maintenance",
        ]),
      ),
    });
  }

  async function latestSettledSession(userId: string) {
    return db.query.financeSetupSessions.findFirst({
      orderBy: [desc(financeSetupSessions.updatedAt)],
      where: and(
        eq(financeSetupSessions.userId, userId),
        eq(financeSetupSessions.status, "settled"),
      ),
    });
  }

  async function advance(
    session: typeof financeSetupSessions.$inferSelect,
    currentProfile: FinanceProfileVersion | null,
    context: FinanceMutationContext,
  ) {
    const question = nextQuestion(currentProfile, session.skippedQuestions);
    if (question) {
      const [updated] = await db
        .update(financeSetupSessions)
        .set({
          currentQuestionKey: question.id,
          questionProfileVersionId: currentProfile?.id ?? null,
          status: "collecting_profile",
          updatedAt: now(),
          version:
            session.currentQuestionKey === question.id &&
            session.questionProfileVersionId === (currentProfile?.id ?? null)
              ? session.version
              : session.version + 1,
        })
        .where(eq(financeSetupSessions.id, session.id))
        .returning();
      if (!updated) throw new AppError("internal_error", "Finance setup did not advance.");
      return setupResult({
        budgetVersionId: updated.budgetVersionId,
        headline: "I need one answer to continue your financial setup.",
        question,
        sessionId: updated.id,
        stage: "collecting_profile",
        version: updated.version,
      });
    }
    const existing = (await planning.getFinanceBudget(context.userId)).data;
    if (
      session.budgetVersionId &&
      existing?.id === session.budgetVersionId &&
      existing.profileVersionId === (currentProfile?.id ?? null)
    )
      return setupResult({
        budgetVersionId: existing.id,
        profileVersionId: existing.profileVersionId,
        headline: "Your first plan is saved. Missing evidence remains explicit.",
        stage: "budget_proposal",
        sessionId: session.id,
        version: session.version,
        disclosures: [
          {
            importance: "important",
            message:
              "Qualified financial position is unavailable. This incomplete plan is not available cash and cannot be activated.",
          },
        ],
      });
    const inputs = financeSetupPlanningSchema.parse(currentProfile?.planning ?? {});
    const allocations: import("@personal-os/domain").FinanceBudgetAllocation[] = [];
    const assumptions = [
      "Qualified position is unavailable: producer_not_registered. Available cash is unknown.",
      "Uncertain income and one-time resources are excluded from recurring funding. Planned contributions are not actual funding.",
    ];
    const spending = async (
      item: { id: string; name: string; amountCents: number | null },
      categoryId?: string | null,
    ) => {
      if (item.amountCents === null) {
        assumptions.push(`${item.name}: amount unknown.`);
        return;
      }
      if (!categoryId) {
        const [category] = await db
          .insert(financeCategories)
          .values({
            group: "Plan",
            isSystem: true,
            name: item.name,
            slug: `setup-${item.id}`,
            userId: context.userId,
          })
          .onConflictDoUpdate({
            set: { updatedAt: now() },
            target: [financeCategories.userId, financeCategories.slug],
          })
          .returning();
        if (!category)
          throw new AppError("internal_error", "The planning category was not created.");
        categoryId = category.id;
      }
      allocations.push({
        amount: item.amountCents / 100,
        categoryId,
        key: item.id,
        kind: "spending",
        description: item.name,
      });
    };
    for (const item of inputs.obligations ?? []) {
      if (item.debtAccountId && item.amountCents !== null)
        allocations.push({
          amount: item.amountCents / 100,
          accountId: item.debtAccountId,
          key: item.id,
          kind: "debt",
          description: item.name,
        });
      else await spending(item);
    }
    for (const debt of currentProfile?.debts ?? []) {
      const matched = inputs.obligations?.some(
        (item) =>
          item.amountCents !== null &&
          (debt.accountId
            ? item.debtAccountId === debt.accountId
            : item.name.trim().toLowerCase() === debt.name.trim().toLowerCase()),
      );
      if (matched) continue;
      const key = `debt-${debt.accountId ?? createHash("sha256").update(debt.name.trim().toLowerCase()).digest("hex").slice(0, 32)}`;
      if (debt.accountId)
        allocations.push({
          key,
          kind: "debt",
          accountId: debt.accountId,
          amount: debt.minimumMonthlyPayment,
          description: debt.name,
        });
      else
        await spending({
          id: key,
          name: debt.name,
          amountCents: Math.round(debt.minimumMonthlyPayment * 100),
        });
      assumptions.push(
        `${debt.name}: minimum reused from the current profile; confirm payment timing.`,
      );
    }
    for (const item of inputs.priorities ?? [])
      await spending(
        { ...item, name: item.protected ? `${item.name} (protected)` : item.name },
        item.categoryId,
      );
    for (const item of inputs.contributions ?? []) {
      if (item.amountCents === null)
        assumptions.push(`${item.name}: planned contribution unknown.`);
      else
        allocations.push({
          amount: item.amountCents / 100,
          goalId: item.goalId,
          key: item.id,
          kind: "goal",
          description: item.name,
        });
    }
    if (currentProfile?.preferences.bufferTarget != null)
      allocations.push({
        key: "chosen-buffer",
        amount: currentProfile.preferences.bufferTarget,
        kind: "buffer",
      });
    for (const key of [
      "recurringIncome",
      "uncertainIncome",
      "exceptionalResources",
      "obligations",
      "contributions",
      "priorities",
    ] as const)
      if (inputs[key] === null)
        assumptions.push(`${key}: unknown; skipping did not confirm an amount or absence.`);
    const proposal = await planning.createFinanceBudget(
      {
        status: "incomplete",
        allocations,
        assumptions:
          assumptions.length <= 100
            ? assumptions
            : [
                ...assumptions.slice(0, 99),
                `${assumptions.length - 99} further unknowns remain in the financial profile. Review all planning facts before completing the plan.`,
              ],
        effectiveFrom: now().toISOString().slice(0, 7),
        idempotencyKey: `setup-budget:${session.id}:${session.version}`,
        name: "First monthly plan",
        rationale:
          "Stated obligations, priorities and planned contributions, with missing evidence kept explicit.",
        resources:
          inputs.recurringIncome?.amountCents == null
            ? []
            : [
                {
                  amount: inputs.recurringIncome.amountCents / 100,
                  key: "recurring-floor",
                  kind: "income",
                },
              ],
      },
      context,
    );
    const [updated] = await db
      .update(financeSetupSessions)
      .set({
        budgetVersionId: proposal.data.id,
        proposalProfileVersionId: currentProfile?.id ?? null,
        currentQuestionKey: null,
        status: "budget_proposal",
        updatedAt: now(),
        version: session.version + 1,
      })
      .where(eq(financeSetupSessions.id, session.id))
      .returning();
    if (!updated)
      throw new AppError("internal_error", "Finance setup did not save the first plan.");
    return setupResult({
      budgetVersionId: proposal.data.id,
      profileVersionId: currentProfile?.id ?? null,
      headline: "Your first plan is saved with its unfunded needs and unknowns.",
      disclosures: proposal.communication.requiredDisclosures,
      sessionId: session.id,
      stage: "budget_proposal",
      version: updated.version,
    });
  }

  async function continueSession(
    session: typeof financeSetupSessions.$inferSelect,
    context: FinanceMutationContext,
  ): Promise<FinanceToolResult<FinanceSetupPayload>> {
    // An old terminal protocol run never establishes canonical setup completion.
    if (session.status === "settled" && !session.canonicalMaintenanceRunId) {
      const recovered = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`finance-maintenance:${context.userId}`}, 0))`,
        );
        const current = await tx.query.financeSetupSessions.findFirst({
          where: and(
            eq(financeSetupSessions.id, session.id),
            eq(financeSetupSessions.userId, context.userId),
          ),
        });
        if (!current) throw new AppError("not_found", "That Finance setup session was not found.");
        if (current.status !== "settled" || current.canonicalMaintenanceRunId) return current;
        const active = await tx.query.financeSetupSessions.findFirst({
          where: and(
            eq(financeSetupSessions.userId, context.userId),
            inArray(financeSetupSessions.status, [
              "collecting_profile",
              "budget_proposal",
              "budget_approval",
              "initial_maintenance",
            ]),
          ),
        });
        if (active) return active;
        const [updated] = await tx
          .update(financeSetupSessions)
          .set({ status: "initial_maintenance", updatedAt: now(), version: current.version + 1 })
          .where(
            and(
              eq(financeSetupSessions.id, current.id),
              eq(financeSetupSessions.version, current.version),
            ),
          )
          .returning();
        if (!updated)
          throw new AppError(
            "conflict",
            "Financial setup changed. Resume saved progress to continue.",
          );
        return updated;
      });
      return continueSession(recovered, context);
    }
    if (session.status === "budget_approval" || session.status === "budget_proposal") {
      const currentProfile = await profile(context.userId);
      if (session.proposalProfileVersionId !== (currentProfile?.id ?? null))
        return advance(session, currentProfile, context);
      // The same plan can be revised or approved through the portal or MCP.
      // Reconcile saved setup progress with that canonical decision on resume.
      const currentBudget = (await planning.getFinanceBudget(context.userId)).data;
      if (
        currentBudget &&
        (currentBudget.id !== session.budgetVersionId || currentBudget.status === "active")
      ) {
        if (currentBudget.status === "incomplete") return advance(session, currentProfile, context);
        if (currentBudget.profileVersionId !== (currentProfile?.id ?? null))
          return advance(session, currentProfile, context);
        if (currentBudget.status !== "proposed" && currentBudget.status !== "active")
          throw new AppError(
            "conflict",
            "Create a current proposal in Plan, then resume financial setup.",
          );
        const [updated] = await db
          .update(financeSetupSessions)
          .set({
            budgetVersionId: currentBudget.id,
            proposalProfileVersionId: currentProfile?.id ?? null,
            currentQuestionKey: currentBudget.status === "active" ? null : "budget:approval",
            status: currentBudget.status === "active" ? "initial_maintenance" : "budget_approval",
            updatedAt: now(),
            version: session.version + 1,
          })
          .where(
            and(
              eq(financeSetupSessions.id, session.id),
              eq(financeSetupSessions.version, session.version),
            ),
          )
          .returning();
        if (!updated)
          throw new AppError(
            "conflict",
            "Financial setup changed. Resume saved progress to continue.",
          );
        return continueSession(updated, context);
      }
      if (session.status === "budget_proposal") return advance(session, currentProfile, context);
      return setupResult({
        budgetVersionId: session.budgetVersionId,
        profileVersionId: currentProfile?.id ?? null,
        headline: "Your balanced budget proposal is ready for approval.",
        question: {
          answerType: "approval",
          id: "budget:approval",
          prompt: "Approve this balanced starting budget?",
        },
        sessionId: session.id,
        stage: "budget_approval",
        version: session.version,
      });
    }
    if (session.status === "initial_maintenance") {
      const legacy = session.maintenanceRunId
        ? await db.query.financeMaintenanceRuns.findFirst({
            where: and(
              eq(financeMaintenanceRuns.id, session.maintenanceRunId),
              eq(financeMaintenanceRuns.userId, context.userId),
            ),
          })
        : null;
      const canonicalRunId = session.canonicalMaintenanceRunId ?? legacy?.canonicalRunId ?? null;
      const canonical = canonicalRunId
        ? await db.query.workspaceMaintenanceRuns.findFirst({
            where: and(
              eq(workspaceMaintenanceRuns.id, canonicalRunId),
              eq(workspaceMaintenanceRuns.userId, context.userId),
              eq(workspaceMaintenanceRuns.domain, "finances"),
            ),
          })
        : null;
      const resumeId = canonical
        ? ["completed", "completed_with_questions", "failed_terminal"].includes(canonical.status)
          ? null
          : canonical.id
        : legacy &&
            !["settled", "failed"].includes(legacy.stage) &&
            legacy.recovery?.state !== "blocked"
          ? legacy.id
          : null;
      return setupResult({
        budgetVersionId: session.budgetVersionId,
        maintenanceRunId: session.maintenanceRunId,
        canonicalMaintenanceRunId: canonicalRunId,
        headline: "Your profile and budget are set; maintenance is the next step.",
        nextAction: {
          arguments: resumeId
            ? { operation: "resume", runId: resumeId }
            : { operation: "start", scope: { type: "all_outstanding" } },
          reason:
            "Prepare and challenge current evidence, then verify the approved result and period review.",
          tool: "maintain_finances",
        },
        sessionId: session.id,
        stage: "initial_maintenance",
        version: session.version,
      });
    }
    if (session.status === "settled") {
      return setupResult({
        budgetVersionId: session.budgetVersionId,
        headline: "Your Finance setup session is complete.",
        maintenanceRunId: session.maintenanceRunId,
        canonicalMaintenanceRunId: session.canonicalMaintenanceRunId,
        sessionId: session.id,
        stage: "settled",
        version: session.version,
      });
    }
    return advance(session, await profile(context.userId), context);
  }

  return {
    async setupFinances(
      input: FinanceSetupInput,
      context: FinanceMutationContext,
    ): Promise<FinanceToolResult<FinanceSetupPayload>> {
      requireFinanceMutation(context);
      if (!executor)
        return db.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`finance-profile:${context.userId}`}, 0))`,
          );
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`finance-setup:${context.userId}`}, 0))`,
          );
          return createSetupService({
            db: tx as unknown as Database,
            now,
            executor: tx,
            planning: createProfileBudgetService({
              db: tx as unknown as Database,
              now,
              executor: tx,
            }),
          }).setupFinances(input, context);
        });
      if (input.operation === "start") {
        let session = await activeSession(context.userId);
        session ??= await latestSettledSession(context.userId);
        if (!session) {
          const question = nextQuestion(await profile(context.userId));
          const [created] = await db
            .insert(financeSetupSessions)
            .values({
              currentQuestionKey: question?.id ?? null,
              status: question ? "collecting_profile" : "budget_proposal",
              userId: context.userId,
            })
            .onConflictDoNothing()
            .returning();
          session = created ?? (await activeSession(context.userId));
          if (!session) throw new AppError("internal_error", "Finance setup did not start.");
        }
        return continueSession(session, context);
      }
      if (input.operation === "resume") {
        const session = await db.query.financeSetupSessions.findFirst({
          where: and(
            eq(financeSetupSessions.id, input.sessionId),
            eq(financeSetupSessions.userId, context.userId),
          ),
        });
        if (!session) throw new AppError("not_found", "That Finance setup session was not found.");
        return continueSession(session, context);
      }
      return executeFinanceIdempotently(
        db,
        context,
        {
          idempotencyKey: input.idempotencyKey,
          operation: `setup_finances:${input.operation}`,
          payload: input,
        },
        async () => {
          const session = await db.query.financeSetupSessions.findFirst({
            where: and(
              eq(financeSetupSessions.id, input.sessionId),
              eq(financeSetupSessions.userId, context.userId),
            ),
          });
          if (!session)
            throw new AppError("not_found", "That Finance setup session was not found.");
          if (session.version !== input.expectedVersion)
            throw new AppError(
              "conflict",
              `Finance setup is at version ${session.version}; resume it before continuing.`,
            );
          if (input.operation === "answer" || input.operation === "skip") {
            if (
              session.status !== "collecting_profile" ||
              session.currentQuestionKey !== input.questionId
            )
              throw new AppError("conflict", "That is not the current Finance setup question.");
            const current = await profile(context.userId);
            if (session.questionProfileVersionId !== (current?.id ?? null))
              throw new AppError(
                "conflict",
                "Your financial profile changed. Resume setup before answering.",
              );
            if (input.operation === "skip") {
              const skippedQuestions = [
                ...session.skippedQuestions.filter(
                  (entry) => entry.questionId !== input.questionId,
                ),
                { questionId: input.questionId, profileVersion: current?.version ?? 0 },
              ];
              const [updated] = await db
                .update(financeSetupSessions)
                .set({ skippedQuestions, version: session.version + 1, updatedAt: now() })
                .where(eq(financeSetupSessions.id, session.id))
                .returning();
              if (!updated) throw new AppError("conflict", "Setup changed.");
              return advance(updated, current, context);
            }
            const saved = await planning.updateFinancialProfile(
              {
                changes: setupProfileChange(input.questionId, input.answer, current, {
                  actorId: context.actorId,
                  actorType: context.actorType,
                  confidence: 1,
                  evidence: { sessionId: session.id, questionId: input.questionId },
                  maintenanceRunId: null,
                  observedAt: now().toISOString(),
                  requestId: context.requestId,
                  sourceId: session.id,
                }),
                expectedVersion: current?.version ?? 0,
                idempotencyKey: `${input.idempotencyKey}:profile`,
              },
              context,
              {
                sourceId: session.id,
                evidence: { sessionId: session.id, questionId: input.questionId },
              },
            );
            const skippedQuestions = session.skippedQuestions
              .filter((entry) => entry.profileVersion === (current?.version ?? 0))
              .map((entry) => ({ ...entry, profileVersion: saved.data.version }));
            const [updated] = await db
              .update(financeSetupSessions)
              .set({ skippedQuestions })
              .where(eq(financeSetupSessions.id, session.id))
              .returning();
            if (!updated) throw new AppError("conflict", "Setup changed.");
            return advance(updated, saved.data, context);
          }
          if (
            session.status !== "budget_approval" ||
            session.budgetVersionId !== input.budgetVersionId
          )
            throw new AppError(
              "conflict",
              "That budget is not awaiting approval in this setup session.",
            );
          const budget = await planning.getFinanceBudget(context.userId);
          if (!budget.data || budget.data.id !== input.budgetVersionId)
            throw new AppError("conflict", "Reload the current budget proposal before approving.");
          const approved = await planning.approveFinanceBudget(
            {
              approvalSource: input.approvalSource,
              budgetVersionId: input.budgetVersionId,
              expectedVersion: budget.data.version,
              expectedProfileVersionId: input.expectedProfileVersionId,
              idempotencyKey: `${input.idempotencyKey}:budget`,
            },
            context,
          );
          const [updated] = await db
            .update(financeSetupSessions)
            .set({
              currentQuestionKey: null,
              status: "initial_maintenance",
              updatedAt: now(),
              version: session.version + 1,
            })
            .where(eq(financeSetupSessions.id, session.id))
            .returning();
          if (!updated)
            throw new AppError("internal_error", "Finance setup did not advance to maintenance.");
          return setupResult({
            budgetVersionId: approved.data.id,
            disclosures: approved.communication.requiredDisclosures,
            headline: "Your financial profile and active budget are ready.",
            nextAction: {
              arguments: { operation: "start", scope: { type: "all_outstanding" } },
              reason: "Categorize, reconcile, and red-team audit current activity.",
              tool: "maintain_finances",
            },
            sessionId: updated.id,
            stage: "initial_maintenance",
            version: updated.version,
          });
        },
        executor,
      );
    },
  };
}
