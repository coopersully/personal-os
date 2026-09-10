import { createHash } from "node:crypto";
import {
  type Database,
  financeLedgerChallengeFindings,
  financeLedgerChallenges,
  financeMaintenanceCandidateItems,
  financeMaintenanceCandidates,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  type FinanceLedgerChallenge,
  type FinanceLedgerChallengePage,
  financeLedgerChallengeChecks,
  financeLedgerChallengePageSchema,
  financeLedgerChallengeSchema,
  type SubmitFinanceLedgerChallengeInput,
  submitFinanceLedgerChallengeInputSchema,
} from "@personal-os/domain";
import { and, asc, desc, eq } from "drizzle-orm";
import { AppError } from "./errors.js";
import { stableFinanceActionInput } from "./finance-action-identity.js";
import type { createFinanceActionService, SupportedActionKind } from "./finance-action-service.js";
import type { createFinanceService } from "./finance-service.js";
import type { Principal } from "./types.js";

type MutationContext = { principal: Principal; requestId: string };
type Options = {
  actions: ReturnType<typeof createFinanceActionService>;
  db: Database;
  finances: ReturnType<typeof createFinanceService>;
  now: () => Date;
};

const rubricVersion = "finance-ledger-challenge-v1" as const;

function serializeChallenge(
  row: typeof financeLedgerChallenges.$inferSelect,
): FinanceLedgerChallenge {
  return financeLedgerChallengeSchema.parse({
    candidateId: row.candidateId,
    candidateRevision: row.candidateRevision,
    createdAt: row.createdAt.toISOString(),
    cutoff: row.cutoff.toISOString(),
    id: row.id,
    rubricVersion: row.rubricVersion,
    runId: row.runId,
    state: row.state,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    submittingAgentId: row.submittingAgentId,
    updatedAt: row.updatedAt.toISOString(),
    userId: row.userId,
  });
}

function sameSet(left: string[], right: string[]) {
  const uniqueLeft = [...new Set(left)].toSorted();
  const uniqueRight = [...new Set(right)].toSorted();
  return (
    uniqueLeft.length === left.length &&
    uniqueRight.length === right.length &&
    uniqueLeft.length === uniqueRight.length &&
    uniqueLeft.every((value, index) => value === uniqueRight[index])
  );
}

