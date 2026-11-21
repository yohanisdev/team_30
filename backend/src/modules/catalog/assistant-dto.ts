import type { AssistantProductCard, AssistantShopCard } from '@marketplace/contracts';
import { money } from '../../lib/format.js';

/**
 * Explicit public fields. Callers pass database rows; anything else on the row is ignored,
 * so a joined private column cannot reach Gemini or the browser by accident.
 */
export interface CatalogProductRow {
  productId: string;
  name: string;
  description: string;
  price: unknown;
  available: boolean;
  categoryName: string;
  categorySlug: string;
  shopId: string;
  shopName: string;
  shopSlug: string;
  imageUrl: string | null;
  distanceKm?: unknown;
}

export interface CatalogShopRow {
  shopId: string;
  name: string;
  slug: string;
  description: string;
  addressText: string;
  phone: string;
  logoUrl: string | null;
  productCount: number;
  distanceKm?: unknown;
}

export function roundDistance(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const km = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(km) || km < 0) return null;
  return Math.round(km * 10) / 10;
}

export function toAssistantProduct(row: CatalogProductRow): AssistantProductCard {
  return {
    productId: row.productId,
    name: row.name,
    description: row.description,
    price: money(String(row.price)),
    currency: 'ETB',
    imageUrl: row.imageUrl,
    available: row.available,
    categoryName: row.categoryName,
    categorySlug: row.categorySlug,
    shopId: row.shopId,
    shopName: row.shopName,
    shopSlug: row.shopSlug,
    distanceKm: roundDistance(row.distanceKm),
  };
}

export function toAssistantShop(row: CatalogShopRow): AssistantShopCard {
  return {
    shopId: row.shopId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    addressText: row.addressText,
    phone: row.phone,
    logoUrl: row.logoUrl,
    distanceKm: roundDistance(row.distanceKm),
    productCount: row.productCount,
  };
}

/** Keys that are allowed to leave the catalog service. Tests assert the model payload stays inside this set. */
export const ASSISTANT_PRODUCT_KEYS = [
  'productId',
  'name',
  'description',
  'price',
  'currency',
  'imageUrl',
  'available',
  'categoryName',
  'categorySlug',
  'shopId',
  'shopName',
  'shopSlug',
  'distanceKm',
] as const;

export const ASSISTANT_SHOP_KEYS = [
  'shopId',
  'name',
  'slug',
  'description',
  'addressText',
  'phone',
  'logoUrl',
  'distanceKm',
  'productCount',
] as const;
