import { createHmac, timingSafeEqual } from "node:crypto";
import { agentAccessWorkItemSnapshots, type Database } from "@personal-os/database";
import {
  type AgentAccessDomain,
  type AgentAccessWorkItem,
  type AgentAccessWorkItemKind,
  type AgentAccessWorkItemPage,
  type AgentAccessWorkItemPriority,
  type AgentAccessWorkItemQuery,
  type AgentConnectionGuide,
  agentAccessDomains,
  featureAccessPolicies,
} from "@personal-os/domain";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "./errors.js";
import { ReviewSearchOverflowError } from "./finance/search-projection-bounds.js";
import type { SourceKey, SourceReaders, SourceResult } from "./review-projections/contract.js";
import { buildSourceReaders, projectItems, sourceImpact } from "./review-projections/registry.js";
import type { Principal, RequestLog } from "./types.js";

const priorityOrder: Record<AgentAccessWorkItemPriority, number> = {
  person_review: 0,
  blocked: 1,
  critical: 2,
  high: 3,
  normal: 4,
  low: 5,
};

const cursorSchema = z.object({
  domain: z.enum(agentAccessDomains).nullable(),
  effectiveAt: z.iso.datetime({ offset: true }),
  id: z.string().min(1).max(300),
  kind: z.enum(["review", "attention"]).nullable(),
  priority: z.enum(["person_review", "blocked", "critical", "high", "normal", "low"]),
  snapshotId: z.uuid(),
  snapshotAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
type Cursor = z.infer<typeof cursorSchema>;

export function createAgentAccessWorkItemService({
  cursorSigningKey,
  db,
  now,
  sourceReaders: sourceReaderOverrides,
  log,
}: {
  cursorSigningKey: string;
  db: Database;
  now: () => Date;
  sourceReaders?: Partial<SourceReaders>;
  log?: (entry: RequestLog) => void;
}) {
  const sourceReaders = { ...buildSourceReaders(db), ...sourceReaderOverrides };

  return {
    /** Reuse the review projection for workspace search without creating pagination snapshots. */
    async searchItems(
      principal: Principal,
      workspace: AgentAccessDomain,
      requestId = "unattributed",
    ): Promise<{ items: AgentAccessWorkItem[]; unavailableSources: SourceKey[] }> {
      if (!principal.scopes.has(featureAccessPolicies[workspace].readScope)) {
        throw new AppError("forbidden", "This workspace requires read access.");
      }
      const input = { snapshotAt: now(), userId: principal.userId };
      const entries = (
        Object.entries(sourceReaders) as Array<[SourceKey, SourceReaders[SourceKey]]>
      ).filter(([key]) => sourceImpact[key].domains.includes(workspace));
      const settled = await Promise.allSettled(
        entries.map(async ([key]) => {
          const started = Date.now();
          try {
            return await db.transaction(async (tx) => {
              // PostgreSQL cancels blocked/slow SQL and terminates over-budget transactions;
              // a Promise.race alone would leave database work running after the response.
              await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
              await tx.execute(sql`SET LOCAL transaction_timeout = '2500ms'`);
              await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
              const reader =
                sourceReaderOverrides?.[key] ??
                buildSourceReaders(tx as unknown as Database, 200)[key];
              return reader(input);
            });
          } catch (error) {
            log?.({
              event: "workspace_review_search_source_failed",
              requestId,
              workspace,
              source: key,
              category: reviewSearchFailureCategory(error),
              durationMs: Date.now() - started,
              method: "GET",
              path: `/v1/workspaces/${workspace}/search`,
              status: 503,
            });
            throw error;
          }
        }),
      );
      const results = {} as Partial<SourceResult>;
      const unavailableSources: SourceKey[] = [];
      for (const [index, result] of settled.entries()) {
        const key = entries[index]?.[0];
        if (!key) continue;
        if (result.status === "fulfilled") Object.assign(results, { [key]: result.value });
        else unavailableSources.push(key);
      }
      return {
        items: projectItems({
          accessibleDomains: new Set([workspace]),
          results,
          includePreview: principal.actorType === "user",
        }).filter((item) => item.domain === workspace),
        unavailableSources,
      };
    },

    async list(
      principal: Principal,
      query: AgentAccessWorkItemQuery,
      domains: AgentConnectionGuide["domains"],
    ): Promise<AgentAccessWorkItemPage> {
      const cursor = query.cursor ? decodeCursor(query.cursor, cursorSigningKey) : null;
      if (
        cursor &&
        (cursor.domain !== (query.domain ?? null) || cursor.kind !== (query.kind ?? null))
      ) {
        throw new AppError(
          "invalid_request",
          "The Agent Access cursor does not match the active filters.",
        );
      }
      const requestTime = now();
      const snapshotAt = cursor ? new Date(cursor.snapshotAt) : requestTime;
      const accessibleDomains = new Set(
        domains
          .filter(
            (entry): entry is typeof entry & { domain: AgentAccessDomain } =>
              entry.support !== "unsupported" &&
              agentAccessDomains.includes(entry.domain as AgentAccessDomain) &&
              principal.scopes.has(featureAccessPolicies[entry.domain].readScope),
          )
          .map((entry) => entry.domain),
      );
      if (cursor) {
        const [snapshot] = await db
          .select()
          .from(agentAccessWorkItemSnapshots)
          .where(
            and(
              eq(agentAccessWorkItemSnapshots.id, cursor.snapshotId),
              eq(agentAccessWorkItemSnapshots.userId, principal.userId),
              eq(agentAccessWorkItemSnapshots.actorId, principal.actorId),
              eq(agentAccessWorkItemSnapshots.actorType, principal.actorType),
              gt(agentAccessWorkItemSnapshots.expiresAt, requestTime),
            ),
          )
          .limit(1);
        if (!snapshot) {
          throw new AppError("invalid_request", "The Agent Access cursor has expired.");
        }
        const remaining = snapshot.items.filter((item) => compareItemToCursor(item, cursor) > 0);
        const pageItems = remaining.slice(0, query.limit);
        const last = pageItems.at(-1);
        return {
          filteredTotal: snapshot.filteredTotal,
          items: pageItems,
          nextCursor:
            remaining.length > query.limit && last
              ? encodeCursor(
                  last,
                  snapshot.createdAt,
                  snapshot.id,
                  snapshot.domain,
                  snapshot.kind,
                  cursorSigningKey,
                )
              : null,
          snapshotAt: snapshot.createdAt.toISOString(),
          summary: snapshot.summary,
          unavailableDomains: snapshot.unavailableDomains,
        };
      }

      const input = { snapshotAt, userId: principal.userId };
      const entries = Object.entries(sourceReaders) as Array<[SourceKey, SourceReaders[SourceKey]]>;
      const settled = await Promise.allSettled(entries.map(([, reader]) => reader(input)));
      const results = {} as Partial<SourceResult>;
      const failedSources = new Set<SourceKey>();
      for (const [index, result] of settled.entries()) {
        const key = entries[index]?.[0];
        if (!key) continue;
        if (result.status === "fulfilled") {
          Object.assign(results, { [key]: result.value });
        } else {
          failedSources.add(key);
        }
      }

      const items = projectItems({
        accessibleDomains,
        results,
        includePreview: principal.actorType === "user",
      }).toSorted(compareItems);
      const unavailableDomains = [
        ...new Set([...failedSources].flatMap((source) => sourceImpact[source].domains)),
      ]
        .filter((domain) => accessibleDomains.has(domain))
        .toSorted();
      const failedKinds = new Set(
        [...failedSources]
          .filter((source) =>
            sourceImpact[source].domains.some((domain) => accessibleDomains.has(domain)),
          )
          .flatMap((source) => sourceImpact[source].kinds),
      );
      const summary = summarizeItems(items, new Set(unavailableDomains), failedKinds);
      const filtered = items.filter(
        (item) =>
          (query.domain === undefined || item.domain === query.domain) &&
          (query.kind === undefined || item.kind === query.kind),
      );
      const filteredCountUnavailable = query.domain
        ? unavailableDomains.includes(query.domain)
        : query.kind
          ? failedKinds.has(query.kind)
          : unavailableDomains.length > 0 || failedKinds.size > 0;
      const filteredTotal = filteredCountUnavailable ? null : filtered.length;
      await db
        .delete(agentAccessWorkItemSnapshots)
        .where(
          and(
            eq(agentAccessWorkItemSnapshots.userId, principal.userId),
            lte(agentAccessWorkItemSnapshots.expiresAt, requestTime),
          ),
        );
      const snapshot =
        filtered.length > query.limit
          ? (
              await db
                .insert(agentAccessWorkItemSnapshots)
                .values({
                  actorId: principal.actorId,
                  actorType: principal.actorType,
                  domain: query.domain ?? null,
                  expiresAt: new Date(requestTime.getTime() + 15 * 60_000),
                  filteredTotal,
                  items: filtered,
                  kind: query.kind ?? null,
                  summary,
                  unavailableDomains,
                  userId: principal.userId,
                })
                .returning()
            )[0]
          : null;
      if (filtered.length > query.limit && !snapshot) {
        throw new AppError("internal_error", "Could not preserve review pagination.");
      }
      const pageItems = filtered.slice(0, query.limit);
      const last = pageItems.at(-1);

      return {
        filteredTotal,
        items: pageItems,
        nextCursor:
          filtered.length > query.limit && last && snapshot
            ? encodeCursor(
                last,
                snapshot.createdAt,
                snapshot.id,
                query.domain ?? null,
                query.kind ?? null,
                cursorSigningKey,
              )
            : null,
        snapshotAt: snapshotAt.toISOString(),
        summary,
        unavailableDomains,
      };
    },
  };
}

function summarizeItems(
  items: AgentAccessWorkItem[],
  unavailableDomains: Set<AgentAccessDomain>,
  failedKinds: Set<AgentAccessWorkItemKind>,
): AgentAccessWorkItemPage["summary"] {
  const count = (predicate: (item: AgentAccessWorkItem) => boolean) =>
    items.filter(predicate).length;
  return {
    byDomain: {
      calendar: unavailableDomains.has("calendar")
        ? null
        : count((item) => item.domain === "calendar"),
      finances: unavailableDomains.has("finances")
        ? null
        : count((item) => item.domain === "finances"),
      mail: unavailableDomains.has("mail") ? null : count((item) => item.domain === "mail"),
      tasks: unavailableDomains.has("tasks") ? null : count((item) => item.domain === "tasks"),
    },
    byKind: {
      attention: failedKinds.has("attention") ? null : count((item) => item.kind === "attention"),
      review: failedKinds.has("review") ? null : count((item) => item.kind === "review"),
    },
    total: unavailableDomains.size > 0 ? null : items.length,
  };
}

function compareItems(left: AgentAccessWorkItem, right: AgentAccessWorkItem): number {
  return (
    priorityOrder[left.priority] - priorityOrder[right.priority] ||
    compareText(effectiveAt(left), effectiveAt(right)) ||
    compareText(left.updatedAt, right.updatedAt) ||
    compareText(left.id, right.id)
  );
}

function compareItemToCursor(item: AgentAccessWorkItem, cursor: Cursor): number {
  return (
    priorityOrder[item.priority] - priorityOrder[cursor.priority] ||
    compareText(effectiveAt(item), cursor.effectiveAt) ||
    compareText(item.updatedAt, cursor.updatedAt) ||
    compareText(item.id, cursor.id)
  );
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function effectiveAt(item: AgentAccessWorkItem): string {
  return item.actionAt ?? item.updatedAt;
}

function encodeCursor(
  item: AgentAccessWorkItem,
  snapshotAt: Date,
  snapshotId: string,
  domain: AgentAccessDomain | null,
  kind: AgentAccessWorkItemKind | null,
  cursorSigningKey: string,
): string {
  const cursor = {
    domain,
    effectiveAt: effectiveAt(item),
    id: item.id,
    kind,
    priority: item.priority,
    snapshotId,
    snapshotAt: snapshotAt.toISOString(),
    updatedAt: item.updatedAt,
  } satisfies Cursor;
  return Buffer.from(
    JSON.stringify({
      cursor,
      signature: cursorSignature(cursor, cursorSigningKey),
    }),
  ).toString("base64url");
}

function decodeCursor(value: string, cursorSigningKey: string): Cursor {
  try {
    const envelope = z
      .object({ cursor: cursorSchema, signature: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (!signaturesMatch(envelope.signature, cursorSignature(envelope.cursor, cursorSigningKey))) {
      throw new Error("Cursor signature mismatch");
    }
    return envelope.cursor;
  } catch {
    throw new AppError("invalid_request", "The Agent Access cursor is invalid.");
  }
}

function cursorSignature(cursor: Cursor, cursorSigningKey: string): string {
  return createHmac("sha256", cursorSigningKey).update(JSON.stringify(cursor)).digest("hex");
}

function signaturesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/** Classify known boundary failures without ever serializing driver errors or query parameters. */
function reviewSearchFailureCategory(error: unknown): "timeout" | "overflow" | "unexpected" {
  const seen = new Set<unknown>();
  let cause = error;
  while (typeof cause === "object" && cause !== null && !seen.has(cause)) {
    seen.add(cause);
    if (cause instanceof ReviewSearchOverflowError) return "overflow";
    if ("code" in cause && (cause.code === "57014" || cause.code === "25P04")) return "timeout";
    cause = "cause" in cause ? cause.cause : null;
  }
  return "unexpected";
}
