"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlaidLinkOnSuccess } from "react-plaid-link";
import { PlaidLinkOpener, readApiError } from "@/components/plaid-link";

// Client-side mirror of ItemDto's serializable subset — no imports from src/server/**.
export interface ItemActionsDto {
  id: string;
  status: string;
  errorCode: string | null;
  institutionName: string;
}

interface SyncLogDto {
  id: string;
  trigger: string;
  status: string;
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
  errorCode: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const STATUS_DOT: Record<string, string> = {
  SUCCESS: "bg-emerald-500",
  FAILED: "bg-red-500",
  RUNNING: "bg-zinc-400",
};

/** "2026-07-08T12:00:00Z" → "2h ago" / "just now", computed client-side. */
function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const buttonClass =
  "shrink-0 rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

const amberButtonClass =
  "shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900";

export function ItemActions({ item }: { item: ItemActionsDto }) {
  const router = useRouter();

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectToken, setReconnectToken] = useState<string | null>(null);
  const [reconnectError, setReconnectError] = useState<string | null>(null);

  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [logs, setLogs] = useState<SyncLogDto[] | null>(null);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      const res = await fetch(`/api/v1/items/${item.id}/sync`, { method: "POST" });
      if (!res.ok) {
        setSyncError(await readApiError(res, "Could not start a sync. Please try again."));
        setSyncing(false);
        return;
      }
      // give the queue a moment to pick the job up before refreshing
      setTimeout(() => {
        setLogs(null); // drop the history cache; the new run belongs in it
        router.refresh();
        setSyncing(false);
      }, 1500);
    } catch {
      setSyncError("Could not start a sync. Please try again.");
      setSyncing(false);
    }
  }, [item.id, router]);

  const handleReconnectClick = useCallback(async () => {
    setReconnecting(true);
    setReconnectError(null);
    try {
      const res = await fetch("/api/v1/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id }),
      });
      if (!res.ok) {
        setReconnectError(await readApiError(res, "Could not start reconnecting. Please try again."));
        setReconnecting(false);
        return;
      }
      const body = (await res.json()) as { data?: { linkToken?: string } };
      if (!body.data?.linkToken) {
        throw new Error("missing linkToken"); // caught below; avoids a stuck busy state
      }
      setReconnectToken(body.data.linkToken);
      // stays busy while Plaid Link is open
    } catch {
      setReconnectError("Could not start reconnecting. Please try again.");
      setReconnecting(false);
    }
  }, [item.id]);

  const handleReconnectSuccess = useCallback<PlaidLinkOnSuccess>(() => {
    // update mode: the returned public_token is not exchanged (D-018)
    setReconnectToken(null);
    void (async () => {
      try {
        const res = await fetch(`/api/v1/items/${item.id}/reconnected`, { method: "POST" });
        if (!res.ok) {
          setReconnectError(await readApiError(res, "Reconnecting failed. Please try again."));
          return;
        }
        setLogs(null); // the reconnect enqueued a sync; refetch history next open
        router.refresh();
      } catch {
        setReconnectError("Reconnecting failed. Please try again.");
      } finally {
        setReconnecting(false);
      }
    })();
  }, [item.id, router]);

  const handleReconnectExit = useCallback(() => {
    setReconnectToken(null);
    setReconnecting(false);
  }, []);

  const handleDisconnect = useCallback(async () => {
    const confirmed = window.confirm(
      `Disconnect ${item.institutionName}? Transaction history is kept, but syncing stops.`,
    );
    if (!confirmed) return;
    setDisconnecting(true);
    setDisconnectError(null);
    try {
      const res = await fetch(`/api/v1/items/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        setDisconnectError(await readApiError(res, "Could not disconnect. Please try again."));
        setDisconnecting(false);
        return;
      }
      router.refresh();
    } catch {
      setDisconnectError("Could not disconnect. Please try again.");
      setDisconnecting(false);
    }
  }, [item.id, item.institutionName, router]);

  const handleToggleHistory = useCallback(async () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (!next || logs !== null) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(`/api/v1/items/${item.id}/sync-logs?limit=5`);
      if (!res.ok) {
        setHistoryError(await readApiError(res, "Could not load sync history."));
        return;
      }
      const body = (await res.json()) as { data: SyncLogDto[] };
      setLogs(body.data);
    } catch {
      setHistoryError("Could not load sync history.");
    } finally {
      setHistoryLoading(false);
    }
  }, [historyOpen, logs, item.id]);

  const canReconnect = item.status === "LOGIN_REQUIRED" || item.status === "ERROR";
  // syncItem skips LOGIN_REQUIRED items, so a Sync button there would be a
  // silent no-op — steer the user to Reconnect instead (M7 review finding)
  const canSync = item.status !== "DISCONNECTED" && item.status !== "LOGIN_REQUIRED";

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {canSync ? (
          <button type="button" onClick={handleSync} disabled={syncing} className={buttonClass}>
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        ) : null}
        {canReconnect ? (
          <button
            type="button"
            onClick={handleReconnectClick}
            disabled={reconnecting}
            className={amberButtonClass}
          >
            {reconnecting ? "Reconnecting…" : "Reconnect"}
          </button>
        ) : null}
        {item.status !== "DISCONNECTED" ? (
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="shrink-0 text-xs font-medium text-red-600 transition-colors hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={handleToggleHistory}
          className="shrink-0 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          {historyOpen ? "Hide history" : "History"}
        </button>
      </div>

      {syncError ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {syncError}
        </p>
      ) : null}
      {reconnectError ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {reconnectError}
        </p>
      ) : null}
      {disconnectError ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {disconnectError}
        </p>
      ) : null}
      {reconnectToken ? (
        <PlaidLinkOpener
          token={reconnectToken}
          onSuccess={handleReconnectSuccess}
          onExit={handleReconnectExit}
        />
      ) : null}

      {historyOpen ? (
        <div className="w-full min-w-[16rem] rounded-lg border border-zinc-200 bg-zinc-50 p-2 text-xs dark:border-zinc-800 dark:bg-zinc-800/50 sm:w-80">
          {historyLoading ? (
            <p className="text-zinc-500 dark:text-zinc-400">Loading…</p>
          ) : historyError ? (
            <p role="alert" className="text-red-600 dark:text-red-400">
              {historyError}
            </p>
          ) : logs && logs.length === 0 ? (
            <p className="text-zinc-500 dark:text-zinc-400">No syncs yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {logs?.map((l) => (
                <li key={l.id} className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[l.status] ?? "bg-zinc-400"}`}
                  />
                  <span className="text-zinc-500 dark:text-zinc-400">{l.trigger.toLowerCase()}</span>
                  <span className="tabular-nums text-zinc-700 dark:text-zinc-300">
                    +{l.addedCount} ~{l.modifiedCount} −{l.removedCount}
                  </span>
                  {l.errorCode ? (
                    <span className="truncate text-red-600 dark:text-red-400">{l.errorCode}</span>
                  ) : null}
                  <span className="ml-auto shrink-0 text-zinc-400 dark:text-zinc-500">
                    {relativeTime(l.startedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
