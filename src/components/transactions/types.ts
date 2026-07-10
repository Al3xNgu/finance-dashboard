// Client-side mirrors of the API DTOs — no imports from src/server/**.

export interface TransactionDto {
  id: string;
  date: string; // YYYY-MM-DD
  authorizedDate: string | null;
  name: string;
  merchantName: string | null;
  amountCents: number; // positive = money out
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

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  flow: string;
  isSystem: boolean;
  parentId: string | null;
  children: Omit<CategoryNode, "children">[];
}

export interface AccountOption {
  id: string;
  name: string;
  mask: string | null;
}

export const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** Reads the API error envelope ({"error":{"code","message","requestId"}}). */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error?: { message?: unknown } }).error?.message === "string"
    ) {
      return (body as { error: { message: string } }).error.message;
    }
  } catch {
    // fall through to the generic message
  }
  return fallback;
}
