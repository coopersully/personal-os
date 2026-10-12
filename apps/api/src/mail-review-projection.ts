import {
  type Database,
  mailRules,
  mailStewardshipQuestions,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import type { AgentAccessWorkItem } from "@personal-os/domain";
import { and, eq, lte } from "drizzle-orm";
import { readProjectionRows } from "./finance/search-projection-bounds.js";
import type { ProjectionInput, SourceReaders } from "./review-projections/contract.js";
import {
  humanize,
  projectAttention,
  projectReconnect,
  workPreview,
} from "./review-projections/helpers.js";

export function createMailReviewReaders(
  db: Database,
  limit?: number,
): Pick<SourceReaders, "mailRules" | "mailQuestions" | "mailRuns"> {
  return {
    mailRules: async ({ snapshotAt, userId }) =>
      readProjectionRows(
        db
          .select()
          .from(mailRules)
          .where(
            and(
              eq(mailRules.userId, userId),
              eq(mailRules.enabled, false),
              lte(mailRules.updatedAt, snapshotAt),
            ),
          ),
        limit,
      ),
    mailQuestions: async ({ snapshotAt, userId }) =>
      readProjectionRows(
        db
          .select()
          .from(mailStewardshipQuestions)
          .where(
            and(
              eq(mailStewardshipQuestions.userId, userId),
              eq(mailStewardshipQuestions.status, "open"),
              lte(mailStewardshipQuestions.updatedAt, snapshotAt),
            ),
          ),
        limit,
      ),
    mailRuns: async ({ snapshotAt, userId }) =>
      readProjectionRows(
        db
          .select()
          .from(workspaceMaintenanceRuns)
          .where(
            and(
              eq(workspaceMaintenanceRuns.userId, userId),
              eq(workspaceMaintenanceRuns.domain, "mail"),
              lte(workspaceMaintenanceRuns.updatedAt, snapshotAt),
            ),
          ),
        limit,
      ),
  };
}

export function projectMailWork({
  results,
  includePreview,
}: ProjectionInput): AgentAccessWorkItem[] {
  const items = projectAttention("mail", "Mail", "/mail", { results, includePreview });
  const representedRun = (results.mailRuns ?? []).toSorted(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  )[0];
  const representedOpenQuestions = (results.mailQuestions ?? []).filter(
    (question) =>
      representedRun && question.updatedAt.getTime() <= representedRun.updatedAt.getTime(),
  );
  if (
    representedRun?.status === "blocked" ||
    (representedRun?.status === "completed_with_questions" && representedOpenQuestions.length > 0)
  ) {
    const blocked = representedRun.status === "blocked";
    items.push({
      action: { label: "Review Mail", to: "/mail/review" },
      actionAt: null,
      domain: "mail",
      id: `mail-run:${representedRun.id}`,
      kind: "review",
      priority: blocked ? "blocked" : "person_review",
      source: null,
      summary: blocked
        ? "A Mail maintenance turn is blocked and needs signed-in review."
        : "A Mail maintenance turn settled with questions that need signed-in judgment.",
      ...(includePreview
        ? {
            preview: workPreview([
              ["What stopped", blocked ? representedRun.lastSafeError?.message : null],
              [
                "Needs your input",
                representedOpenQuestions.map((question) => question.reason).join("; "),
              ],
            ]),
          }
        : {}),
      title: blocked ? "Mail maintenance is blocked" : "Mail needs your input",
      updatedAt: representedRun.updatedAt.toISOString(),
    });
  }
  // A later run can cover another thread or a bounded window. Its timestamp
  // cannot prove that an unresolved question was included or answered.
  for (const question of results.mailQuestions ?? []) {
    items.push({
      action: { label: "Answer in Mail", to: `/mail/review?question=${question.id}` },
      actionAt: null,
      domain: "mail",
      id: `mail-question:${question.id}`,
      kind: "review",
      priority: "person_review",
      source: null,
      summary: `${question.reason} Question type: ${question.kind}. Account ${question.accountId}; thread ${question.threadId}. Open since ${question.createdAt.toISOString()}.`,
      ...(includePreview
        ? {
            preview: workPreview([
              ["Question", question.reason],
              ["Choices", question.options.map((option) => option.label).join(" · ")],
            ]),
          }
        : {}),
      title: "Answer a Mail stewardship question",
      updatedAt: question.updatedAt.toISOString(),
    });
  }
  for (const rule of results.mailRules ?? []) {
    items.push({
      action: {
        label: "Review rule",
        to: `/settings?section=mail&reviewRule=${rule.id}`,
      },
      actionAt: null,
      domain: "mail",
      id: `mail-rule:${rule.id}`,
      kind: "review",
      priority: "person_review",
      source: null,
      ...(includePreview
        ? {
            preview: workPreview([
              [
                "When",
                rule.condition
                  ? `${rule.condition.field === "any" ? "Message" : humanize(rule.condition.field)} ${rule.condition.operator.replaceAll("_", " ")} “${rule.condition.value}”`
                  : null,
              ],
              [
                "Proposed action",
                rule.actions
                  ?.map(
                    (action) =>
                      `${humanize(action.type)}${action.afterDays ? ` after ${action.afterDays} days` : " immediately"}`,
                  )
                  .join("; "),
              ],
            ]),
          }
        : {}),
      summary: rule.description || "Review the current bounded sample before activation.",
      title: `Review ${rule.name}`,
      updatedAt: rule.updatedAt.toISOString(),
    });
  }

  for (const account of results.accounts ?? []) {
    if (account.mailEnabled) items.push(...projectReconnect("mail", "Mail", account));
  }
  return items;
}
