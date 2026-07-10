import "server-only";
import { decryptSecret, encryptSecret } from "@/server/lib/crypto";
import { db } from "@/server/db/client";
import { ConflictError, NotFoundError } from "@/server/lib/errors";
import { centsToNumber } from "@/server/lib/money";
import { log } from "@/server/lib/request-context";
import { getQueue } from "@/server/jobs";
import { getPlaidService } from "@/server/services/plaid";
import type { PlaidService } from "@/server/services/plaid";
import { PlaidApiError } from "@/server/services/plaid/errors";

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
  errorCode: string | null;
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

  // initial transaction sync happens off the request path
  await getQueue().enqueue(
    "sync-item",
    { itemId: item.id, trigger: "INITIAL" },
    { dedupKey: `sync-item:${item.id}` },
  );

  return {
    id: item.id,
    institutionId: item.institutionId,
    institutionName: item.institutionName,
    status: item.status,
    errorCode: item.errorCode,
    lastSyncedAt: item.lastSyncedAt?.toISOString() ?? null,
    accountCount: accounts.length,
  };
}

/**
 * Link token for connect (no itemId) or update mode (itemId given — D-018).
 * The decrypted access token exists only inside this function's scope.
 */
export async function createLinkTokenForUser(
  userId: string,
  itemId?: string,
  plaid: PlaidService = getPlaidService(),
): Promise<{ linkToken: string }> {
  if (!itemId) {
    const { linkToken } = await plaid.createLinkToken({ userId });
    return { linkToken };
  }
  const item = await requireOwnItem(userId, itemId);
  if (item.status === "DISCONNECTED") {
    // /item/remove invalidated the token; only a fresh connect can revive it
    throw new ConflictError("This connection was removed. Connect it again.");
  }
  const { linkToken } = await plaid.createLinkToken({
    userId,
    accessToken: decryptSecret(item.encryptedAccessToken),
  });
  return { linkToken };
}

async function requireOwnItem(userId: string, itemId: string) {
  const item = await db.plaidItem.findFirst({
    where: { id: itemId, userId },
    select: { id: true, status: true, encryptedAccessToken: true },
  });
  // 404 (not 403) so ids are no existence oracle
  if (!item) throw new NotFoundError("Connection not found.");
  return item;
}

/** Client-asserted reconnect completion after update-mode Link (D-018). */
export async function markItemReconnected(
  userId: string,
  itemId: string,
): Promise<void> {
  const item = await requireOwnItem(userId, itemId);
  // conditional write: a disconnect committed between the read above and this
  // update must win — DISCONNECTED is terminal (M7 review finding)
  const updated = await db.plaidItem.updateMany({
    where: { id: item.id, status: { not: "DISCONNECTED" } },
    data: { status: "ACTIVE", errorCode: null },
  });
  if (updated.count === 0) {
    throw new ConflictError("This connection was removed. Connect it again.");
  }
  log().info({ itemId: item.id }, "item marked reconnected");
  // If a sync for this item is already in flight, this enqueue is dropped by
  // dedup; re-validation falls to the 12h stale poller (accepted, M7 review NIT).
  await getQueue().enqueue(
    "sync-item",
    { itemId: item.id, trigger: "MANUAL" },
    { dedupKey: `sync-item:${item.id}` },
  );
}

/** Revoke at Plaid, keep local history readable (D-019). */
export async function disconnectItem(
  userId: string,
  itemId: string,
  plaid: PlaidService = getPlaidService(),
): Promise<void> {
  const item = await requireOwnItem(userId, itemId);
  if (item.status !== "DISCONNECTED") {
    try {
      await plaid.removeItem(decryptSecret(item.encryptedAccessToken));
    } catch (err) {
      // Item already gone at Plaid → the goal state is reached; anything
      // retryable propagates so the user can retry the disconnect.
      if (!(err instanceof PlaidApiError && err.classification === "FATAL")) {
        throw err;
      }
    }
  }
  await db.plaidItem.update({
    where: { id: item.id },
    data: { status: "DISCONNECTED" },
  });
  log().info({ itemId: item.id }, "item disconnected");
}

export interface SyncLogDto {
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

export async function listSyncLogs(
  userId: string,
  itemId: string,
  limit = 10,
): Promise<SyncLogDto[]> {
  await requireOwnItem(userId, itemId);
  const logs = await db.syncLog.findMany({
    where: { plaidItemId: itemId },
    orderBy: { startedAt: "desc" },
    take: limit,
  });
  return logs.map((l) => ({
    id: l.id,
    trigger: l.trigger,
    status: l.status,
    addedCount: l.addedCount,
    modifiedCount: l.modifiedCount,
    removedCount: l.removedCount,
    errorCode: l.errorCode,
    startedAt: l.startedAt.toISOString(),
    finishedAt: l.finishedAt?.toISOString() ?? null,
  }));
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
    errorCode: i.errorCode,
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
