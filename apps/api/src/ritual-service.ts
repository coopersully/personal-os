import { createHash, randomUUID } from "node:crypto";
import {
  auditEvents,
  type Database,
  ritualActions,
  ritualDefinitionRevisions,
  ritualDefinitions,
  ritualOccurrences,
  ritualRequests,
  ritualResponses,
  users,
} from "@personal-os/database";
import {
  currentRitualWindow,
  type RitualAction,
  type RitualActionInput,
  type RitualActionResult,
  type RitualDefinition,
  type RitualDefinitionInput,
  type RitualOccurrence,
  type RitualResponseInput,
  type RitualState,
  requiresSnoozeConfirmation,
  ritualAnswerIsValid,
  ritualIsAnswered,
  upcomingRitualWindows,
} from "@personal-os/domain";
import { and, desc, eq, gte, lt, lte, or, sql } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { AppError } from "./errors.js";
import type { Principal } from "./types.js";

type Context = { principal: Principal; requestId: string };
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export function createRitualService({ db, now }: { db: Database; now: () => Date }) {
  async function locked<T>(context: Context, run: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, context.principal.userId))
        .for("update");
      if (!owner) throw new AppError("not_found", "Account was not found.");
      return run(tx);
    });
  }
  async function definitions(tx: Tx, userId: string) {
    return (
      await tx.select().from(ritualDefinitions).where(eq(ritualDefinitions.userId, userId))
    ).map((r) => r.data);
  }
  async function persist(tx: Tx, occurrence: RitualOccurrence, userId: string) {
    await tx
      .update(ritualOccurrences)
      .set({ data: occurrence })
      .where(and(eq(ritualOccurrences.id, occurrence.id), eq(ritualOccurrences.userId, userId)));
  }
  async function reconcile(
    tx: Tx,
    userId: string,
  ): Promise<{ state: RitualState; occurrences: RitualOccurrence[] }> {
    const defs = await definitions(tx, userId);
    const instant = now().toISOString();
    const window = currentRitualWindow(defs, instant);
    const occurrences = (
      await tx
        .select()
        .from(ritualOccurrences)
        .where(
          and(
            eq(ritualOccurrences.userId, userId),
            or(
              gte(ritualOccurrences.dueAt, new Date(now().getTime() - 7 * 86400000)),
              sql`${ritualOccurrences.data}->>'status' = 'pending'`,
            ),
          ),
        )
    ).map((r) => r.data);
    for (const occurrence of occurrences) {
      if (occurrence.status !== "pending") continue;
      const def = defs.find((d) => d.id === occurrence.ritualId);
      if (!def?.enabled) {
        occurrence.status = "cancelled_configuration";
      } else if (
        occurrence.expiresAt <= instant ||
        (window &&
          window.dueAt > occurrence.dueAt &&
          (window.ritualId !== occurrence.ritualId ||
            window.scheduledLocalDate !== occurrence.scheduledLocalDate))
      ) {
        occurrence.status = "missed";
      } else continue;
      occurrence.revision++;
      occurrence.settledAt = instant;
      await persist(tx, occurrence, userId);
    }
    const pending = occurrences
      .filter((o) => o.status === "pending")
      .sort((a, b) => b.dueAt.localeCompare(a.dueAt))[0];
    let current =
      pending ??
      (window
        ? (occurrences.find(
            (o) =>
              o.ritualId === window.ritualId && o.scheduledLocalDate === window.scheduledLocalDate,
          ) ?? null)
        : null);
    if (window && !current) {
      const definition = defs.find((d) => d.id === window.ritualId)!;
      current = {
        ...window,
        id: occurrenceId(userId, window.ritualId, window.scheduledLocalDate),
        definition,
        status: "pending",
        revision: 1,
        snoozedUntil: null,
        settledAt: null,
        responses: [],
        actions: [],
      };
      await tx.insert(ritualOccurrences).values({
        id: current.id,
        userId,
        ritualId: current.ritualId,
        localDate: current.scheduledLocalDate,
        dueAt: new Date(current.dueAt),
        data: current,
      });
      occurrences.push(current);
    }
    const state: RitualState = {
      definitions: defs,
      upcoming: upcomingRitualWindows(defs, instant).map((window) => ({
        ...window,
        id: occurrenceId(userId, window.ritualId, window.scheduledLocalDate),
        definition: defs.find((d) => d.id === window.ritualId) as RitualDefinition,
        status: "pending" as const,
        revision: 1,
        snoozedUntil: null,
        settledAt: null,
        responses: [],
        actions: [],
      })),
      current,
      serverNow: instant,
      snoozeCount: current ? countSnoozes(occurrences, current.ritualId, instant) : 0,
      syncStatus: "saved",
    };
    return { state, occurrences };
  }
  function occurrenceId(userId: string, ritualId: string, date: string) {
    const hash = createHash("sha256").update(`${userId}/${ritualId}/${date}`).digest("hex");
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  }
  function countSnoozes(occurrences: RitualOccurrence[], ritualId: string, at: string) {
    const end = Date.parse(at),
      start = end - 72 * 3600000;
    return occurrences
      .filter((o) => o.ritualId === ritualId)
      .flatMap((o) => o.actions)
      .filter(
        (a) =>
          a.kind === "snooze_confirmed" &&
          a.outcome === "applied" &&
          Date.parse(a.recordedAt) >= start &&
          Date.parse(a.recordedAt) <= end,
      ).length;
  }
  async function previous<T>(
    tx: Tx,
    context: Context,
    requestId: string,
    input: unknown,
  ): Promise<T | undefined> {
    const [row] = await tx
      .select()
      .from(ritualRequests)
      .where(
        and(
          eq(ritualRequests.userId, context.principal.userId),
          eq(ritualRequests.requestId, requestId),
        ),
      );
    if (!row) return undefined;
    if (row.fingerprint !== hash(input))
      throw new AppError("conflict", "This request ID was already used for another action.");
    if (row.result === null)
      throw new AppError(
        "conflict",
        "This saved reply was removed after ritual data deletion. Refresh before continuing.",
      );
    const receipt = row.result as {
      receiptVersion?: number;
      kind?: "definition" | "state" | "action";
      revision?: number;
      result?: Omit<RitualActionResult, "state">;
    };
    // Older locally created records remain readable until deletion tombstones them.
    if (receipt.receiptVersion !== 1) return row.result as T;
    if (receipt.kind === "definition") {
      const [version] = await tx
        .select()
        .from(ritualDefinitionRevisions)
        .where(
          and(
            eq(ritualDefinitionRevisions.userId, context.principal.userId),
            eq(ritualDefinitionRevisions.ritualId, row.ritualId),
            eq(ritualDefinitionRevisions.revision, receipt.revision!),
          ),
        );
      if (!version) throw new AppError("conflict", "This ritual version is no longer available.");
      return version.data as T;
    }
    const { state } = await reconcile(tx, context.principal.userId);
    return (receipt.kind === "state" ? state : { ...receipt.result, state }) as T;
  }
  function hash(input: unknown) {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex");
  }
  async function remember(
    tx: Tx,
    context: Context,
    ritualId: string,
    requestId: string,
    input: unknown,
    result: RitualDefinition | RitualState | RitualActionResult,
    operation: string,
    occurrenceId?: string,
  ) {
    let receipt: unknown;
    if ("outcome" in result) {
      const { state: _state, ...outcome } = result;
      receipt = { receiptVersion: 1, kind: "action", result: outcome };
    } else if ("current" in result) {
      receipt = { receiptVersion: 1, kind: "state" };
    } else {
      receipt = { receiptVersion: 1, kind: "definition", revision: result.revision };
    }
    await tx.insert(ritualRequests).values({
      userId: context.principal.userId,
      ritualId,
      requestId,
      fingerprint: hash(input),
      result: receipt,
    });
    await tx.insert(auditEvents).values(
      auditValues({
        ...context,
        action: `ritual.${operation}`,
        entityType: "ritual",
        entityId: ritualId,
        before: null,
        after: {
          requestId,
          ...(occurrenceId ? { occurrenceId } : {}),
          ...("outcome" in result ? { outcome: result.outcome } : {}),
        },
      }),
    );
  }
  function findOccurrence(occurrences: RitualOccurrence[], id: string) {
    const o = occurrences.find((o) => o.id === id);
    if (!o) throw new AppError("not_found", "Ritual occurrence was not found.");
    return o;
  }
  function fresh(occurrence: RitualOccurrence, expectedRevision: number) {
    if (occurrence.status !== "pending" || occurrence.revision !== expectedRevision)
      throw new AppError("conflict", "This ritual changed. Refresh before continuing.");
  }
  return {
    async current(context: Context) {
      return locked(context, async (tx) => (await reconcile(tx, context.principal.userId)).state);
    },
    async list(context: Context) {
      return locked(context, (tx) => definitions(tx, context.principal.userId));
    },
    async saveDefinition(
      kind: string,
      input: RitualDefinitionInput,
      context: Context,
    ): Promise<RitualDefinition> {
      return locked(context, async (tx) => {
        if (kind !== input.kind)
          throw new AppError("invalid_request", "Ritual kind must match its address.");
        const replay = await previous<RitualDefinition>(tx, context, input.requestId, input);
        if (replay) return replay;
        const defs = await definitions(tx, context.principal.userId),
          before = defs.find((d) => d.kind === kind);
        if (input.expectedRevision !== (before?.revision ?? 0))
          throw new AppError("conflict", "Ritual settings changed. Refresh before saving.");
        if (
          defs.some((d) => d.kind !== kind && d.enabled && input.enabled && d.time === input.time)
        )
          throw new AppError("invalid_request", "Morning and evening need different times.");
        if (
          defs.some(
            (d) => d.kind !== kind && d.enabled && input.enabled && d.timeZone !== input.timeZone,
          )
        )
          throw new AppError("invalid_request", "Use the same time zone for both rituals.");
        const { requestId, deviceId: _device, expectedRevision: _revision, ...settings } = input;
        let enabledAt = before?.enabledAt ?? new Date(now().getTime() - 36 * 3600000).toISOString();
        if (before && !before.enabled && input.enabled) enabledAt = now().toISOString();
        const definition: RitualDefinition = {
          ...settings,
          id: before?.id ?? randomUUID(),
          revision: (before?.revision ?? 0) + 1,
          enabledAt,
        };
        if (before)
          await tx
            .update(ritualDefinitions)
            .set({ data: definition })
            .where(
              and(
                eq(ritualDefinitions.id, before.id),
                eq(ritualDefinitions.userId, context.principal.userId),
              ),
            );
        else
          await tx.insert(ritualDefinitions).values({
            id: definition.id,
            userId: context.principal.userId,
            kind,
            data: definition,
          });
        await tx.insert(ritualDefinitionRevisions).values({
          userId: context.principal.userId,
          ritualId: definition.id,
          revision: definition.revision,
          data: definition,
        });
        await reconcile(tx, context.principal.userId);
        await remember(
          tx,
          context,
          definition.id,
          requestId,
          input,
          definition,
          "definition_saved",
        );
        return definition;
      });
    },
    async saveResponse(
      id: string,
      stepId: string,
      input: RitualResponseInput,
      context: Context,
    ): Promise<RitualState> {
      return locked(context, async (tx) => {
        const payload = { id, stepId, ...input };
        const replay = await previous<RitualState>(tx, context, input.requestId, payload);
        if (replay) return replay;
        const { state, occurrences } = await reconcile(tx, context.principal.userId);
        const occurrence = findOccurrence(occurrences, id);
        fresh(occurrence, input.expectedRevision);
        const step = occurrence.definition.steps.find((s) => s.id === stepId);
        if (!step) throw new AppError("invalid_request", "This step is not part of the ritual.");
        if (
          step.kind === "checkbox"
            ? typeof input.value !== "boolean"
            : typeof input.value !== "string"
        )
          throw new AppError("invalid_request", "The answer type does not match the step.");
        if (step.kind !== "checkbox" && input.submitted && !ritualAnswerIsValid(step, input.value))
          throw new AppError("invalid_request", "Enter a valid answer before submitting.");
        const response = {
          id: randomUUID(),
          requestId: input.requestId,
          stepId,
          value: input.value,
          submitted: input.submitted,
          observedAt: input.observedAt,
          recordedAt: now().toISOString(),
        };
        occurrence.responses.push(response);
        occurrence.revision++;
        await tx.insert(ritualResponses).values({
          id: response.id,
          userId: context.principal.userId,
          occurrenceId: id,
          requestId: input.requestId,
          data: response,
        });
        await persist(tx, occurrence, context.principal.userId);
        await remember(
          tx,
          context,
          occurrence.ritualId,
          input.requestId,
          payload,
          state,
          "response_saved",
          id,
        );
        return state;
      });
    },
    async act(id: string, input: RitualActionInput, context: Context): Promise<RitualActionResult> {
      return locked(context, async (tx) => {
        const payload = { id, ...input };
        const replay = await previous<RitualActionResult>(tx, context, input.requestId, payload);
        if (replay) return replay;
        const { state, occurrences } = await reconcile(tx, context.principal.userId);
        const occurrence = findOccurrence(occurrences, id);
        const instant = now().toISOString();
        const count = countSnoozes(occurrences, occurrence.ritualId, instant);
        const valid =
          occurrence.status === "pending" && occurrence.revision === input.expectedRevision;
        async function event(
          kind: RitualAction["kind"],
          outcome: RitualAction["outcome"],
          challengeId?: string,
        ) {
          const action: RitualAction = {
            id: randomUUID(),
            requestId: input.requestId,
            deviceId: input.deviceId,
            kind,
            observedAt: input.observedAt,
            recordedAt: instant,
            count,
            outcome,
            ...(challengeId ? { challengeId } : {}),
          };
          occurrence.actions.push(action);
          await tx.insert(ritualActions).values({
            id: action.id,
            userId: context.principal.userId,
            occurrenceId: id,
            requestId: input.requestId,
            kind,
            data: action,
          });
        }
        let result: RitualActionResult = { outcome: "conflict", state };
        if (input.kind === "snooze" || input.kind === "skip")
          await event(
            input.kind === "snooze" ? "snooze_pressed" : "skip_pressed",
            valid ? "pending" : "rejected",
          );
        if (valid) {
          if (input.kind === "complete" && ritualIsAnswered(occurrence)) {
            await event("complete_applied", "applied");
            occurrence.status = "completed";
            occurrence.settledAt = instant;
            result = { outcome: "applied", state };
          } else if (input.kind === "skip") {
            await event("skip_applied", "applied");
            occurrence.status = "skipped";
            occurrence.settledAt = instant;
            result = { outcome: "applied", state };
          } else if (
            input.kind === "snooze" &&
            (input.requireConfirmation || requiresSnoozeConfirmation(count))
          ) {
            const challengeId = input.requestId;
            const press = occurrence.actions.at(-1)!;
            press.challengeId = challengeId;
            await tx
              .update(ritualActions)
              .set({ data: press })
              .where(eq(ritualActions.id, press.id));
            result = { outcome: "confirmation_required", count, challengeId, state };
          } else if (input.kind === "snooze") {
            await event("snooze_confirmed", "applied");
            occurrence.snoozedUntil = new Date(
              Math.min(
                Math.min(
                  now().getTime(),
                  Math.max(Date.parse(occurrence.dueAt), Date.parse(input.observedAt)),
                ) + 600000,
                Date.parse(occurrence.expiresAt),
              ),
            ).toISOString();
            result = { outcome: "applied", state };
          } else if (input.kind === "confirm_snooze" || input.kind === "cancel_snooze") {
            const press = occurrence.actions.find(
              (a) =>
                a.kind === "snooze_pressed" &&
                a.challengeId === input.challengeId &&
                a.deviceId === input.deviceId,
            );
            const used = occurrence.actions.some(
              (a) => a.kind !== "snooze_pressed" && a.challengeId === input.challengeId,
            );
            if (press && !used) {
              if (input.kind === "cancel_snooze") {
                await event("snooze_cancelled", "applied", press.challengeId);
                result = { outcome: "applied", state };
              } else if (!input.historyUnavailable && input.displayedCount !== count) {
                result = {
                  outcome: "confirmation_required",
                  count,
                  challengeId: press.challengeId!,
                  state,
                };
              } else {
                await event("snooze_confirmed", "applied", press.challengeId);
                occurrence.snoozedUntil = new Date(
                  Math.min(
                    Math.min(
                      now().getTime(),
                      Math.max(Date.parse(occurrence.dueAt), Date.parse(input.observedAt)),
                    ) + 600000,
                    Date.parse(occurrence.expiresAt),
                  ),
                ).toISOString();
                result = { outcome: "applied", state };
              }
            }
          }
        }
        occurrence.revision++;
        await persist(tx, occurrence, context.principal.userId);
        state.snoozeCount = countSnoozes(
          occurrences,
          occurrence.ritualId,
          new Date(now().getTime() + 1).toISOString(),
        );
        await remember(
          tx,
          context,
          occurrence.ritualId,
          input.requestId,
          payload,
          result,
          input.kind,
          id,
        );
        return result;
      });
    },
    async history(
      context: Context,
      query: {
        limit: number;
        cursor?: string | undefined;
        kind?: string | undefined;
        dateFrom?: string | undefined;
        dateTo?: string | undefined;
      },
    ) {
      return locked(context, async (tx) => {
        await reconcile(tx, context.principal.userId);
        const [cursorTime, cursorId] = query.cursor?.split("|") ?? [];
        const rows = await tx
          .select()
          .from(ritualOccurrences)
          .where(
            and(
              eq(ritualOccurrences.userId, context.principal.userId),
              cursorTime
                ? or(
                    lt(ritualOccurrences.dueAt, new Date(cursorTime)),
                    cursorId
                      ? and(
                          eq(ritualOccurrences.dueAt, new Date(cursorTime)),
                          lt(ritualOccurrences.id, cursorId),
                        )
                      : undefined,
                  )
                : undefined,
              query.kind
                ? sql`${ritualOccurrences.data}->'definition'->>'kind' = ${query.kind}`
                : undefined,
              query.dateFrom ? gte(ritualOccurrences.localDate, query.dateFrom) : undefined,
              query.dateTo ? lte(ritualOccurrences.localDate, query.dateTo) : undefined,
            ),
          )
          .orderBy(desc(ritualOccurrences.dueAt), desc(ritualOccurrences.id))
          .limit(query.limit + 1);
        return {
          items: rows.slice(0, query.limit).map((r) => r.data),
          nextCursor:
            rows.length > query.limit
              ? `${rows[query.limit - 1]!.dueAt.toISOString()}|${rows[query.limit - 1]!.id}`
              : null,
        };
      });
    },
    async export(context: Context) {
      return locked(context, async (tx) => {
        await reconcile(tx, context.principal.userId);
        return {
          definitions: await definitions(tx, context.principal.userId),
          occurrences: (
            await tx
              .select()
              .from(ritualOccurrences)
              .where(eq(ritualOccurrences.userId, context.principal.userId))
          ).map((r) => r.data),
        };
      });
    },
    async deleteData(kind: string, context: Context) {
      await locked(context, async (tx) => {
        const defs = await definitions(tx, context.principal.userId);
        const def = defs.find((d) => d.id === kind || d.kind === kind);
        if (!def) throw new AppError("not_found", "Ritual was not found.");
        await tx
          .delete(ritualDefinitions)
          .where(
            and(
              eq(ritualDefinitions.id, def.id),
              eq(ritualDefinitions.userId, context.principal.userId),
            ),
          );
        // Only legacy snapshots can contain another ritual’s private answers. Compact
        // receipts retain the other ritual’s retry identity without copying private state.
        await tx
          .update(ritualRequests)
          .set({ result: sql`'null'::jsonb` })
          .where(
            and(
              eq(ritualRequests.userId, context.principal.userId),
              sql`coalesce(${ritualRequests.result}->>'receiptVersion', '') <> '1'`,
            ),
          );
        await tx.insert(auditEvents).values(
          auditValues({
            ...context,
            action: "ritual.deleted",
            entityType: "ritual",
            entityId: def.id,
            before: null,
            after: null,
          }),
        );
      });
    },
  };
}
