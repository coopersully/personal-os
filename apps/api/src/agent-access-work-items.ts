import { createHmac, timingSafeEqual } from "node:crypto";
import {
  agentAccessWorkItemSnapshots,
  attentionItems,
  calendarAccounts,
  type Database,
  domainProfiles,
  financeReviewCases,
  mailRules,
} from "@personal-os/database";
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
import { and, eq, gt, lte, or } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "./errors.js";
import type { Principal } from "./types.js";

type SourceInput = { snapshotAt: Date; userId: string };
type SourceReaders = {
  accounts: (input: SourceInput) => Promise<Array<typeof calendarAccounts.$inferSelect>>;
  attention: (input: SourceInput) => Promise<Array<typeof attentionItems.$inferSelect>>;
  financeReviews: (input: SourceInput) => Promise<Array<typeof financeReviewCases.$inferSelect>>;
  mailRules: (input: SourceInput) => Promise<Array<typeof mailRules.$inferSelect>>;
  profiles: (input: SourceInput) => Promise<Array<typeof domainProfiles.$inferSelect>>;
};

type SourceKey = keyof SourceReaders;
type SourceResult = {
  accounts: Awaited<ReturnType<SourceReaders["accounts"]>>;
  attention: Awaited<ReturnType<SourceReaders["attention"]>>;
  financeReviews: Awaited<ReturnType<SourceReaders["financeReviews"]>>;
  mailRules: Awaited<ReturnType<SourceReaders["mailRules"]>>;
  profiles: Awaited<ReturnType<SourceReaders["profiles"]>>;
};

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

const sourceImpact: Record<
  SourceKey,
  { domains: AgentAccessDomain[]; kinds: AgentAccessWorkItemKind[] }
> = {
  accounts: { domains: ["mail", "calendar"], kinds: ["attention"] },
  attention: {
    domains: [...agentAccessDomains],
    kinds: ["attention"],
  },
  financeReviews: { domains: ["finances"], kinds: ["review"] },
  mailRules: { domains: ["mail"], kinds: ["review"] },
  profiles: {
    domains: [...agentAccessDomains],
    kinds: ["review"],
  },
};

const workspaceRoutes: Record<AgentAccessDomain, string> = {
  calendar: "/calendar",
  finances: "/finances",
  mail: "/mail",
  tasks: "/tasks",
};

export function createAgentAccessWorkItemService({
  cursorSigningKey,
  db,
  now,
  sourceReaders: sourceReaderOverrides,
}: {
  cursorSigningKey: string;
  db: Database;
  now: () => Date;
  sourceReaders?: Partial<SourceReaders>;
}) {
  const sourceReaders: SourceReaders = {
    accounts: async ({ snapshotAt, userId }) =>
      db
        .select()
        .from(calendarAccounts)
        .where(
          and(
            eq(calendarAccounts.userId, userId),
            eq(calendarAccounts.syncRecovery, "reconnect"),
            lte(calendarAccounts.updatedAt, snapshotAt),
          ),
        ),
    attention: async ({ snapshotAt, userId }) =>
      db
        .select()
        .from(attentionItems)
        .where(
          and(
            eq(attentionItems.userId, userId),
            eq(attentionItems.status, "open"),
            lte(attentionItems.updatedAt, snapshotAt),
          ),
        ),
    financeReviews: async ({ snapshotAt, userId }) =>
      db
        .select()
        .from(financeReviewCases)
        .where(
          and(
            eq(financeReviewCases.userId, userId),
            or(eq(financeReviewCases.status, "open"), eq(financeReviewCases.status, "deferred")),
            lte(financeReviewCases.updatedAt, snapshotAt),
          ),
        ),
    mailRules: async ({ snapshotAt, userId }) =>
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
    profiles: async ({ snapshotAt, userId }) =>
      db
        .select()
        .from(domainProfiles)
        .where(
          and(
            eq(domainProfiles.userId, userId),
            eq(domainProfiles.status, "draft"),
            lte(domainProfiles.updatedAt, snapshotAt),
          ),
        ),
    ...sourceReaderOverrides,
  };

  return {
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

function projectItems({
  accessibleDomains,
  results,
}: {
  accessibleDomains: Set<AgentAccessDomain>;
  results: Partial<SourceResult>;
}): AgentAccessWorkItem[] {
  const items: AgentAccessWorkItem[] = [];
  for (const item of results.attention ?? []) {
    if (!isAgentAccessDomain(item.domain) || !accessibleDomains.has(item.domain)) continue;
    items.push({
      action: { label: `Open ${workspaceLabel(item.domain)}`, to: workspaceRoutes[item.domain] },
      actionAt: item.occursAt?.toISOString() ?? null,
      domain: item.domain,
      id: `attention:${item.id}`,
      kind: "attention",
      priority: item.importance,
      source: item.source,
      summary: item.summary,
      title: item.title,
      updatedAt: item.updatedAt.toISOString(),
    });
  }

  if (accessibleDomains.has("mail")) {
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
        summary: rule.description || "Review the current bounded sample before activation.",
        title: `Review ${rule.name}`,
        updatedAt: rule.updatedAt.toISOString(),
      });
    }
  }

  if (accessibleDomains.has("finances")) {
    for (const review of results.financeReviews ?? []) {
      items.push({
        action: { label: "Open Finance review", to: "/finances/review" },
        actionAt: null,
        domain: "finances",
        id: `finance-review:${review.id}`,
        kind: "review",
        priority: "person_review",
        source: null,
        summary: "A Finance decision needs signed-in judgment; Ilo will not guess.",
        title: "Review a Finance decision",
        updatedAt: review.updatedAt.toISOString(),
      });
    }
    for (const profile of results.profiles ?? []) {
      if (profile.domain !== "finances") continue;
      items.push({
        action: { label: "Review guidance", to: "/finances/profile" },
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
  }

  for (const account of results.accounts ?? []) {
    for (const domain of [
      ...(account.mailEnabled ? (["mail"] as const) : []),
      ...(account.calendarEnabled ? (["calendar"] as const) : []),
    ]) {
      if (!accessibleDomains.has(domain)) continue;
      items.push({
        action: { label: "Reconnect", to: "/settings?section=connections" },
        actionAt: null,
        domain,
        id: `reconnect:${domain}:${account.id}`,
        kind: "attention",
        priority: "blocked",
        source: null,
        summary: `${workspaceLabel(domain)} cannot use this source until authorization is renewed.`,
        title: `Reconnect ${account.label} for ${workspaceLabel(domain)}`,
        updatedAt: account.updatedAt.toISOString(),
      });
    }
  }

  return items;
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

function isAgentAccessDomain(value: string): value is AgentAccessDomain {
  return agentAccessDomains.includes(value as AgentAccessDomain);
}

function workspaceLabel(domain: AgentAccessDomain): string {
  return domain === "finances" ? "Finances" : `${domain[0]?.toUpperCase()}${domain.slice(1)}`;
}