/** Durable packet and structured semantic challenge performed by the connected agent. */
export function createFinanceChallengeService({ actions, db, finances, now }: Options) {
  return {
    async prepare(
      userId: string,
      runId: string,
      candidateId: string,
    ): Promise<FinanceLedgerChallenge> {
      return db.transaction(async (tx) => {
        const [candidate] = await tx
          .select()
          .from(financeMaintenanceCandidates)
          .where(
            and(
              eq(financeMaintenanceCandidates.id, candidateId),
              eq(financeMaintenanceCandidates.runId, runId),
              eq(financeMaintenanceCandidates.userId, userId),
              eq(financeMaintenanceCandidates.state, "ready_for_challenge"),
            ),
          )
          .for("update")
          .limit(1);
        if (!candidate)
          throw new AppError("conflict", "The Finance candidate is not ready for challenge.");
        const [existing] = await tx
          .select()
          .from(financeLedgerChallenges)
          .where(eq(financeLedgerChallenges.candidateId, candidate.id))
          .limit(1);
        if (existing) {
          if (existing.candidateRevision !== candidate.revision)
            throw new AppError("conflict", "The Finance challenge candidate revision changed.");
          return serializeChallenge(existing);
        }
        const [created] = await tx
          .insert(financeLedgerChallenges)
          .values({
            candidateId: candidate.id,
            candidateRevision: candidate.revision,
            cutoff: now(),
            rubricVersion,
            runId,
            userId,
          })
          .returning();
        if (!created) throw new Error("The Finance challenge could not be prepared.");
        return serializeChallenge(created);
      });
    },

    async getPage(
      userId: string,
      challengeId: string,
      cursor?: string,
    ): Promise<FinanceLedgerChallengePage> {
      const [row] = await db
        .select()
        .from(financeLedgerChallenges)
        .where(
          and(
            eq(financeLedgerChallenges.id, challengeId),
            eq(financeLedgerChallenges.userId, userId),
          ),
        )
        .limit(1);
      if (!row) throw new AppError("not_found", "The Finance ledger challenge was not found.");
      const page = await finances.listMaintenanceCandidateItems(
        userId,
        row.candidateId,
        cursor,
        100,
      );
      return financeLedgerChallengePageSchema.parse({
        challenge: serializeChallenge(row),
        checks: financeLedgerChallengeChecks,
        items: page.items,
        nextCursor: page.nextCursor,
      });
    },

    async submit(inputValue: SubmitFinanceLedgerChallengeInput, context: MutationContext) {
      if (context.principal.actorType !== "agent")
        throw new AppError("forbidden", "A connected agent must submit the ledger challenge.");
      const input = submitFinanceLedgerChallengeInputSchema.parse(inputValue);
      return db.transaction(async (tx) => {
        const [challenge] = await tx
          .select()
          .from(financeLedgerChallenges)
          .where(
            and(
              eq(financeLedgerChallenges.id, input.challengeId),
              eq(financeLedgerChallenges.userId, context.principal.userId),
            ),
          )
          .for("update")
          .limit(1);
        if (!challenge) throw new AppError("not_found", "The Finance challenge was not found.");
        if (challenge.state !== "prepared") {
          const submissionFingerprint = createHash("sha256")
            .update(stableFinanceActionInput(input))
            .digest("hex");
          if (
            (challenge.coverage as { submissionFingerprint?: string }).submissionFingerprint !==
            submissionFingerprint
          )
            throw new AppError("conflict", "The submitted Finance challenge body changed.");
          return serializeChallenge(challenge);
        }
        const [candidate] = await tx
          .select()
          .from(financeMaintenanceCandidates)
          .where(
            and(
              eq(financeMaintenanceCandidates.id, challenge.candidateId),
              eq(financeMaintenanceCandidates.userId, context.principal.userId),
            ),
          )
          .for("update")
          .limit(1);
        if (
          candidate?.state !== "ready_for_challenge" ||
          candidate.revision !== input.candidateRevision ||
          challenge.candidateRevision !== input.candidateRevision ||
          input.rubricVersion !== rubricVersion
        )
          throw new AppError("conflict", "The Finance challenge packet is stale.");
        const [run] = await tx
          .select()
          .from(workspaceMaintenanceRuns)
          .where(
            and(
              eq(workspaceMaintenanceRuns.id, challenge.runId),
              eq(workspaceMaintenanceRuns.userId, context.principal.userId),
              eq(workspaceMaintenanceRuns.status, "awaiting_agent_challenge"),
            ),
          )
          .for("update")
          .limit(1);
        const checkpoint = run?.checkpoint as { candidateId?: string; revision?: string } | null;
        if (
          !run ||
          checkpoint?.candidateId !== candidate.id ||
          checkpoint.revision !== candidate.revision
        )
          throw new AppError("conflict", "The Finance maintenance challenge is no longer current.");
        const items = await tx
          .select()
          .from(financeMaintenanceCandidateItems)
          .where(eq(financeMaintenanceCandidateItems.candidateId, candidate.id))
          .orderBy(asc(financeMaintenanceCandidateItems.ordinal))
          .for("update");
        const currentPacket = await finances.maintenanceCandidateSnapshot(
          context.principal.userId,
          run.scope,
          items,
          candidate.discoveryRevision,
          tx,
        );
        if (currentPacket.revision !== candidate.revision)
          throw new AppError("conflict", "The Finance challenge sources changed; rebuild it.");
        if (
          !sameSet(
            input.reviewedItemIds,
            items.map((item) => item.id),
          )
        )
          throw new AppError(
            "invalid_request",
            "Challenge coverage must include every candidate item.",
          );
        if (!sameSet(input.checked, [...financeLedgerChallengeChecks]))
          throw new AppError(
            "invalid_request",
            "Challenge coverage must include every rubric check.",
          );
        const byId = new Map(items.map((item) => [item.id, item]));
        const allSourceRefs = new Set(
          items.flatMap((item) => item.sourceRefs.map((ref) => stableFinanceActionInput(ref))),
        );
        for (const finding of input.findings) {
          const item = finding.candidateItemId ? byId.get(finding.candidateItemId) : undefined;
          if (finding.candidateItemId && !item)
            throw new AppError(
              "invalid_request",
              "A challenge finding references another candidate.",
            );
          if (finding.kind !== "observation" && !item)
            throw new AppError(
              "invalid_request",
              "Actionable challenge findings must identify a candidate item.",
            );
          if (finding.sourceRefs.some((ref) => !allSourceRefs.has(stableFinanceActionInput(ref))))
            throw new AppError(
              "invalid_request",
              "Challenge evidence is outside the packet scope.",
            );
          const allowed =
            (finding.kind === "observation" && finding.resolution.type === "keep") ||
            (finding.kind === "correction" &&
              ["remove", "replace"].includes(finding.resolution.type)) ||
            (["question", "blocker"].includes(finding.kind) &&
              finding.resolution.type === "question");
          if (!allowed)
            throw new AppError(
              "invalid_request",
              "The challenge finding resolution is unsupported.",
            );
          if (finding.resolution.type === "remove" && item) {
            await tx
              .update(financeMaintenanceCandidateItems)
              .set({ disposition: "removed", updatedAt: now() })
              .where(eq(financeMaintenanceCandidateItems.id, item.id));
          } else if (finding.resolution.type === "replace" && item) {
            const draft = await actions.prepareMaintenanceCandidateDraft(
              finding.resolution.actionKind as SupportedActionKind,
              finding.resolution.input,
              context.principal.userId,
              tx,
              "agent",
            );
            await tx
              .update(financeMaintenanceCandidateItems)
              .set({
                actionKind: draft.actionKind,
                disposition: draft.disposition,
                evidence: draft.evidence,
                expectedRevision: draft.expectedRevision,
                fingerprint: draft.fingerprint,
                privatePayload: { ...draft.privatePayload, assumptions: draft.assumptions },
                safeChanges: draft.safeChanges,
                sourceRefs: draft.sourceRefs,
                updatedAt: now(),
              })
              .where(eq(financeMaintenanceCandidateItems.id, item.id));
          } else if (finding.resolution.type === "question" && item) {
            const fingerprint = `sha256:${createHash("sha256")
              .update(stableFinanceActionInput({ finding, itemId: item.id }))
              .digest("hex")}`;
            await tx
              .update(financeMaintenanceCandidateItems)
              .set({
                actionKind: "question",
                disposition: "question",
                evidence: { confidence: 0, rationale: finding.evidence },
                expectedRevision: null,
                fingerprint,
                privatePayload: {
                  asOf: now().toISOString(),
                  choices: finding.resolution.choices.map((value) => ({ label: value, value })),
                  expectedAnswer: [{ name: "answer", required: true, type: "string" }],
                  prompt: finding.resolution.prompt,
                  transactionId: null,
                  underlyingAction: item.actionKind,
                  why: finding.resolution.why,
                },
                safeChanges: [],
                sourceRefs: finding.sourceRefs,
                updatedAt: now(),
              })
              .where(eq(financeMaintenanceCandidateItems.id, item.id));
          }
        }
        if (input.findings.length)
          await tx
            .insert(financeLedgerChallengeFindings)
            .values(input.findings.map((finding) => ({ ...finding, challengeId: challenge.id })));
        const currentItems = await tx
          .select()
          .from(financeMaintenanceCandidateItems)
          .where(eq(financeMaintenanceCandidateItems.candidateId, candidate.id))
          .orderBy(asc(financeMaintenanceCandidateItems.ordinal));
        const snapshot = await finances.maintenanceCandidateSnapshot(
          context.principal.userId,
          run.scope,
          currentItems,
          candidate.discoveryRevision,
          tx,
        );
        const [updatedChallenge] = await tx
          .update(financeLedgerChallenges)
          .set({
            candidateRevision: snapshot.revision,
            coverage: {
              checked: [...new Set(input.checked)].toSorted(),
              reviewedItemIds: [...new Set(input.reviewedItemIds)].toSorted(),
              submissionFingerprint: createHash("sha256")
                .update(stableFinanceActionInput(input))
                .digest("hex"),
            },
            state: "submitted",
            submittedAt: now(),
            submittingAgentId: context.principal.actorId,
            updatedAt: now(),
          })
          .where(eq(financeLedgerChallenges.id, challenge.id))
          .returning();
        await tx
          .update(financeMaintenanceCandidates)
          .set({
            projection: snapshot.projection,
            revision: snapshot.revision,
            state: "challenged",
            updatedAt: now(),
          })
          .where(eq(financeMaintenanceCandidates.id, candidate.id));
        await tx
          .update(workspaceMaintenanceRuns)
          .set({
            checkpoint: {
              candidateId: candidate.id,
              challengeId: challenge.id,
              phase: "challenge_resolve",
              revision: snapshot.revision,
            },
            status: "queued",
            updatedAt: now(),
          })
          .where(
            and(
              eq(workspaceMaintenanceRuns.id, run.id),
              eq(workspaceMaintenanceRuns.status, "awaiting_agent_challenge"),
            ),
          );
        if (!updatedChallenge) throw new Error("The Finance challenge could not be submitted.");
        return serializeChallenge(updatedChallenge);
      });
    },

    async resolve(userId: string, runId: string) {
      return db.transaction(async (tx) => {
        const [challenge] = await tx
          .select()
          .from(financeLedgerChallenges)
          .where(
            and(
              eq(financeLedgerChallenges.runId, runId),
              eq(financeLedgerChallenges.userId, userId),
              eq(financeLedgerChallenges.state, "submitted"),
            ),
          )
          .orderBy(desc(financeLedgerChallenges.createdAt), desc(financeLedgerChallenges.id))
          .for("update")
          .limit(1);
        if (!challenge)
          throw new AppError("conflict", "The Finance challenge has not been submitted.");
        const [candidate] = await tx
          .select({ revision: financeMaintenanceCandidates.revision })
          .from(financeMaintenanceCandidates)
          .where(
            and(
              eq(financeMaintenanceCandidates.id, challenge.candidateId),
              eq(financeMaintenanceCandidates.userId, userId),
            ),
          )
          .limit(1);
        const items = await tx
          .select({ disposition: financeMaintenanceCandidateItems.disposition })
          .from(financeMaintenanceCandidateItems)
          .where(eq(financeMaintenanceCandidateItems.candidateId, challenge.candidateId));
        const [resolved] = await tx
          .update(financeLedgerChallenges)
          .set({ state: "resolved", updatedAt: now() })
          .where(
            and(
              eq(financeLedgerChallenges.id, challenge.id),
              eq(financeLedgerChallenges.state, "submitted"),
            ),
          )
          .returning({ id: financeLedgerChallenges.id });
        if (!resolved)
          throw new AppError("conflict", "The Finance challenge changed before resolution.");
        return {
          candidateId: challenge.candidateId,
          candidateRevision: candidate?.revision,
          questions: items.filter((item) => item.disposition === "question").length,
          submittingAgentId: challenge.submittingAgentId,
        };
      });
    },
  };
}

export type FinanceChallengeService = ReturnType<typeof createFinanceChallengeService>;
