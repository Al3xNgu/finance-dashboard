"use client";

import { useState } from "react";
import { CategorySelect } from "./category-select";
import { readApiError, usd, type CategoryNode, type TransactionDto } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-07-08" → "Jul 8" without a Date round-trip (avoids timezone shifts). */
function formatShortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  return `${MONTHS[Number(month) - 1]} ${Number(day)}`;
}

export function TransactionRow({
  txn,
  categories,
  onUpdated,
}: {
  txn: TransactionDto;
  categories: CategoryNode[];
  onUpdated: (id: string, patch: { categoryId: string | null; userCategoryOverride: boolean }) => void;
}) {
  const [saving, setSaving] = useState(false);
  // Shown optimistically while the PATCH is in flight; cleared on settle so an
  // error reverts the select to the row's real value.
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCategoryChange(value: string) {
    setSaving(true);
    setError(null);
    setPendingValue(value);
    try {
      const res = await fetch(`/api/v1/transactions/${txn.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value === "" ? { clearOverride: true } : { categoryId: value }),
      });
      if (!res.ok) {
        setError(await readApiError(res, "Could not update the category."));
        return;
      }
      const body = (await res.json()) as {
        data: { categoryId: string | null; userCategoryOverride: boolean };
      };
      onUpdated(txn.id, body.data);
    } catch {
      setError("Could not update the category.");
    } finally {
      setSaving(false);
      setPendingValue(null);
    }
  }

  const displayMerchant = txn.merchantName ?? txn.name;
  const showRawName = txn.merchantName !== null && txn.merchantName !== txn.name;
  const inflow = txn.amountCents < 0;
  const amount = usd.format(Math.abs(txn.amountCents) / 100);

  return (
    <li className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_9rem_11rem_6.5rem] sm:items-center sm:gap-4">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{formatShortDate(txn.date)}</p>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {displayMerchant}
          {txn.pending ? (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              Pending
            </span>
          ) : null}
        </p>
        {showRawName ? (
          <p className="truncate text-xs text-zinc-400 dark:text-zinc-500">{txn.name}</p>
        ) : null}
      </div>
      <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
        {txn.accountName}
        {txn.accountMask ? ` ••${txn.accountMask}` : ""}
      </p>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <CategorySelect
            categories={categories}
            value={pendingValue ?? txn.categoryId ?? ""}
            emptyOptionLabel="Auto"
            onChange={handleCategoryChange}
            disabled={saving}
            ariaLabel={`Category for ${displayMerchant}`}
          />
          {txn.userCategoryOverride ? (
            <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">manual</span>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
      </div>
      <p
        className={`text-sm tabular-nums sm:text-right ${
          inflow ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-900 dark:text-zinc-50"
        }`}
      >
        {inflow ? `+${amount}` : amount}
      </p>
    </li>
  );
}
