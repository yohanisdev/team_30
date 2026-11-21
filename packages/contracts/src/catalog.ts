import { z } from 'zod';
import { fullNameSchema, usernameSchema } from './auth.js';
import {
  MAX_PRODUCT_IMAGES,
  latitudeSchema,
  longitudeSchema,
  moneySchema,
  paginationQuerySchema,
  phoneSchema,
  positiveMoneySchema,
  queryBooleanSchema,
  uuidSchema,
} from './common.js';
import type { ProductStatus, ShopStatus } from './enums.js';

/* ----------------------------------------------------------------------------
 * Categories
 * ------------------------------------------------------------------------- */

export const createCategorySchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  description: z.string().trim().max(500).optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export interface PublicCategory {
  id: string;
  name: string;
  slug: string;
}

export interface AdminCategory extends PublicCategory {
  description: string | null;
  isActive: boolean;
  productCount: number;
  createdAt: string;
}

/* ----------------------------------------------------------------------------
 * Shops
 * ------------------------------------------------------------------------- */

/** Public ids returned by the image upload endpoint. The server derives the URL itself. */
export const imageIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9/_.-]+$/, 'Invalid image reference');

const shopFields = {
  merchantId: uuidSchema,
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(160),
  description: z.string().trim().max(5000),
  phone: phoneSchema,
  addressText: z.string().trim().min(2, 'Address must be at least 2 characters').max(300),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  deliveryFeeEtb: moneySchema,
  bankName: z.string().trim().min(2, 'Bank name is required').max(120),
  bankAccountName: z.string().trim().min(2, 'Account name is required').max(160),
  bankAccountNumber: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{4,40}$/, 'Use 4–40 letters, digits or dashes'),
  logoImageId: imageIdSchema.nullable(),
  coverImageId: imageIdSchema.nullable(),
};

const merchantAccountFields = {
  merchantFullName: fullNameSchema.optional(),
  merchantUsername: usernameSchema.optional(),
  merchantPhone: phoneSchema.optional(),
};

/** A shop is owned by a merchant user. The id and the typed account are alternative inputs. */
function requireMerchantReference(
  value: {
    merchantId?: string;
    merchantFullName?: string;
    merchantUsername?: string;
    merchantPhone?: string;
  },
  ctx: z.RefinementCtx,
  required: boolean,
) {
  const hasId = value.merchantId !== undefined;
  const provided = [
    value.merchantFullName !== undefined,
    value.merchantUsername !== undefined,
    value.merchantPhone !== undefined,
  ].filter(Boolean).length;
  if (hasId && provided === 0) return;
  if (hasId && provided > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['merchantFullName'],
      message: 'Send an existing merchant id or the merchant account details, not both',
    });
    return;
  }
  if (provided === 0) {
    if (required) {
      ctx.addIssue({
        code: 'custom',
        path: ['merchantFullName'],
        message: "Enter the merchant's full name",
      });
    }
    return;
  }
  if (!value.merchantFullName) {
    ctx.addIssue({ code: 'custom', path: ['merchantFullName'], message: "Enter the merchant's full name" });
  }
  if (!value.merchantUsername) {
    ctx.addIssue({ code: 'custom', path: ['merchantUsername'], message: 'Enter a username for the merchant' });
  }
  if (!value.merchantPhone) {
    ctx.addIssue({ code: 'custom', path: ['merchantPhone'], message: 'Enter the merchant phone number' });
  }
}

export const createShopSchema = z
  .object({
    ...shopFields,
    merchantId: shopFields.merchantId.optional(),
    ...merchantAccountFields,
    description: shopFields.description.default(''),
    deliveryFeeEtb: shopFields.deliveryFeeEtb.default('0'),
    logoImageId: shopFields.logoImageId.optional(),
    coverImageId: shopFields.coverImageId.optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).default('ACTIVE'),
  })
  .superRefine((value, ctx) => requireMerchantReference(value, ctx, true));
export type CreateShopInput = z.input<typeof createShopSchema>;

