"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_FILTERS, FilterBar, type Filters } from "./filter-bar";
import { TransactionRow } from "./transaction-row";
import {
  readApiError,
  type AccountOption,
  type CategoryNode,
  type TransactionDto,
  type TransactionListDto,
} from "./types";

/** "12.34" → 1234; null when empty or not a number. Never emits floats. */
function dollarsToCents(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function buildQuery(f: Filters, search: string): string {
  const p = new URLSearchParams();
  if (search.trim()) p.set("search", search.trim());
  if (f.dateFrom) p.set("dateFrom", f.dateFrom);
  if (f.dateTo) p.set("dateTo", f.dateTo);
  if (f.accountId) p.set("accountId", f.accountId);
  if (f.categoryId) p.set("categoryId", f.categoryId);
  if (f.pending) p.set("pending", f.pending);
  const min = dollarsToCents(f.minAmount);
  if (min !== null) p.set("minAmountCents", String(min));
  const max = dollarsToCents(f.maxAmount);
  if (max !== null) p.set("maxAmountCents", String(max));
  p.set("sort", f.sort);
  p.set("order", f.order);
  return p.toString();
}

export function TransactionsExplorer() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);

  // null = page one not loaded yet (skeleton)
  const [transactions, setTransactions] = useState<TransactionDto[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  // Monotonic request id: a response only lands if no newer request started
  // after it, so stale pages can't clobber fresh ones.
  const seqRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(timer);
  }, [filters.search]);

  // Any filter/sort change produces a new query string, which resets to page
  // one and drops the cursor — cursors are only valid for the sort they were
  // issued under.
  const queryString = useMemo(
    () => buildQuery(filters, debouncedSearch),
    [filters, debouncedSearch],
  );

  // Render-time adjustment (not an effect): reset to the skeleton in the same
  // render the query changes, so a stale list never flashes.
  const [activeQuery, setActiveQuery] = useState(queryString);
  if (activeQuery !== queryString) {
    setActiveQuery(queryString);
    setTransactions(null);
    setNextCursor(null);
    setError(null);
    setLoadingMore(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [catRes, acctRes] = await Promise.all([
          fetch("/api/v1/categories", { signal: controller.signal }),
          fetch("/api/v1/accounts", { signal: controller.signal }),
        ]);
        if (catRes.ok) {
          const body = (await catRes.json()) as { data: CategoryNode[] };
          setCategories(body.data);
        }
        if (acctRes.ok) {
          const body = (await acctRes.json()) as { data: AccountOption[] };
          setAccounts(body.data);
        }
      } catch {
        // Filter dropdowns just stay empty; the transaction list still works.
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const seq = ++seqRef.current;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/v1/transactions?${queryString}`, {
          signal: controller.signal,
        });
        if (seq !== seqRef.current) return;
        if (!res.ok) {
          setError(await readApiError(res, "Could not load transactions."));
          return;
        }
        const body = (await res.json()) as { data: TransactionListDto };
        if (seq !== seqRef.current) return;
        setTransactions(body.data.transactions);
        setNextCursor(body.data.nextCursor);
        setTotalCount(body.data.totalCount);
      } catch {
        if (controller.signal.aborted || seq !== seqRef.current) return;
        setError("Could not load transactions.");
      }
    })();
    return () => controller.abort();
  }, [queryString, retryTick]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const seq = ++seqRef.current;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/v1/transactions?${queryString}&cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (seq !== seqRef.current) return;
      if (!res.ok) {
        setError(await readApiError(res, "Could not load more transactions."));
        return;
      }
      const body = (await res.json()) as { data: TransactionListDto };
      if (seq !== seqRef.current) return;
      setTransactions((prev) => [...(prev ?? []), ...body.data.transactions]);
      setNextCursor(body.data.nextCursor);
      setTotalCount(body.data.totalCount);
    } catch {
      if (seq !== seqRef.current) return;
      setError("Could not load more transactions.");
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, queryString]);

  const handleFilterChange = useCallback((patch: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleClear = useCallback(() => {
    // Keep sort/order; only the narrowing filters reset.
    setFilters((prev) => ({ ...DEFAULT_FILTERS, sort: prev.sort, order: prev.order }));
    setDebouncedSearch(""); // skip the debounce delay on clear
  }, []);

  const handleRowUpdated = useCallback(
    (id: string, patch: { categoryId: string | null; userCategoryOverride: boolean }) => {
      setTransactions((prev) =>
        prev ? prev.map((t) => (t.id === id ? { ...t, ...patch } : t)) : prev,
      );
    },
    [],
  );

  return (
    <div className="space-y-4">
      <FilterBar
        filters={filters}
        categories={categories}
        accounts={accounts}
        onChange={handleFilterChange}
        onClear={handleClear}
      />

      {error ? (
        <div className="rounded-xl border border-red-200 bg-white p-10 text-center dark:border-red-900 dark:bg-zinc-900">
          <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
            {error}
          </p>
          <button
            type="button"
            onClick={() => {
              setTransactions(null);
              setNextCursor(null);
              setError(null);
              setRetryTick((t) => t + 1);
            }}
            className="mt-4 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Retry
          </button>
        </div>
      ) : transactions === null ? (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <ul className="animate-pulse divide-y divide-zinc-100 dark:divide-zinc-800">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center justify-between gap-4 px-4 py-4">
                <div className="h-4 w-12 rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="h-4 flex-1 rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="h-4 w-20 rounded bg-zinc-200 dark:bg-zinc-800" />
              </li>
            ))}
          </ul>
        </div>
      ) : transactions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            No transactions match your filters
          </p>
          <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">
            Try adjusting or clearing your filters.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {transactions.map((txn) => (
                <TransactionRow
                  key={txn.id}
                  txn={txn}
                  categories={categories}
                  onUpdated={handleRowUpdated}
                />
              ))}
            </ul>
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Showing {transactions.length} of {totalCount} transactions
            </p>
            {nextCursor ? (
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
