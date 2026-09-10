import { auditEvents, type Database, domainProfiles } from "@personal-os/database";
import { type ActorType, calendarProfilePreferencesSchema } from "@personal-os/domain";
import { and, eq } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { AppError } from "./errors.js";
import { auditDomainProfileMetadata, domainProfileChangedFields } from "./serialization.js";

type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type CalendarProfileInvalidationContext = {
  principal: {
    actorId: string;
    actorType: ActorType;
    userId: string;
  };
  requestId: string;
};

/**
 * Keep a durable Calendar profile honest when a referenced source disappears or
 * its default destination loses write capability.
 */
export async function invalidateCalendarProfileSources(
  transaction: DatabaseTransaction,
  input: {
    context: CalendarProfileInvalidationContext;
    now: Date;
    unavailableCalendarIds?: string[];
    unwritableCalendarIds?: string[];
    userId: string;
  },
): Promise<void> {
  const unavailable = new Set(input.unavailableCalendarIds ?? []);
  const unwritable = new Set(input.unwritableCalendarIds ?? []);
  if (unavailable.size === 0 && unwritable.size === 0) return;
  const [profile] = await transaction
    .select()
    .from(domainProfiles)
    .where(and(eq(domainProfiles.userId, input.userId), eq(domainProfiles.domain, "calendar")))
    .for("update")
    .limit(1);
  if (!profile) return;
  const parsedPreferences = calendarProfilePreferencesSchema.safeParse(profile.preferences);
  const defaultCalendarId = parsedPreferences.success
    ? parsedPreferences.data.defaultCalendarId
    : typeof profile.preferences.defaultCalendarId === "string"
      ? profile.preferences.defaultCalendarId
      : null;
  const removedSource = profile.sourceContexts.some((source) => unavailable.has(source.sourceId));
  const invalidDefault =
    defaultCalendarId !== null &&
    (unavailable.has(defaultCalendarId) || unwritable.has(defaultCalendarId));
  if (!removedSource && !(invalidDefault && profile.status === "active")) return;
  const nextSourceContexts = profile.sourceContexts.filter(
    (source) => !unavailable.has(source.sourceId),
  );
  const [updated] = await transaction
    .update(domainProfiles)
    .set({
      sourceContexts: nextSourceContexts,
      status: profile.status === "active" ? "draft" : profile.status,
      updatedAt: input.now,
      version: profile.version + 1,
    })
    .where(and(eq(domainProfiles.id, profile.id), eq(domainProfiles.version, profile.version)))
    .returning();
  if (!updated) {
    throw new AppError(
      "conflict",
      "The Calendar profile changed while an unavailable source was being removed.",
    );
  }
  const changedFields = domainProfileChangedFields(profile, updated);
  await transaction.insert(auditEvents).values(
    auditValues({
      action: "assistant.profile.updated",
      after: auditDomainProfileMetadata(updated, changedFields),
      before: auditDomainProfileMetadata(profile, changedFields),
      entityId: updated.id,
      entityType: "domain_profile",
      ...input.context,
    }),
  );
}
