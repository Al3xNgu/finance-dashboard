import { z } from "zod";

// Shared between client and server — no server-only imports here.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const aggregateGroupBySchema = z.enum([
  "category",
  "category_top",
  "month",
  "week",
  "merchant",
  "account",
  "flow",
]);

export const aggregateMetricSchema = z.enum(["sum", "count", "avg"]);

export const aggregateFlowSchema = z.enum(["expense", "income", "transfer"]);

export const aggregateQuerySchema = z
  .object({
    groupBy: aggregateGroupBySchema,
    metric: aggregateMetricSchema.default("sum"),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    // Flow filter. When omitted: "expense" (transfers and income excluded from
    // spending views) — unless groupBy=flow, which returns all flows so income
    // vs expenses can be compared in one call. See D-012 / ARCHITECTURE.md §4.
    flow: aggregateFlowSchema.optional(),
    categoryId: z.string().min(1).optional(),
    accountId: z.string().min(1).optional(),
    merchant: z.string().trim().min(1).max(200).optional(),
    pending: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .refine(
    (q) => !(q.dateFrom && q.dateTo) || q.dateFrom <= q.dateTo,
    "dateFrom must not be after dateTo.",
  );

export type AggregateQuery = z.infer<typeof aggregateQuerySchema>;
