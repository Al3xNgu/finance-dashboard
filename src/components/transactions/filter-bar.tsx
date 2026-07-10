"use client";

import { CategorySelect } from "./category-select";
import type { AccountOption, CategoryNode } from "./types";

export interface Filters {
  search: string;
  dateFrom: string;
  dateTo: string;
  accountId: string;
  categoryId: string;
  pending: "" | "true" | "false";
  minAmount: string; // dollars, as typed
  maxAmount: string;
  sort: "date" | "amount" | "merchant";
  order: "asc" | "desc";
}

export const DEFAULT_FILTERS: Filters = {
  search: "",
  dateFrom: "",
  dateTo: "",
  accountId: "",
  categoryId: "",
  pending: "",
  minAmount: "",
  maxAmount: "",
  sort: "date",
  order: "desc",
};

/** True when any narrowing filter is set (sort/order don't count). */
export function hasActiveFilters(f: Filters): boolean {
  return (
    f.search !== "" ||
    f.dateFrom !== "" ||
    f.dateTo !== "" ||
    f.accountId !== "" ||
    f.categoryId !== "" ||
    f.pending !== "" ||
    f.minAmount !== "" ||
    f.maxAmount !== ""
  );
}

const inputClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:placeholder:text-zinc-500";

const labelClass = "text-xs font-medium text-zinc-500 dark:text-zinc-400";

export function FilterBar({
  filters,
  categories,
  accounts,
  onChange,
  onClear,
}: {
  filters: Filters;
  categories: CategoryNode[];
  accounts: AccountOption[];
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="col-span-2 flex flex-col gap-1">
          <label htmlFor="txn-search" className={labelClass}>
            Search
          </label>
          <input
            id="txn-search"
            type="text"
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            placeholder="Search transactions"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="txn-date-from" className={labelClass}>
            From
          </label>
          <input
            id="txn-date-from"
            type="date"
            value={filters.dateFrom}
            onChange={(e) => onChange({ dateFrom: e.target.value })}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="txn-date-to" className={labelClass}>
            To
          </label>
          <input
            id="txn-date-to"
            type="date"
            value={filters.dateTo}
            onChange={(e) => onChange({ dateTo: e.target.value })}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="txn-account" className={labelClass}>
            Account
          </label>
          <select
            id="txn-account"
            value={filters.accountId}
            onChange={(e) => onChange({ accountId: e.target.value })}
            className={inputClass}
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.mask ? `${a.name} ••${a.mask}` : a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="txn-category" className={labelClass}>
            Category
          </label>
          <CategorySelect
            id="txn-category"
            categories={categories}
            value={filters.categoryId}
            emptyOptionLabel="All categories"
            onChange={(categoryId) => onChange({ categoryId })}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="txn-status" className={labelClass}>
            Status
          </label>
          <select
            id="txn-status"
            value={filters.pending}
            onChange={(e) => onChange({ pending: e.target.value as Filters["pending"] })}
            className={inputClass}
          >
            <option value="">All</option>
            <option value="true">Pending</option>
            <option value="false">Posted</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="txn-min-amount" className={labelClass}>
            Min amount ($)
          </label>
          <input
            id="txn-min-amount"
            type="number"
            step="0.01"
            inputMode="decimal"
            value={filters.minAmount}
            onChange={(e) => onChange({ minAmount: e.target.value })}
            placeholder="0.00"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="txn-max-amount" className={labelClass}>
            Max amount ($)
          </label>
          <input
            id="txn-max-amount"
            type="number"
            step="0.01"
            inputMode="decimal"
            value={filters.maxAmount}
            onChange={(e) => onChange({ maxAmount: e.target.value })}
            placeholder="0.00"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="txn-sort" className={labelClass}>
            Sort by
          </label>
          <div className="flex gap-2">
            <select
              id="txn-sort"
              value={filters.sort}
              onChange={(e) => onChange({ sort: e.target.value as Filters["sort"] })}
              className={inputClass}
            >
              <option value="date">Date</option>
              <option value="amount">Amount</option>
              <option value="merchant">Merchant</option>
            </select>
            <button
              type="button"
              onClick={() => onChange({ order: filters.order === "desc" ? "asc" : "desc" })}
              aria-label={filters.order === "desc" ? "Sort descending" : "Sort ascending"}
              title={filters.order === "desc" ? "Descending" : "Ascending"}
              className="shrink-0 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {filters.order === "desc" ? "↓" : "↑"}
            </button>
          </div>
        </div>
      </div>
      {hasActiveFilters(filters) ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onClear}
            className="text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Clear filters
          </button>
        </div>
      ) : null}
    </div>
  );
}
