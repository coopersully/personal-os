import {
  accessTokens,
  attentionItems,
  auditEvents,
  type Database,
  domainProfileApprovals,
  domainProfiles,
  users,
} from "@personal-os/database";
import {
  type AccessScope,
  type AssistantDomain,
  type AssistantSetupPlan,
  type AssistantSetupPlanQuery,
  type AssistantSetupStatus,
  type AssistantSetupStep,
  type AttentionItem,
  type AttentionItemQuery,
  assistantDomains,
  type CreateAttentionItemInput,
  type DomainProfile,
  featureAccessPolicies,
  type IloAgentContext,
  type UpdateAttentionItemInput,
  type UpsertDomainProfileInput,
} from "@personal-os/domain";
import { and, desc, eq, gt, isNotNull, isNull, or } from "drizzle-orm";
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

type SetupRecipe = {
  inspect: string[];
  requiredTools: string[];
  review: string[];
};

const setupRecipes: Record<AssistantDomain, SetupRecipe> = {
  calendar: {
    inspect: [
      "Read the existing Calendar profile before asking questions.",
      "Inspect selected and writable calendars plus a small representative event sample.",
      "Learn destination, privacy, hard-versus-flexible, buffer, and time-zone preferences; ask only about unresolved choices.",
      "Save a draft profile with source meanings and the user's own wording.",
    ],
    requiredTools: ["get_domain_profile", "list_calendars", "list_events", "save_domain_profile"],
    review: [
      "Summarize the exact calendars and preferences covered by the draft.",
      "Use preview_calendar_commitment for a concrete commitment candidate; do not imply automatic creation is enabled.",
      "Activate guidance only after the user accepts the summary.",
    ],
  },
  finances: {
    inspect: [
      "Read the existing Finance profile and guided setup context before asking questions.",
      "Inspect account identity, ledger health, review state, and suggested workflows without exposing balances unnecessarily.",
      "Learn planning goals, account meanings, review cadence, and alert preferences; ask only about unresolved choices.",
      "Save Finance guidance as a draft. The agent cannot approve it.",
    ],
    requiredTools: [
      "get_domain_profile",
      "get_finance_guided_setup",
      "get_finance_ledger_health",
      "save_domain_profile",
    ],
    review: [
      "Summarize the accounts, assumptions, and reviewed workflows covered by the draft.",
      "Direct the person to Finances → Profile for signed-in approval.",
      "Do not categorize transactions, resolve reviews, or alter accounts during setup.",
    ],
  },
  goals: {
    inspect: [
      "Read the existing Goals profile and current goals before asking questions.",
      "Learn how goals should influence prioritization and what should remain advisory.",
      "Ask only about unresolved tradeoffs, then save a draft profile.",
    ],
    requiredTools: ["get_domain_profile", "list_goals", "save_domain_profile"],
    review: [
      "Summarize the prioritization guidance and any explicit exceptions.",
      "Activate guidance only after the user accepts the summary.",
    ],
  },
  mail: {
    inspect: [
      "Read the existing Mail profile before asking questions.",
      "Inspect connected account identity, mailbox roles, freshness, and a bounded summary sample; read bodies only when summaries are insufficient.",
      "Infer source meanings and signal-versus-noise preferences, then ask only about unresolved choices.",
      "Save a draft profile before proposing any executable rule.",
    ],
    requiredTools: [
      "get_domain_profile",
      "get_mail_setup_context",
      "list_mail",
      "save_domain_profile",
    ],
    review: [
      "Summarize the exact accounts, categories, retention choices, and exceptions covered by the draft.",
      "Preview each proposed Mail rule against its bounded recent window and disclose truncation.",
      "Leave rules disabled until the signed-in person reviews and activates them in Settings.",
    ],
  },
  reminders: {
    inspect: [
      "Read the existing Reminders profile before asking questions.",
      "Inspect a bounded set of open reminders and overdue state without treating due dates as notification evidence.",
      "Learn capture defaults, priority meanings, overdue review, and deadline-versus-notification intent.",
      "Ask only about unresolved choices, then save a draft profile.",
    ],
    requiredTools: [
      "get_domain_profile",
      "list_reminders",
      "preview_overdue_reminder_deferral",
      "save_domain_profile",
    ],
    review: [
      "Summarize the reminder defaults and exact overdue proposal boundary.",
      "Keep bulk deferral preview-only and activate guidance only after the user accepts the summary.",
    ],
  },
  tasks: {
    inspect: [
      "Read the existing Tasks profile before asking questions.",
      "Inspect a bounded task sample across inbox, planned, scheduled, overdue, and completed work.",
      "Learn capture location, priority, estimates, scheduling, and deadline meanings; ask only about unresolved choices.",
      "Save a draft profile with explicit exceptions.",
    ],
    requiredTools: ["get_domain_profile", "list_tasks", "save_domain_profile"],
    review: [
      "Summarize the planning guidance and examples covered by the draft.",
      "Activate guidance only after the user accepts the summary.",
    ],
  },
};

