// Shared helpers for the dashboard server components. Money is integer cents
// everywhere; dividing by 100 happens only here, at the formatting step.

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatCents(cents: number): string {
  // negating an all-zero sum yields -0, which Intl renders as "-$0.00"
  return usd.format(cents === 0 ? 0 : cents / 100);
}

/** YYYY-MM-DD in server-local time (matches the aggregates date filters). */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
