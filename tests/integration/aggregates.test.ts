import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { encryptSecret } from "@/server/lib/crypto";
import { aggregateTransactions } from "@/server/services/aggregates";
import { aggregateQuerySchema } from "@/shared/schemas/aggregates";
import type { Prisma } from "@/generated/prisma/client";

/** Parsed query with schema defaults applied. */
function query(over: Record<string, unknown>) {
  return aggregateQuerySchema.parse(over);
}

async function seedWorld() {
  const user = await db.user.create({
    data: { email: `agg-${Date.now()}-${Math.random()}@test.local` },
  });
  const item = await db.plaidItem.create({
    data: {
      userId: user.id,
      plaidItemId: `pi-${Math.random()}`,
      encryptedAccessToken: encryptSecret("tok"),
      institutionId: "ins_1",
      institutionName: "Test Bank",
    },
  });
  const checking = await db.account.create({
    data: {
      userId: user.id,
      plaidItemId: item.id,
      plaidAccountId: `pa-c-${Math.random()}`,
      name: "Checking",
      type: "depository",
    },
  });
  const credit = await db.account.create({
    data: {
      userId: user.id,
      plaidItemId: item.id,
      plaidAccountId: `pa-x-${Math.random()}`,
      name: "Credit Card",
      type: "credit",
    },
  });
  const food = await db.category.create({
    data: { name: "Food & Dining", slug: "food-and-dining", isSystem: true },
  });
  const coffee = await db.category.create({
    data: { name: "Coffee", slug: "coffee", isSystem: true, parentId: food.id },
  });
  const income = await db.category.create({
    data: { name: "Income", slug: "income", isSystem: true, flow: "INCOME" },
  });
  const transfers = await db.category.create({
    data: { name: "Transfers", slug: "transfers", isSystem: true, flow: "TRANSFER" },
  });
  const unc = await db.category.create({
    data: { name: "Uncategorized", slug: "uncategorized", isSystem: true },
  });
  return { user, item, checking, credit, food, coffee, income, transfers, unc };
}

type World = Awaited<ReturnType<typeof seedWorld>>;

let seq = 0;
function makeTxn(
  w: World,
  over: Partial<Prisma.TransactionUncheckedCreateInput> = {},
) {
  seq += 1;
  return db.transaction.create({
    data: {
      userId: w.user.id,
      accountId: w.checking.id,
      plaidTransactionId: `agg-${seq}-${Math.random()}`,
      amountCents: 1000n,
      date: new Date("2026-07-01"),
      name: "GENERIC",
      merchantName: null,
      pending: false,
      ...over,
    },
  });
}

/** The standard fixture: two months of mixed-flow activity. */
async function seedActivity(w: World) {
  // June: coffee 300 + 200 (checking), food(parent) 1500 (credit)
  await makeTxn(w, { date: new Date("2026-06-05"), amountCents: 300n, categoryId: w.coffee.id, merchantName: "Starbucks" });
  await makeTxn(w, { date: new Date("2026-06-20"), amountCents: 200n, categoryId: w.coffee.id, merchantName: "Blue Bottle" });
  await makeTxn(w, { date: new Date("2026-06-21"), amountCents: 1500n, categoryId: w.food.id, accountId: w.credit.id, merchantName: "Chipotle" });
  // July: uncategorized-null 700, paycheck -500000, transfer 10000, pending coffee 400
  await makeTxn(w, { date: new Date("2026-07-02"), amountCents: 700n, categoryId: null });
  await makeTxn(w, { date: new Date("2026-07-03"), amountCents: -500000n, categoryId: w.income.id, merchantName: "Gusto" });
  await makeTxn(w, { date: new Date("2026-07-04"), amountCents: 10000n, categoryId: w.transfers.id });
  await makeTxn(w, { date: new Date("2026-07-05"), amountCents: 400n, categoryId: w.coffee.id, merchantName: "Starbucks", pending: true });
  // noise: soft-deleted expense
  await makeTxn(w, { date: new Date("2026-07-06"), amountCents: 99999n, categoryId: w.food.id, deletedAt: new Date() });
}

