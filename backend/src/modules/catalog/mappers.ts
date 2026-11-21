import type {
  AdminCategory,
  AdminShop,
  ManagedShop,
  MerchantProduct,
  PublicCategory,
  PublicProduct,
  PublicProductDetail,
  PublicShopDetail,
  PublicShopSummary,
} from '@marketplace/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { coordinate, iso, money } from '../../lib/format.js';
import { canPurchase } from './visibility.js';

/* ----------------------------------------------------------------------------
 * Query shapes. Each mapper declares exactly the columns it needs, so a public
 * response can never pick up bank details or stock counts by accident.
 * ------------------------------------------------------------------------- */

export const publicShopSelect = {
  id: true,
  name: true,
  slug: true,
  addressText: true,
  latitude: true,
  longitude: true,
  logoUrl: true,
  _count: { select: { products: { where: { status: 'ACTIVE' } } } },
} satisfies Prisma.ShopSelect;

export const publicShopDetailSelect = {
  ...publicShopSelect,
  description: true,
  phone: true,
  coverUrl: true,
  deliveryFeeEtb: true,
} satisfies Prisma.ShopSelect;

export const managedShopSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  phone: true,
  addressText: true,
  latitude: true,
  longitude: true,
  status: true,
  deliveryFeeEtb: true,
  bankName: true,
  bankAccountName: true,
  bankAccountNumber: true,
  logoUrl: true,
  logoPublicId: true,
  coverUrl: true,
  coverPublicId: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: { where: { status: 'ACTIVE' } } } },
} satisfies Prisma.ShopSelect;

export const adminShopSelect = {
  ...managedShopSelect,
  merchant: {
    select: {
      id: true,
      username: true,
      fullName: true,
      status: true,
      merchantProfile: { select: { contactPhone: true } },
    },
  },
} satisfies Prisma.ShopSelect;

export const publicProductSelect = {
  id: true,
  name: true,
  price: true,
  isAvailable: true,
  stockQuantity: true,
  images: { select: { url: true }, orderBy: { position: 'asc' }, take: 1 },
  category: { select: { slug: true, name: true } },
  shop: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ProductSelect;

export const publicProductDetailSelect = {
  ...publicProductSelect,
  description: true,
  images: { select: { url: true }, orderBy: { position: 'asc' } },
  shop: {
    select: {
      id: true,
      name: true,
      slug: true,
      addressText: true,
      latitude: true,
      longitude: true,
      phone: true,
    },
  },
} satisfies Prisma.ProductSelect;

export const merchantProductSelect = {
  id: true,
  shopId: true,
  name: true,
  description: true,
  price: true,
  stockQuantity: true,
  isAvailable: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  shop: { select: { name: true } },
  category: { select: { id: true, name: true, slug: true } },
  images: { select: { publicId: true, url: true, position: true }, orderBy: { position: 'asc' } },
} satisfies Prisma.ProductSelect;

type PublicShopRow = Prisma.ShopGetPayload<{ select: typeof publicShopSelect }>;
type PublicShopDetailRow = Prisma.ShopGetPayload<{ select: typeof publicShopDetailSelect }>;
type ManagedShopRow = Prisma.ShopGetPayload<{ select: typeof managedShopSelect }>;
type AdminShopRow = Prisma.ShopGetPayload<{ select: typeof adminShopSelect }>;
type PublicProductRow = Prisma.ProductGetPayload<{ select: typeof publicProductSelect }>;
type PublicProductDetailRow = Prisma.ProductGetPayload<{ select: typeof publicProductDetailSelect }>;
type MerchantProductRow = Prisma.ProductGetPayload<{ select: typeof merchantProductSelect }>;

/* ----------------------------------------------------------------------------
 * Mappers
 * ------------------------------------------------------------------------- */

export const toPublicCategory = (category: {
  id: string;
  name: string;
  slug: string;
}): PublicCategory => ({ id: category.id, name: category.name, slug: category.slug });

export function toAdminCategory(category: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  _count: { products: number };
}): AdminCategory {
  return {
    ...toPublicCategory(category),
    description: category.description,
    isActive: category.isActive,
    productCount: category._count.products,
    createdAt: iso(category.createdAt),
  };
}

