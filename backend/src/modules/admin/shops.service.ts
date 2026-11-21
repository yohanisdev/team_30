import type {
  AdminShop,
  AdminShopsQuery,
  ShopWriteResult,
  createShopSchema,
  updateShopSchema,
} from '@marketplace/contracts';
import type { z } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { conflict, notFound, validationError } from '../../lib/errors.js';
import { Decimal } from '../../lib/format.js';
import { pageArgs } from '../../lib/http.js';
import { generateTemporaryPassword, hashPassword } from '../../lib/passwords.js';
import { prisma, type DbClient } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { uniqueSlug } from '../../lib/slug.js';
import { diffFields, writeAudit, type AuditActor } from '../audit/audit.service.js';
import { adminShopSelect, toAdminShop } from '../catalog/mappers.js';
import { resolveImages } from '../media/storage.js';

type CreateShop = z.output<typeof createShopSchema>;
type UpdateShop = z.output<typeof updateShopSchema>;

interface MerchantDraft {
  fullName: string;
  username: string;
  contactPhone: string;
}

function merchantDraft(input: {
  merchantFullName?: string;
  merchantUsername?: string;
  merchantPhone?: string;
}): MerchantDraft | null {
  if (!input.merchantFullName && !input.merchantUsername && !input.merchantPhone) return null;
  if (!input.merchantFullName || !input.merchantUsername || !input.merchantPhone) return null;
  return {
    fullName: input.merchantFullName,
    username: input.merchantUsername,
    contactPhone: input.merchantPhone,
  };
}

/**
 * Uses the typed username as the account key. An existing merchant is reused.
 * A new username creates one account. A customer or admin username is rejected.
 * The temporary password is returned only for a newly created account and is never audited.
 */
async function resolveMerchant(
  tx: DbClient,
  draft: MerchantDraft,
  actor: AuditActor,
  prepared: { temporaryPassword: string; passwordHash: string },
): Promise<{ merchantId: string; credentials: ShopWriteResult['merchantCredentials'] }> {
  const existing = await tx.user.findUnique({
    where: { username: draft.username },
    select: { id: true, role: true },
  });
  if (existing && existing.role !== 'MERCHANT') {
    throw validationError('That username belongs to another account.', [
      { field: 'merchantUsername', message: 'Choose a different username' },
    ]);
  }
  if (existing) {
    await tx.user.update({
      where: { id: existing.id },
      data: {
        fullName: draft.fullName,
        merchantProfile: {
          upsert: {
            create: { contactPhone: draft.contactPhone, createdByUserId: actor.actorUserId },
            update: { contactPhone: draft.contactPhone },
          },
        },
      },
    });
    return { merchantId: existing.id, credentials: null };
  }
  try {
    const created = await tx.user.create({
      data: {
        role: 'MERCHANT',
        fullName: draft.fullName,
        username: draft.username,
        passwordHash: prepared.passwordHash,
        mustChangePassword: true,
        merchantProfile: {
          create: { contactPhone: draft.contactPhone, createdByUserId: actor.actorUserId },
        },
      },
      select: { id: true, username: true },
    });
    await writeAudit(tx, actor, {
      action: 'merchant.created',
      entityType: 'user',
      entityId: created.id,
      metadata: { username: created.username },
    });
    return {
      merchantId: created.id,
      credentials: {
        id: created.id,
        username: created.username,
        temporaryPassword: prepared.temporaryPassword,
        mustChangePassword: true,
      },
    };
  } catch (error) {
    if (isUniqueViolation(error, 'username')) {
      throw conflict('That username is already taken.', [
        { field: 'merchantUsername', message: 'Choose a different username' },
      ]);
    }
    throw error;
  }
}

async function prepareMerchant(draft: MerchantDraft | null) {
  if (!draft) return null;
  const temporaryPassword = generateTemporaryPassword();
  return { temporaryPassword, passwordHash: await hashPassword(temporaryPassword) };
}

async function assertMerchant(merchantId: string) {
  const merchant = await prisma.user.findFirst({
    where: { id: merchantId, role: 'MERCHANT' },
    select: { id: true },
  });
  if (!merchant) {
    throw validationError('Choose an existing merchant account.', [
      { field: 'merchantId', message: 'Not a merchant' },
    ]);
  }
}

/** Turns optional image ids into the column pair (id + server-derived URL). */
async function imageColumns(
  imageId: string | null | undefined,
  field: 'logoImageId' | 'coverImageId',
): Promise<{ publicId: string | null; url: string | null } | undefined> {
  if (imageId === undefined) return undefined;
  if (imageId === null) return { publicId: null, url: null };
  const [image] = await resolveImages([imageId], 'shops', field);
  return { publicId: image?.publicId ?? null, url: image?.url ?? null };
}