beforeEach(async () => {
  await db.transaction.deleteMany();
  await db.categoryRule.deleteMany();
  await db.plaidCategoryMapping.deleteMany();
  await db.category.deleteMany();
  await db.syncLog.deleteMany();
  await db.webhookEvent.deleteMany();
  await db.account.deleteMany();
  await db.plaidItem.deleteMany();
  await db.user.deleteMany();
});

describe("aggregateTransactions — grouping", () => {
  it("category_top rolls children into parents and buckets null as Uncategorized", async () => {
    const w = await seedWorld();
    await seedActivity(w);
    const res = await aggregateTransactions(w.user.id, query({ groupBy: "category_top" }));
    // default flow=expense: income + transfer excluded, soft-deleted excluded
    const byLabel = Object.fromEntries(res.rows.map((r) => [r.label, r]));
    expect(byLabel["Food & Dining"].valueCents).toBe(2400); // 300+200+1500+400
    expect(byLabel["Food & Dining"].count).toBe(4);
    expect(byLabel["Uncategorized"].valueCents).toBe(700);
    expect(res.rows).toHaveLength(2);
    expect(res.meta.flow).toBe("expense");
    // ordered by sum desc
    expect(res.rows[0].label).toBe("Food & Dining");
  });

  it("category keeps children separate", async () => {
    const w = await seedWorld();
    await seedActivity(w);
    const res = await aggregateTransactions(w.user.id, query({ groupBy: "category" }));
    const byLabel = Object.fromEntries(res.rows.map((r) => [r.label, r]));
    expect(byLabel["Coffee"].valueCents).toBe(900); // 300+200+400
    expect(byLabel["Food & Dining"].valueCents).toBe(1500);
    expect(byLabel["Uncategorized"].valueCents).toBe(700);
  });

  it("month produces an ascending time series", async () => {
    const w = await seedWorld();
    await seedActivity(w);
    const res = await aggregateTransactions(w.user.id, query({ groupBy: "month" }));
    expect(res.rows.map((r) => r.key)).toEqual(["2026-06", "2026-07"]);
    expect(res.rows[0].valueCents).toBe(2000); // June expenses
    expect(res.rows[1].valueCents).toBe(1100); // July: 700 + 400 pending coffee
  });

  it("week buckets use the ISO week start date", async () => {
    const w = await seedWorld();
    await makeTxn(w, { date: new Date("2026-07-01"), amountCents: 100n }); // Wed
    await makeTxn(w, { date: new Date("2026-07-02"), amountCents: 200n }); // Thu, same week
    await makeTxn(w, { date: new Date("2026-07-07"), amountCents: 400n }); // next Tue
    const res = await aggregateTransactions(w.user.id, query({ groupBy: "week" }));
    expect(res.rows.map((r) => r.key)).toEqual(["2026-06-29", "2026-07-06"]);
    expect(res.rows.map((r) => r.valueCents)).toEqual([300, 400]);
  });

  it("flow returns all flows when no flow filter is given", async () => {
    const w = await seedWorld();
    await seedActivity(w);
    const res = await aggregateTransactions(w.user.id, query({ groupBy: "flow" }));
    const byKey = Object.fromEntries(res.rows.map((r) => [r.key, r]));
    expect(byKey["EXPENSE"].valueCents).toBe(3100); // 300+200+1500+700+400
    expect(byKey["INCOME"].valueCents).toBe(-500000);
    expect(byKey["TRANSFER"].valueCents).toBe(10000);
    expect(res.meta.flow).toBe("all");
  });

  it("merchant groups by merchant name, falling back to the raw name", async () => {
    const w = await seedWorld();
    await seedActivity(w);
    const res = await aggregateTransactions(w.user.id, query({ groupBy: "merchant" }));
    const byLabel = Object.fromEntries(res.rows.map((r) => [r.label, r]));
    expect(byLabel["Starbucks"].valueCents).toBe(700); // 300 + 400
    expect(byLabel["GENERIC"].valueCents).toBe(700); // null merchant → raw name
  });

  it("account labels buckets with the account name", async () => {
    const w = await seedWorld();
    await seedActivity(w);
    const res = await aggregateTransactions(w.user.id, query({ groupBy: "account" }));
    const byLabel = Object.fromEntries(res.rows.map((r) => [r.label, r]));
    expect(byLabel["Credit Card"].valueCents).toBe(1500);
    expect(byLabel["Checking"].valueCents).toBe(1600); // 300+200+700+400
  });
});

