import {
  accessTokens,
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
import { and, eq, gt, isNotNull, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "./errors.js";
import type { Principal } from "./types.js";

type SourceInput = { snapshotAt: Date; userId: string };
type SourceReaders = {
  accounts: (input: SourceInput) => Promise<Array<typeof calendarAccounts.$inferSelect>>;
  attention: (input: SourceInput) => Promise<Array<typeof attentionItems.$inferSelect>>;
  credentials: (input: SourceInput) => Promise<Array<typeof accessTokens.$inferSelect>>;
  financeReviews: (input: SourceInput) => Promise<Array<typeof financeReviewCases.$inferSelect>>;
  mailRules: (input: SourceInput) => Promise<Array<typeof mailRules.$inferSelect>>;
  profiles: (input: SourceInput) => Promise<Array<typeof domainProfiles.$inferSelect>>;
};

type SourceKey = keyof SourceReaders;
type SourceResult = {
  accounts: Awaited<ReturnType<SourceReaders["accounts"]>>;
  attention: Awaited<ReturnType<SourceReaders["attention"]>>;
  credentials: Awaited<ReturnType<SourceReaders["credentials"]>>;
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
  kind: z.enum(["review", "attention", "setup"]).nullable(),
  priority: z.enum(["person_review", "blocked", "critical", "high", "normal", "low"]),
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
  credentials: {
    domains: [...agentAccessDomains],
    kinds: ["setup"],
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
  db,
  now,
  sourceReaders: sourceReaderOverrides,
}: {
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
    credentials: async ({ snapshotAt, userId }) =>
      db
        .select()
        .from(accessTokens)
        .where(
          and(
            eq(accessTokens.userId, userId),
            isNull(accessTokens.revokedAt),
            isNotNull(accessTokens.lastUsedAt),
            lte(accessTokens.lastUsedAt, snapshotAt),
            or(isNull(accessTokens.expiresAt), gt(accessTokens.expiresAt, snapshotAt)),
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
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      if (
        cursor &&
        (cursor.domain !== (query.domain ?? null) || cursor.kind !== (query.kind ?? null))
      ) {
        throw new AppError(
          "invalid_request",
          "The Agent Access cursor does not match the active filters.",
        );
      }
      const snapshotAt = cursor ? new Date(cursor.snapshotAt) : now();
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
        snapshotAt,
      }).toSorted(compareItems);
      const unavailableDomains = [
        ...new Set([...failedSources].flatMap((source) => sourceImpact[source].domains)),
      ]
        .filter((domain) => accessibleDomains.has(domain))
        .toSorted();
      const failedKinds = new Set(
        [...failedSources].flatMap((source) => sourceImpact[source].kinds),
      );
      const summary = summarizeItems(items, new Set(unavailableDomains), failedKinds);
      const filtered = items.filter(
        (item) =>
          (query.domain === undefined || item.domain === query.domain) &&
          (query.kind === undefined || item.kind === query.kind) &&
          (cursor === null || compareItemToCursor(item, cursor) > 0),
      );
      const pageItems = filtered.slice(0, query.limit);
      const last = pageItems.at(-1);

      return {
        items: pageItems,
        nextCursor:
          filtered.length > query.limit && last
            ? encodeCursor(last, snapshotAt, query.domain ?? null, query.kind ?? null)
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
  snapshotAt,
}: {
  accessibleDomains: Set<AgentAccessDomain>;
  results: Partial<SourceResult>;
  snapshotAt: Date;
}): AgentAccessWorkItem[] {
  const items: AgentAccessWorkItem[] = [];
  const credentials = results.credentials;
  if (credentials) {
    const observedScopes = new Set(credentials.flatMap((credential) => credential.scopes));
    if (credentials.length === 0) {
      items.push({
        action: {
          label: "Connect an agent",
          to: "/settings?section=agents&setup=connect",
        },
        actionAt: null,
        domain: null,
        id: "setup:connect-agent",
        kind: "setup",
        priority: "blocked",
        source: null,
        summary: "Authorize one compatible host so Ilo can observe its scoped access.",
        title: "Connect an agent",
        updatedAt: snapshotAt.toISOString(),
      });
    } else {
      for (const domain of accessibleDomains) {
        const access = featureAccessPolicies[domain];
        const missingRead = !observedScopes.has(access.readScope);
        const missingWrite = !observedScopes.has(access.writeScope);
        if (!missingRead && !missingWrite) continue;
        const missing = [...(missingRead ? ["read"] : []), ...(missingWrite ? ["write"] : [])].join(
          " and ",
        );
        items.push({
          action: {
            label: "Manage access",
            to: `/settings?section=agents&workspace=${domain}#access-management`,
          },
          actionAt: null,
          domain,
          id: `setup:${domain}:agent-authority`,
          kind: "setup",
          priority: "blocked",
          source: null,
          summary: `No observed host has the required ${missing} access for this workspace.`,
          title: `Update ${workspaceLabel(domain)} agent access`,
          updatedAt: snapshotAt.toISOString(),
        });
      }
    }
  }

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
          to: `/settings?section=agents&workspace=mail&reviewRule=${rule.id}`,
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
      setup: failedKinds.has("setup") ? null : count((item) => item.kind === "setup"),
    },
    total: unavailableDomains.size > 0 ? null : items.length,
  };
}

function compareItems(left: AgentAccessWorkItem, right: AgentAccessWorkItem): number {
  return (
    priorityOrder[left.priority] - priorityOrder[right.priority] ||
    effectiveAt(left).localeCompare(effectiveAt(right)) ||
    left.updatedAt.localeCompare(right.updatedAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareItemToCursor(item: AgentAccessWorkItem, cursor: Cursor): number {
  return (
    priorityOrder[item.priority] - priorityOrder[cursor.priority] ||
    effectiveAt(item).localeCompare(cursor.effectiveAt) ||
    item.updatedAt.localeCompare(cursor.updatedAt) ||
    item.id.localeCompare(cursor.id)
  );
}

function effectiveAt(item: AgentAccessWorkItem): string {
  return item.actionAt ?? item.updatedAt;
}

function encodeCursor(
  item: AgentAccessWorkItem,
  snapshotAt: Date,
  domain: AgentAccessDomain | null,
  kind: AgentAccessWorkItemKind | null,
): string {
  return Buffer.from(
    JSON.stringify({
      domain,
      effectiveAt: effectiveAt(item),
      id: item.id,
      kind,
      priority: item.priority,
      snapshotAt: snapshotAt.toISOString(),
      updatedAt: item.updatedAt,
    } satisfies Cursor),
  ).toString("base64url");
}

function decodeCursor(value: string): Cursor {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    throw new AppError("invalid_request", "The Agent Access cursor is invalid.");
  }
}

function isAgentAccessDomain(value: string): value is AgentAccessDomain {
  return agentAccessDomains.includes(value as AgentAccessDomain);
}

function workspaceLabel(domain: AgentAccessDomain): string {
  return domain === "finances" ? "Finances" : `${domain[0]?.toUpperCase()}${domain.slice(1)}`;
}
