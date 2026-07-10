import "server-only";
import { db } from "@/server/db/client";
import { decryptSecret } from "@/server/lib/crypto";
import { log } from "@/server/lib/request-context";
import { withRetry } from "@/server/lib/retry";
import {
  loadCategorizationContext,
  resolveCategoryId,
} from "@/server/services/categorization";
import { getPlaidService } from "@/server/services/plaid";
import { toPlaidApiError } from "@/server/services/plaid/errors";
import type { PlaidService, SyncPage } from "@/server/services/plaid/types";
import type { SyncTrigger } from "@/generated/prisma/enums";

export interface SyncResult {
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  added: number;
  modified: number;
  removed: number;
  errorCode?: string;
}

const MAX_PAGINATION_RESTARTS = 3;

/**
 * Cursor-based sync for one Item (ARCHITECTURE.md §6.4). Invariants:
 *  - the cursor is persisted in the SAME db transaction as the page's
 *    mutations — a crash resumes from the last committed page, and upserts
 *    make replays idempotent
 *  - user category overrides are never clobbered, including across
 *    pending→posted reconciliation
 *  - every run writes a SyncLog row (counts only — no transaction data)
 */
export async function syncItem(
  itemId: string,
  trigger: SyncTrigger,
  plaid: PlaidService = getPlaidService(),
): Promise<SyncResult> {
  const item = await db.plaidItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      userId: true,
      status: true,
      syncCursor: true,
      encryptedAccessToken: true,
    },
  });
  if (!item) {
    log().warn({ itemId }, "sync skipped: item not found");
    return { status: "SKIPPED", added: 0, modified: 0, removed: 0 };
  }
  if (item.status === "DISCONNECTED" || item.status === "LOGIN_REQUIRED") {
    log().info({ itemId, status: item.status }, "sync skipped: item not syncable");
    return { status: "SKIPPED", added: 0, modified: 0, removed: 0 };
  }

  const accessToken = decryptSecret(item.encryptedAccessToken);
  const syncLog = await db.syncLog.create({
    data: { plaidItemId: item.id, trigger, cursorBefore: item.syncCursor },
    select: { id: true },
  });

  const counts = { added: 0, modified: 0, removed: 0 };
  let cursor = item.syncCursor;
  let restarts = 0;

  try {
    let hasMore = true;
    while (hasMore) {
      let page: SyncPage;
      try {
        page = await withRetry(
          () => plaid.syncTransactions(accessToken, cursor),
          {
            shouldRetry: (err) =>
              toPlaidApiError(err).classification === "RETRYABLE" &&
              toPlaidApiError(err).plaidErrorCode !==
                "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
            onRetry: (err, attempt, delayMs) =>
              log().warn(
                { itemId, attempt, delayMs, code: toPlaidApiError(err).plaidErrorCode },
                "sync page retry",
              ),
          },
        );
      } catch (err) {
        const perr = toPlaidApiError(err);
        if (
          perr.plaidErrorCode === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" &&
          restarts < MAX_PAGINATION_RESTARTS
        ) {
          restarts += 1;
          // restart from the last cursor we committed
          const fresh = await db.plaidItem.findUniqueOrThrow({
            where: { id: item.id },
            select: { syncCursor: true },
          });
          cursor = fresh.syncCursor;
          log().warn({ itemId, restarts }, "sync pagination restarted");
          continue;
        }
        throw perr;
      }

      const applied = await applyPage(item.id, item.userId, page);
      counts.added += applied.added;
      counts.modified += applied.modified;
      counts.removed += applied.removed;
      cursor = page.nextCursor;
      hasMore = page.hasMore;
    }

    await db.$transaction([
      db.plaidItem.update({
        where: { id: item.id },
        data: { lastSyncedAt: new Date(), status: "ACTIVE", errorCode: null },
      }),
      db.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status: "SUCCESS",
          finishedAt: new Date(),
          cursorAfter: cursor,
          addedCount: counts.added,
          modifiedCount: counts.modified,
          removedCount: counts.removed,
        },
      }),
    ]);
    log().info({ itemId, trigger, ...counts, restarts }, "sync completed");
    return { status: "SUCCESS", ...counts };
  } catch (err) {
    const perr = toPlaidApiError(err);
    const itemStatus =
      perr.classification === "REAUTH"
        ? "LOGIN_REQUIRED"
        : perr.classification === "FATAL"
          ? "DISCONNECTED"
          : "ERROR";
    await db.$transaction([
      db.plaidItem.update({
        where: { id: item.id },
        data: { status: itemStatus, errorCode: perr.plaidErrorCode },
      }),
      db.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          cursorAfter: cursor,
          addedCount: counts.added,
          modifiedCount: counts.modified,
          removedCount: counts.removed,
          errorCode: perr.plaidErrorCode,
          errorMessage: perr.publicMessage,
        },
      }),
    ]);
    log().error(
      { itemId, trigger, code: perr.plaidErrorCode, itemStatus },
      "sync failed",
    );
    return { status: "FAILED", ...counts, errorCode: perr.plaidErrorCode };
  }
}

