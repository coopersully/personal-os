import { attentionItems, auditEvents, type Database, domainProfiles } from "@personal-os/database";
import {
  type AssistantDomain,
  type AssistantSetupStatus,
  type AttentionItem,
  type AttentionItemQuery,
  assistantDomains,
  type CreateAttentionItemInput,
  type DomainProfile,
  featureAccessPolicies,
  type UpdateAttentionItemInput,
  type UpsertDomainProfileInput,
} from "@personal-os/domain";
import { and, desc, eq } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { requireDatabaseRecord } from "./database.js";
import { normalizeDomainProfilePreferences } from "./domain-profile-validation.js";
import { AppError, isUniqueViolation } from "./errors.js";
import { auditSnapshot } from "./serialization.js";
import type { Principal } from "./types.js";

type MutationContext = { principal: Principal; requestId: string };

export function createAssistantService({ db, now }: { db: Database; now: () => Date }) {
  async function findProfile(userId: string, domain: AssistantDomain) {
    return (
      await db
        .select()
        .from(domainProfiles)
        .where(and(eq(domainProfiles.userId, userId), eq(domainProfiles.domain, domain)))
        .limit(1)
    )[0];
  }

  return {
    async getProfile(userId: string, domain: AssistantDomain): Promise<DomainProfile | null> {
      const profile = await findProfile(userId, domain);
      return profile ? serializeProfile(profile) : null;
    },

    async getSetupStatus(principal: Principal): Promise<AssistantSetupStatus> {
      const profiles = await db
        .select({
          domain: domainProfiles.domain,
          status: domainProfiles.status,
          version: domainProfiles.version,
        })
        .from(domainProfiles)
        .where(eq(domainProfiles.userId, principal.userId));
      const byDomain = new Map(profiles.map((profile) => [profile.domain, profile]));
      return {
        domains: assistantDomains.map((domain) => {
          const access = featureAccessPolicies[domain];
          const profile = byDomain.get(domain);
          const canRead = principal.scopes.has(access.readScope);
          return {
            canRead,
            canWrite: principal.scopes.has(access.writeScope),
            domain,
            profileStatus: canRead ? (profile?.status ?? null) : null,
            profileVersion: canRead ? (profile?.version ?? null) : null,
          };
        }),
      };
    },

    async upsertProfile(
      input: UpsertDomainProfileInput,
      context: MutationContext,
    ): Promise<DomainProfile> {
      const existing = await findProfile(context.principal.userId, input.domain);
      const preferences = normalizeDomainProfilePreferences(
        input,
        existing ? serializeProfile(existing) : undefined,
      );
      if (existing && input.expectedVersion === undefined) {
        throw new AppError(
          "invalid_request",
          "expectedVersion is required when revising a domain profile.",
        );
      }
      if (
        input.expectedVersion !== undefined &&
        input.expectedVersion !== (existing?.version ?? 0)
      ) {
        throw new AppError("conflict", "The domain profile changed since it was loaded.", {
          currentVersion: existing?.version ?? null,
        });
      }
      const values = {
        categories: input.categories,
        domain: input.domain,
        instructions: input.instructions,
        objective: input.objective,
        preferences,
        sourceContexts: input.sourceContexts,
        status: input.status,
        summary: input.summary,
      };
      const updatedAt = now();
      let saved: typeof domainProfiles.$inferSelect;
      try {
        saved = await db.transaction(async (transaction) => {
          const [profile] = existing
            ? await transaction
                .update(domainProfiles)
                .set({ ...values, updatedAt, version: existing.version + 1 })
                .where(
                  and(
                    eq(domainProfiles.id, existing.id),
                    eq(domainProfiles.version, existing.version),
                  ),
                )
                .returning()
            : await transaction
                .insert(domainProfiles)
                .values({ ...values, userId: context.principal.userId })
                .returning();
          if (!profile) {
            throw new AppError("conflict", "The domain profile changed while it was being saved.");
          }
          await transaction.insert(auditEvents).values(
            auditValues({
              action: existing ? "assistant.profile.updated" : "assistant.profile.created",
              after: auditSnapshot(profile),
              before: auditSnapshot(existing ?? null),
              entityId: profile.id,
              entityType: "domain_profile",
              ...context,
            }),
          );
          return profile;
        });
      } catch (error) {
        if (!existing && isUniqueViolation(error, "domain_profiles_user_domain_idx")) {
          throw new AppError("conflict", "The domain profile changed while it was being created.");
        }
        throw error;
      }
      return serializeProfile(saved);
    },

    async createAttentionItem(
      input: CreateAttentionItemInput,
      context: MutationContext,
    ): Promise<AttentionItem> {
      const created = await db.transaction(async (transaction) => {
        const item = requireDatabaseRecord(
          (
            await transaction
              .insert(attentionItems)
              .values({
                ...input,
                expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
                occursAt: input.occursAt ? new Date(input.occursAt) : null,
                userId: context.principal.userId,
              })
              .returning()
          )[0],
          "The attention item could not be created.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "assistant.attention.created",
            after: auditSnapshot(item),
            before: null,
            entityId: item.id,
            entityType: "attention_item",
            ...context,
          }),
        );
        return item;
      });
      return serializeAttentionItem(created);
    },

    async listAttentionItems(userId: string, query: AttentionItemQuery): Promise<AttentionItem[]> {
      const records = await db
        .select()
        .from(attentionItems)
        .where(
          and(
            eq(attentionItems.userId, userId),
            eq(attentionItems.domain, query.domain),
            eq(attentionItems.status, query.status),
          ),
        )
        .orderBy(desc(attentionItems.createdAt))
        .limit(query.limit);
      return records.map(serializeAttentionItem);
    },

    async updateAttentionItem(
      domain: AssistantDomain,
      id: string,
      input: UpdateAttentionItemInput,
      context: MutationContext,
    ): Promise<AttentionItem> {
      const [existing] = await db
        .select()
        .from(attentionItems)
        .where(
          and(
            eq(attentionItems.id, id),
            eq(attentionItems.userId, context.principal.userId),
            eq(attentionItems.domain, domain),
          ),
        )
        .limit(1);
      if (!existing) throw new AppError("not_found", "The attention item was not found.");
      const updatedAt = now();
      const updated = await db.transaction(async (transaction) => {
        const item = requireDatabaseRecord(
          (
            await transaction
              .update(attentionItems)
              .set({ status: input.status, updatedAt })
              .where(eq(attentionItems.id, existing.id))
              .returning()
          )[0],
          "The attention item could not be updated.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "assistant.attention.updated",
            after: auditSnapshot(item),
            before: auditSnapshot(existing),
            entityId: item.id,
            entityType: "attention_item",
            ...context,
          }),
        );
        return item;
      });
      return serializeAttentionItem(updated);
    },
  };
}

function serializeProfile(row: typeof domainProfiles.$inferSelect): DomainProfile {
  return {
    categories: row.categories,
    createdAt: row.createdAt.toISOString(),
    domain: row.domain,
    id: row.id,
    instructions: row.instructions,
    objective: row.objective,
    preferences: row.preferences,
    sourceContexts: row.sourceContexts,
    status: row.status,
    summary: row.summary,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function serializeAttentionItem(row: typeof attentionItems.$inferSelect): AttentionItem {
  return {
    createdAt: row.createdAt.toISOString(),
    domain: row.domain,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    id: row.id,
    importance: row.importance,
    kind: row.kind,
    occursAt: row.occursAt?.toISOString() ?? null,
    relatedEntityId: row.relatedEntityId,
    relatedEntityType: row.relatedEntityType,
    source: row.source,
    status: row.status,
    summary: row.summary,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}
