import { Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { escapeLike } from '../../lib/params.js';
import { createPrismaClient, prisma, type DbClient } from '../../lib/prisma.js';
import {
  toAssistantProduct,
  toAssistantShop,
  type CatalogProductRow,
  type CatalogShopRow,
} from './assistant-dto.js';
import type { AssistantProductCard, AssistantShopCard } from '@marketplace/contracts';

/**
 * The only database gateway the shopping assistant may use.
 * Every query is a fixed statement with bound parameters. Nothing in this file accepts SQL,
 * a table name, or a Prisma delegate chosen by the caller.
 * Reads go through `public_catalog_products`, which already hides inactive products,
 * suspended shops, and suspended merchants. Stock quantities are not selected.
 */

export interface ProductSearch {
  query?: string;
  category?: string;
  minPrice?: string;
  maxPrice?: string;
  availableOnly: boolean;
  limit: number;
}

export interface NearbySearch extends ProductSearch {
  radiusKm: number;
  origin: { latitude: number; longitude: number } | null;
  area: string | null;
}

export interface NearbyShopGroup {
  shop: AssistantShopCard;
  products: AssistantProductCard[];
}

let readOnlyClient: DbClient | undefined;

function catalogDb(): DbClient {
  const url = env.DATABASE_URL_CATALOG_RO;
  if (!url) return prisma;
  readOnlyClient ??= createPrismaClient(url);
  return readOnlyClient;
}

const productColumns = Prisma.sql`
  p.id AS "productId",
  p.name,
  left(p.description, 500) AS description,
  p.price,
  p.can_purchase AS available,
  c.name AS "categoryName",
  c.slug AS "categorySlug",
  s.id AS "shopId",
  s.name AS "shopName",
  s.slug AS "shopSlug",
  left(s.description, 500) AS "shopDescription",
  s.address_text AS "addressText",
  s.phone,
  s.logo_url AS "logoUrl",
  (
    SELECT pi.url FROM product_images pi
    WHERE pi.product_id = p.id
    ORDER BY pi.position ASC
    LIMIT 1
  ) AS "imageUrl"
`;

function filters(input: {
  query?: string;
  category?: string;
  minPrice?: string;
  maxPrice?: string;
  availableOnly?: boolean;
  productIds?: string[];
  area?: string;
}): Prisma.Sql[] {
  const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (input.query) {
    const pattern = `%${escapeLike(input.query)}%`;
    where.push(Prisma.sql`(p.name ILIKE ${pattern} OR p.description ILIKE ${pattern})`);
  }
  if (input.category) where.push(Prisma.sql`c.slug = ${input.category}`);
  if (input.minPrice) where.push(Prisma.sql`p.price >= ${input.minPrice}::numeric`);
  if (input.maxPrice) where.push(Prisma.sql`p.price <= ${input.maxPrice}::numeric`);
  if (input.availableOnly) where.push(Prisma.sql`p.can_purchase`);
  if (input.productIds) {
    const ids = Prisma.join(input.productIds.map((id) => Prisma.sql`${id}::uuid`));
    where.push(Prisma.sql`p.id IN (${ids})`);
  }
  if (input.area) {
    where.push(Prisma.sql`s.address_text ILIKE ${`%${escapeLike(input.area)}%`}`);
  }
  return where;
}

function distanceSql(origin: { latitude: number; longitude: number } | null): Prisma.Sql {
  if (!origin) return Prisma.sql`NULL`;
  const { latitude, longitude } = origin;
  // Haversine, clamped so rounding error cannot push the asin argument above 1.
  return Prisma.sql`
    (6371 * 2 * asin(sqrt(least(1.0,
      power(sin(radians(s.latitude - ${latitude}) / 2), 2)
      + cos(radians(${latitude})) * cos(radians(s.latitude))
        * power(sin(radians(s.longitude - ${longitude}) / 2), 2)
    ))))`;
}

async function queryProducts(
  input: {
    query?: string;
    category?: string;
    minPrice?: string;
    maxPrice?: string;
    availableOnly?: boolean;
    productIds?: string[];
    area?: string;
    origin?: { latitude: number; longitude: number } | null;
    radiusKm?: number;
    limit: number;
    order: 'relevance' | 'price' | 'distance';
  },
): Promise<CatalogProductRow[]> {
  const where = filters(input);
  const distance = distanceSql(input.origin ?? null);
  if (input.origin && input.radiusKm !== undefined) {
    where.push(Prisma.sql`${distance} <= ${input.radiusKm}`);
  }
  let orderBy: Prisma.Sql;
  if (input.order === 'distance') {
    orderBy = Prisma.sql`${distance} ASC NULLS LAST, p.price ASC, p.id`;
  } else if (input.order === 'price') {
    orderBy = Prisma.sql`p.price ASC, p.id`;
  } else if (input.query) {
    orderBy = Prisma.sql`(p.name ILIKE ${`${escapeLike(input.query)}%`}) DESC,
      similarity(p.name, ${input.query}) DESC, p.created_at DESC, p.id`;
  } else {
    orderBy = Prisma.sql`p.can_purchase DESC, p.created_at DESC, p.id`;
  }

  const rows = await catalogDb().$queryRaw<CatalogProductRow[]>`
    SELECT ${productColumns}, ${distance} AS "distanceKm"
    FROM public_catalog_products p
    JOIN shops s ON s.id = p.shop_id
    JOIN categories c ON c.id = p.category_id
    WHERE ${Prisma.join(where, ' AND ')}
    ORDER BY ${orderBy}
    LIMIT ${input.limit}`;
  return rows;
}

export async function searchProducts(input: ProductSearch): Promise<AssistantProductCard[]> {
  const rows = await queryProducts({ ...input, order: 'relevance' });
  return rows.map((row) => toAssistantProduct({ ...row, distanceKm: null }));
}

export async function getProduct(productId: string): Promise<AssistantProductCard | null> {
  const rows = await queryProducts({ productIds: [productId], limit: 1, order: 'relevance' });
  const row = rows[0];
  return row ? toAssistantProduct({ ...row, distanceKm: null }) : null;
}

export async function compareProducts(productIds: string[]): Promise<AssistantProductCard[]> {
  const rows = await queryProducts({
    productIds,
    limit: productIds.length,
    order: 'price',
  });
  const cards = new Map(rows.map((row) => [row.productId, toAssistantProduct({ ...row, distanceKm: null })]));
  return productIds.flatMap((id) => {
    const card = cards.get(id);
    return card ? [card] : [];
  });
}

export async function getShop(shopId: string): Promise<AssistantShopCard | null> {
  const rows = await catalogDb().$queryRaw<CatalogShopRow[]>`
    SELECT
      s.id AS "shopId",
      s.name,
      s.slug,
      left(s.description, 500) AS description,
      s.address_text AS "addressText",
      s.phone,
      s.logo_url AS "logoUrl",
      (
        SELECT count(*)::int FROM public_catalog_products p WHERE p.shop_id = s.id
      ) AS "productCount"
    FROM shops s
    JOIN users u ON u.id = s.merchant_id
    WHERE s.id = ${shopId}::uuid
      AND s.status = 'ACTIVE'
      AND u.status = 'ACTIVE'
    LIMIT 1`;
  const row = rows[0];
  return row ? toAssistantShop(row) : null;
}

export async function findNearby(input: NearbySearch): Promise<NearbyShopGroup[]> {
  const where = filters({
    query: input.query,
    category: input.category,
    minPrice: input.minPrice,
    maxPrice: input.maxPrice,
    availableOnly: input.availableOnly,
    area: input.area ?? undefined,
  });
  const distance = distanceSql(input.origin);
  if (input.origin) where.push(Prisma.sql`${distance} <= ${input.radiusKm}`);

  // At most three matching products per shop, shops ordered nearest-first.
  const rows = await catalogDb().$queryRaw<
    (CatalogProductRow & {
      shopDescription: string;
      addressText: string;
      phone: string;
      logoUrl: string | null;
    })[]
  >`
    WITH matched AS (
      SELECT ${productColumns}, ${distance} AS "distanceKm"
      FROM public_catalog_products p
      JOIN shops s ON s.id = p.shop_id
      JOIN categories c ON c.id = p.category_id
      WHERE ${Prisma.join(where, ' AND ')}
    ),
    ranked AS (
      SELECT *,
        row_number() OVER (PARTITION BY "shopId" ORDER BY price ASC, name ASC) AS product_rank
      FROM matched
    )
    SELECT * FROM ranked
    WHERE product_rank <= 3
    ORDER BY "distanceKm" ASC NULLS LAST, "shopName" ASC, product_rank ASC
    LIMIT ${input.limit * 3}`;

  const groups = new Map<string, NearbyShopGroup>();
  for (const row of rows) {
    let group = groups.get(row.shopId);
    if (!group) {
      if (groups.size >= input.limit) continue;
      group = {
        shop: toAssistantShop({
          shopId: row.shopId,
          name: row.shopName,
          slug: row.shopSlug,
          description: row.shopDescription ?? '',
          addressText: row.addressText,
          phone: row.phone,
          logoUrl: row.logoUrl,
          productCount: 0,
          distanceKm: row.distanceKm,
        }),
        products: [],
      };
      groups.set(row.shopId, group);
    }
    group.products.push(toAssistantProduct(row));
    group.shop = { ...group.shop, productCount: group.products.length };
  }
  return [...groups.values()];
}

export interface AssistantCatalog {
  searchProducts: typeof searchProducts;
  getProduct: typeof getProduct;
  getShop: typeof getShop;
  findNearby: typeof findNearby;
  compareProducts: typeof compareProducts;
}

export const assistantCatalog: AssistantCatalog = {
  searchProducts,
  getProduct,
  getShop,
  findNearby,
  compareProducts,
};
