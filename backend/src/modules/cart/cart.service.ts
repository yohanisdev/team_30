import {
  MAX_CART_LINES,
  MAX_CART_LINE_QUANTITY,
  type AddCartItemInput,
  type Cart,
  type CartLineInput,
  type CheckoutQuote,
  type FulfillmentPreference,
  type LineIssue,
  type MergeCartResult,
} from '@marketplace/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { businessRule, notFound } from '../../lib/errors.js';
import { Decimal, money } from '../../lib/format.js';
import { prisma, type DbClient } from '../../lib/prisma.js';
import { canPurchase, isShopPublic } from '../catalog/visibility.js';

const cartProductSelect = {
  id: true,
  name: true,
  price: true,
  stockQuantity: true,
  isAvailable: true,
  status: true,
  images: { select: { url: true }, orderBy: { position: 'asc' }, take: 1 },
  shop: {
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      deliveryFeeEtb: true,
      merchant: { select: { status: true } },
    },
  },
} satisfies Prisma.ProductSelect;

type CartProduct = Prisma.ProductGetPayload<{ select: typeof cartProductSelect }>;

interface RawLine {
  id: string;
  quantity: number;
  product: CartProduct;
}

/** Why a line cannot be bought right now, or null when it can. */
function lineIssue(product: CartProduct | undefined, quantity: number): LineIssue | null {
  if (!product || product.status !== 'ACTIVE' || !isShopPublic(product.shop)) return 'NOT_FOUND';
  if (!canPurchase(product)) return 'UNAVAILABLE';
  if (quantity > product.stockQuantity) return 'INSUFFICIENT_STOCK';
  return null;
}

interface PricedGroup {
  shopId: string;
  shopName: string;
  shopSlug: string;
  deliveryFee: Decimal;
  subtotal: Decimal;
  purchasableLines: number;
  lines: {
    id: string;
    productId: string;
    name: string;
    imageUrl: string | null;
    unitPrice: Decimal;
    quantity: number;
    lineTotal: Decimal;
    issue: LineIssue | null;
  }[];
}

/**
 * Prices lines from live catalog data and groups them by shop, in the order the shops
 * first appear. Lines with an issue are shown but excluded from every total.
 */
function priceLines(lines: RawLine[]): PricedGroup[] {
  const groups = new Map<string, PricedGroup>();
  for (const line of lines) {
    const { product } = line;
    const issue = lineIssue(product, line.quantity);
    const lineTotal = product.price.mul(line.quantity);
    let group = groups.get(product.shop.id);
    if (!group) {
      group = {
        shopId: product.shop.id,
        shopName: product.shop.name,
        shopSlug: product.shop.slug,
        deliveryFee: product.shop.deliveryFeeEtb,
        subtotal: new Decimal(0),
        purchasableLines: 0,
        lines: [],
      };
      groups.set(product.shop.id, group);
    }
    group.lines.push({
      id: line.id,
      productId: product.id,
      name: product.name,
      imageUrl: product.images[0]?.url ?? null,
      unitPrice: product.price,
      quantity: line.quantity,
      lineTotal,
      issue,
    });
    if (!issue) {
      group.subtotal = group.subtotal.add(lineTotal);
      group.purchasableLines += 1;
    }
  }
  return [...groups.values()];
}

function toCart(cartId: string | null, lines: RawLine[]): Cart {
  const groups = priceLines(lines);
  let subtotal = new Decimal(0);
  let itemCount = 0;
  let hasIssues = false;
  const shops = groups.map((group) => {
    subtotal = subtotal.add(group.subtotal);
    return {
      shopId: group.shopId,
      shopName: group.shopName,
      shopSlug: group.shopSlug,
      subtotal: money(group.subtotal),
      items: group.lines.map((line) => {
        itemCount += line.quantity;
        if (line.issue) hasIssues = true;
        return {
          id: line.id,
          productId: line.productId,
          name: line.name,
          imageUrl: line.imageUrl,
          unitPrice: money(line.unitPrice),
          quantity: line.quantity,
          lineTotal: money(line.lineTotal),
          canPurchase: line.issue === null,
          issue: line.issue,
        };
      }),
    };
  });
  return { id: cartId, shops, itemCount, merchandiseSubtotal: money(subtotal), hasIssues };
}

