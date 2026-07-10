import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db/client";
import { centsToNumber } from "@/server/lib/money";
import type { AggregateQuery } from "@/shared/schemas/aggregates";

export interface AggregateBucketDto {
  key: string;
  label: string;
  valueCents: number;
  count: number;
}

export interface AggregateResultDto {
  rows: AggregateBucketDto[];
  meta: {
    currency: "USD";
    groupBy: AggregateQuery["groupBy"];
    metric: AggregateQuery["metric"];
    /** The flow filter actually applied ("all" when groupBy=flow and none given). */
    flow: string;
    dateFrom: string | null;
    dateTo: string | null;
  };
}

/**
 * D-012 guardrail: every SQL identifier/expression is a hardcoded fragment
 * selected by a Zod-validated enum — user input only ever binds as a
 * parameter. Uncategorized (categoryId null) buckets as flow EXPENSE.
 */
const GROUP_EXPRESSIONS: Record<
  AggregateQuery["groupBy"],
  { key: string; label: string; timeBucket: boolean }
> = {
  category: {
    key: `COALESCE(c."id", 'uncategorized')`,
    label: `COALESCE(c."name", 'Uncategorized')`,
    timeBucket: false,
  },
  category_top: {
    // children roll up into their parent; the tree is at most two levels
    key: `COALESCE(cp."id", c."id", 'uncategorized')`,
    label: `COALESCE(cp."name", c."name", 'Uncategorized')`,
    timeBucket: false,
  },
  month: {
    key: `to_char(t."date", 'YYYY-MM')`,
    label: `to_char(t."date", 'YYYY-MM')`,
    timeBucket: true,
  },
  week: {
    key: `to_char(date_trunc('week', t."date"), 'YYYY-MM-DD')`,
    label: `to_char(date_trunc('week', t."date"), 'YYYY-MM-DD')`,
    timeBucket: true,
  },
  merchant: {
    key: `COALESCE(t."merchantName", t."name")`,
    label: `COALESCE(t."merchantName", t."name")`,
    timeBucket: false,
  },
  account: { key: `t."accountId"`, label: `a."name"`, timeBucket: false },
  flow: {
    key: `COALESCE(c."flow"::text, 'EXPENSE')`,
    label: `COALESCE(c."flow"::text, 'EXPENSE')`,
    timeBucket: false,
  },
};

const METRIC_ORDER: Record<AggregateQuery["metric"], string> = {
  sum: `SUM(t."amountCents") DESC`,
  avg: `AVG(t."amountCents") DESC`,
  count: `COUNT(*) DESC`,
};

const FLOW_VALUES = {
  expense: "EXPENSE",
  income: "INCOME",
  transfer: "TRANSFER",
} as const;

/** Escape LIKE wildcards; backslash is Postgres's default escape character. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

interface RawRow {
  key: string;
  label: string;
  sum_cents: bigint | null;
  count: bigint;
}

export async function aggregateTransactions(
  userId: string,
  q: AggregateQuery,
): Promise<AggregateResultDto> {
  const group = GROUP_EXPRESSIONS[q.groupBy];

  // Spending views exclude transfers and income by default; groupBy=flow
  // compares the flows, so no implicit filter there.
  const effectiveFlow = q.flow ?? (q.groupBy === "flow" ? undefined : "expense");

  const conditions: Prisma.Sql[] = [
    Prisma.sql`t."userId" = ${userId}`,
    Prisma.sql`t."deletedAt" IS NULL`,
  ];
  if (q.dateFrom) conditions.push(Prisma.sql`t."date" >= ${q.dateFrom}::date`);
  if (q.dateTo) conditions.push(Prisma.sql`t."date" <= ${q.dateTo}::date`);
  if (effectiveFlow) {
    conditions.push(
      Prisma.sql`COALESCE(c."flow"::text, 'EXPENSE') = ${FLOW_VALUES[effectiveFlow]}`,
    );
  }
  if (q.categoryId) {
    const uncategorized = await db.category.findUnique({
      where: { slug: "uncategorized" },
      select: { id: true },
    });
    conditions.push(
      q.categoryId === uncategorized?.id
        ? Prisma.sql`(t."categoryId" = ${q.categoryId} OR t."categoryId" IS NULL)`
        : Prisma.sql`t."categoryId" = ${q.categoryId}`,
    );
  }
  if (q.accountId) conditions.push(Prisma.sql`t."accountId" = ${q.accountId}`);
  if (q.merchant) {
    conditions.push(
      Prisma.sql`t."merchantName" ILIKE ${`%${escapeLike(q.merchant)}%`}`,
    );
  }
  if (q.pending !== undefined) {
    conditions.push(Prisma.sql`t."pending" = ${q.pending}`);
  }

  const orderBy = group.timeBucket ? `1 ASC` : METRIC_ORDER[q.metric];

  const rows = await db.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT
      ${Prisma.raw(group.key)}   AS key,
      ${Prisma.raw(group.label)} AS label,
      CAST(SUM(t."amountCents") AS bigint) AS sum_cents,
      COUNT(*)::bigint AS count
    FROM "Transaction" t
    LEFT JOIN "Category" c  ON c."id" = t."categoryId"
    LEFT JOIN "Category" cp ON cp."id" = c."parentId"
    LEFT JOIN "Account"  a  ON a."id" = t."accountId"
    WHERE ${Prisma.join(conditions, " AND ")}
    GROUP BY 1, 2
    ORDER BY ${Prisma.raw(orderBy)}
    LIMIT ${q.limit}
  `);

  return {
    rows: rows.map((r) => {
      const count = Number(r.count);
      const sum = centsToNumber(r.sum_cents) ?? 0;
      const valueCents =
        q.metric === "count"
          ? count
          : q.metric === "avg"
            ? Math.round(sum / Math.max(count, 1))
            : sum;
      return { key: r.key, label: r.label, valueCents, count };
    }),
    meta: {
      currency: "USD",
      groupBy: q.groupBy,
      metric: q.metric,
      flow: effectiveFlow ?? "all",
      dateFrom: q.dateFrom ?? null,
      dateTo: q.dateTo ?? null,
    },
  };
}
