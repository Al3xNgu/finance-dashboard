import { aggregateTransactions } from "@/server/services/aggregates";
import { aggregateQuerySchema } from "@/shared/schemas/aggregates";
import { formatCents, isoDate } from "./format";

/**
 * Server component. Current-month spending grouped by top-level category as a
 * horizontal bar list. Top 8 buckets get a fixed color each (same hues in
 * light and dark; every row also carries a text label, so color is never the
 * only identity cue); the remainder folds into a neutral "Other".
 */

const BAR_COLORS = [
  "bg-blue-500",
  "bg-amber-600",
  "bg-emerald-600",
  "bg-violet-500",
  "bg-rose-500",
  "bg-cyan-600",
  "bg-lime-600",
  "bg-fuchsia-500",
];
const OTHER_COLOR = "bg-zinc-400";

export async function SpendingByCategory({ userId }: { userId: string }) {
  const now = new Date();
  const result = await aggregateTransactions(
    userId,
    aggregateQuerySchema.parse({
      groupBy: "category_top",
      dateFrom: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
      dateTo: isoDate(now),
    }),
  );

  const top = result.rows.slice(0, 8).map((row, i) => ({
    key: row.key,
    label: row.label,
    valueCents: row.valueCents,
    colorClass: BAR_COLORS[i],
  }));
  const restCents = result.rows
    .slice(8)
    .reduce((sum, row) => sum + row.valueCents, 0);
  const bars =
    result.rows.length > 8
      ? [...top, { key: "other", label: "Other", valueCents: restCents, colorClass: OTHER_COLOR }]
      : top;

  // Refund-heavy buckets can sum negative; they clamp to a zero-width bar.
  const maxCents = Math.max(1, ...bars.map((b) => b.valueCents));

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Spending by category
      </h3>
      {bars.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-400 dark:text-zinc-500">No activity yet</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {bars.map((bar) => (
            <li key={bar.key}>
              <div className="flex items-baseline justify-between gap-4">
                <span className="truncate text-sm text-zinc-700 dark:text-zinc-300">
                  {bar.label}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-zinc-900 dark:text-zinc-50">
                  {formatCents(bar.valueCents)}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className={`h-full rounded-full ${bar.colorClass}`}
                  style={{ width: `${(Math.max(0, bar.valueCents) / maxCents) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
