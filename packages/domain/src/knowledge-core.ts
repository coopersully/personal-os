import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common.js";
import { type KnowledgeRecordSnapshot, knowledgeOriginSchema } from "./knowledge.js";

/** The whole session-start memory section, as UTF-8 bytes of its JSON. */
export const knowledgeCoreMaxBytes = 4096;
/** The tag index's reserved share of the section, so tag reuse always works. */
export const knowledgeCoreTagBytes = 1024;
export const knowledgeCoreMaxRecords = 30;
export const knowledgeCoreMaxTags = 100;
/** A core record whose text exceeds this many bytes is listed by ID and label instead. */
export const knowledgeCoreRecordMaxBytes = 1024;
export const knowledgeCoreHint =
  "Search memory with search_user_knowledge for anything not listed here.";

export const knowledgeCoreRecordSchema = z
  .object({
    id: idSchema,
    text: z.string(),
    tags: z.array(z.string()),
    origin: knowledgeOriginSchema,
    ownerHeld: z.boolean(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export const knowledgeCoreLabelSchema = z.object({ id: idSchema, label: z.string() }).strict();
/**
 * The compact memory loaded at the start of every session: core records, the tag index and
 * counts the caller may see. Agents fetch anything else with search or by ID.
 */
export const knowledgeCoreSchema = z
  .object({
    records: z
      .array(z.union([knowledgeCoreRecordSchema, knowledgeCoreLabelSchema]))
      .max(knowledgeCoreMaxRecords),
    tagIndex: z
      .array(z.object({ name: z.string(), count: z.int().positive() }).strict())
      .max(knowledgeCoreMaxTags),
    counts: z
      .object({
        active: z.int().nonnegative(),
        conflicts: z.int().nonnegative(),
        archived: z.int().nonnegative(),
      })
      .strict(),
    truncated: z.object({ records: z.boolean(), tags: z.boolean() }).strict(),
    hint: z.literal(knowledgeCoreHint),
  })
  .strict();
export type KnowledgeCore = z.infer<typeof knowledgeCoreSchema>;
export type KnowledgeCoreEntry = KnowledgeCore["records"][number];

function label(value: string) {
  return value.replace(/_/g, " ").replace(/^./, (character) => character.toUpperCase());
}

/** A memory's readable title and text, shared by the app and the session-start core. */
export function knowledgeSummary(content: KnowledgeRecordSnapshot["content"]): {
  title: string;
  text: string;
} {
  switch (content.kind) {
    case "fact":
      return {
        title:
          content.value.subject === "owner"
            ? label(content.value.predicate)
            : `${content.value.subject} · ${content.value.predicate}`,
        text: String(content.value.value.value),
      };
    case "preference": {
      const { subject, key, value } = content.value;
      const title = label(key);
      return {
        title: subject === "owner" ? title : `${subject} · ${title}`,
        text: String(value.value),
      };
    }
    case "relationship":
      return {
        title: content.value.relationship,
        text: `${content.value.subjectId} ${content.value.direction === "directed" ? "→" : "↔"} ${content.value.objectId}`,
      };
    case "goal":
      return { title: "Linked goal", text: content.value.goalId };
    case "constraint":
      return {
        title: content.value.subject,
        text: `${content.value.condition} · ${content.value.boundary}`,
      };
    case "routine":
      return { title: content.value.subject, text: content.value.recurrence };
    case "decision":
      return {
        title: content.value.subject,
        text: `${content.value.option} · ${content.value.reason}`,
      };
    case "entity_meaning":
      return { title: "Record meaning", text: content.value.meaning };
    case "inference":
      return { title: content.value.subject, text: content.value.proposition };
  }
}
