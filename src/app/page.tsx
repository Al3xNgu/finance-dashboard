import { redirect } from "next/navigation";
import { auth, signOut } from "@/server/auth";
import { AppHeader } from "@/components/app-header";
import { AccountsList } from "@/components/accounts-list";
import { ConnectAccountButton } from "@/components/connect-account-button";
import { ConnectionsList } from "@/components/connections/connections-list";
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
      <AppHeader email={session.user.email} active="overview" signOutAction={signOutAction} />

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
        <div className="mt-6">
          <ConnectionsList userId={session.user.id} />
        </div>
      </main>
    </div>
  );
}