export function createAssistantService({
  appBaseUrl = "http://localhost",
  db,
  now,
  profileRequiresApproval,
  validateProfileSources,
}: {
  appBaseUrl?: string;
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

  async function getSetupStatus(principal: Principal): Promise<AssistantSetupStatus> {
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
  }

  async function getObservedAgentAccess(principal: Principal): Promise<{
    lastObservedAt: string | null;
    observed: boolean;
    scopes: ReadonlySet<AccessScope>;
  }> {
    if (principal.actorType === "agent") {
      return {
        lastObservedAt: now().toISOString(),
        observed: true,
        scopes: principal.scopes,
      };
    }
    const observedCredentials = await db
      .select({ lastUsedAt: accessTokens.lastUsedAt, scopes: accessTokens.scopes })
      .from(accessTokens)
      .where(
        and(
          eq(accessTokens.userId, principal.userId),
          isNull(accessTokens.revokedAt),
          isNotNull(accessTokens.lastUsedAt),
          or(isNull(accessTokens.expiresAt), gt(accessTokens.expiresAt, now())),
        ),
      );
    const scopes = new Set(observedCredentials.flatMap((credential) => credential.scopes));
    const lastObservedAt = observedCredentials
      .map((credential) => credential.lastUsedAt)
      .filter((value): value is Date => value !== null)
      .toSorted((left, right) => left.getTime() - right.getTime())
      .at(-1);
    return {
      lastObservedAt: lastObservedAt?.toISOString() ?? null,
      observed: observedCredentials.length > 0,
      scopes,
    };
  }

  return {
    async getContext(principal: Principal): Promise<IloAgentContext> {
      const [user, readiness] = await Promise.all([
        db
          .select({ displayName: users.displayName, planningTimezone: users.planningTimezone })
          .from(users)
          .where(eq(users.id, principal.userId))
          .limit(1)
          .then(([record]) => record),
        getSetupStatus(principal),
      ]);
      if (!user) throw new AppError("not_found", "The nohmi account was not found.");
      const link = (path: string) => new URL(path, appBaseUrl).href;
      const timestamp = now().toISOString();
      return {
        access: { grantedScopes: [...principal.scopes].toSorted() },
        generatedAt: timestamp,
        identity: {
          actorType: principal.actorType,
          displayName: user.displayName,
          userId: principal.userId,
        },
        links: {
          activity: link("/activity"),
          agentAccess: link("/settings?section=workspace-access"),
          approvals: link("/reviews"),
          recovery: link("/settings?section=connections"),
          today: link("/today"),
        },
        readiness,
        time: { timestamp, timezone: user.planningTimezone },
      };
    },

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

    getSetupStatus,

    async getSetupPlan(
      principal: Principal,
      query: AssistantSetupPlanQuery,
    ): Promise<AssistantSetupPlan> {
      const domain = query.domain ?? "mail";
      const [setup, connection] = await Promise.all([
        getSetupStatus(principal),
        getObservedAgentAccess(principal),
      ]);
      const domainStatus = setup.domains.find((item) => item.domain === domain);
      if (!domainStatus) throw new AppError("not_found", "The setup domain was not found.");
      const access = featureAccessPolicies[domain];
      const canRead = connection.scopes.has(access.readScope);
      const canWrite = connection.scopes.has(access.writeScope);
      const profileExists = domainStatus.profileVersion !== null;
      const profileActive =
        domainStatus.profileStatus === "active" || domainStatus.approvedProfileStatus === "active";
      const currentStepId = !connection.observed
        ? "connect_agent"
        : !canRead || !canWrite || !profileExists
          ? "learn_preferences"
          : !profileActive
            ? "review_guidance"
            : "complete";
      const recipe = setupRecipes[domain];
      const steps: AssistantSetupStep[] = [
        {
          completionEvidence: connection.observed
            ? [
                principal.actorType === "agent"
                  ? "This authenticated MCP caller reached nohmi."
                  : `An authenticated agent last reached nohmi at ${connection.lastObservedAt}.`,
              ]
            : [],
          description: "Authorize one MCP host so nohmi can identify its actual scoped authority.",
          id: "connect_agent",
          instructions: [
            "Connect the host to the nohmi MCP URL and complete OAuth when the host supports it.",
            "Do not request provider credentials; they remain inside nohmi.",
          ],
          order: 1,
          owner: "person",
          requiredTools: [],
          state: connection.observed ? "complete" : "current",
          title: "Connect an agent",
          userAction: connection.observed ? null : "Connect an MCP-compatible agent host to nohmi.",
        },
        {
          completionEvidence: profileExists
            ? [`${domain} guidance exists at profile version ${domainStatus.profileVersion}.`]
            : [],
          description:
            "Inspect existing nohmi material, infer useful defaults, and ask only about unresolved preferences.",
          id: "learn_preferences",
          instructions: recipe.inspect,
          order: 2,
          owner: "agent",
          requiredTools: recipe.requiredTools,
          state: profileExists
            ? "complete"
            : connection.observed && canRead && canWrite
              ? "current"
              : "blocked",
          title: `Learn ${domain} preferences`,
          userAction:
            connection.observed && canRead && canWrite
              ? "Answer only the preference questions the agent cannot resolve from nohmi evidence."
              : null,
        },
        {
          completionEvidence: profileActive
            ? [
                domainStatus.approvedProfileStatus === "active"
                  ? `Signed-in approval is active at version ${domainStatus.approvedProfileVersion}.`
                  : `${domain} guidance is active at version ${domainStatus.profileVersion}.`,
              ]
            : profileExists
              ? [`Draft guidance is waiting at version ${domainStatus.profileVersion}.`]
              : [],
          description:
            "Show what the guidance covers, preview consequential behavior, and preserve the approval boundary.",
          id: "review_guidance",
          instructions: recipe.review,
          order: 3,
          owner: "person",
          requiredTools: [],
          state: profileActive ? "complete" : profileExists ? "current" : "blocked",
          title: "Review the proposed guidance",
          userAction:
            profileExists && !profileActive
              ? profileRequiresApproval(domain)
                ? `Review and approve the ${domain} guidance while signed in to nohmi.`
                : "Accept or revise the agent's summary before it activates the guidance."
              : null,
        },
        {
          completionEvidence:
            connection.observed && profileActive
              ? ["nohmi observes both an authenticated agent and active domain guidance."]
              : [],
          description: "nohmi confirms setup from observed connection and guidance state.",
          id: "complete",
          instructions: [
            "Call get_ilo_setup again after saving or approval to verify the terminal state.",
            "Report active versus draft behavior and any remaining human-only boundary.",
          ],
          order: 4,
          owner: "ilo",
          requiredTools: ["get_ilo_setup"],
          state: connection.observed && profileActive ? "complete" : "blocked",
          title: "Confirm setup",
          userAction: null,
        },
      ];
      const status = !connection.observed
        ? "needs_connection"
        : !canRead || !canWrite
          ? "blocked"
          : !profileExists
            ? "in_progress"
            : !profileActive
              ? "needs_input"
              : "complete";
      const nextAction = !connection.observed
        ? "Connect an MCP-compatible host to nohmi."
        : !canRead || !canWrite
          ? `Reconnect the agent with both ${access.readScope} and ${access.writeScope}.`
          : !profileExists
            ? `The agent should inspect ${domain} material and save a draft profile.`
            : !profileActive
              ? `Review ${domain} draft version ${domainStatus.profileVersion} and accept or revise it.`
              : `${domain} setup is active. The agent should report its exact scope and remaining boundaries.`;
      return {
        access: { canRead, canWrite },
        connection: {
          lastObservedAt: connection.lastObservedAt,
          observed: connection.observed,
        },
        currentStepId,
        domain,
        nextAction,
        profile: {
          approvedStatus: domainStatus.approvedProfileStatus,
          approvedVersion: domainStatus.approvedProfileVersion,
          pendingDraftVersion: domainStatus.pendingDraftVersion,
          status: domainStatus.profileStatus,
          version: domainStatus.profileVersion,
        },
        progress: {
          completed: steps.filter((step) => step.state === "complete").length,
          total: steps.length,
        },
        protocolVersion: "1.0",
        selectedStepId: query.stepId ?? currentStepId,
        status,
        steps,
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
