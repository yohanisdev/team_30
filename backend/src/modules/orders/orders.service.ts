import { createHash, randomBytes } from 'node:crypto';
import type {
  CheckoutRequest,
  CheckoutResult,
  CustomerOrderDetail,
  PaymentRecordStatus,
} from '@marketplace/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { env } from '../../config/env.js';
import { businessRule, conflict, notFound, validationError } from '../../lib/errors.js';
import { Decimal, money } from '../../lib/format.js';
import { prisma } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { canPurchase, isShopPublic } from '../catalog/visibility.js';
import { initializeChapa, isChapaCheckoutUrl, type ChapaInitializeInput, type ChapaInitializeResult } from './chapa.js';
import { savePrivateReceipt } from './receipt-storage.js';
import type { ImageType } from '../media/image-type.js';

const CHAPA_HOLD_MS = 30 * 60 * 1000;
const BANK_HOLD_MS = 48 * 60 * 60 * 1000;

type Initializer = (input: ChapaInitializeInput) => Promise<ChapaInitializeResult>;

let testInitializer: Initializer | null | undefined;

/** Tests substitute Chapa so the suite never calls the payment provider. */
export function setChapaInitializerForTests(initializer: Initializer | null | undefined): void {
  if (env.NODE_ENV !== 'test') throw new Error('The Chapa test client is only available in tests.');
  testInitializer = initializer;
}

function initializer(): Initializer {
  if (env.NODE_ENV === 'test' && testInitializer !== undefined && testInitializer !== null) return testInitializer;
  return initializeChapa;
}

