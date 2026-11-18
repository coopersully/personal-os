import { z } from "zod";
import { idSchema } from "../common.js";
import {
  financeConversationBatchSchema,
  financeConversationMessageSchema,
  financeConversationSequenceSchema,
} from "./conversation.js";

/** Body-free shape only. No owner authority, native membership or cursor authenticity is proved. */
export const repairContextHeldReasonSchema = z.enum([
  "original_binding_unavailable",
  "host_binding_changed",
  "authority_unavailable",
  "consent_changed",
  "expired",
  "source_changed",
  "source_resolved",
  "context_revision_changed",
  "reserved_run_failed",
  "proof_unavailable",
]);
export type RepairContextHeldReason = z.infer<typeof repairContextHeldReasonSchema>;
export const financeRepairContextHeldEntrySchema = z
  .object({
    kind: z.literal("repair_context_held"),
    messageId: idSchema,
    sequence: financeConversationSequenceSchema,
    routeId: idSchema,
    state: z.enum(["held", "expired", "uncertain"]),
    reason: repairContextHeldReasonSchema,
  })
  .strict();
export type FinanceRepairContextHeldEntry = z.infer<typeof financeRepairContextHeldEntrySchema>;
/**
 * Future adapter obligations, not implemented by this DTO:
 * - Negotiate V2 explicitly; retain V1 shape and atomically reject affected V1 pages with
 *   conflict reasonCode repair_context_page_upgrade_required before body/deliveredAt writes.
 * - Keep the deployed V1 cursor envelope; use a distinct V2 signing domain bound to version.
 *   Reject V2 -> V1; any V1 -> V2 transition needs its own validated same-batch contract.
 * - Process at most the requested total membership limit (protocol ceiling 100). Limit+1 is
 *   unprocessed lookahead, never a cursor position. Cursor follows last processed body OR held
 *   membership. All-held pages advance, including a final all-held page with null nextCursor.
 * - Classify minimal route metadata under current authority/consent/deadline before serializing
 *   permitted bodies. Held entries never record delivery or ack. Body release, acknowledgement
 *   and accepted causal consumption remain distinct; end of pagination implies none of them.
 *
 * These validators implement no negotiation, signing, routing, disclosure or consumption gate.
 */
export const financeRepairContextPageV2Schema = z
  .object({
    pageVersion: z.literal(2),
    batch: financeConversationBatchSchema,
    messages: z.array(financeConversationMessageSchema).max(100),
    heldEntries: z.array(financeRepairContextHeldEntrySchema).max(100),
    nextCursor: z.string().min(1).max(2000).nullable(),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.messages.length + page.heldEntries.length > 100)
      context.addIssue({ code: "custom", message: "The total processed membership limit is 100." });
    // Dirty regex/range issues may still reach superRefine: never BigInt invalid input.
    if (!financeConversationSequenceSchema.safeParse(page.batch.cutoffSequence).success) return;
    const ids = new Set<string>();
    const sequences = new Set<string>();
    for (const rows of [
      page.messages.map((m) => ({ id: m.id, sequence: m.sequence })),
      page.heldEntries.map((h) => ({ id: h.messageId, sequence: h.sequence })),
    ]) {
      let previous = 0n;
      for (const row of rows) {
        if (!financeConversationSequenceSchema.safeParse(row.sequence).success) continue;
        const sequence = BigInt(row.sequence);
        if (
          sequence <= previous ||
          sequence > BigInt(page.batch.cutoffSequence) ||
          ids.has(row.id) ||
          sequences.has(row.sequence)
        )
          context.addIssue({
            code: "custom",
            message: "Page memberships must be unique, ordered and within cutoff.",
          });
        ids.add(row.id);
        sequences.add(row.sequence);
        previous = sequence;
      }
    }
  });
export type FinanceRepairContextPageV2 = z.infer<typeof financeRepairContextPageV2Schema>;
