import {
  attentionItems,
  auditEvents,
  type Database,
  domainProfileApprovals,
  domainProfiles,
} from "@personal-os/database";
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
import { AppError, isUniqueViolation } from "./errors.js";
import {
  auditAttentionItemMetadata,
  auditDomainProfileMetadata,
  domainProfileChangedFields,
  serializeAttentionItem,
} from "./serialization.js";
import type { Principal } from "./types.js";

type MutationContext = { principal: Principal; requestId: string };
export type ProfileSourceTransaction = Pick<Database, "select">;

export function createAssistantService({
  db,
  now,
  profileRequiresApproval,
  validateProfileSources,
}: {
  db: Database;
  now: () => Date;
  profileRequiresApproval: (domain: AssistantDomain) => boolean;
  validateProfileSources: (
    transaction: ProfileSourceTransaction,
    domain: AssistantDomain,
    userId: string,
    sourceIds: string[],
    status: UpsertDomainProfileInput["status"],
    actorType: Principal["actorType"],
    preferences: UpsertDomainProfileInput["preferences"],
  ) => Promise<UpsertDomainProfileInput["preferences"] | undefined>;
}) {
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
      if (!profile) return null;
      const serialized = serializeProfile(profile);
      if (!profileRequiresApproval(domain) || profile.status !== "active") return serialized;
      const [approval] = await db
        .select({ id: domainProfileApprovals.id })
        .from(domainProfileApprovals)
        .where(
          and(
            eq(domainProfileApprovals.profileId, profile.id),
            eq(domainProfileApprovals.userId, userId),
            eq(domainProfileApprovals.domain, domain),
            eq(domainProfileApprovals.profileVersion, profile.version),
          ),
        )
        .limit(1);
      return approval ? serialized : { ...serialized, status: "draft" };
    },

    async getSetupStatus(principal: Principal): Promise<AssistantSetupStatus> {
      const profiles = await db
        .select({
          approvedVersion: domainProfileApprovals.profileVersion,
          domain: domainProfiles.domain,
          status: domainProfiles.status,
          version: domainProfiles.version,
        })
        .from(domainProfiles)
        .leftJoin(
          domainProfileApprovals,
          and(
            eq(domainProfileApprovals.profileId, domainProfiles.id),
            eq(domainProfileApprovals.userId, domainProfiles.userId),
            eq(domainProfileApprovals.domain, domainProfiles.domain),
          ),
        )
        .where(eq(domainProfiles.userId, principal.userId));
      const byDomain = new Map(profiles.map((profile) => [profile.domain, profile]));
      return {
        domains: assistantDomains.map((domain) => {
          const access = featureAccessPolicies[domain];
          const profile = byDomain.get(domain);
          const canRead = principal.scopes.has(access.readScope);
          const approvedVersion =
            canRead && profileRequiresApproval(domain) ? (profile?.approvedVersion ?? null) : null;
          const profileStatus =
            profileRequiresApproval(domain) &&
            profile?.status === "active" &&
            approvedVersion === null
              ? "draft"
              : (profile?.status ?? null);
          return {
            approvedProfileStatus: approvedVersion === null ? null : ("active" as const),
            approvedProfileVersion: approvedVersion,
            canRead,
            canWrite: principal.scopes.has(access.writeScope),
            domain,
            pendingDraftVersion:
              approvedVersion !== null && profileStatus === "draft"
                ? (profile?.version ?? null)
                : null,
            profileStatus: canRead ? profileStatus : null,
            profileVersion: canRead ? (profile?.version ?? null) : null,
          };
        }),
      };
    },

    async upsertProfile(
      input: UpsertDomainProfileInput,
      context: MutationContext,
    ): Promise<DomainProfile> {
      const updatedAt = now();
      let saved: typeof domainProfiles.$inferSelect;
      try {
        saved = await db.transaction(async (transaction) => {
          const preferences =
            (await validateProfileSources(
              transaction,
              input.domain,
              context.principal.userId,
              input.sourceContexts.map((source) => source.sourceId),
              input.status,
              context.principal.actorType,
              input.preferences,
            )) ?? input.preferences;
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
          const [existing] = await transaction
            .select()
            .from(domainProfiles)
            .where(
              and(
                eq(domainProfiles.userId, context.principal.userId),
                eq(domainProfiles.domain, input.domain),
              ),
            )
            .for("update")
            .limit(1);
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
          const recordsApproval =
            profile.status === "active" &&
            context.principal.actorType === "user" &&
            profileRequiresApproval(profile.domain);
          if (recordsApproval) {
            await transaction
              .insert(domainProfileApprovals)
              .values({
                approvedAt: updatedAt,
                approvedByUserId: context.principal.userId,
                domain: profile.domain,
                profile: serializeProfile(profile),
                profileId: profile.id,
                profileVersion: profile.version,
                userId: context.principal.userId,
              })
              .onConflictDoUpdate({
                set: {
                  approvedAt: updatedAt,
                  approvedByUserId: context.principal.userId,
                  profile: serializeProfile(profile),
                  profileId: profile.id,
                  profileVersion: profile.version,
                  updatedAt,
                },
                target: [domainProfileApprovals.userId, domainProfileApprovals.domain],
              });
          }
          const changedFields = domainProfileChangedFields(existing ?? null, profile);
          await transaction.insert(auditEvents).values(
            auditValues({
              action: existing ? "assistant.profile.updated" : "assistant.profile.created",
              after: auditDomainProfileMetadata(profile, changedFields),
              before: auditDomainProfileMetadata(existing ?? null, changedFields),
              entityId: profile.id,
              entityType: "domain_profile",
              ...context,
            }),
          );
          if (recordsApproval) {
            await transaction.insert(auditEvents).values(
              auditValues({
                action: "assistant.profile.approved",
                after: { domain: profile.domain, profileVersion: profile.version },
                before: null,
                entityId: profile.id,
                entityType: "domain_profile",
                ...context,
              }),
            );
          }
          return profile;
        });
      } catch (error) {
        if (isUniqueViolation(error, "domain_profiles_user_domain_idx")) {
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
      if (
        input.source !== null ||
        input.relatedEntityId !== null ||
        input.relatedEntityType !== null
      ) {
        throw new AppError(
          "invalid_request",
          "Generic attention items must be unlinked. Use the owning domain endpoint for source-linked attention.",
        );
      }
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
            after: auditAttentionItemMetadata(item),
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
      const updatedAt = now();
      const updated = await db.transaction(async (transaction) => {
        const [existing] = await transaction
          .select()
          .from(attentionItems)
          .where(
            and(
              eq(attentionItems.id, id),
              eq(attentionItems.userId, context.principal.userId),
              eq(attentionItems.domain, domain),
            ),
          )
          .for("update")
          .limit(1);
        if (!existing) throw new AppError("not_found", "The attention item was not found.");
        if (existing.version !== input.expectedVersion) {
          throw new AppError("conflict", "The attention item changed since it was loaded.", {
            currentVersion: existing.version,
          });
        }
        const [item] = await transaction
          .update(attentionItems)
          .set({ status: input.status, updatedAt, version: existing.version + 1 })
          .where(
            and(eq(attentionItems.id, existing.id), eq(attentionItems.version, existing.version)),
          )
          .returning();
        if (!item) {
          throw new AppError("conflict", "The attention item changed while it was being updated.");
        }
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "assistant.attention.updated",
            after: auditAttentionItemMetadata(item),
            before: auditAttentionItemMetadata(existing),
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
