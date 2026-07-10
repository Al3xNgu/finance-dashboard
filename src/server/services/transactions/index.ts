import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db/client";
import { ValidationError } from "@/server/lib/errors";
import { centsToNumber } from "@/server/lib/money";
import type { ListTransactionsQuery } from "@/shared/schemas/transactions";

export interface TransactionDto {
  id: string;
  date: string; // YYYY-MM-DD
  authorizedDate: string | null;
  name: string;
  merchantName: string | null;
  amountCents: number; // Plaid sign convention: positive = outflow (D-006)
  isoCurrencyCode: string;
  pending: boolean;
  categoryId: string | null;
  userCategoryOverride: boolean;
  accountId: string;
  accountName: string;
  accountMask: string | null;
  institutionName: string;
}

export interface TransactionListDto {
  transactions: TransactionDto[];
  nextCursor: string | null;
  totalCount: number;
}

type Sort = ListTransactionsQuery["sort"];
type Order = ListTransactionsQuery["order"];

/**
 * Opaque keyset cursor (D-011): base64url JSON of the last row's sort value +
 * id. Self-describing (sort/order embedded) so a cursor can't be replayed
 * against a differently-ordered query, and independent of the cursor row still
 * existing — a row soft-deleted mid-browse doesn't break the next page.
 */
interface CursorPayload {
  s: Sort;
  o: Order;
  v: string | null; // sort value: ISO date, stringified cents, or merchant name
  id: string;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeCursor(raw: string, q: ListTransactionsQuery): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("Invalid cursor.");
  }
  const c = parsed as Partial<CursorPayload>;
  if (
    typeof c !== "object" ||
    c === null ||
    typeof c.id !== "string" ||
    (typeof c.v !== "string" && c.v !== null)
  ) {
    throw new ValidationError("Invalid cursor.");
  }
  if (c.s !== q.sort || c.o !== q.order) {
    throw new ValidationError("Cursor does not match the requested sort.");
  }
  return c as CursorPayload;
}

/** Rows strictly after the cursor position in (sortKey, id) order. */
function cursorWhere(c: CursorPayload): Prisma.TransactionWhereInput {
  const asc = c.o === "asc";
  const idAfter = asc ? { id: { gt: c.id } } : { id: { lt: c.id } };

  if (c.s === "date") {
    const v = new Date(c.v as string);
    return {
      OR: [{ date: asc ? { gt: v } : { lt: v } }, { date: v, ...idAfter }],
    };
  }
  if (c.s === "amount") {
    const v = BigInt(c.v as string);
    return {
      OR: [
        { amountCents: asc ? { gt: v } : { lt: v } },
        { amountCents: v, ...idAfter },
      ],
    };
  }
  // merchant: nullable, ordered nulls-last in both directions
  if (c.v === null) {
    return { merchantName: null, ...idAfter };
  }
  return {
    OR: [
      { merchantName: asc ? { gt: c.v } : { lt: c.v } },
      { merchantName: c.v, ...idAfter },
      { merchantName: null }, // nulls sort after every non-null value
    ],
  };
}

function nextCursorFor(q: ListTransactionsQuery, last: { id: string; date: Date; amountCents: bigint; merchantName: string | null }): string {
  const v =
    q.sort === "date"
      ? last.date.toISOString().slice(0, 10)
      : q.sort === "amount"
        ? last.amountCents.toString()
        : last.merchantName;
  return encodeCursor({ s: q.sort, o: q.order, v, id: last.id });
}

function filterConditions(
  userId: string,
  q: ListTransactionsQuery,
  uncategorizedId: string | null,
): Prisma.TransactionWhereInput[] {
  const conditions: Prisma.TransactionWhereInput[] = [
    { userId, deletedAt: null },
  ];
  if (q.dateFrom || q.dateTo) {
    conditions.push({
      date: {
        ...(q.dateFrom ? { gte: new Date(q.dateFrom) } : {}),
        ...(q.dateTo ? { lte: new Date(q.dateTo) } : {}),
      },
    });
  }
  if (q.categoryId) {
    // Deleting a custom category leaves categoryId null (FK SetNull); those
    // rows render as Uncategorized, so that filter must include them.
    conditions.push(
      q.categoryId === uncategorizedId
        ? { OR: [{ categoryId: q.categoryId }, { categoryId: null }] }
        : { categoryId: q.categoryId },
    );
  }
  if (q.accountId) conditions.push({ accountId: q.accountId });
  if (q.merchant) {
    conditions.push({
      merchantName: { contains: q.merchant, mode: "insensitive" },
    });
  }
  if (q.search) {
    conditions.push({
      OR: [
        { name: { contains: q.search, mode: "insensitive" } },
        { merchantName: { contains: q.search, mode: "insensitive" } },
      ],
    });
  }
  if (q.minAmountCents !== undefined || q.maxAmountCents !== undefined) {
    conditions.push({
      amountCents: {
        ...(q.minAmountCents !== undefined ? { gte: q.minAmountCents } : {}),
        ...(q.maxAmountCents !== undefined ? { lte: q.maxAmountCents } : {}),
      },
    });
  }
  if (q.pending !== undefined) conditions.push({ pending: q.pending });
  return conditions;
}

function orderBy(q: ListTransactionsQuery): Prisma.TransactionOrderByWithRelationInput[] {
  const dir = q.order;
  const primary: Prisma.TransactionOrderByWithRelationInput =
    q.sort === "amount"
      ? { amountCents: dir }
      : q.sort === "merchant"
        ? { merchantName: { sort: dir, nulls: "last" } }
        : { date: dir };
  // id tiebreak makes the order total so pages never skip or repeat rows
  return [primary, { id: dir }];
}

export async function listTransactions(
  userId: string,
  q: ListTransactionsQuery,
): Promise<TransactionListDto> {
  const uncategorized = q.categoryId
    ? await db.category.findUnique({
        where: { slug: "uncategorized" },
        select: { id: true },
      })
    : null;
  const filters = filterConditions(userId, q, uncategorized?.id ?? null);
  const where: Prisma.TransactionWhereInput = { AND: filters };
  const pageWhere: Prisma.TransactionWhereInput = q.cursor
    ? { AND: [...filters, cursorWhere(decodeCursor(q.cursor, q))] }
    : where;

  const [rows, totalCount] = await Promise.all([
    db.transaction.findMany({
      where: pageWhere,
      orderBy: orderBy(q),
      take: q.limit + 1, // one extra row = "there is a next page"
      include: {
        account: {
          select: {
            name: true,
            mask: true,
            plaidItem: { select: { institutionName: true } },
          },
        },
      },
    }),
    db.transaction.count({ where }), // count ignores the cursor: whole result set
  ]);

  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;

  return {
    transactions: page.map((t) => ({
      id: t.id,
      date: t.date.toISOString().slice(0, 10),
      authorizedDate: t.authorizedDate?.toISOString().slice(0, 10) ?? null,
      name: t.name,
      merchantName: t.merchantName,
      amountCents: centsToNumber(t.amountCents) as number,
      isoCurrencyCode: t.isoCurrencyCode,
      pending: t.pending,
      categoryId: t.categoryId,
      userCategoryOverride: t.userCategoryOverride,
      accountId: t.accountId,
      accountName: t.account.name,
      accountMask: t.account.mask,
      institutionName: t.account.plaidItem.institutionName,
    })),
    nextCursor: hasMore ? nextCursorFor(q, page[page.length - 1]) : null,
    totalCount,
  };
}
