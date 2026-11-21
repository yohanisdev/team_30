import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { setChapaInitializerForTests } from '../src/modules/orders/orders.service.js';
import { PNG_1PX, api, bearer, createAndLogin, createCategory, createProduct, createShop, createUser } from './helpers.js';

afterEach(() => setChapaInitializerForTests(undefined));

const address = {
  contactName: 'Sara Bekele',
  addressName: 'Hermata',
  houseNumber: '12',
  phoneNumber: '0911223344',
};

async function stockedCart() {
  const merchant = await createUser('MERCHANT');
  const shop = await createShop(merchant.id, { name: 'Shoe Shop', bankAccountNumber: '1000999888' });
  const category = await createCategory();
  const shoes = await createProduct(shop.id, category.id, {
    name: 'Running shoes',
    price: 12500,
    stockQuantity: 4,
  });
  const customer = await createAndLogin('CUSTOMER');
  await api().post('/api/v1/cart/items').set(bearer(customer.token)).send({ productId: shoes.id, quantity: 2 }).expect(200);
  return { shop, shoes, customer };
}

describe('POST /checkout', () => {
  it('places a bank-transfer order from server prices and ignores a second identical submit', async () => {
    const { shoes, customer } = await stockedCart();
    const body = { fulfillmentPreference: 'DELIVERY', paymentMethod: 'BANK_TRANSFER', ...address };
    const first = await api()
      .post('/api/v1/checkout')
      .set(bearer(customer.token))
      .set('Idempotency-Key', 'checkout-bank-001')
      .send({ ...body, grandTotal: '1.00' })
      .expect(201);

    expect(first.body.data.order).toMatchObject({
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      fulfillmentStatus: 'PENDING_PAYMENT',
      grandTotal: '25050.00',
    });
    expect(first.body.data.order.merchantOrders[0].bank).toMatchObject({
      accountNumber: '1000999888',
      amount: '25050.00',
    });
    expect(first.body.data.chapa).toBeNull();
    expect(first.body.data.order.paymentStatus).not.toBe('PAID');

    const again = await api()
      .post('/api/v1/checkout')
      .set(bearer(customer.token))
      .set('Idempotency-Key', 'checkout-bank-001')
      .send(body)
      .expect(201);
    expect(again.body.data.order.id).toBe(first.body.data.order.id);
    const product = await prisma.product.findUniqueOrThrow({ where: { id: shoes.id } });
    expect(product.stockQuantity).toBe(2);
    const cart = await api().get('/api/v1/cart').set(bearer(customer.token)).expect(200);
    expect(cart.body.data.itemCount).toBe(0);

    await api()
      .post('/api/v1/checkout')
      .set(bearer(customer.token))
      .set('Idempotency-Key', 'checkout-bank-001')
      .send({ ...body, houseNumber: '99' })
      .expect(409);
  });

  it('keeps a Chapa order unpaid when initialization fails and does not mark it paid when a URL is returned', async () => {
    const { customer } = await stockedCart();
    setChapaInitializerForTests(async () => ({ error: true }));
    const failed = await api()
      .post('/api/v1/checkout')
      .set(bearer(customer.token))
      .set('Idempotency-Key', 'checkout-chapa-fail')
      .send({ fulfillmentPreference: 'PICKUP', paymentMethod: 'CHAPA', payerEmail: 'sara@example.com', ...address })
      .expect(201);
    expect(failed.body.data.chapa.initializationError).toBe(true);
    expect(failed.body.data.chapa.checkoutUrl).toBeNull();
    expect(failed.body.data.order.paymentStatus).toBe('UNPAID');
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: failed.body.data.order.id } });
    expect(payment.status).toBe('PENDING');

    const other = await createAndLogin('CUSTOMER');
    await api().get(`/api/v1/orders/${failed.body.data.order.id}`).set(bearer(other.token)).expect(404);

    const { customer: payer, shoes } = await stockedCart();
    setChapaInitializerForTests(async () => ({ checkoutUrl: 'https://checkout.chapa.co/pay/test' }));
    const started = await api()
      .post('/api/v1/checkout')
      .set(bearer(payer.token))
      .set('Idempotency-Key', 'checkout-chapa-ok')
      .send({ fulfillmentPreference: 'PICKUP', paymentMethod: 'CHAPA', payerEmail: 'sara@example.com', ...address })
      .expect(201);
    expect(started.body.data.chapa.checkoutUrl).toBe('https://checkout.chapa.co/pay/test');
    expect(started.body.data.chapa.initializationError).toBe(false);
    expect(started.body.data.order.paymentStatus).toBe('UNPAID');
    const open = await prisma.payment.findFirstOrThrow({ where: { orderId: started.body.data.order.id } });
    expect(open.status).toBe('PROCESSING');
    expect(shoes.stockQuantity).toBe(4);
  });

  it('rejects an order when stock is gone and accepts a receipt without marking the order paid', async () => {
    const { shoes, customer, shop } = await stockedCart();
    await prisma.product.update({ where: { id: shoes.id }, data: { stockQuantity: 0 } });
    const blocked = await api()
      .post('/api/v1/checkout')
      .set(bearer(customer.token))
      .set('Idempotency-Key', 'checkout-stock')
      .send({ fulfillmentPreference: 'PICKUP', paymentMethod: 'BANK_TRANSFER', ...address })
      .expect(422);
    expect(blocked.body.error.code).toBe('BUSINESS_RULE');
    expect(await prisma.order.count()).toBe(0);

    await prisma.product.update({ where: { id: shoes.id }, data: { stockQuantity: 2 } });
    const placed = await api()
      .post('/api/v1/checkout')
      .set(bearer(customer.token))
      .set('Idempotency-Key', 'checkout-receipt')
      .send({ fulfillmentPreference: 'PICKUP', paymentMethod: 'BANK_TRANSFER', ...address })
      .expect(201);
    const merchantOrderId = placed.body.data.order.merchantOrders[0].id as string;
    const uploaded = await api()
      .post(`/api/v1/merchant-orders/${merchantOrderId}/receipts`)
      .set(bearer(customer.token))
      .attach('receipt', PNG_1PX, { filename: 'receipt.png', contentType: 'image/png' })
      .expect(201);
    expect(uploaded.body.data).toEqual({
      paymentStatus: 'AWAITING_VERIFICATION',
      uploadedAt: expect.any(String),
    });
    expect(JSON.stringify(uploaded.body)).not.toMatch(/storageKey|uploads\//);
    const order = await api().get(`/api/v1/orders/${placed.body.data.order.id}`).set(bearer(customer.token)).expect(200);
    expect(order.body.data.paymentStatus).toBe('UNPAID');
    expect(order.body.data.merchantOrders[0].paymentStatus).toBe('AWAITING_VERIFICATION');
    expect(order.body.data.merchantOrders[0].bank.accountNumber).toBe(shop.bankAccountNumber);
  });

  it('requires an idempotency key', async () => {
    const { customer } = await stockedCart();
    await api()
      .post('/api/v1/checkout')
      .set(bearer(customer.token))
      .send({ fulfillmentPreference: 'PICKUP', paymentMethod: 'BANK_TRANSFER', ...address })
      .expect(400);
  });
});
