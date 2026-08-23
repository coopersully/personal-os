import { type Database, financeCategories, financeSetupSessions } from "@personal-os/database";
import type {
  FinanceProfileVersion,
  FinanceQuestion,
  FinanceSetupInput,
  FinanceSetupPayload,
  FinanceToolResult,
  UpdateFinancialProfileInput,
} from "@personal-os/domain";
import { and, desc, eq, inArray } from "drizzle-orm";
import { AppError } from "../errors.js";
import {
  executeFinanceIdempotently,
  type FinanceMutationContext,
  requireFinanceMutation,
} from "./context.js";
import type { createProfileBudgetService } from "./profile-budget-service.js";

type Options = {
  db: Database;
  now: () => Date;
  planning: ReturnType<typeof createProfileBudgetService>;
};

const questions = {
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
} satisfies Record<string, FinanceQuestion>;

type QuestionId = keyof typeof questions;

function nextQuestion(profile: FinanceProfileVersion | null): FinanceQuestion | null {
  if (!profile?.jurisdiction) return questions["profile:location"];
  if (!profile.householdSize) return questions["profile:household_size"];
  if (profile.expectedMonthlyTakeHome === null) return questions["profile:monthly_take_home"];
  if (profile.liquidReserves === null) return questions["profile:liquid_reserves"];
  return null;
}

function parseMoney(answer: string): number {
  const value = Number(answer.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(value) || value < 0)
    throw new AppError("invalid_request", "Enter a non-negative amount.");
  return Math.round(value * 100) / 100;
}

function jurisdiction(answer: string): string {
  const normalized = answer.toLowerCase();
  if (normalized.includes("new york") || normalized.includes("brooklyn")) return "US-NY";
  if (normalized.includes("california")) return "US-CA";
  if (normalized.includes("texas")) return "US-TX";
  if (normalized.includes("florida")) return "US-FL";
  return answer.trim().slice(0, 120);
}

function profileChange(
  questionId: QuestionId,
  answer: string,
): UpdateFinancialProfileInput["changes"] {
  if (questionId === "profile:location") return { jurisdiction: jurisdiction(answer) };
  if (questionId === "profile:household_size") {
    const value = Number(answer);
    if (!Number.isInteger(value) || value < 1 || value > 100)
      throw new AppError("invalid_request", "Household size must be a positive whole number.");
    return { householdSize: value };
  }
  if (questionId === "profile:monthly_take_home")
    return { expectedMonthlyTakeHome: parseMoney(answer) };
  return { liquidReserves: parseMoney(answer) };
}

function setupResult(input: {
  budgetVersionId: string | null;
  disclosures?: Array<{ importance: "critical" | "important"; message: string }>;
  headline: string;
  maintenanceRunId?: string | null;
  nextAction?: FinanceToolResult<unknown>["nextAction"];
  question?: FinanceQuestion | null;
  sessionId: string;
  stage: FinanceSetupPayload["stage"];
  version: number;
}): FinanceToolResult<FinanceSetupPayload> {
  const payload: FinanceSetupPayload = {
    budgetVersionId: input.budgetVersionId,
    maintenanceRunId: input.maintenanceRunId ?? null,
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
      optionalDetails: [],
      requiredDisclosures: input.disclosures ?? [],
    },
    data: payload,
    ...(input.nextAction ? { nextAction: input.nextAction } : {}),
    outcome: input.question
      ? "user_input_required"
      : input.nextAction
        ? "work_remaining"
        : "completed",
    remainingWork: {
      categories: input.question ? [input.stage] : input.nextAction ? ["maintenance"] : [],
      count: input.question || input.nextAction ? 1 : 0,
    },
    schemaVersion: 1,
  };
}