function requestHash(input: CheckoutRequest): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function orderNumber(): string {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `ORD-${day}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

const productSelect = {
  id: true,
  name: true,
  price: true,
  stockQuantity: true,
  isAvailable: true,
  status: true,
  shop: {
    select: {
      id: true,
      name: true,
      status: true,
      deliveryFeeEtb: true,
      bankName: true,
      bankAccountName: true,
      bankAccountNumber: true,
      merchantId: true,
      merchant: { select: { status: true } },
    },
  },
} satisfies Prisma.ProductSelect;

type LockedProduct = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

const orderInclude = {
  payments: { where: { method: 'CHAPA' as const }, orderBy: { createdAt: 'desc' as const }, take: 1 },
  merchantOrders: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      items: { orderBy: { createdAt: 'asc' as const } },
      shop: { select: { bankName: true, bankAccountName: true, bankAccountNumber: true } },
      bankPayment: {
        include: { receipts: { orderBy: { createdAt: 'desc' as const }, take: 1 } },
      },
    },
  },
} satisfies Prisma.OrderInclude;

type StoredOrder = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

function lineProblem(product: LockedProduct | undefined, quantity: number): string | null {
  if (!product || product.status !== 'ACTIVE' || !isShopPublic(product.shop)) return 'no longer available';
  if (!canPurchase(product)) return 'unavailable';
  if (quantity > product.stockQuantity) return 'short on stock';
  return null;
}

async function loadOwnedOrder(userId: string, orderId: string): Promise<StoredOrder> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId: userId },
    include: orderInclude,
  });
  if (!order) throw notFound('Order');
  return order;
}

function toResult(order: StoredOrder): CheckoutResult {
  const attempt = order.payments[0] ?? null;
  const checkoutUrl =
    attempt?.checkoutUrl && attempt.status === 'PROCESSING' && isChapaCheckoutUrl(attempt.checkoutUrl)
      ? attempt.checkoutUrl
      : null;
  return {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      paymentMethod: order.paymentMethod,
      fulfillmentPreference: order.fulfillmentPreference,
      merchandiseSubtotal: money(order.merchandiseSubtotal),
      deliveryFeeTotal: money(order.deliveryFeeTotal),
      grandTotal: money(order.grandTotal),
      paymentStatus: order.paymentStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      contactName: order.contactName,
      addressName: order.addressName,
      houseNumber: order.houseNumber,
      phoneNumber: order.phoneNumber,
      customerNote: order.customerNote,
      merchantOrders: order.merchantOrders.map((sub) => {
        const receipt = sub.bankPayment?.receipts[0] ?? null;
        return {
          id: sub.id,
          shopId: sub.shopId,
          shopName: sub.shopNameSnapshot,
          subtotal: money(sub.subtotal),
          deliveryFee: money(sub.deliveryFee),
          total: money(sub.total),
          paymentStatus: sub.paymentStatus,
          fulfillmentStatus: sub.fulfillmentStatus,
          items: sub.items.map((item) => ({
            productId: item.productId,
            productName: item.productNameSnapshot,
            unitPrice: money(item.unitPriceSnapshot),
            quantity: item.quantity,
            lineTotal: money(item.lineTotal),
          })),
          bank:
            order.paymentMethod === 'BANK_TRANSFER'
              ? {
                  bankName: sub.shop.bankName,
                  accountName: sub.shop.bankAccountName,
                  accountNumber: sub.shop.bankAccountNumber,
                  amount: money(sub.total),
                }
              : null,
          receipt: receipt
            ? {
                status: receipt.reviewStatus,
                uploadedAt: receipt.createdAt.toISOString(),
                rejectionReason: receipt.rejectionReason,
              }
            : null,
        };
      }),
    },
    chapa:
      order.paymentMethod === 'CHAPA' && attempt
        ? {
            paymentId: attempt.id,
            checkoutUrl,
            initializationError: checkoutUrl === null && attempt.status !== 'PAID',
          }
        : null,
  };
}

function toDetail(order: StoredOrder): CustomerOrderDetail {
  const result = toResult(order);
  const attempt = order.payments[0] ?? null;
  return {
    ...result.order,
    paymentAttempt: attempt
      ? {
          status: attempt.status as PaymentRecordStatus,
          checkoutUrl: result.chapa?.checkoutUrl ?? null,
        }
      : null,
  };
}

async function deliveryAddress(userId: string, input: CheckoutRequest) {
  if (input.addressId) {
    const saved = await prisma.customerAddress.findFirst({
      where: { id: input.addressId, userId },
    });
    if (!saved) {
      throw validationError('Choose a saved address.', [{ field: 'addressId', message: 'Address not found' }]);
    }
    return {
      contactName: saved.contactName,
      addressName: saved.addressName,
      houseNumber: saved.houseNumber,
      phoneNumber: saved.phoneNumber,
    };
  }
  return {
    contactName: input.contactName ?? '',
    addressName: input.addressName ?? '',
    houseNumber: input.houseNumber ?? '',
    phoneNumber: input.phoneNumber ?? '',
  };
}

async function replayOrConflict(userId: string, key: string, hash: string): Promise<CheckoutResult> {
  const prior = await prisma.order.findUnique({
    where: { customerId_clientRequestId: { customerId: userId, clientRequestId: key } },
    select: { id: true, clientRequestHash: true },
  });
  if (!prior) throw conflict('This checkout was already submitted. Refresh and try again.');
  if (prior.clientRequestHash !== hash) {
    throw conflict('This Idempotency-Key was already used for a different checkout.');
  }
  return toResult(await loadOwnedOrder(userId, prior.id));
}

/**
 * Creates the parent order, one sub-order per shop, stock holds and payment rows.
 * Chapa is contacted only after the database commit. A failed initialization leaves the order unpaid.
 */
export async function placeOrder(userId: string, input: CheckoutRequest, idempotencyKey: string): Promise<CheckoutResult> {
  const hash = requestHash(input);
  const prior = await prisma.order.findUnique({
    where: { customerId_clientRequestId: { customerId: userId, clientRequestId: idempotencyKey } },
    select: { id: true, clientRequestHash: true },
  });
  if (prior) {
    if (prior.clientRequestHash !== hash) {
      throw conflict('This Idempotency-Key was already used for a different checkout.');
    }
    return toResult(await loadOwnedOrder(userId, prior.id));
  }

  const cart = await prisma.cart.findUnique({
    where: { userId },
    select: { id: true, items: { orderBy: { createdAt: 'asc' }, select: { productId: true, quantity: true } } },
  });
  if (!cart || cart.items.length === 0) throw businessRule('Your cart is empty.');

  const address = await deliveryAddress(userId, input);
  const productIds = [...cart.items.map((item) => item.productId)].sort();
  const txRef = `tx_${randomBytes(16).toString('hex')}`;
  const number = orderNumber();
  const holdMs = input.paymentMethod === 'CHAPA' ? CHAPA_HOLD_MS : BANK_HOLD_MS;

  let orderId: string;
  try {
    orderId = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM products
        WHERE id IN (${Prisma.join(productIds.map((id) => Prisma.sql`${id}::uuid`))})
        ORDER BY id
        FOR UPDATE
      `;
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: productSelect,
      });
      const byId = new Map(products.map((product) => [product.id, product]));
      const problems = cart.items.flatMap((item) => {
        const product = byId.get(item.productId);
        const problem = lineProblem(product, item.quantity);
        return problem ? [{ field: item.productId, message: `${product?.name ?? 'An item'} is ${problem}.` }] : [];
      });
      if (problems.length > 0) {
        throw businessRule('Some items cannot be purchased. Update your cart and try again.', problems);
      }

      const groups = new Map<
        string,
        {
          shopName: string;
          merchantId: string;
          deliveryFee: Decimal;
          subtotal: Decimal;
          lines: { productId: string; name: string; unitPrice: Decimal; quantity: number; lineTotal: Decimal }[];
        }
      >();
      for (const item of cart.items) {
        const product = byId.get(item.productId);
        if (!product) throw businessRule('Some items cannot be purchased. Update your cart and try again.');
        const lineTotal = product.price.mul(item.quantity);
        let group = groups.get(product.shop.id);
        if (!group) {
          group = {
            shopName: product.shop.name,
            merchantId: product.shop.merchantId,
            deliveryFee: input.fulfillmentPreference === 'DELIVERY' ? product.shop.deliveryFeeEtb : new Decimal(0),
            subtotal: new Decimal(0),
            lines: [],
          };
          groups.set(product.shop.id, group);
        }
        group.subtotal = group.subtotal.add(lineTotal);
        group.lines.push({
          productId: product.id,
          name: product.name,
          unitPrice: product.price,
          quantity: item.quantity,
          lineTotal,
        });
      }

      let merchandise = new Decimal(0);
      let delivery = new Decimal(0);
      for (const group of groups.values()) {
        merchandise = merchandise.add(group.subtotal);
        delivery = delivery.add(group.deliveryFee);
      }
      const grand = merchandise.add(delivery);

      const created = await tx.order.create({
        data: {
          orderNumber: number,
          customerId: userId,
          clientRequestId: idempotencyKey,
          clientRequestHash: hash,
          fulfillmentPreference: input.fulfillmentPreference,
          contactName: address.contactName,
          addressName: address.addressName,
          houseNumber: address.houseNumber,
          phoneNumber: address.phoneNumber,
          customerNote: input.customerNote ?? null,
          paymentMethod: input.paymentMethod,
          merchandiseSubtotal: merchandise,
          deliveryFeeTotal: delivery,
          grandTotal: grand,
          paymentStatus: 'UNPAID',
          fulfillmentStatus: 'PENDING_PAYMENT',
          stockHoldState: 'HELD',
          stockHoldExpiresAt: new Date(Date.now() + holdMs),
          merchantOrders: {
            create: [...groups.entries()].map(([shopId, group]) => ({
              shopId,
              merchantId: group.merchantId,
              shopNameSnapshot: group.shopName,
              contactName: address.contactName,
              addressName: address.addressName,
              houseNumber: address.houseNumber,
              phoneNumber: address.phoneNumber,
              customerNote: input.customerNote ?? null,
              subtotal: group.subtotal,
              deliveryFee: group.deliveryFee,
              total: group.subtotal.add(group.deliveryFee),
              paymentStatus: 'PENDING',
              fulfillmentStatus: 'AWAITING_PAYMENT',
              items: {
                create: group.lines.map((line) => ({
                  productId: line.productId,
                  productNameSnapshot: line.name,
                  unitPriceSnapshot: line.unitPrice,
                  quantity: line.quantity,
                  lineTotal: line.lineTotal,
                })),
              },
            })),
          },
          ...(input.paymentMethod === 'CHAPA'
            ? {
                payments: {
                  create: {
                    method: 'CHAPA',
                    amount: grand,
                    currency: 'ETB',
                    status: 'PENDING',
                    provider: 'CHAPA',
                    txRef,
                    payerEmail: input.payerEmail ?? null,
                  },
                },
              }
            : {}),
        },
        select: { id: true },
      });

      if (input.paymentMethod === 'BANK_TRANSFER') {
        const subs = await tx.merchantOrder.findMany({
          where: { orderId: created.id },
          select: { id: true, total: true },
        });
        await tx.payment.createMany({
          data: subs.map((sub) => ({
            orderId: created.id,
            merchantOrderId: sub.id,
            method: 'BANK_TRANSFER' as const,
            amount: sub.total,
            currency: 'ETB',
            status: 'PENDING' as const,
            provider: 'MANUAL' as const,
          })),
        });
      }

      for (const item of cart.items) {
        const updated = await tx.product.updateMany({
          where: { id: item.productId, stockQuantity: { gte: item.quantity } },
          data: { stockQuantity: { decrement: item.quantity } },
        });
        if (updated.count !== 1) throw businessRule('There is not enough stock to place this order.');
      }
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      return created.id;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'client_request')) return replayOrConflict(userId, idempotencyKey, hash);
    throw error;
  }

  if (input.paymentMethod === 'CHAPA') {
    const payment = await prisma.payment.findFirst({
      where: { orderId, method: 'CHAPA', status: 'PENDING' },
      select: { id: true, amount: true, txRef: true },
    });
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    if (payment?.txRef) {
      const started = await initializer()({
        amount: money(payment.amount),
        currency: 'ETB',
        txRef: payment.txRef,
        email: input.payerEmail ?? null,
        fullName: user?.fullName ?? address.contactName,
        orderId,
      });
      if ('checkoutUrl' in started) {
        await prisma.payment.updateMany({
          where: { id: payment.id, status: 'PENDING' },
          data: { status: 'PROCESSING', checkoutUrl: started.checkoutUrl },
        });
      }
    }
  }

  return toResult(await loadOwnedOrder(userId, orderId));
}

