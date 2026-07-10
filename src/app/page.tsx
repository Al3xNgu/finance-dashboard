import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/server/auth";
import { AccountsList } from "@/components/accounts-list";
import { ConnectAccountButton } from "@/components/connect-account-button";
import { DashboardSummary } from "@/components/dashboard/dashboard-summary";
import { MonthlyCashFlow } from "@/components/dashboard/monthly-cash-flow";
import { SpendingByCategory } from "@/components/dashboard/spending-by-category";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/signin" });
  }

  return (
    <div className="flex min-h-screen flex-1 flex-col bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Finance Dashboard
            </h1>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/" className="font-medium text-zinc-900 dark:text-zinc-50">
                Overview
              </Link>
              <Link
                href="/transactions"
                className="text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
              >
                Transactions
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-zinc-500 dark:text-zinc-400 sm:inline">
              {session.user.email}
            </span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-500/20 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Overview
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Signed in as {session.user.email}
            </p>
          </div>
          <ConnectAccountButton />
        </div>
        <div className="mt-6">
          <DashboardSummary userId={session.user.id} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <SpendingByCategory userId={session.user.id} />
          <MonthlyCashFlow userId={session.user.id} />
        </div>
        <div className="mt-6">
          <AccountsList userId={session.user.id} />
        </div>
      </main>
    </div>
  );
}
