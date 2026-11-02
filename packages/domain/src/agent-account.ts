import { z } from "zod";
import type { AccessScope } from "./auth.js";

export const agentPlatformSchema = z.enum(["claude", "codex", "other", "unknown"]);
export type AgentPlatform = z.infer<typeof agentPlatformSchema>;
export const agentAccountUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    accountLabel: z.string().trim().max(80).nullable().optional(),
    platform: agentPlatformSchema.optional(),
  })
  .strict();
export const agentAccountLinkSchema = z
  .object({
    agentAccountId: z.uuid().nullable(),
    platform: agentPlatformSchema.optional(),
  })
  .strict();
export const agentAccountRegistrationSchema = z
  .object({ platform: agentPlatformSchema.optional() })
  .strict();
export const agentAccountSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  platform: agentPlatformSchema,
  displayName: z.string().min(1).max(80),
  accountLabel: z.string().max(80).nullable(),
  avatarSeed: z.uuid(),
  avatarVersion: z.literal(1),
  identitySource: z.enum(["connection", "user_confirmed"]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AgentAccount = z.infer<typeof agentAccountSchema>;
export type AgentAccountConnection = {
  id: string;
  label: string;
  agentAccountId: string | null;
  scopes: AccessScope[];
  active: boolean;
  lastUsedAt: string | null;
};
export type AgentAccountDirectory = {
  accounts: AgentAccount[];
  connections: AgentAccountConnection[];
};
/** A display name is stable presentation, never a credential or matching key. */
export function generatedAgentName(seed: string): string {
  const adjectives = ["Amber", "Silver", "Quiet", "Cedar", "Bright", "Gentle", "Indigo", "Golden"];
  const nouns = ["Finch", "Pine", "Maple", "Heron", "Otter", "Willow", "Robin", "Aspen"];
  const value = Number.parseInt(seed.replaceAll("-", "").slice(0, 8), 16) || 0;
  return `${adjectives[value % adjectives.length]} ${nouns[Math.floor(value / adjectives.length) % nouns.length]} ${seed.slice(-4)}`;
}
