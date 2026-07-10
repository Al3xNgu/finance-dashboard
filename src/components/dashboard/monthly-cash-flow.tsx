import { aggregateTransactions } from "@/server/services/aggregates";
import { aggregateQuerySchema } from "@/shared/schemas/aggregates";
import { formatCents, isoDate } from "./format";

/**
 * Server component. Grouped-column SVG chart of spending vs income for the
 * last 6 calendar months (including the current one). The month axis is built
 * in code so months absent from the API response render as zero. Static SVG:
 * no client JS; tooltips are native <title> elements.
 */

// viewBox geometry (SVG user units)
const VB_W = 480;
const VB_H = 200;
const SLOT_W = VB_W / 6;
const BAR_W = 20;
const BAR_GAP = 6;
const PLOT_TOP = 8;
const BASELINE_Y = 172;
const LABEL_Y = 190;

export async function MonthlyCashFlow({ userId }: { userId: string }) {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return {
      key,
      label: d.toLocaleString("en-US", { month: "short" }),
      year: d.getFullYear(),
    };
  });

  const dateFrom = isoDate(new Date(now.getFullYear(), now.getMonth() - 5, 1));
  const dateTo = isoDate(now);
  const [expense, income] = await Promise.all([
    aggregateTransactions(
      userId,
      aggregateQuerySchema.parse({ groupBy: "month", dateFrom, dateTo }),
    ),
    aggregateTransactions(
      userId,
      aggregateQuerySchema.parse({ groupBy: "month", dateFrom, dateTo, flow: "income" }),
    ),
  ]);

  const expenseByMonth = new Map(expense.rows.map((r) => [r.key, r.valueCents]));
  const incomeByMonth = new Map(income.rows.map((r) => [r.key, r.valueCents]));

  // Income sums are negative (positive cents = money out); negate for display.
  // Clamp at zero so a refund-dominated month can't render an inverted bar.
  const series = months.map((m) => ({
    ...m,
    spentCents: Math.max(0, expenseByMonth.get(m.key) ?? 0),
    incomeCents: Math.max(0, -(incomeByMonth.get(m.key) ?? 0)),
  }));

  const maxCents = Math.max(...series.map((m) => Math.max(m.spentCents, m.incomeCents)));

  const plotHeight = BASELINE_Y - PLOT_TOP;
  const barHeight = (cents: number) =>
    cents > 0 ? Math.max(1, (cents / maxCents) * plotHeight) : 0;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Monthly cash flow
        </h3>
        <div className="flex items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-zinc-400 dark:bg-zinc-500" />
            Spending
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-emerald-500 dark:bg-emerald-400" />
            Income
          </span>
        </div>
      </div>
      {maxCents === 0 ? (
        <p className="mt-4 text-sm text-zinc-400 dark:text-zinc-500">No activity yet</p>
      ) : (
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          width="100%"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Monthly cash flow from ${months[0].label} ${months[0].year} to ${months[5].label} ${months[5].year}: grouped bars of spending and income per month.`}
          className="mt-4 w-full"
        >
          <line
            x1={8}
            y1={BASELINE_Y}
            x2={VB_W - 8}
            y2={BASELINE_Y}
            className="stroke-zinc-200 dark:stroke-zinc-800"
            strokeWidth={1}
          />
          {series.map((m, i) => {
            const slotX = i * SLOT_W;
            const pairX = slotX + (SLOT_W - (BAR_W * 2 + BAR_GAP)) / 2;
            const spentH = barHeight(m.spentCents);
            const incomeH = barHeight(m.incomeCents);
            return (
              <g key={m.key}>
                {spentH > 0 && (
                  <rect
                    x={pairX}
                    y={BASELINE_Y - spentH}
                    width={BAR_W}
                    height={spentH}
                    rx={2}
                    className="fill-zinc-400 dark:fill-zinc-500"
                  >
                    <title>{`${m.label} ${m.year} spending: ${formatCents(m.spentCents)}`}</title>
                  </rect>
                )}
                {incomeH > 0 && (
                  <rect
                    x={pairX + BAR_W + BAR_GAP}
                    y={BASELINE_Y - incomeH}
                    width={BAR_W}
                    height={incomeH}
                    rx={2}
                    className="fill-emerald-500 dark:fill-emerald-400"
                  >
                    <title>{`${m.label} ${m.year} income: ${formatCents(m.incomeCents)}`}</title>
                  </rect>
                )}
                <text
                  x={slotX + SLOT_W / 2}
                  y={LABEL_Y}
                  textAnchor="middle"
                  fontSize={11}
                  className="fill-zinc-400 dark:fill-zinc-500"
                >
                  {m.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </section>
  );
}
