import "server-only";
import type { z } from "zod";
import { db } from "@/server/db/client";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/server/lib/errors";
import type {
  createCategorySchema,
  createCategoryRuleSchema,
  updateCategorySchema,
  updateCategoryRuleSchema,
} from "@/shared/schemas/categories";

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  flow: string;
  isSystem: boolean;
  parentId: string | null;
  children: Omit<CategoryDto, "children">[];
}

/** System + the user's own categories, as a two-level tree. */
export async function listCategories(userId: string): Promise<CategoryDto[]> {
  const rows = await db.category.findMany({
    where: { OR: [{ userId: null }, { userId }] },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });
  const toDto = (r: (typeof rows)[number]) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    flow: r.flow,
    isSystem: r.isSystem,
    parentId: r.parentId,
  });
  return rows
    .filter((r) => !r.parentId)
    .map((parent) => ({
      ...toDto(parent),
      children: rows.filter((r) => r.parentId === parent.id).map(toDto),
    }));
}

async function uniqueSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "category";
  const taken = new Set(
    (
      await db.category.findMany({
        where: { slug: { startsWith: base } },
        select: { slug: true },
      })
    ).map((c) => c.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }
}

export async function createCategory(
  userId: string,
  input: z.infer<typeof createCategorySchema>,
): Promise<{ id: string; slug: string }> {
  if (input.parentId) {
    const parent = await db.category.findFirst({
      where: { id: input.parentId, OR: [{ userId: null }, { userId }] },
      select: { parentId: true },
    });
    if (!parent) throw new NotFoundError("Parent category not found.");
    if (parent.parentId)
      throw new ValidationError("Categories can be nested one level deep.");
  }
  const slug = await uniqueSlug(input.name);
  const created = await db.category.create({
    data: {
      userId,
      name: input.name,
      slug,
      flow: input.flow,
      parentId: input.parentId ?? null,
      isSystem: false,
    },
    select: { id: true, slug: true },
  });
  return created;
}

async function requireOwnCategory(userId: string, id: string) {
  const category = await db.category.findFirst({
    where: { id, userId },
    select: { id: true, isSystem: true },
  });
  if (!category) {
    // system categories 404 here too: they are not editable, and ids must
    // not act as an existence oracle
    const isSystem = await db.category.findFirst({
      where: { id, userId: null },
      select: { id: true },
    });
    if (isSystem)
      throw new ForbiddenError("System categories cannot be modified.");
    throw new NotFoundError("Category not found.");
  }
  return category;
}

export async function updateCategory(
  userId: string,
  id: string,
  input: z.infer<typeof updateCategorySchema>,
): Promise<void> {
  await requireOwnCategory(userId, id);
  if (input.parentId) {
    if (input.parentId === id)
      throw new ValidationError("A category cannot be its own parent.");
    const parent = await db.category.findFirst({
      where: { id: input.parentId, OR: [{ userId: null }, { userId }] },
      select: { parentId: true },
    });
    if (!parent) throw new NotFoundError("Parent category not found.");
    if (parent.parentId)
      throw new ValidationError("Categories can be nested one level deep.");
  }
  await db.category.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    },
  });
}

export async function deleteCategory(userId: string, id: string): Promise<void> {
  await requireOwnCategory(userId, id);
  const childCount = await db.category.count({ where: { parentId: id } });
  if (childCount > 0)
    throw new ConflictError("Delete or move its subcategories first.");
  // transactions fall back via onDelete: SetNull → rendered as Uncategorized
  await db.category.delete({ where: { id } });
}

// ---------- rules ----------

export interface CategoryRuleDto {
  id: string;
  categoryId: string;
  priority: number;
  matchField: string;
  matchType: string;
  matchValue: string;
  minAmountCents: number | null;
  maxAmountCents: number | null;
  accountId: string | null;
  isActive: boolean;
}

export async function listRules(userId: string): Promise<CategoryRuleDto[]> {
  const rules = await db.categoryRule.findMany({
    where: { userId },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  return rules.map((r) => ({
    id: r.id,
    categoryId: r.categoryId,
    priority: r.priority,
    matchField: r.matchField,
    matchType: r.matchType,
    matchValue: r.matchValue,
    minAmountCents: r.minAmountCents == null ? null : Number(r.minAmountCents),
    maxAmountCents: r.maxAmountCents == null ? null : Number(r.maxAmountCents),
    accountId: r.accountId,
    isActive: r.isActive,
  }));
}

async function validateRuleRefs(
  userId: string,
  input: { categoryId?: string; accountId?: string },
) {
  if (input.categoryId) {
    const cat = await db.category.findFirst({
      where: { id: input.categoryId, OR: [{ userId: null }, { userId }] },
      select: { id: true },
    });
    if (!cat) throw new NotFoundError("Category not found.");
  }
  if (input.accountId) {
    const acct = await db.account.findFirst({
      where: { id: input.accountId, userId },
      select: { id: true },
    });
    if (!acct) throw new NotFoundError("Account not found.");
  }
}

export async function createRule(
  userId: string,
  input: z.infer<typeof createCategoryRuleSchema>,
): Promise<{ id: string }> {
  await validateRuleRefs(userId, input);
  return db.categoryRule.create({
    data: { ...input, userId },
    select: { id: true },
  });
}

export async function updateRule(
  userId: string,
  id: string,
  input: z.infer<typeof updateCategoryRuleSchema>,
): Promise<void> {
  const existing = await db.categoryRule.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError("Rule not found.");
  await validateRuleRefs(userId, input);
  await db.categoryRule.update({ where: { id }, data: input });
}

export async function deleteRule(userId: string, id: string): Promise<void> {
  const existing = await db.categoryRule.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError("Rule not found.");
  await db.categoryRule.delete({ where: { id } });
}
