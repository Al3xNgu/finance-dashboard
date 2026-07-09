import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { logger } from "./logger";

interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Logger bound to the current request (or job) id, if any. */
export function log() {
  const requestId = currentRequestId();
  return requestId ? logger.child({ requestId }) : logger;
}
