import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type Database,
  financeMutationRecords,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  type FinanceConversationEvidenceReadInput,
  type FinanceConversationEvidenceReadResult,
  financeConversationEffectReceiptSchema,
  financeConversationEvidenceReadInputSchema,
} from "@personal-os/domain";
import { and, eq } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import { requireWorkspaceExecution } from "../workspace-execution.js";
import { financeCandidateEffectKey } from "./candidate-effect-receipt.js";
import {
  loadFinanceEffectPrincipal,
  requireFinanceEffectMessageProof,
} from "./conversation-causality.js";

export function effectEvidenceCursor(
  owner: string,
  runId: string,
  key: string,
  offset: number,
  secret: string,
) {
  const payload = Buffer.from(JSON.stringify({ owner, runId, key, offset })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(`finance-effect:${payload}`).digest("hex")}`;
}
export function decodeEffectEvidenceCursor(
  cursor: string | undefined,
  owner: string,
  runId: string,
  key: string,
  secret: string,
) {
  if (!cursor) return 0;
  try {
    const [payload, signature, extra] = cursor.split(".");
    if (!payload || !signature || extra) throw new Error("cursor format");
    const expected = createHmac("sha256", secret).update(`finance-effect:${payload}`).digest("hex");
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw new Error("signature");
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      value.owner !== owner ||
      value.runId !== runId ||
      value.key !== key ||
      !Number.isSafeInteger(value.offset) ||
      value.offset < 0 ||
      value.offset > 10000
    )
      throw new Error("binding");
    return value.offset as number;
  } catch {
    throw new AppError("invalid_request", "Use the exact owner/run/candidate evidence cursor.");
  }
}
export function createFinanceConversationEvidenceService({
  db,
  cursorSecret,
  now = () => new Date(),
}: {
  db: Database;
  cursorSecret: string;
  now?: () => Date;
}) {
  if (!cursorSecret)
    throw new AppError("internal_error", "The existing server cursor key is required.");
  return {
    async readRunEvidence(
      principal: Principal,
      runId: string,
      raw: FinanceConversationEvidenceReadInput,
    ): Promise<FinanceConversationEvidenceReadResult> {
      const input = financeConversationEvidenceReadInputSchema.parse(raw);
      if (principal.actorType !== "agent" || !principal.scopes.has("finances:maintain"))
        throw new AppError("forbidden", "Use the original authenticated Finance host.");
      const key = financeCandidateEffectKey(input.candidateId, input.candidateRevision);
      const offset = decodeEffectEvidenceCursor(
        input.cursor,
        principal.userId,
        runId,
        key,
        cursorSecret,
      );
      return db.transaction(async (tx) => {
        const [run] = await tx
          .select()
          .from(workspaceMaintenanceRuns)
          .where(
            and(
              eq(workspaceMaintenanceRuns.userId, principal.userId),
              eq(workspaceMaintenanceRuns.id, runId),
              eq(workspaceMaintenanceRuns.domain, "finances"),
            ),
          )
          .for("share");
        if (!run) throw new AppError("not_found", "The Finance run was not found.");
        if (!run.authorizationConnectionId || !run.automationScheduleId)
          return { state: "unavailable", reason: "run_has_no_original_host" };
        await requireFinanceEffectMessageProof(tx, run, principal, now());
        await requireWorkspaceExecution(tx, principal, "finances", now());
        const [stored] = await tx
          .select()
          .from(financeMutationRecords)
          .where(
            and(
              eq(financeMutationRecords.userId, principal.userId),
              eq(financeMutationRecords.idempotencyKey, key),
              eq(financeMutationRecords.operation, "commit_finance_candidate_effect_v1"),
              eq(financeMutationRecords.status, "completed"),
            ),
          );
        const parsed = financeConversationEffectReceiptSchema.safeParse(
          stored?.response?.financeEffectReceipt,
        );
        if (!parsed.success) return { state: "unavailable", reason: "no_committed_effect_receipt" };
        const receipt = parsed.data;
        if (
          receipt.authorizationConnectionId !== run.authorizationConnectionId ||
          receipt.automationScheduleId !== run.automationScheduleId
        )
          return { state: "unavailable", reason: "original_run_binding_changed" };
        if (receipt.authorityBasis === "original_live_grant")
          await loadFinanceEffectPrincipal(
            tx,
            run,
            { ...principal, actorId: receipt.actor.id },
            now(),
            true,
          );
        if (
          receipt.runId !== runId ||
          receipt.candidateId !== input.candidateId ||
          receipt.candidateRevision !== input.candidateRevision ||
          receipt.id !== stored?.id
        )
          throw new AppError(
            "conflict",
            "The committed receipt does not match this exact run and candidate.",
          );
        const end = offset + 100;
        return {
          state: "available",
          receipt: {
            ...receipt,
            auditEventIds: receipt.auditEventIds.slice(offset, end),
            recordRefs: receipt.recordRefs.slice(offset, end),
          },
          nextCursor:
            end < Math.max(receipt.auditEventIds.length, receipt.recordRefs.length)
              ? effectEvidenceCursor(principal.userId, runId, key, end, cursorSecret)
              : null,
        };
      });
    },
  };
}
