"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { PlaidLinkOnSuccess } from "react-plaid-link";
import { PlaidLinkOpener, readApiError } from "@/components/plaid-link";

export function ConnectAccountButton() {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/plaid/link-token", { method: "POST" });
      if (!res.ok) {
        setError(await readApiError(res, "Could not start the connection. Please try again."));
        setBusy(false);
        return;
      }
      const body = (await res.json()) as { data?: { linkToken?: string } };
      if (!body.data?.linkToken) {
        throw new Error("missing linkToken"); // caught below; avoids a stuck busy state
      }
      setLinkToken(body.data.linkToken);
      // stays busy while Plaid Link is open
    } catch {
      setError("Could not start the connection. Please try again.");
      setBusy(false);
    }
  }, []);

  const handleSuccess = useCallback<PlaidLinkOnSuccess>(
    (publicToken) => {
      setLinkToken(null);
      void (async () => {
        try {
          const res = await fetch("/api/v1/plaid/exchange", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ publicToken }),
          });
          if (!res.ok) {
            setError(
              await readApiError(res, "Connecting your bank failed. Please try again."),
            );
            return;
          }
          router.refresh();
        } catch {
          setError("Connecting your bank failed. Please try again.");
        } finally {
          setBusy(false);
        }
      })();
    },
    [router],
  );

  const handleExit = useCallback(() => {
    setLinkToken(null);
    setBusy(false);
  }, []);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-zinc-50 transition-colors hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {busy ? "Connecting…" : "Connect bank account"}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {linkToken ? (
        <PlaidLinkOpener token={linkToken} onSuccess={handleSuccess} onExit={handleExit} />
      ) : null}
    </div>
  );
}