export function toPublicShopSummary(
  shop: PublicShopRow,
  categories: PublicCategory[] = [],
): PublicShopSummary {
  return {
    id: shop.id,
    name: shop.name,
    slug: shop.slug,
    addressText: shop.addressText,
    latitude: coordinate(shop.latitude),
    longitude: coordinate(shop.longitude),
    productCount: shop._count.products,
    logoUrl: shop.logoUrl,
    categories,
  };
}

export function toPublicShopDetail(
  shop: PublicShopDetailRow,
  categories: PublicCategory[] = [],
): PublicShopDetail {
  return {
    ...toPublicShopSummary(shop, categories),
    description: shop.description,
    phone: shop.phone,
    coverUrl: shop.coverUrl,
    deliveryFeeEtb: money(shop.deliveryFeeEtb),
  };
}

export function toManagedShop(shop: ManagedShopRow): ManagedShop {
  return {
    id: shop.id,
    name: shop.name,
    slug: shop.slug,
    description: shop.description,
    phone: shop.phone,
    addressText: shop.addressText,
    latitude: coordinate(shop.latitude),
    longitude: coordinate(shop.longitude),
    status: shop.status,
    deliveryFeeEtb: money(shop.deliveryFeeEtb),
    bankName: shop.bankName,
    bankAccountName: shop.bankAccountName,
    bankAccountNumber: shop.bankAccountNumber,
    logoUrl: shop.logoUrl,
    logoImageId: shop.logoPublicId,
    coverUrl: shop.coverUrl,
    coverImageId: shop.coverPublicId,
    productCount: shop._count.products,
    createdAt: iso(shop.createdAt),
    updatedAt: iso(shop.updatedAt),
  };
}

export function toAdminShop(shop: AdminShopRow): AdminShop {
  return {
    ...toManagedShop(shop),
    merchant: {
      id: shop.merchant.id,
      username: shop.merchant.username,
      fullName: shop.merchant.fullName,
      status: shop.merchant.status,
      contactPhone: shop.merchant.merchantProfile?.contactPhone ?? null,
    },
  };
}

export function toPublicProduct(product: PublicProductRow): PublicProduct {
  return {
    id: product.id,
    name: product.name,
    price: money(product.price),
    currency: 'ETB',
    imageUrl: product.images[0]?.url ?? null,
    canPurchase: canPurchase(product),
    category: { slug: product.category.slug, name: product.category.name },
    shop: { id: product.shop.id, name: product.shop.name, slug: product.shop.slug },
  };
}

export function toPublicProductDetail(product: PublicProductDetailRow): PublicProductDetail {
  return {
    id: product.id,
    name: product.name,
    price: money(product.price),
    currency: 'ETB',
    imageUrl: product.images[0]?.url ?? null,
    canPurchase: canPurchase(product),
    category: { slug: product.category.slug, name: product.category.name },
    description: product.description,
    images: product.images.map((image) => ({ url: image.url })),
    shop: {
      id: product.shop.id,
      name: product.shop.name,
      slug: product.shop.slug,
      addressText: product.shop.addressText,
      latitude: coordinate(product.shop.latitude),
      longitude: coordinate(product.shop.longitude),
      phone: product.shop.phone,
    },
  };
}

export function toMerchantProduct(product: MerchantProductRow): MerchantProduct {
  return {
    id: product.id,
    shopId: product.shopId,
    shopName: product.shop.name,
    category: product.category,
    name: product.name,
    description: product.description,
    price: money(product.price),
    stockQuantity: product.stockQuantity,
    isAvailable: product.isAvailable,
    status: product.status,
    imageUrl: product.images[0]?.url ?? null,
    images: product.images,
    createdAt: iso(product.createdAt),
    updatedAt: iso(product.updatedAt),
  };
}
