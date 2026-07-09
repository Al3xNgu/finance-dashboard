import { listAccounts, type AccountDto } from "@/server/services/items";

/**
 * Server component. Data-flow choice: takes a `userId` prop and fetches its
 * own data via listAccounts(), keeping the page free of data-access details
 * and letting this subtree stream/refresh independently on router.refresh().
 */

// Balances are integer cents; format as dollars.
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatCents(cents: number | null): string {
  return cents === null ? "—" : usd.format(cents / 100);
}

function groupByInstitution(accounts: AccountDto[]): Map<string, AccountDto[]> {
  const groups = new Map<string, AccountDto[]>();
  for (const account of accounts) {
    const group = groups.get(account.institutionName);
    if (group) {
      group.push(account);
    } else {
      groups.set(account.institutionName, [account]);
    }
  }
  return groups;
}

export async function AccountsList({ userId }: { userId: string }) {
  const accounts = await listAccounts(userId);

  if (accounts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          No accounts connected yet
        </p>
        <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">
          Connect a bank account to see your balances here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {[...groupByInstitution(accounts)].map(([institutionName, institutionAccounts]) => (
        <section
          key={institutionName}
          className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h3 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-900 dark:border-zinc-800 dark:text-zinc-50">
            {institutionName}
          </h3>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {institutionAccounts.map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {account.name}
                    {account.mask ? (
                      <span className="ml-2 font-normal text-zinc-400 dark:text-zinc-500">
                        ••{account.mask}
                      </span>
                    ) : null}
                  </p>
                  {account.subtype ? (
                    <p className="text-xs capitalize text-zinc-500 dark:text-zinc-400">
                      {account.subtype}
                    </p>
                  ) : null}
                </div>
                <p className="shrink-0 text-right text-sm tabular-nums text-zinc-900 dark:text-zinc-50">
                  {formatCents(account.currentBalanceCents)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