export function createSetupService({ db, now, planning }: Options) {
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

  async function advance(
    session: typeof financeSetupSessions.$inferSelect,
    currentProfile: FinanceProfileVersion | null,
    context: FinanceMutationContext,
  ) {
    const question = nextQuestion(currentProfile);
    if (question) {
      const [updated] = await db
        .update(financeSetupSessions)
        .set({
          currentQuestionKey: question.id,
          status: "collecting_profile",
          updatedAt: now(),
          version: session.version + 1,
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
    if (!currentProfile?.expectedMonthlyTakeHome)
      throw new AppError("invalid_request", "Monthly take-home income is required for a budget.");
    const [category] = await db
      .insert(financeCategories)
      .values({
        group: "Plan",
        isSystem: true,
        name: "Living expenses",
        slug: "living-expenses",
        userId: context.userId,
      })
      .onConflictDoUpdate({
        set: { updatedAt: now() },
        target: [financeCategories.userId, financeCategories.slug],
      })
      .returning();
    if (!category) throw new AppError("internal_error", "The planning category was not created.");
    const income = currentProfile.expectedMonthlyTakeHome;
    const living = Math.round(income * 0.8 * 100) / 100;
    const savings = Math.round(income * 0.15 * 100) / 100;
    const buffer = Math.round((income - living - savings) * 100) / 100;
    const proposal = await planning.createFinanceBudget(
      {
        allocations: [
          { amount: living, categoryId: category.id, key: "living", kind: "spending" },
          { amount: savings, key: "savings", kind: "savings" },
          { amount: buffer, key: "buffer", kind: "buffer" },
        ],
        assumptions: [
          "Initial allocations are conservative defaults and should be revised as categorized activity becomes reliable.",
          "Unknown income variability, debt, insurance, and fixed obligations remain review items until supported by profile or ledger evidence.",
        ],
        effectiveFrom: now().toISOString().slice(0, 7),
        idempotencyKey: `setup-budget:${session.id}:${session.version}`,
        name: "Initial monthly plan",
        rationale:
          "Provide a balanced starting plan, then refine it from maintained transaction evidence.",
        resources: [{ amount: income, key: "take-home", kind: "income" }],
      },
      context,
    );
    const approvalQuestion: FinanceQuestion = {
      answerType: "approval",
      id: "budget:approval",
      prompt: "Approve this balanced starting budget?",
    };
    const [updated] = await db
      .update(financeSetupSessions)
      .set({
        budgetVersionId: proposal.data.id,
        currentQuestionKey: approvalQuestion.id,
        status: "budget_approval",
        updatedAt: now(),
        version: session.version + 1,
      })
      .where(eq(financeSetupSessions.id, session.id))
      .returning();
    if (!updated) throw new AppError("internal_error", "Finance setup did not save the proposal.");
    return setupResult({
      budgetVersionId: proposal.data.id,
      disclosures: proposal.communication.requiredDisclosures,
      headline: "I created a balanced starting budget proposal.",
      question: approvalQuestion,
      sessionId: updated.id,
      stage: "budget_approval",
      version: updated.version,
    });
  }

  return {
    async setupFinances(
      input: FinanceSetupInput,
      context: FinanceMutationContext,
    ): Promise<FinanceToolResult<FinanceSetupPayload>> {
      requireFinanceMutation(context);
      if (input.operation === "start") {
        let session = await activeSession(context.userId);
        if (!session) {
          const question = nextQuestion(await profile(context.userId));
          const [created] = await db
            .insert(financeSetupSessions)
            .values({
              currentQuestionKey: question?.id ?? null,
              status: question ? "collecting_profile" : "budget_proposal",
              userId: context.userId,
            })
            .returning();
          if (!created) throw new AppError("internal_error", "Finance setup did not start.");
          session = created;
        }
        if (session.status === "budget_approval") {
          return setupResult({
            budgetVersionId: session.budgetVersionId,
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
          return setupResult({
            budgetVersionId: session.budgetVersionId,
            headline: "Your profile and budget are set; maintenance is the next step.",
            nextAction: {
              arguments: { operation: "start", scope: { type: "all_outstanding" } },
              reason: "Categorize, reconcile, and audit current activity.",
              tool: "maintain_finances",
            },
            sessionId: session.id,
            stage: "initial_maintenance",
            version: session.version,
          });
        }
        return advance(session, await profile(context.userId), context);
      }
      if (input.operation === "resume") {
        const session = await db.query.financeSetupSessions.findFirst({
          where: and(
            eq(financeSetupSessions.id, input.sessionId),
            eq(financeSetupSessions.userId, context.userId),
          ),
        });
        if (!session) throw new AppError("not_found", "That Finance setup session was not found.");
        return this.setupFinances({ operation: "start" }, context);
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
          if (input.operation === "answer") {
            if (
              session.status !== "collecting_profile" ||
              session.currentQuestionKey !== input.questionId
            )
              throw new AppError("conflict", "That is not the current Finance setup question.");
            const current = await profile(context.userId);
            const saved = await planning.updateFinancialProfile(
              {
                changes: profileChange(input.questionId as QuestionId, input.answer),
                expectedVersion: current?.version ?? 0,
                idempotencyKey: `${input.idempotencyKey}:profile`,
              },
              context,
            );
            return advance(session, saved.data, context);
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
      );
    },
  };
}
