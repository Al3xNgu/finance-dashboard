import { z } from "zod";

// Shared between client and server — no server-only imports here.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

/** Query params come in as strings; booleans must be explicit ("false" is falsy here). */
const boolParam = z.enum(["true", "false"]).transform((v) => v === "true");

export const transactionSortSchema = z.enum(["date", "amount", "merchant"]);
export const sortOrderSchema = z.enum(["asc", "desc"]);

export const listTransactionsQuerySchema = z
  .object({
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    categoryId: z.string().min(1).optional(),
    accountId: z.string().min(1).optional(),
    merchant: z.string().trim().min(1).max(200).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    minAmountCents: z.coerce.number().int().optional(),
    maxAmountCents: z.coerce.number().int().optional(),
    pending: boolParam.optional(),
    sort: transactionSortSchema.default("date"),
    order: sortOrderSchema.default("desc"),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).optional(),
  })
  .refine(
    (q) => !(q.dateFrom && q.dateTo) || q.dateFrom <= q.dateTo,
    "dateFrom must not be after dateTo.",
  )
  .refine(
    (q) =>
      q.minAmountCents === undefined ||
      q.maxAmountCents === undefined ||
      q.minAmountCents <= q.maxAmountCents,
    "minAmountCents must not exceed maxAmountCents.",
  );

export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;
