import { randomUUID } from "node:crypto";
import {
  auditEvents,
  type Database,
  financeContextRevisions,
  financeContexts,
  users,
} from "@personal-os/database";
import {
  captureFinanceContextInputSchema,
  type FinanceContext,
  financeContextSchema,
  financeProvenanceSchema,
  idSchema,
} from "@personal-os/domain";
import { and, eq } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import {
  executeFinanceIdempotently,
  type FinanceTransaction,
  loadFinanceAuthorization,
} from "./context.js";

type Snapshot = typeof financeContextRevisions.$inferSelect;
const maxRevision = 9223372036854775807n;
function value(row: Snapshot): FinanceContext {
  return financeContextSchema.parse({
    id: row.contextId,
    revision: row.revision.toString(),
    text: row.text,
    validFrom: row.validFrom?.toISOString() ?? null,
    validThrough: row.validThrough?.toISOString() ?? null,
    participants: row.participants,
    paymentChannel: row.paymentChannel,
    expectedCents: row.expectedCents === null ? null : Number(row.expectedCents),
    categoryId: row.categoryId,
    transactionIds: row.transactionIds,
    status: row.status,
    source: { id: row.id, revision: row.revision.toString() },
  });
}
function nextRevision(current: bigint): bigint {
  if (current === maxRevision) throw new AppError("conflict", "Context revision limit reached.");
  return current + 1n;
}
/** Internal capture adapter. No HTTP/MCP registration or matching capability is implied. */
export function createFinanceContextService(options: {
  db: Database;
  principal: Principal;
  requestId: string;
  now?: () => Date;
}) {
  const { db, principal, requestId } = options;
  const now = options.now ?? (() => new Date());
  function authorize(scope: "finances:read" | "finances:write") {
    if (!principal.scopes.has(scope))
      throw new AppError("forbidden", `This token requires the ${scope} scope.`);
    idSchema.parse(principal.userId);
    // Server provenance must be valid before any receipt can be replayed.
    if (principal.actorType !== "user" && principal.actorType !== "agent")
      throw new AppError("forbidden", "Context capture requires a user or agent principal.");
    financeProvenanceSchema.shape.actorId.unwrap().parse(principal.actorId);
    financeProvenanceSchema.shape.requestId.unwrap().parse(requestId);
  }
  async function admit(tx: FinanceTransaction) {
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, principal.userId))
      .for("key share");
    if (!owner) throw new AppError("not_found", "Context owner not found.");
  }
  async function current(tx: FinanceTransaction, id: string): Promise<Snapshot> {
    const [pointer] = await tx
      .select()
      .from(financeContexts)
      .where(and(eq(financeContexts.userId, principal.userId), eq(financeContexts.id, id)))
      .for("update");
    if (!pointer) throw new AppError("not_found", "Finance context not found.");
    const row = await tx.query.financeContextRevisions.findFirst({
      where: and(
        eq(financeContextRevisions.userId, principal.userId),
        eq(financeContextRevisions.contextId, id),
        eq(financeContextRevisions.revision, pointer.currentRevision),
      ),
    });
    if (!row) throw new AppError("internal_error", "Context snapshot is missing.");
    return row;
  }
  async function append(tx: FinanceTransaction, row: Snapshot, previous: Snapshot | null) {
    await tx.insert(financeContextRevisions).values(row);
    if (previous) {
      const changed = await tx
        .update(financeContexts)
        .set({ currentRevision: row.revision, updatedAt: row.recordedAt })
        .where(
          and(
            eq(financeContexts.userId, principal.userId),
            eq(financeContexts.id, row.contextId),
            eq(financeContexts.currentRevision, previous.revision),
          ),
        )
        .returning({ id: financeContexts.id });
      if (changed.length !== 1) throw new AppError("conflict", "Context revision changed.");
    }
    await tx.insert(auditEvents).values(
      auditValues({
        action: `finance.context.${row.sourceKind === "expiry" ? "expired" : row.status === "cancelled" ? "cancelled" : previous ? "revised" : "created"}`,
        entityId: row.contextId,
        entityType: "finance_context",
        principal: { userId: row.userId, actorType: row.actorType, actorId: row.actorId },
        requestId,
        before: previous
          ? { revision: previous.revision.toString(), status: previous.status }
          : null,
        after: {
          revision: row.revision.toString(),
          status: row.status,
          source: { id: row.id, revision: row.revision.toString() },
        },
      }),
    );
    return value(row);
  }
  return {
    /** Supplied executor results remain provisional until its caller commits. */
    async captureContext(raw: unknown, executor?: FinanceTransaction): Promise<FinanceContext> {
      authorize("finances:write");
      const input = captureFinanceContextInputSchema.parse(raw);
      const context = await loadFinanceAuthorization({ db: executor ?? db, principal, requestId });
      const sourceKind = principal.actorType === "user" ? "app" : "agent";
      return executeFinanceIdempotently(
        db,
        context,
        {
          idempotencyKey: input.operationId,
          operation: "capture_finance_context_v1",
          payload: { input, sourceKind },
          requireUserAdmission: true,
        },
        async (tx) => {
          const previous = input.type === "create" ? null : await current(tx, input.id);
          // Sample after lock acquisition, including after waits, never at transaction start.
          const decisionNow = now();
          if (
            previous &&
            input.type !== "create" &&
            (previous.revision.toString() !== input.expectedRevision ||
              previous.status !== "active" ||
              (previous.validThrough !== null && previous.validThrough <= decisionNow))
          ) {
            throw new AppError("conflict", "Context changed or is no longer active.");
          }
          if (
            input.type !== "cancel" &&
            input.validThrough !== null &&
            new Date(input.validThrough) <= decisionNow
          )
            throw new AppError("conflict", "Context validity has already elapsed.");
          const id = previous?.contextId ?? randomUUID();
          const revision = previous ? nextRevision(previous.revision) : 1n;
          if (input.type === "cancel") {
            if (!previous) throw new AppError("internal_error", "Context snapshot is missing.");
            return append(
              tx,
              {
                ...previous,
                id: randomUUID(),
                revision,
                sourceKind,
                actorType: principal.actorType,
                actorId: principal.actorId,
                requestId,
                operationId: input.operationId,
                recordedAt: decisionNow,
                status: "cancelled",
              },
              previous,
            );
          }
          const row: Snapshot = {
            text: input.text,
            validFrom: input.validFrom === null ? null : new Date(input.validFrom),
            validThrough: input.validThrough === null ? null : new Date(input.validThrough),
            participants: input.participants,
            paymentChannel: input.paymentChannel,
            expectedCents: input.expectedCents === null ? null : BigInt(input.expectedCents),
            categoryId: null,
            transactionIds: [],
            id: randomUUID(),
            contextId: id,
            userId: principal.userId,
            revision,
            sourceKind,
            actorType: principal.actorType,
            actorId: principal.actorId,
            requestId,
            operationId: input.operationId,
            recordedAt: decisionNow,
            status: "active",
          };
          if (!previous)
            await tx.insert(financeContexts).values({
              id,
              userId: principal.userId,
              currentRevision: revision,
              createdAt: decisionNow,
              updatedAt: decisionNow,
            });
          return append(tx, row, previous);
        },
        executor,
      );
    },
    /** Deterministic expiry requires read scope; no editable content is changed. */
    async getCurrentContext(
      authenticatedUserId: string,
      id: string,
      executor?: FinanceTransaction,
    ): Promise<FinanceContext> {
      authorize("finances:read");
      idSchema.parse(authenticatedUserId);
      idSchema.parse(id);
      if (authenticatedUserId !== principal.userId)
        throw new AppError(
          "forbidden",
          "Context owner does not match the authenticated principal.",
        );
      const read = async (tx: FinanceTransaction) => {
        await admit(tx);
        const row = await current(tx, id);
        const decisionNow = now();
        if (row.status !== "active" || row.validThrough === null || row.validThrough > decisionNow)
          return value(row);
        return append(
          tx,
          {
            ...row,
            id: randomUUID(),
            revision: nextRevision(row.revision),
            status: "expired",
            sourceKind: "expiry",
            actorType: "system",
            actorId: "finance-context-expiry",
            requestId,
            operationId: null,
            recordedAt: decisionNow,
          },
          row,
        );
      };
      return executor ? read(executor) : db.transaction(read);
    },
  };
}