interface AppliedCounts {
  added: number;
  modified: number;
  removed: number;
}

/** Apply one sync page atomically, cursor included (the §6.4 invariant). */
async function applyPage(
  itemId: string,
  userId: string,
  page: SyncPage,
): Promise<AppliedCounts> {
  const applied: AppliedCounts = { added: 0, modified: 0, removed: 0 };

  // read-only context; loaded outside the write transaction to keep it short
  const catCtx = await loadCategorizationContext(userId);

  await db.$transaction(async (tx) => {
    const existing = await tx.account.findMany({
      where: { plaidItemId: itemId },
      select: { id: true, plaidAccountId: true },
    });
    const accountIdByPlaidId = new Map(
      existing.map((a) => [a.plaidAccountId, a.id]),
    );

    // refresh balances; create accounts newly added at the institution
    for (const a of page.accounts) {
      const known = accountIdByPlaidId.get(a.plaidAccountId);
      if (known) {
        await tx.account.update({
          where: { id: known },
          data: {
            currentBalanceCents: a.currentBalanceCents,
            availableBalanceCents: a.availableBalanceCents,
          },
        });
      } else {
        const created = await tx.account.create({
          data: {
            userId,
            plaidItemId: itemId,
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
          select: { id: true },
        });
        accountIdByPlaidId.set(a.plaidAccountId, created.id);
      }
    }

    for (const t of [...page.added, ...page.modified]) {
      const accountId = accountIdByPlaidId.get(t.plaidAccountId);
      if (!accountId) {
        log().warn(
          { itemId, plaidAccountId: t.plaidAccountId },
          "sync: transaction for unknown account skipped",
        );
        continue;
      }

      // pending→posted reconciliation: inherit the user's category decision
      // from the pending row, then retire it
      let inherited: { categoryId: string | null; userCategoryOverride: true } | null =
        null;
      if (t.pendingTransactionId) {
        const pendingRow = await tx.transaction.findUnique({
          where: { plaidTransactionId: t.pendingTransactionId },
          select: { id: true, categoryId: true, userCategoryOverride: true },
        });
        if (pendingRow) {
          if (pendingRow.userCategoryOverride) {
            inherited = {
              categoryId: pendingRow.categoryId,
              userCategoryOverride: true,
            };
          }
          await tx.transaction.update({
            where: { id: pendingRow.id },
            data: { deletedAt: new Date() },
          });
        }
      }

      const base = {
        amountCents: t.amountCents,
        isoCurrencyCode: t.isoCurrencyCode,
        date: new Date(t.date),
        authorizedDate: t.authorizedDate ? new Date(t.authorizedDate) : null,
        name: t.name,
        merchantName: t.merchantName,
        pending: t.pending,
        pendingTransactionId: t.pendingTransactionId,
        plaidPfcPrimary: t.pfcPrimary,
        plaidPfcDetailed: t.pfcDetailed,
        deletedAt: null,
      };

      // resolution order §7: override (inherited or existing) > rules > mapping
      const autoCategory = () => ({
        categoryId: resolveCategoryId(
          {
            merchantName: t.merchantName,
            name: t.name,
            amountCents: t.amountCents,
            accountId,
            pfcPrimary: t.pfcPrimary,
            pfcDetailed: t.pfcDetailed,
          },
          catCtx,
        ),
      });

      const current = await tx.transaction.findUnique({
        where: { plaidTransactionId: t.plaidTransactionId },
        select: { id: true, userCategoryOverride: true },
      });
      if (current) {
        // never touch category fields on a row the user has overridden
        await tx.transaction.update({
          where: { id: current.id },
          data: {
            ...base,
            ...(current.userCategoryOverride
              ? {}
              : (inherited ?? autoCategory())),
          },
        });
        applied.modified += 1;
      } else {
        await tx.transaction.create({
          data: {
            userId,
            accountId,
            plaidTransactionId: t.plaidTransactionId,
            ...base,
            ...(inherited ?? autoCategory()),
          },
        });
        applied.added += 1;
      }
    }

    for (const r of page.removed) {
      const res = await tx.transaction.updateMany({
        where: { plaidTransactionId: r.plaidTransactionId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      applied.removed += res.count;
    }

    // same transaction as the mutations — the crash-safety invariant
    await tx.plaidItem.update({
      where: { id: itemId },
      data: { syncCursor: page.nextCursor },
    });
  });

  return applied;
}