export async function getOrder(userId: string, orderId: string): Promise<CustomerOrderDetail> {
  return toDetail(await loadOwnedOrder(userId, orderId));
}

/** Starts a new Chapa attempt. The previous open attempt is marked failed. Stock is not changed. */
export async function retryChapa(
  userId: string,
  orderId: string,
  payerEmail: string | undefined,
): Promise<{ paymentId: string; checkoutUrl: string }> {
  const order = await loadOwnedOrder(userId, orderId);
  if (order.paymentMethod !== 'CHAPA') throw businessRule('This order is paid by bank transfer.');
  if (order.fulfillmentStatus !== 'PENDING_PAYMENT' || order.stockHoldState !== 'HELD') {
    throw businessRule('This order can no longer be paid.');
  }
  if (order.stockHoldExpiresAt && order.stockHoldExpiresAt.getTime() <= Date.now()) {
    throw businessRule('The payment window for this order has expired.');
  }
  if (order.payments.some((payment) => payment.status === 'PROCESSING')) {
    throw businessRule('A payment is already in progress for this order.');
  }

  const txRef = `tx_${randomBytes(16).toString('hex')}`;
  const paymentId = await prisma.$transaction(async (tx) => {
    await tx.payment.updateMany({
      where: { orderId, method: 'CHAPA', status: { in: ['PENDING', 'PROCESSING'] } },
      data: { status: 'FAILED', failureReason: 'Superseded by a new payment attempt' },
    });
    const created = await tx.payment.create({
      data: {
        orderId,
        method: 'CHAPA',
        amount: order.grandTotal,
        currency: 'ETB',
        status: 'PENDING',
        provider: 'CHAPA',
        txRef,
        payerEmail: payerEmail ?? null,
      },
      select: { id: true },
    });
    return created.id;
  });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  const started = await initializer()({
    amount: money(order.grandTotal),
    currency: 'ETB',
    txRef,
    email: payerEmail ?? null,
    fullName: user?.fullName ?? order.contactName,
    orderId,
  });
  if (!('checkoutUrl' in started)) {
    throw businessRule('The payment service did not start. The order is still unpaid.');
  }
  await prisma.payment.updateMany({
    where: { id: paymentId, status: 'PENDING' },
    data: { status: 'PROCESSING', checkoutUrl: started.checkoutUrl },
  });
  return { paymentId, checkoutUrl: started.checkoutUrl };
}