async function loadCart(userId: string): Promise<{ id: string | null; lines: RawLine[] }> {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    select: {
      id: true,
      items: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, quantity: true, product: { select: cartProductSelect } },
      },
    },
  });
  return cart ? { id: cart.id, lines: cart.items } : { id: null, lines: [] };
}

async function cartIdFor(db: DbClient, userId: string): Promise<string> {
  const cart = await db.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
    select: { id: true },
  });
  return cart.id;
}

/** Folds duplicate product ids together, capping each quantity at the line maximum. */
function combineLines(items: CartLineInput[]): Map<string, number> {
  const combined = new Map<string, number>();
  for (const item of items) {
    const quantity = (combined.get(item.productId) ?? 0) + item.quantity;
    combined.set(item.productId, Math.min(quantity, MAX_CART_LINE_QUANTITY));
  }
  return combined;
}

const notEnoughStock = () =>
  businessRule('There is not enough stock for that quantity.', [
    { field: 'quantity', message: 'Reduce the quantity' },
  ]);

export async function getCart(userId: string): Promise<Cart> {
  const { id, lines } = await loadCart(userId);
  return toCart(id, lines);
}

export async function addItem(userId: string, input: AddCartItemInput): Promise<Cart> {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: cartProductSelect,
  });
  const issue = lineIssue(product ?? undefined, 1);
  if (!product || issue === 'NOT_FOUND') throw notFound('Product');
  if (issue === 'UNAVAILABLE') throw businessRule('This product is currently unavailable.');

  await prisma.$transaction(async (tx) => {
    const cartId = await cartIdFor(tx, userId);
    const existing = await tx.cartItem.findUnique({
      where: { cartId_productId: { cartId, productId: product.id } },
      select: { quantity: true },
    });
    const quantity = Math.min((existing?.quantity ?? 0) + input.quantity, MAX_CART_LINE_QUANTITY);
    if (quantity > product.stockQuantity) throw notEnoughStock();
    if (!existing && (await tx.cartItem.count({ where: { cartId } })) >= MAX_CART_LINES) {
      throw businessRule(`Your cart can hold at most ${MAX_CART_LINES} different products.`);
    }
    await tx.cartItem.upsert({
      where: { cartId_productId: { cartId, productId: product.id } },
      create: { cartId, productId: product.id, quantity },
      update: { quantity },
    });
  });
  return getCart(userId);
}

export async function updateItem(userId: string, itemId: string, quantity: number): Promise<Cart> {
  const item = await prisma.cartItem.findFirst({
    where: { id: itemId, cart: { userId } },
    select: { id: true, product: { select: cartProductSelect } },
  });
  if (!item) throw notFound('Cart item');
  if (lineIssue(item.product, quantity) === 'INSUFFICIENT_STOCK') throw notEnoughStock();
  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
  return getCart(userId);
}

export async function removeItem(userId: string, itemId: string): Promise<Cart> {
  const { count } = await prisma.cartItem.deleteMany({ where: { id: itemId, cart: { userId } } });
  if (count === 0) throw notFound('Cart item');
  return getCart(userId);
}

export async function clearCart(userId: string): Promise<Cart> {
  await prisma.cartItem.deleteMany({ where: { cart: { userId } } });
  return getCart(userId);
}

