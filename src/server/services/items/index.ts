import "server-only";
import { encryptSecret } from "@/server/lib/crypto";
import { db } from "@/server/db/client";
import { ConflictError } from "@/server/lib/errors";
import { centsToNumber } from "@/server/lib/money";
import { log } from "@/server/lib/request-context";
import { getPlaidService } from "@/server/services/plaid";
import type { PlaidService } from "@/server/services/plaid";

export interface AccountDto {
  id: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentBalanceCents: number | null;
  availableBalanceCents: number | null;
  isoCurrencyCode: string;
  institutionName: string;
}

export interface ItemDto {
  id: string;
  institutionId: string;
  institutionName: string;
  status: string;
  lastSyncedAt: string | null;
  accountCount: number;
}

/**
 * The Plaid token-exchange path (ARCHITECTURE.md §6.3). The plaintext access
 * token exists only inside this function's scope; it is encrypted before any
 * write and never logged, returned, or serialized.
 */
export async function exchangePublicToken(
  userId: string,
  publicToken: string,
  plaid: PlaidService = getPlaidService(),
): Promise<ItemDto> {
  const { accessToken, plaidItemId } = await plaid.exchangePublicToken(publicToken);
  const { institutionId, accounts } = await plaid.getAccounts(accessToken);
  const institution = institutionId
    ? await plaid.getInstitution(institutionId)
    : { institutionId: "unknown", name: "Unknown institution" };

  const existing = await db.plaidItem.findUnique({
    where: { plaidItemId },
    select: { userId: true },
  });
  if (existing && existing.userId !== userId) {
    // Same institution login linked from a different user account.
    throw new ConflictError("This bank connection is already linked.");
  }

  const encryptedAccessToken = encryptSecret(accessToken);

  const item = await db.$transaction(async (tx) => {
    const upserted = await tx.plaidItem.upsert({
      where: { plaidItemId },
      create: {
        userId,
        plaidItemId,
        encryptedAccessToken,
        institutionId: institution.institutionId,
        institutionName: institution.name,
        status: "ACTIVE",
      },
      update: {
        // re-link of the same Item: rotate the stored token, clear error state
        encryptedAccessToken,
        status: "ACTIVE",
        errorCode: null,
      },
    });
    for (const a of accounts) {
      await tx.account.upsert({
        where: { plaidAccountId: a.plaidAccountId },
        create: {
          userId,
          plaidItemId: upserted.id,
          plaidAccountId: a.plaidAccountId,
          name: a.name,
          officialName: a.officialName,
          mask: a.mask,
          type: a.type,
          subtype: a.subtype,
          currentBalanceCents: a.currentBalanceCents,
          availableBalanceCents: a.availableBalanceCents,
          isoCurrencyCode: a.isoCurrencyCode,
        },
        update: {
          name: a.name,
          officialName: a.officialName,
          currentBalanceCents: a.currentBalanceCents,
          availableBalanceCents: a.availableBalanceCents,
        },
      });
    }
    return upserted;
  });

  log().info(
    { itemId: item.id, institutionId: institution.institutionId, accountCount: accounts.length },
    "plaid item linked",
  );

  return {
    id: item.id,
    institutionId: item.institutionId,
    institutionName: item.institutionName,
    status: item.status,
    lastSyncedAt: item.lastSyncedAt?.toISOString() ?? null,
    accountCount: accounts.length,
  };
}

export async function createLinkTokenForUser(
  userId: string,
  plaid: PlaidService = getPlaidService(),
): Promise<{ linkToken: string }> {
  const { linkToken } = await plaid.createLinkToken({ userId });
  return { linkToken };
}

export async function listItems(userId: string): Promise<ItemDto[]> {
  const items = await db.plaidItem.findMany({
    where: { userId },
    include: { _count: { select: { accounts: true } } },
    orderBy: { createdAt: "asc" },
  });
  return items.map((i) => ({
    id: i.id,
    institutionId: i.institutionId,
    institutionName: i.institutionName,
    status: i.status,
    lastSyncedAt: i.lastSyncedAt?.toISOString() ?? null,
    accountCount: i._count.accounts,
  }));
}

export async function listAccounts(userId: string): Promise<AccountDto[]> {
  const accounts = await db.account.findMany({
    where: { userId, hidden: false },
    include: { plaidItem: { select: { institutionName: true } } },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
  });
  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    officialName: a.officialName,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    currentBalanceCents: centsToNumber(a.currentBalanceCents),
    availableBalanceCents: centsToNumber(a.availableBalanceCents),
    isoCurrencyCode: a.isoCurrencyCode,
    institutionName: a.plaidItem.institutionName,
  }));
}