/** Records a private receipt and moves that sub-order's payment to awaiting verification. */
export async function submitReceipt(
  userId: string,
  merchantOrderId: string,
  file: { buffer: Buffer; type: ImageType },
  note: string | undefined,
): Promise<{ paymentStatus: 'AWAITING_VERIFICATION'; uploadedAt: string }> {
  const sub = await prisma.merchantOrder.findFirst({
    where: { id: merchantOrderId, order: { customerId: userId, paymentMethod: 'BANK_TRANSFER' } },
    include: { bankPayment: true },
  });
  if (!sub?.bankPayment) throw notFound('Order');
  if (sub.paymentStatus !== 'PENDING' && sub.paymentStatus !== 'REJECTED') {
    throw businessRule('A receipt can be uploaded while this payment is pending or rejected.');
  }
  if (sub.bankPayment.status !== 'PENDING' && sub.bankPayment.status !== 'REJECTED') {
    throw businessRule('A receipt can be uploaded while this payment is pending or rejected.');
  }

  const storageKey = await savePrivateReceipt(file.buffer, file.type);
  const uploadedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.paymentReceipt.create({
      data: {
        paymentId: sub.bankPayment!.id,
        uploadedByUserId: userId,
        storageKey,
        mimeType: file.type.mime,
        sizeBytes: file.buffer.length,
        note: note ?? null,
        reviewStatus: 'PENDING',
      },
    });
    await tx.payment.update({
      where: { id: sub.bankPayment!.id },
      data: { status: 'AWAITING_VERIFICATION' },
    });
    await tx.merchantOrder.update({
      where: { id: sub.id },
      data: { paymentStatus: 'AWAITING_VERIFICATION' },
    });
  });
  return { paymentStatus: 'AWAITING_VERIFICATION', uploadedAt: uploadedAt.toISOString() };
}
