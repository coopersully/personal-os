import { isDeepStrictEqual } from "node:util";
import {
  type AssistantDomain,
  type DomainProfile,
  reminderDraftProfilePreferencesSchema,
  reminderProfilePreferencesSchema,
  type UpsertDomainProfileInput,
} from "@personal-os/domain";
import type { z } from "zod";

type PreferenceValidator = {
  active: z.ZodType;
  draft: z.ZodType;
};

const preferenceSchemas: Partial<Record<AssistantDomain, PreferenceValidator>> = {
  reminders: {
    active: reminderProfilePreferencesSchema,
    draft: reminderDraftProfilePreferencesSchema,
  },
};

/**
 * Domain-owned preference contracts plug into the shared profile service here
 * without coupling the generic domain-profile schema to individual features.
 */
export function normalizeDomainProfilePreferences(
  input: UpsertDomainProfileInput,
  existing?: Pick<DomainProfile, "preferences" | "status">,
): UpsertDomainProfileInput["preferences"] {
  const schemas = preferenceSchemas[input.domain];
  if (!schemas) return input.preferences;
  if (
    input.status === "active" &&
    existing?.status === "active" &&
    isDeepStrictEqual(existing.preferences, input.preferences)
  ) {
    return input.preferences;
  }
  return (input.status === "draft" ? schemas.draft : schemas.active).parse(
    input.preferences,
  ) as UpsertDomainProfileInput["preferences"];
}
