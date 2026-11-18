import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common.js";

/** Normalized tags are at most this many characters (Unicode code points). */
export const knowledgeTagMaxLength = 40;
export const knowledgeTagsMax = 8;
export const knowledgeTagIndexMaxLimit = 500;

/**
 * Mechanical normalization only: NFC, lowercase, trim, runs of spaces and underscores become one
 * hyphen, other punctuation is stripped, and the result is capped at 40 characters. Returns null
 * when nothing is left. Similar tags are folded by the API against existing owner tags, not here.
 */
export function normalizeKnowledgeTag(raw: string): string | null {
  const hyphenated = raw
    .normalize("NFC")
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/gu, "-")
    .replace(/[^\p{L}\p{M}\p{N}-]/gu, "")
    .replace(/-{2,}/gu, "-");
  const tag = trimHyphens(
    Array.from(trimHyphens(hyphenated)).slice(0, knowledgeTagMaxLength).join(""),
  ).normalize("NFC");
  // A tag needs a letter or number; a lone combining mark or hyphen is not a tag.
  return /[\p{L}\p{N}]/u.test(tag) ? tag : null;
}

/** Strips leading and trailing hyphens in linear time (an anchored `-+$` regex backtracks). */
function trimHyphens(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === "-") start += 1;
  while (end > start && value[end - 1] === "-") end -= 1;
  return value.slice(start, end);
}

/** One tag as a caller writes it; parses to its normalized form. */
export const knowledgeTagNameSchema = z.string().transform((raw, context) => {
  const tag = normalizeKnowledgeTag(raw);
  if (tag === null) {
    context.addIssue({
      code: "custom",
      message: `The tag ${JSON.stringify(raw)} has no letters or numbers.`,
    });
    return z.NEVER;
  }
  return tag;
});

/** 1–8 tags, normalized and deduplicated. */
export const knowledgeTagsInputSchema = z
  .array(knowledgeTagNameSchema)
  .min(1)
  .max(knowledgeTagsMax)
  .transform((tags) => [...new Set(tags)]);

/** Files tag `from` under tag `into`; `from` becomes an alias of `into`. */
export const knowledgeTagMergeInputSchema = z
  .object({ from: knowledgeTagNameSchema, into: knowledgeTagNameSchema, mutationKey: z.uuid() })
  .strict();
export type KnowledgeTagMergeInput = z.input<typeof knowledgeTagMergeInputSchema>;
/** Person-only: restores `from` on the records the merge retagged and removes its alias. */
export const knowledgeTagUnmergeInputSchema = z
  .object({ mergeId: z.uuid(), mutationKey: z.uuid() })
  .strict();
export type KnowledgeTagUnmergeInput = z.input<typeof knowledgeTagUnmergeInputSchema>;
/** A merge as stored; `undoneAt` is set once the person undoes it. */
export const knowledgeTagMergeSchema = z
  .object({
    mergeId: idSchema,
    from: z.string(),
    into: z.string(),
    undoneAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export type KnowledgeTagMerge = z.infer<typeof knowledgeTagMergeSchema>;

export const knowledgeTagIndexInputSchema = z
  .object({ limit: z.int().min(1).max(knowledgeTagIndexMaxLimit).optional() })
  .strict();
export type KnowledgeTagIndexInput = z.infer<typeof knowledgeTagIndexInputSchema>;
/**
 * The caller's canonical tags with the number of records it can see, most used first, and the
 * aliases that resolve to them. `mergeId` names the merge that created the alias, for undo.
 */
export const knowledgeTagIndexSchema = z
  .object({
    tags: z.array(z.object({ name: z.string(), count: z.int().positive() }).strict()),
    aliases: z.array(z.object({ alias: z.string(), name: z.string(), mergeId: idSchema }).strict()),
  })
  .strict();
export type KnowledgeTagIndex = z.infer<typeof knowledgeTagIndexSchema>;
