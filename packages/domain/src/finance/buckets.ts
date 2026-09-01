import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";
import { financeMonthSchema } from "./budget.js";
import { financeMutationMetaSchema } from "./common.js";

const bucketNameSchema = z.string().trim().min(1).max(80);
const bucketDescriptionSchema = z.string().trim().max(240).nullable();

export const financeBudgetBucketSchema = z.object({
  categories: z.array(idSchema),
  createdAt: isoDateTimeSchema,
  description: bucketDescriptionSchema,
  id: idSchema,
  name: bucketNameSchema,
  position: z.number().int().nonnegative(),
  updatedAt: isoDateTimeSchema,
  version: z.number().int().positive(),
});
export type FinanceBudgetBucket = z.infer<typeof financeBudgetBucketSchema>;

export const financeBudgetBucketRollupSchema = z.object({
  bucketId: idSchema.nullable(),
  budgeted: z.number().finite().nonnegative(),
  categoryIds: z.array(idSchema),
  label: z.string().min(1),
  remaining: z.number().finite(),
  spent: z.number().finite().nonnegative(),
});
export type FinanceBudgetBucketRollup = z.infer<typeof financeBudgetBucketRollupSchema>;

export const financeBudgetBucketTaxonomySchema = z.object({
  buckets: z.array(financeBudgetBucketSchema),
  createdAt: isoDateTimeSchema,
  description: bucketDescriptionSchema,
  id: idSchema,
  isActive: z.boolean(),
  name: z.string().trim().min(1).max(120),
  rollups: z.array(financeBudgetBucketRollupSchema),
  updatedAt: isoDateTimeSchema,
  version: z.number().int().positive(),
});
export type FinanceBudgetBucketTaxonomy = z.infer<typeof financeBudgetBucketTaxonomySchema>;

export const financeBudgetBucketListSchema = z.object({
  taxonomy: financeBudgetBucketTaxonomySchema.nullable(),
});
export type FinanceBudgetBucketList = z.infer<typeof financeBudgetBucketListSchema>;

export const financeBudgetBucketQuerySchema = z.object({
  month: financeMonthSchema.optional(),
});
export type FinanceBudgetBucketQuery = z.infer<typeof financeBudgetBucketQuerySchema>;

export const createFinanceBudgetBucketInputSchema = financeMutationMetaSchema.and(
  z.object({
    description: bucketDescriptionSchema.default(null),
    name: bucketNameSchema,
  }),
);
export type CreateFinanceBudgetBucketInput = z.infer<typeof createFinanceBudgetBucketInputSchema>;

export const updateFinanceBudgetBucketInputSchema = financeMutationMetaSchema.and(
  z.object({
    bucketId: idSchema,
    description: bucketDescriptionSchema.optional(),
    expectedVersion: z.number().int().positive(),
    name: bucketNameSchema.optional(),
    categoryIds: z.array(idSchema).max(200).optional(),
    position: z.number().int().nonnegative().optional(),
  }),
);
export type UpdateFinanceBudgetBucketInput = z.infer<typeof updateFinanceBudgetBucketInputSchema>;

export const manageFinanceBudgetBucketInputSchema = z.discriminatedUnion("operation", [
  z.object({
    ...financeMutationMetaSchema.shape,
    description: bucketDescriptionSchema.default(null),
    name: bucketNameSchema,
    operation: z.literal("create"),
  }),
  z.object({
    ...financeMutationMetaSchema.shape,
    bucketId: idSchema,
    categoryIds: z.array(idSchema).max(200).optional(),
    description: bucketDescriptionSchema.optional(),
    expectedVersion: z.number().int().positive(),
    name: bucketNameSchema.optional(),
    operation: z.literal("update"),
    position: z.number().int().nonnegative().optional(),
  }),
]);
export type ManageFinanceBudgetBucketInput = z.infer<typeof manageFinanceBudgetBucketInputSchema>;