/** Adds a guest (browser) cart to the server cart after sign-in. */
export async function mergeGuestCart(userId: string, items: CartLineInput[]): Promise<MergeCartResult> {
  const wanted = combineLines(items);
  const products = await prisma.product.findMany({
    where: { id: { in: [...wanted.keys()] } },
    select: cartProductSelect,
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  const rejected: MergeCartResult['rejected'] = [];

  await prisma.$transaction(async (tx) => {
    const cartId = await cartIdFor(tx, userId);
    const existing = await tx.cartItem.findMany({
      where: { cartId },
      select: { productId: true, quantity: true },
    });
    const current = new Map(existing.map((line) => [line.productId, line.quantity]));
    let lineCount = existing.length;

    for (const [productId, guestQuantity] of wanted) {
      const issue = lineIssue(byId.get(productId), 1);
      if (issue === 'NOT_FOUND' || issue === 'UNAVAILABLE') {
        rejected.push({ productId, reason: issue });
        continue;
      }
      const serverQuantity = current.get(productId);
      if (serverQuantity === undefined && lineCount >= MAX_CART_LINES) {
        rejected.push({ productId, reason: 'CART_FULL' });
        continue;
      }
      // Over-stock quantities are kept and flagged on the line so the customer can adjust.
      const quantity = Math.min((serverQuantity ?? 0) + guestQuantity, MAX_CART_LINE_QUANTITY);
      await tx.cartItem.upsert({
        where: { cartId_productId: { cartId, productId } },
        create: { cartId, productId, quantity },
        update: { quantity },
      });
      if (serverQuantity === undefined) lineCount += 1;
    }
  });
  return { ...(await getCart(userId)), rejected };
}

/** Prices a guest cart held in the browser; no account and nothing is stored. */
export async function previewGuestCart(items: CartLineInput[]): Promise<MergeCartResult> {
  const wanted = combineLines(items);
  const products = await prisma.product.findMany({
    where: { id: { in: [...wanted.keys()] } },
    select: cartProductSelect,
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  const lines: RawLine[] = [];
  const rejected: MergeCartResult['rejected'] = [];
  for (const [productId, quantity] of wanted) {
    const product = byId.get(productId);
    if (!product || lineIssue(product, quantity) === 'NOT_FOUND') {
      rejected.push({ productId, reason: 'NOT_FOUND' });
    } else {
      lines.push({ id: productId, quantity, product });
    }
  }
  return { ...toCart(null, lines), rejected };
}

/**
 * Server-side checkout summary: live prices, live stock and each shop's flat delivery fee
 * (zero for pickup). Placing the order uses the same prices inside a stock lock.
 */
export async function quoteCheckout(
  userId: string,
  fulfillmentPreference: FulfillmentPreference,
): Promise<CheckoutQuote> {
  const { lines } = await loadCart(userId);
  const groups = priceLines(lines);
  let merchandise = new Decimal(0);
  let delivery = new Decimal(0);
  const issues: CheckoutQuote['issues'] = [];

  const shops = groups.map((group) => {
    const deliveryFee =
      fulfillmentPreference === 'DELIVERY' && group.purchasableLines > 0
        ? group.deliveryFee
        : new Decimal(0);
    merchandise = merchandise.add(group.subtotal);
    delivery = delivery.add(deliveryFee);
    for (const line of group.lines) {
      if (line.issue) {
        issues.push({
          cartItemId: line.id,
          productId: line.productId,
          name: line.name,
          issue: line.issue,
        });
      }
    }
    return {
      shopId: group.shopId,
      shopName: group.shopName,
      shopSlug: group.shopSlug,
      items: group.lines.map((line) => ({
        cartItemId: line.id,
        productId: line.productId,
        name: line.name,
        imageUrl: line.imageUrl,
        unitPrice: money(line.unitPrice),
        quantity: line.quantity,
        lineTotal: money(line.lineTotal),
        issue: line.issue,
      })),
      subtotal: money(group.subtotal),
      deliveryFee: money(deliveryFee),
      total: money(group.subtotal.add(deliveryFee)),
    };
  });

  return {
    fulfillmentPreference,
    currency: 'ETB',
    shops,
    merchandiseSubtotal: money(merchandise),
    deliveryFeeTotal: money(delivery),
    grandTotal: money(merchandise.add(delivery)),
    canCheckout: lines.length > 0 && issues.length === 0,
    issues,
  };
}
