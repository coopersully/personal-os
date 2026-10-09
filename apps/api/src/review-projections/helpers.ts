import {
  type Database,
  attentionItems,
  calendarAccounts,
  domainProfiles,
} from "@personal-os/database";
import type { AgentAccessDomain, AgentAccessWorkItem } from "@personal-os/domain";
import { and, eq, lte } from "drizzle-orm";
import { readProjectionRows } from "../finance/search-projection-bounds.js";
import type { ProjectionInput, SourceReaders } from "./contract.js";

export function createSharedProjectionReaders(
  db: Database,
  limit?: number,
): Pick<SourceReaders, "accounts" | "attention" | "profiles"> {
  return {
    accounts: async ({ snapshotAt, userId }) =>
      readProjectionRows(
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
        limit,
      ),
    attention: async ({ snapshotAt, userId }) =>
      readProjectionRows(
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
        limit,
      ),
    profiles: async ({ snapshotAt, userId }) =>
      readProjectionRows(
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
        limit,
      ),
  };
}

/** Shared row formatting; workspace owners supply their label and native destination. */
export function projectAttention(
  domain: AgentAccessDomain,
  label: string,
  route: string,
  { results }: ProjectionInput,
): AgentAccessWorkItem[] {
  const items: AgentAccessWorkItem[] = [];
  for (const item of results.attention ?? []) {
    if (item.domain !== domain) continue;
    items.push({
      action: { label: `Open ${label}`, to: route },
      actionAt: item.occursAt?.toISOString() ?? null,
      domain,
      id: `attention:${item.id}`,
      kind: "attention",
      priority: item.importance,
      source: item.source,
      summary: item.summary,
      title: item.title,
      updatedAt: item.updatedAt.toISOString(),
    });
  }

  return items;
}

export function projectReconnect(
  domain: "mail" | "calendar",
  label: string,
  account: typeof calendarAccounts.$inferSelect,
): AgentAccessWorkItem[] {
  const items: AgentAccessWorkItem[] = [];
  items.push({
    action: { label: "Reconnect", to: "/settings?section=connections" },
    actionAt: null,
    domain,
    id: `reconnect:${domain}:${account.id}`,
    kind: "attention",
    priority: "blocked",
    source: null,
    summary: `${label} cannot use this source until authorization is renewed.`,
    title: `Reconnect ${account.label} for ${label}`,
    updatedAt: account.updatedAt.toISOString(),
  });
  return items;
}

export function humanize(value: string) {
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Explicit display fields only: never serialize arbitrary evidence or private payloads. */
export function workPreview(
  fields: Array<[string, unknown]>,
): NonNullable<AgentAccessWorkItem["preview"]> {
  return fields
    .flatMap(([label, value]) =>
      typeof value === "string" && value.trim()
        ? [
            {
              label,
              value: value.trim().length > 600 ? `${value.trim().slice(0, 599)}…` : value.trim(),
            },
          ]
        : [],
    )
    .slice(0, 4);
}

