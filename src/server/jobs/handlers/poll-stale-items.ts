import "server-only";
import { db } from "@/server/db/client";
import { logger } from "@/server/lib/logger";
import type { JobHandler } from "../queue";

/** Items not synced in this window get a scheduled sync — webhooks are a
 *  latency optimization, never a correctness dependency (§6.6). */
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

export const pollStaleItemsHandler: JobHandler<"poll-stale-items"> = async () => {
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
  const stale = await db.plaidItem.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleBefore } }],
    },
    select: { id: true },
  });
  if (stale.length === 0) return;
  logger.info({ count: stale.length }, "fallback poll: enqueueing stale items");
  // dynamic import avoids a module-level cycle with the queue registry
  const { getQueue } = await import("../index");
  for (const item of stale) {
    await getQueue().enqueue(
      "sync-item",
      { itemId: item.id, trigger: "SCHEDULED" },
      { dedupKey: `sync-item:${item.id}` },
    );
  }
};
