// Idempotent seed: system categories + Plaid PFC mapping table.
// Run with `npm run db:seed` (tsx prisma/seed.ts). Safe to re-run — every
// row is upserted by its stable key (Category.slug / PlaidCategoryMapping.plaidDetailed).
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { SYSTEM_CATEGORIES } from "./seed-data/categories";
import { PLAID_CATEGORY_MAPPING } from "./seed-data/plaid-mapping";

function validate(): void {
  const slugs = new Set<string>();
  for (const parent of SYSTEM_CATEGORIES) {
    for (const slug of [parent.slug, ...(parent.children ?? []).map((c) => c.slug)]) {
      if (slugs.has(slug)) {
        throw new Error(`Duplicate category slug in seed data: "${slug}"`);
      }
      slugs.add(slug);
    }
  }

  const detailedCodes = new Set<string>();
  for (const mapping of PLAID_CATEGORY_MAPPING) {
    if (detailedCodes.has(mapping.plaidDetailed)) {
      throw new Error(`Duplicate plaidDetailed in seed data: "${mapping.plaidDetailed}"`);
    }
    detailedCodes.add(mapping.plaidDetailed);
    if (!slugs.has(mapping.categorySlug)) {
      throw new Error(
        `Mapping ${mapping.plaidDetailed} references unknown categorySlug "${mapping.categorySlug}"`,
      );
    }
  }
}

async function main(): Promise<void> {
  validate();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  try {
    let categoryCount = 0;

    // Parents first, then children referencing parentId.
    for (const parent of SYSTEM_CATEGORIES) {
      const parentRow = await prisma.category.upsert({
        where: { slug: parent.slug },
        create: {
          slug: parent.slug,
          name: parent.name,
          flow: parent.flow,
          isSystem: true,
          userId: null,
          parentId: null,
        },
        update: {
          name: parent.name,
          flow: parent.flow,
          isSystem: true,
          userId: null,
          parentId: null,
        },
      });
      categoryCount++;

      for (const child of parent.children ?? []) {
        await prisma.category.upsert({
          where: { slug: child.slug },
          create: {
            slug: child.slug,
            name: child.name,
            flow: parent.flow, // children inherit flow
            isSystem: true,
            userId: null,
            parentId: parentRow.id,
          },
          update: {
            name: child.name,
            flow: parent.flow,
            isSystem: true,
            userId: null,
            parentId: parentRow.id,
          },
        });
        categoryCount++;
      }
    }

    let mappingCount = 0;
    for (const mapping of PLAID_CATEGORY_MAPPING) {
      await prisma.plaidCategoryMapping.upsert({
        where: { plaidDetailed: mapping.plaidDetailed },
        create: mapping,
        update: {
          plaidPrimary: mapping.plaidPrimary,
          categorySlug: mapping.categorySlug,
        },
      });
      mappingCount++;
    }

    console.log(`Seed complete: ${categoryCount} categories, ${mappingCount} plaid mappings upserted.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exitCode = 1;
});
