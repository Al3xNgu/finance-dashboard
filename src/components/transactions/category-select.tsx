"use client";

import type { CategoryNode } from "./types";

/**
 * Two-level category picker. Each top-level category heads its own optgroup
 * and is itself selectable as the group's first option.
 */
export function CategorySelect({
  categories,
  value,
  emptyOptionLabel,
  onChange,
  disabled = false,
  ariaLabel,
  className,
  id,
}: {
  categories: CategoryNode[];
  value: string; // "" = the empty option (e.g. "All categories" / "Auto")
  emptyOptionLabel: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  id?: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      className={
        className ??
        "w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      }
    >
      <option value="">{emptyOptionLabel}</option>
      {categories.map((top) => (
        <optgroup key={top.id} label={top.name}>
          <option value={top.id}>{top.name}</option>
          {top.children.map((child) => (
            <option key={child.id} value={child.id}>
              {child.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
