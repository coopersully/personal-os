import {
  type Database,
  financeAccounts,
  financeAgentActionReviews,
  financeReviewCases,
  financeTransactions,
} from "@personal-os/database";
import type { AgentAccessWorkItem } from "@personal-os/domain";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import type { ProjectionInput, SourceReaders } from "../review-projections/contract.js";
import {
  humanize,
  isRecord,
  projectAttention,
  workPreview,
} from "../review-projections/helpers.js";
import { readFinanceContextualWork } from "./contextual-question-projection.js";
import { readFinanceEffectWork } from "./review-effect-projection.js";
import { readProjectionRows } from "./search-projection-bounds.js";

export function createFinanceWorkReaders(
  db: Database,
  limit?: number,
): Pick<
  SourceReaders,
  "financeEffects" | "financeAccounts" | "financeActions" | "financeContextual" | "financeReviews"
> {
  return {
    financeEffects: (input) => readFinanceEffectWork(db, input, limit),
    financeAccounts: async ({ snapshotAt, userId }) =>
      readProjectionRows(
        db
          .select()
          .from(financeAccounts)
          .where(
            and(
              eq(financeAccounts.userId, userId),
              or(
                eq(financeAccounts.syncRecovery, "reconnect"),
                and(
                  eq(financeAccounts.status, "needs_reauth"),
                  isNull(financeAccounts.syncRecovery),
                ),
              ),
              lte(financeAccounts.updatedAt, snapshotAt),
            ),
          ),
        limit,
      ),
    financeActions: async ({ snapshotAt, userId }) =>
      readProjectionRows(
        db
          .select()
          .from(financeAgentActionReviews)
          .where(
            and(
              eq(financeAgentActionReviews.userId, userId),
              eq(financeAgentActionReviews.status, "pending"),
              lte(financeAgentActionReviews.updatedAt, snapshotAt),
            ),
          ),
        limit,
      ),
    financeContextual: (input) => readFinanceContextualWork(db, input, limit),
    financeReviews: async ({ snapshotAt, userId }) => {
      const rows = await readProjectionRows(
        db
          .select({ review: financeReviewCases, transaction: financeTransactions })
          .from(financeReviewCases)
          .leftJoin(
            financeTransactions,
            and(
              eq(financeTransactions.id, financeReviewCases.transactionId),
              eq(financeTransactions.userId, userId),
            ),
          )
          .where(
            and(
              eq(financeReviewCases.userId, userId),
              or(eq(financeReviewCases.status, "open"), eq(financeReviewCases.status, "deferred")),
              lte(financeReviewCases.updatedAt, snapshotAt),
            ),
          ),
        limit,
      );
      return rows.map(({ review, transaction }) => ({ ...review, transaction }));
    },
  };
}

export function projectFinanceWork({ results, includePreview }: ProjectionInput): AgentAccessWorkItem[] {
  const items = projectAttention("finances", "Finances", "/finances", { results, includePreview });
  items.push(...(results.financeEffects ?? []));
  items.push(...(results.financeContextual ?? []));
  for (const review of results.financeReviews ?? []) {
    items.push({
      action: {
        label: "Open Finance review",
        to: review.economicEventId
          ? `/finances/review?item=${review.id}`
          : `/finances/review/legacy?item=${review.id}`,
      },
      actionAt: null,
      domain: "finances",
      id: `finance-review:${review.id}`,
      kind: "review",
      priority: "person_review",
      source: null,
      summary:
        review.resolution?.type === "clarify" || typeof review.evidence.clarification === "string"
          ? "A note is saved for maintenance. This Finance decision remains open."
          : "A Finance decision needs signed-in judgment; nohmi will not guess.",
      ...(includePreview
        ? {
            preview: workPreview([
              [
                "Transaction",
                review.transaction
                  ? `${review.transaction.merchant} · ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(review.transaction.amount / 100)} ${review.transaction.currencyCode ?? "(currency not recorded)"} · ${review.transaction.transactionDate}`
                  : null,
              ],
              ["Decision", humanize(review.economicEventId ? review.reasonCode : review.reason)],
              ["Why it needs review", review.rationale],
              [
                "Your note",
                review.resolution?.type === "clarify"
                  ? review.resolution.clarification
                  : review.evidence.clarification,
              ],
            ]),
          }
        : {}),
      title: "Review a Finance decision",
      updatedAt: review.updatedAt.toISOString(),
    });
  }
  for (const review of results.financeActions ?? []) {
    const question = review.actionKind === "question";
    items.push({
      action: {
        label: question ? "Answer Finance question" : "Review Finance approval",
        to: `/finances/review?${question ? "question" : "approval"}=${review.id}`,
      },
      actionAt: null,
      domain: "finances",
      id: `finance-action:${review.id}`,
      kind: "review",
      priority: "person_review",
      source: null,
      summary: question
        ? "A Finance question needs your judgment. Open its current evidence before answering."
        : "A proposed Finance change needs signed-in approval of its current evidence.",
      ...(includePreview
        ? {
            preview: workPreview([
              [
                question ? "Question" : "Proposed change",
                question
                  ? isRecord(review.privatePayload.question)
                    ? review.privatePayload.question.prompt
                    : null
                  : review.safeChanges
                      .map((change) => (typeof change.summary === "string" ? change.summary : ""))
                      .filter(Boolean)
                      .join("; "),
              ],
              ["Reason", review.privatePayload.rationale],
              ["Change type", humanize(review.actionKind)],
            ]),
          }
        : {}),
      title: question ? "Answer a Finance question" : "Approve a Finance change",
      updatedAt: review.updatedAt.toISOString(),
    });
  }
  for (const account of results.financeAccounts ?? []) {
    items.push({
      action: {
        label: "Inspect Finance account",
        to: `/finances/accounts#account-${account.id}`,
      },
      actionAt: null,
      domain: "finances",
      id: `finance-reconnect:${account.id}`,
      kind: "review",
      priority: "blocked",
      source: null,
      summary:
        "This Finance source needs renewed authorization before synchronization can continue.",
      ...(includePreview
        ? {
            preview: workPreview([
              ["Account", account.name],
              ["Institution", account.institution],
            ]),
          }
        : {}),
      title: "Reconnect a Finance account",
      updatedAt: account.updatedAt.toISOString(),
    });
  }
  for (const profile of results.profiles ?? []) {
    if (profile.domain !== "finances") continue;
    items.push({
      action: { label: "Review guidance", to: "/settings?section=finances#guidance" },
      actionAt: null,
      domain: "finances",
      id: `profile:${profile.id}:${profile.version}`,
      kind: "review",
      priority: "person_review",
      source: null,
      summary: profile.summary,
      title: "Review Finances guidance",
      updatedAt: profile.updatedAt.toISOString(),
    });
  }
  return items;
}
