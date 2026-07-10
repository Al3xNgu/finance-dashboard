import "server-only";
import { syncItem } from "@/server/services/sync";
import type { JobHandler } from "../queue";

export const syncItemHandler: JobHandler<"sync-item"> = async (payload) => {
  await syncItem(payload.itemId, payload.trigger);
};
