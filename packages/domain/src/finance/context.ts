import { z } from "zod";
import { idSchema } from "../common.js";

const revision = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .refine((value) => value.length < 19 || value <= "9223372036854775807");
const instant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString())
  .nullable();
const content = {
  text: z.string().trim().min(1).max(10_000),
  validFrom: instant,
  validThrough: instant,
  participants: z.array(z.string().trim().min(1).max(200)).max(50),
  paymentChannel: z.string().trim().min(1).max(100).nullable(),
  expectedCents: z.number().int().safe().nullable(),
  categoryId: z.null(),
  transactionIds: z.array(z.never()).max(0),
};
/** Capture-only input: references and provenance are assigned by the service. */
export const captureFinanceContextInputSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("create"), operationId: idSchema, ...content }).strict(),
    z
      .object({
        type: z.literal("revise"),
        operationId: idSchema,
        id: idSchema,
        expectedRevision: revision,
        ...content,
      })
      .strict(),
    z
      .object({
        type: z.literal("cancel"),
        operationId: idSchema,
        id: idSchema,
        expectedRevision: revision,
      })
      .strict(),
  ])
  .refine(
    (input) =>
      input.type === "cancel" ||
      input.validFrom === null ||
      input.validThrough === null ||
      input.validFrom <= input.validThrough,
    { message: "Context validity bounds must be ordered." },
  );
export type CaptureFinanceContextInput = z.infer<typeof captureFinanceContextInputSchema>;