describe("aggregateTransactions — metrics and filters", () => {
  it("metric=count and metric=avg", async () => {
    const w = await seedWorld();
    await seedActivity(w);
    const count = await aggregateTransactions(
      w.user.id,
      query({ groupBy: "category", metric: "count" }),
    );
    const coffeeCount = count.rows.find((r) => r.label === "Coffee");
    expect(coffeeCount).toMatchObject({ valueCents: 3, count: 3 });

    const avg = await aggregateTransactions(
      w.user.id,
      query({ groupBy: "category", metric: "avg" }),
    );
    const coffeeAvg = avg.rows.find((r) => r.label === "Coffee");
    expect(coffeeAvg?.valueCents).toBe(300); // (300+200+400)/3
  });

  it("explicit flow=income and flow=transfer filters", async () => {
    const w = await seedWorld();
    await seedActivity(w);
    const income = await aggregateTransactions(
      w.user.id,
      query({ groupBy: "month", flow: "income" }),
    );
    expect(income.rows).toEqual([
      { key: "2026-07", label: "2026-07", valueCents: -500000, count: 1 },
    ]);
    const transfer = await aggregateTransactions(
      w.user.id,
      query({ groupBy: "month", flow: "transfer" }),
    );
    expect(transfer.rows[0].valueCents).toBe(10000);
  });

  it("date range, account, merchant, and pending filters", async () => {
    const w = await seedWorld();
    await seedActivity(w);

    const june = await aggregateTransactions(
      w.user.id,
      query({ groupBy: "category_top", dateFrom: "2026-06-01", dateTo: "2026-06-30" }),
    );
    expect(june.rows).toHaveLength(1);
    expect(june.rows[0].valueCents).toBe(2000);

    const credit = await aggregateTransactions(
      w.user.id,
      query({ groupBy: "month", accountId: w.credit.id }),
    );
    expect(credit.rows[0].valueCents).toBe(1500);

    const starbucks = await aggregateTransactions(
      w.user.id,
      query({ groupBy: "month", merchant: "STARBUCK" }),
    );
    expect(starbucks.rows.map((r) => r.valueCents)).toEqual([300, 400]);

    const posted = await aggregateTransactions(
      w.user.id,
      query({ groupBy: "month", pending: "false" }),
    );
    expect(posted.rows.find((r) => r.key === "2026-07")?.valueCents).toBe(700);
  });

  it("categoryId filter: uncategorized includes null; scoping excludes other users", async () => {
    const w = await seedWorld();
    await seedActivity(w);
    // another user's uncategorized July expense must not leak in
    const otherUser = await db.user.create({
      data: { email: `agg-other-${Math.random()}@test.local` },
    });
    const otherItem = await db.plaidItem.create({
      data: {
        userId: otherUser.id,
        plaidItemId: `pi-${Math.random()}`,
        encryptedAccessToken: encryptSecret("tok"),
        institutionId: "ins_2",
        institutionName: "Other Bank",
      },
    });
    const otherAccount = await db.account.create({
      data: {
        userId: otherUser.id,
        plaidItemId: otherItem.id,
        plaidAccountId: `pa-o-${Math.random()}`,
        name: "Other Checking",
        type: "depository",
      },
    });
    await db.transaction.create({
      data: {
        userId: otherUser.id,
        accountId: otherAccount.id,
        plaidTransactionId: `agg-other-${Math.random()}`,
        amountCents: 777777n,
        date: new Date("2026-07-02"),
        name: "OTHER",
        pending: false,
      },
    });

    const unc = await aggregateTransactions(
      w.user.id,
      query({ groupBy: "month", categoryId: w.unc.id }),
    );
    expect(unc.rows).toEqual([
      { key: "2026-07", label: "2026-07", valueCents: 700, count: 1 },
    ]);
  });
});