export async function listShops(
  query: AdminShopsQuery,
): Promise<{ items: AdminShop[]; total: number }> {
  const where: Prisma.ShopWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.merchantId ? { merchantId: query.merchantId } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { addressText: { contains: query.q, mode: 'insensitive' } },
            { merchant: { username: { contains: query.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.shop.findMany({
      where,
      select: adminShopSelect,
      orderBy: { createdAt: 'desc' },
      ...pageArgs(query.page, query.pageSize),
    }),
    prisma.shop.count({ where }),
  ]);
  return { items: rows.map(toAdminShop), total };
}

export async function getShop(shopId: string): Promise<AdminShop> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: adminShopSelect });
  if (!shop) throw notFound('Shop');
  return toAdminShop(shop);
}

export async function createShop(input: CreateShop, actor: AuditActor): Promise<ShopWriteResult> {
  const draft = merchantDraft(input);
  if (!draft) {
    if (!input.merchantId) {
      throw validationError("Enter the merchant's full name.", [
        { field: 'merchantFullName', message: "Enter the merchant's full name" },
      ]);
    }
    await assertMerchant(input.merchantId);
  }
  const prepared = await prepareMerchant(draft);
  const [logo, cover] = await Promise.all([
    imageColumns(input.logoImageId, 'logoImageId'),
    imageColumns(input.coverImageId, 'coverImageId'),
  ]);
  const slug = await uniqueSlug(input.name, 'shop', async (candidate) =>
    Boolean(await prisma.shop.findUnique({ where: { slug: candidate }, select: { id: true } })),
  );

  return prisma.$transaction(async (tx) => {
    const resolved = draft && prepared ? await resolveMerchant(tx, draft, actor, prepared) : null;
    const merchantId = resolved?.merchantId ?? input.merchantId;
    if (!merchantId) {
      throw validationError("Enter the merchant's full name.", [
        { field: 'merchantFullName', message: "Enter the merchant's full name" },
      ]);
    }
    const shop = await tx.shop.create({
      data: {
        merchantId,
        name: input.name,
        slug,
        description: input.description,
        phone: input.phone,
        addressText: input.addressText,
        latitude: new Decimal(input.latitude),
        longitude: new Decimal(input.longitude),
        status: input.status,
        deliveryFeeEtb: new Decimal(input.deliveryFeeEtb),
        bankName: input.bankName,
        bankAccountName: input.bankAccountName,
        bankAccountNumber: input.bankAccountNumber,
        logoPublicId: logo?.publicId ?? null,
        logoUrl: logo?.url ?? null,
        coverPublicId: cover?.publicId ?? null,
        coverUrl: cover?.url ?? null,
      },
      select: adminShopSelect,
    });
    await writeAudit(tx, actor, {
      action: 'shop.created',
      entityType: 'shop',
      entityId: shop.id,
      metadata: {
        name: shop.name,
        merchantId,
        latitude: input.latitude,
        longitude: input.longitude,
        status: input.status,
      },
    });
    return { ...toAdminShop(shop), merchantCredentials: resolved?.credentials ?? null };
  });
}

export async function updateShop(
  shopId: string,
  input: UpdateShop,
  actor: AuditActor,
): Promise<ShopWriteResult> {
  const before = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!before) throw notFound('Shop');
  const draft = merchantDraft(input);
  if (!draft && input.merchantId && input.merchantId !== before.merchantId) {
    await assertMerchant(input.merchantId);
  }
  const prepared = await prepareMerchant(draft);
  const [logo, cover] = await Promise.all([
    imageColumns(input.logoImageId, 'logoImageId'),
    imageColumns(input.coverImageId, 'coverImageId'),
  ]);

  const data = {
    ...(input.merchantId !== undefined ? { merchantId: input.merchantId } : {}),
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.addressText !== undefined ? { addressText: input.addressText } : {}),
    ...(input.latitude !== undefined ? { latitude: new Decimal(input.latitude) } : {}),
    ...(input.longitude !== undefined ? { longitude: new Decimal(input.longitude) } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.deliveryFeeEtb !== undefined
      ? { deliveryFeeEtb: new Decimal(input.deliveryFeeEtb) }
      : {}),
    ...(input.bankName !== undefined ? { bankName: input.bankName } : {}),
    ...(input.bankAccountName !== undefined ? { bankAccountName: input.bankAccountName } : {}),
    ...(input.bankAccountNumber !== undefined
      ? { bankAccountNumber: input.bankAccountNumber }
      : {}),
    ...(logo ? { logoPublicId: logo.publicId, logoUrl: logo.url } : {}),
    ...(cover ? { coverPublicId: cover.publicId, coverUrl: cover.url } : {}),
  };

  return prisma.$transaction(async (tx) => {
    const resolved = draft && prepared ? await resolveMerchant(tx, draft, actor, prepared) : null;
    const next = {
      ...data,
      ...(resolved ? { merchantId: resolved.merchantId } : {}),
    };
    // The slug is kept on rename so shared storefront links keep working.
    const shop = await tx.shop.update({ where: { id: shopId }, data: next, select: adminShopSelect });
    const { logoUrl: _logoUrl, coverUrl: _coverUrl, ...audited } = next;
    await writeAudit(tx, actor, {
      action: 'shop.updated',
      entityType: 'shop',
      entityId: shopId,
      metadata: { changes: diffFields(before, audited) },
    });
    return { ...toAdminShop(shop), merchantCredentials: resolved?.credentials ?? null };
  });
}
