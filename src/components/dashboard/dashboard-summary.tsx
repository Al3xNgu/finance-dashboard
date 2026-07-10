import { aggregateTransactions } from "@/server/services/aggregates";
import { aggregateQuerySchema } from "@/shared/schemas/aggregates";
import { formatCents, isoDate } from "./format";

/**
 * Server component. Current-month stat cards (first of month → today, server
 * time). One groupBy=flow call returns expense and income buckets together.
 * Sign convention: positive cents = money out, so income sums come back
 * negative and are negated for display.
 */

function StatCard({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${
          valueClass ?? "text-zinc-900 dark:text-zinc-50"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export async function DashboardSummary({ userId }: { userId: string }) {
  const now = new Date();
  const result = await aggregateTransactions(
    userId,
    aggregateQuerySchema.parse({
      groupBy: "flow",
      dateFrom: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      dateTo: isoDate(now),
    }),
  );

  const byFlow = new Map(result.rows.map((r) => [r.key, r.valueCents]));
  const spentCents = byFlow.get("EXPENSE") ?? 0;
  const incomeCents = -(byFlow.get("INCOME") ?? 0);
  const netCents = incomeCents - spentCents;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard label="Spent this month" value={formatCents(spentCents)} />
      <StatCard label="Income this month" value={formatCents(incomeCents)} />
      <StatCard
        label="Net"
        value={formatCents(netCents)}
        valueClass={
          netCents > 0
            ? "text-emerald-600 dark:text-emerald-400"
            : netCents < 0
              ? "text-red-600 dark:text-red-400"
              : undefined
        }
      />
    </div>
  );
}