export const updateShopSchema = z
  .object({
    merchantId: shopFields.merchantId.optional(),
    ...merchantAccountFields,
    name: shopFields.name.optional(),
    description: shopFields.description.optional(),
    phone: shopFields.phone.optional(),
    addressText: shopFields.addressText.optional(),
    latitude: shopFields.latitude.optional(),
    longitude: shopFields.longitude.optional(),
    deliveryFeeEtb: shopFields.deliveryFeeEtb.optional(),
    bankName: shopFields.bankName.optional(),
    bankAccountName: shopFields.bankAccountName.optional(),
    bankAccountNumber: shopFields.bankAccountNumber.optional(),
    logoImageId: shopFields.logoImageId.optional(),
    coverImageId: shopFields.coverImageId.optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'REMOVED']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update')
  .refine(
    (value) => (value.latitude === undefined) === (value.longitude === undefined),
    'Latitude and longitude must be updated together',
  )
  .superRefine((value, ctx) => requireMerchantReference(value, ctx, false));
export type UpdateShopInput = z.input<typeof updateShopSchema>;

/** Max shops per page. Higher than the general cap so the map can draw every pin at once. */
export const MAX_MAP_SHOPS = 200;

export const publicShopsQuerySchema = paginationQuerySchema
  .extend({
    pageSize: z.coerce.number().int().min(1).max(MAX_MAP_SHOPS).default(50),
    q: z.string().trim().max(100).optional(),
    product: z.string().trim().max(100).optional(),
    category: z.string().trim().max(100).optional(),
    swLat: z.coerce.number().min(-90).max(90).optional(),
    swLng: z.coerce.number().min(-180).max(180).optional(),
    neLat: z.coerce.number().min(-90).max(90).optional(),
    neLng: z.coerce.number().min(-180).max(180).optional(),
  })
  .refine((value) => {
    const box = [value.swLat, value.swLng, value.neLat, value.neLng];
    return box.every((v) => v === undefined) || box.every((v) => v !== undefined);
  }, 'Provide all four bounding-box values or none');
export type PublicShopsQuery = z.infer<typeof publicShopsQuerySchema>;

export interface PublicShopSummary {
  id: string;
  name: string;
  slug: string;
  addressText: string;
  latitude: string;
  longitude: string;
  productCount: number;
  logoUrl: string | null;
  categories: PublicCategory[];
}

export interface PublicShopDetail extends PublicShopSummary {
  description: string;
  phone: string;
  coverUrl: string | null;
  deliveryFeeEtb: string;
}

/** Shop as seen by its owning merchant and by the Super Admin (includes bank details). */
export interface ManagedShop {
  id: string;
  name: string;
  slug: string;
  description: string;
  phone: string;
  addressText: string;
  latitude: string;
  longitude: string;
  status: ShopStatus;
  deliveryFeeEtb: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  logoUrl: string | null;
  logoImageId: string | null;
  coverUrl: string | null;
  coverImageId: string | null;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminShop extends ManagedShop {
  merchant: {
    id: string;
    username: string;
    fullName: string;
    status: 'ACTIVE' | 'SUSPENDED';
    contactPhone: string | null;
  };
}

/** Shop write response. Credentials appear once, only when this request created the merchant account. */
export interface ShopWriteResult extends AdminShop {
  merchantCredentials: {
    id: string;
    username: string;
    temporaryPassword: string;
    mustChangePassword: true;
  } | null;
}

/* ----------------------------------------------------------------------------
 * Products
 * ------------------------------------------------------------------------- */

const productImagesSchema = z
  .array(z.object({ publicId: imageIdSchema }))
  .max(MAX_PRODUCT_IMAGES, `At most ${MAX_PRODUCT_IMAGES} images per product`)
  .refine(
    (images) => new Set(images.map((image) => image.publicId)).size === images.length,
    'The same image is listed twice',
  );

const productFields = {
  categoryId: uuidSchema,
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(160),
  description: z.string().trim().min(1, 'Description is required').max(5000),
  price: positiveMoneySchema,
  stockQuantity: z.coerce
    .number({ error: 'Stock must be a whole number' })
    .int('Stock must be a whole number')
    .min(0, 'Stock cannot be negative')
    .max(1_000_000),
  isAvailable: z.boolean(),
  images: productImagesSchema,
};

export const createProductSchema = z.object({
  shopId: uuidSchema.optional(),
  ...productFields,
  isAvailable: productFields.isAvailable.default(true),
  images: productFields.images.default([]),
});
export type CreateProductInput = z.input<typeof createProductSchema>;

export const updateProductSchema = z
  .object({
    categoryId: productFields.categoryId.optional(),
    name: productFields.name.optional(),
    description: productFields.description.optional(),
    price: productFields.price.optional(),
    stockQuantity: productFields.stockQuantity.optional(),
    isAvailable: productFields.isAvailable.optional(),
    images: productFields.images.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update');
export type UpdateProductInput = z.input<typeof updateProductSchema>;

export const PRODUCT_SORTS = ['relevance', 'newest', 'price_asc', 'price_desc'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const publicProductsQuerySchema = paginationQuerySchema
  .extend({
    q: z.string().trim().max(100).optional(),
    shopId: uuidSchema.optional(),
    shop: z.string().trim().max(180).optional(),
    category: z.string().trim().max(100).optional(),
    minPrice: moneySchema.optional(),
    maxPrice: moneySchema.optional(),
    available: queryBooleanSchema.optional(),
    sort: z.enum(PRODUCT_SORTS).default('relevance'),
  })
  .refine(
    (value) =>
      value.minPrice === undefined ||
      value.maxPrice === undefined ||
      Number(value.minPrice) <= Number(value.maxPrice),
    { message: 'Minimum price cannot be greater than maximum price', path: ['minPrice'] },
  );
export type PublicProductsQuery = z.infer<typeof publicProductsQuerySchema>;

export interface ProductImageDto {
  publicId: string;
  url: string;
  position: number;
}

export interface PublicProduct {
  id: string;
  name: string;
  price: string;
  currency: 'ETB';
  imageUrl: string | null;
  canPurchase: boolean;
  category: { slug: string; name: string };
  shop: { id: string; name: string; slug: string };
}

export interface PublicProductDetail extends PublicProduct {
  description: string;
  images: { url: string }[];
  shop: {
    id: string;
    name: string;
    slug: string;
    addressText: string;
    latitude: string;
    longitude: string;
    phone: string;
  };
}

export interface MerchantProduct {
  id: string;
  shopId: string;
  shopName: string;
  category: { id: string; name: string; slug: string };
  name: string;
  description: string;
  price: string;
  stockQuantity: number;
  isAvailable: boolean;
  status: ProductStatus;
  imageUrl: string | null;
  images: ProductImageDto[];
  createdAt: string;
  updatedAt: string;
}

export const merchantProductsQuerySchema = paginationQuerySchema.extend({
  shopId: uuidSchema.optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  stock: z.enum(['in_stock', 'out_of_stock']).optional(),
});
export type MerchantProductsQuery = z.infer<typeof merchantProductsQuerySchema>;
