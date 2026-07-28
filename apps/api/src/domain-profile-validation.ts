import {
  type AssistantDomain,
  reminderProfilePreferencesSchema,
  type UpsertDomainProfileInput,
} from "@personal-os/domain";
import type { z } from "zod";

const preferenceSchemas: Partial<Record<AssistantDomain, z.ZodType>> = {
  reminders: reminderProfilePreferencesSchema,
};

/**
 * Domain-owned preference contracts plug into the shared profile service here
 * without coupling the generic domain-profile schema to individual features.
 */
export function validateDomainProfilePreferences(input: UpsertDomainProfileInput): void {
  preferenceSchemas[input.domain]?.parse(input.preferences);
}
