import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/server/auth";
import { AppHeader } from "@/components/app-header";
import { TransactionsExplorer } from "@/components/transactions/transactions-explorer";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/signin" });
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <AppHeader email={session.user.email} active="transactions" signOutAction={signOutAction} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Transactions
        </h2>
        <div className="mt-6">
          <TransactionsExplorer />
        </div>
      </main>
    </div>
  );
}
