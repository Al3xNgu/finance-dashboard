import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "@/server/lib/errors";

const { dbMock, plaidItemUpsert, accountUpsert, plaidItemFindUnique } =
  vi.hoisted(() => {
    const plaidItemUpsert = vi.fn();
    const accountUpsert = vi.fn();
    const plaidItemFindUnique = vi.fn();
    const tx = {
      plaidItem: { upsert: plaidItemUpsert },
      account: { upsert: accountUpsert },
    };
    const dbMock = {
      plaidItem: {
        findUnique: plaidItemFindUnique,
        upsert: plaidItemUpsert,
      },
      account: { upsert: accountUpsert },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    };
    return { dbMock, plaidItemUpsert, accountUpsert, plaidItemFindUnique };
  });

vi.mock("@/server/db/client", () => ({ db: dbMock }));

const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("@/server/jobs", () => ({ getQueue: () => ({ enqueue, schedule: vi.fn() }) }));

import { decryptSecret } from "@/server/lib/crypto";
import { exchangePublicToken } from "@/server/services/items";
import { FakePlaidService } from "@/server/services/plaid/fake";

// Must match the ENCRYPTION_KEY set in vitest.config.ts — the env singleton
// captures it at import time, before tests run.
const KEY = Buffer.alloc(32, 9).toString("base64");

function makeFake() {
  const fake = new FakePlaidService();
  fake.addItemFixture("public-token-1", {
    plaidItemId: "item-abc",
    accessToken: "access-sandbox-secret-token",
    institutionId: "ins_1",
    institutionName: "First Platypus Bank",
    accounts: [
      {
        plaidAccountId: "acc-1",
        name: "Checking",
        officialName: "Plaid Gold Checking",
        mask: "0000",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 110024n,
        availableBalanceCents: 100000n,
        isoCurrencyCode: "USD",
      },
      {
        plaidAccountId: "acc-2",
        name: "Credit Card",
        officialName: null,
        mask: "3333",
        type: "credit",
        subtype: "credit card",
        currentBalanceCents: 41023n,
        availableBalanceCents: null,
        isoCurrencyCode: "USD",
      },
    ],
  });
  return fake;
}

beforeEach(() => {
  plaidItemFindUnique.mockReset().mockResolvedValue(null);
  plaidItemUpsert.mockReset().mockImplementation(async ({ create, update }) => ({
    id: "db-item-1",
    institutionId: "ins_1",
    institutionName: "First Platypus Bank",
    status: "ACTIVE",
    lastSyncedAt: null,
    ...(create ?? update),
  }));
  accountUpsert.mockReset().mockResolvedValue({});
});

describe("exchangePublicToken (token-exchange path)", () => {
  it("stores the access token encrypted, never in plaintext", async () => {
    await exchangePublicToken("user-1", "public-token-1", makeFake());
    const stored = plaidItemUpsert.mock.calls[0][0].create.encryptedAccessToken;
    expect(stored).not.toContain("access-sandbox-secret-token");
    expect(stored).toMatch(/^v1:/);
    expect(decryptSecret(stored, Buffer.from(KEY, "base64"))).toBe(
      "access-sandbox-secret-token",
    );
  });

  it("creates the item and all accounts, scoped to the user", async () => {
    const dto = await exchangePublicToken("user-1", "public-token-1", makeFake());
    expect(plaidItemUpsert.mock.calls[0][0].create.userId).toBe("user-1");
    expect(accountUpsert).toHaveBeenCalledTimes(2);
    expect(accountUpsert.mock.calls[0][0].create.userId).toBe("user-1");
    expect(dto.institutionName).toBe("First Platypus Bank");
    expect(dto.accountCount).toBe(2);
  });

  it("enqueues the initial sync off the request path", async () => {
    await exchangePublicToken("user-1", "public-token-1", makeFake());
    expect(enqueue).toHaveBeenCalledWith(
      "sync-item",
      { itemId: "db-item-1", trigger: "INITIAL" },
      { dedupKey: "sync-item:db-item-1" },
    );
  });

  it("never returns the access token in the DTO", async () => {
    const dto = await exchangePublicToken("user-1", "public-token-1", makeFake());
    expect(JSON.stringify(dto)).not.toContain("access");
  });

  it("rejects an item already linked by a different user", async () => {
    plaidItemFindUnique.mockResolvedValue({ userId: "someone-else" });
    await expect(
      exchangePublicToken("user-1", "public-token-1", makeFake()),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(plaidItemUpsert).not.toHaveBeenCalled();
  });

  it("re-links the same user's item by rotating the stored token", async () => {
    plaidItemFindUnique.mockResolvedValue({ userId: "user-1" });
    await exchangePublicToken("user-1", "public-token-1", makeFake());
    const update = plaidItemUpsert.mock.calls[0][0].update;
    expect(update.encryptedAccessToken).toMatch(/^v1:/);
    expect(update.status).toBe("ACTIVE");
    expect(update.errorCode).toBeNull();
  });
});
