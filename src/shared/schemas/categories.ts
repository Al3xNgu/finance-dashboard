import { z } from "zod";

// Shared between client and server — no server-only imports here.

export const categoryFlowSchema = z.enum(["EXPENSE", "INCOME", "TRANSFER"]);

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  parentId: z.string().optional(),
  flow: categoryFlowSchema.default("EXPENSE"),
});

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    parentId: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const createCategoryRuleSchema = z.object({
  categoryId: z.string().min(1),
  priority: z.number().int().min(0).max(10_000),
  matchField: z.enum(["MERCHANT_NAME", "DESCRIPTION"]).default("MERCHANT_NAME"),
  matchType: z.enum(["CONTAINS", "EQUALS", "STARTS_WITH"]).default("CONTAINS"),
  matchValue: z.string().trim().min(1).max(200),
  minAmountCents: z.number().int().optional(),
  maxAmountCents: z.number().int().optional(),
  accountId: z.string().optional(),
});

export const updateCategoryRuleSchema = createCategoryRuleSchema
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

/** PATCH /transactions/:id — set a manual category, or clear the override. */
export const patchTransactionSchema = z.union([
  z.object({ categoryId: z.string().nullable() }),
  z.object({ clearOverride: z.literal(true) }),
]);

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type CreateCategoryRuleInput = z.infer<typeof createCategoryRuleSchema>;
