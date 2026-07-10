import { listItems, type ItemDto } from "@/server/services/items";
import { ItemActions } from "./item-actions";

/**
 * Server component, mirrors AccountsList: takes a `userId` prop, fetches its
 * own data, and stays free of client-only Plaid Link plumbing (that lives in
 * the ItemActions leaf below).
 */

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  ACTIVE: {
    label: "Active",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
  },
  LOGIN_REQUIRED: {
    label: "Reconnect required",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  },
  ERROR: {
    label: "Error",
    className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  },
  DISCONNECTED: {
    label: "Disconnected",
    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  },
};

function StatusBadge({ status }: { status: string }) {
  const badge = STATUS_BADGE[status] ?? {
    label: status,
    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
    >
      {badge.label}
    </span>
  );
}

/** Computed server-side against request time; "never" when unsynced. */
function relativeSyncTime(lastSyncedAt: string | null): string {
  if (!lastSyncedAt) return "never";
  const diffMs = Date.now() - new Date(lastSyncedAt).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function ConnectionsList({ userId }: { userId: string }) {
  const items = await listItems(userId);

  if (items.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          No connections yet
        </p>
        <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">
          Connect a bank account to manage it here.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-900 dark:border-zinc-800 dark:text-zinc-50">
        Connections
      </h3>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {items.map((item: ItemDto) => (
          <li key={item.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {item.institutionName}
                  </p>
                  <StatusBadge status={item.status} />
                </div>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {item.accountCount} {item.accountCount === 1 ? "account" : "accounts"} · synced{" "}
                  {relativeSyncTime(item.lastSyncedAt)}
                </p>
              </div>
              <ItemActions
                item={{
                  id: item.id,
                  status: item.status,
                  errorCode: item.errorCode,
                  institutionName: item.institutionName,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
