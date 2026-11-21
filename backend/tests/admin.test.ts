import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import {
  PNG_1PX,
  api,
  bearer,
  createAndLogin,
  createCategory,
  createProduct,
  createShop,
  createUser,
  login,
} from './helpers.js';

let adminToken: string;

beforeEach(async () => {
  adminToken = (await createAndLogin('SUPER_ADMIN')).token;
});

const asAdmin = {
  get: (path: string) => api().get(path).set(bearer(adminToken)),
  post: (path: string, body?: object) => api().post(path).set(bearer(adminToken)).send(body),
  patch: (path: string, body: object) => api().patch(path).set(bearer(adminToken)).send(body),
};

const shopBody = (merchantId: string, overrides: Record<string, unknown> = {}) => ({
  merchantId,
  name: 'Abebe Coffee House',
  description: 'Fresh Jimma coffee',
  phone: '047 111 2233',
  addressText: 'Near Abba Jifar Square',
  latitude: '7.6742',
  longitude: '36.8346',
  deliveryFeeEtb: '50',
  bankName: 'Commercial Bank of Ethiopia',
  bankAccountName: 'Abebe Kebede',
  bankAccountNumber: '1000123456789',
  ...overrides,
});

describe('merchant accounts', () => {
  it('creates a merchant with a one-time temporary password that must be changed', async () => {
    const response = await asAdmin
      .post('/api/v1/admin/merchants', {
        fullName: 'Abel Tadesse',
        username: 'abel',
        contactPhone: '0911223344',
        businessName: 'Abel Shop',
      })
      .expect(201);
    const { id, temporaryPassword } = response.body.data;
    expect(response.body.data).toMatchObject({ username: 'abel', mustChangePassword: true });
    expect(temporaryPassword).toMatch(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);

    const session = await login('abel', temporaryPassword);
    const gated = await api().get('/api/v1/merchant/dashboard').set(bearer(session.token)).expect(403);
    expect(gated.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'merchant.created' } });
    expect(audit.entityId).toBe(id);
    expect(JSON.stringify(audit.metadata)).not.toContain(temporaryPassword);
  });

  it('rejects duplicate usernames and invalid phone numbers', async () => {
    await createUser('CUSTOMER', { username: 'abel' });
    await asAdmin
      .post('/api/v1/admin/merchants', { fullName: 'Abel', username: 'abel', contactPhone: '0911223344' })
      .expect(409);
    const invalid = await asAdmin
      .post('/api/v1/admin/merchants', { fullName: 'Abel', username: 'abel2', contactPhone: '12345' })
      .expect(400);
    expect(invalid.body.error.details[0].field).toBe('contactPhone');
  });

  it('suspending a merchant hides their shops and ends their sessions', async () => {
    const merchant = await createAndLogin('MERCHANT');
    const shop = await createShop(merchant.user.id);
    await api().get(`/api/v1/shops/${shop.slug}`).expect(200);

    await asAdmin
      .patch(`/api/v1/admin/merchants/${merchant.user.id}/status`, { status: 'SUSPENDED' })
      .expect(200);

    await api().get(`/api/v1/shops/${shop.slug}`).expect(404);
    await api().get('/api/v1/merchant/dashboard').set(bearer(merchant.token)).expect(401);

    await asAdmin
      .patch(`/api/v1/admin/merchants/${merchant.user.id}/status`, { status: 'ACTIVE' })
      .expect(200);
    await api().get(`/api/v1/shops/${shop.slug}`).expect(200);
  });

  it('resets a merchant password and invalidates the old one', async () => {
    const merchant = await createAndLogin('MERCHANT');
    const response = await asAdmin
      .post(`/api/v1/admin/merchants/${merchant.user.id}/reset-password`, {})
      .expect(200);
    await api().get('/api/v1/auth/me').set(bearer(merchant.token)).expect(401);
    await login(merchant.user.username, response.body.data.temporaryPassword);
  });

  it('status routes only target their own role', async () => {
    const customer = await createUser('CUSTOMER');
    await asAdmin
      .patch(`/api/v1/admin/merchants/${customer.id}/status`, { status: 'SUSPENDED' })
      .expect(404);
  });
});

describe('categories', () => {
  it('creates, renames (keeping the slug) and deactivates categories', async () => {
    const created = await asAdmin
      .post('/api/v1/admin/categories', { name: 'Home & Kitchen', description: 'Cookware' })
      .expect(201);
    expect(created.body.data).toMatchObject({ slug: 'home-kitchen', isActive: true });

    await asAdmin.post('/api/v1/admin/categories', { name: 'home & kitchen' }).expect(409);

    const updated = await asAdmin
      .patch(`/api/v1/admin/categories/${created.body.data.id}`, { name: 'Kitchen', isActive: false })
      .expect(200);
    expect(updated.body.data).toMatchObject({ name: 'Kitchen', slug: 'home-kitchen', isActive: false });

    const publicList = await api().get('/api/v1/categories').expect(200);
    expect(publicList.body.data).toHaveLength(0);
  });
});

describe('shops', () => {
  it('creates a shop at the exact coordinates and returns them with six decimals', async () => {
    const merchant = await createUser('MERCHANT');
    const response = await asAdmin.post('/api/v1/admin/shops', shopBody(merchant.id)).expect(201);
    expect(response.body.data).toMatchObject({
      slug: 'abebe-coffee-house',
      latitude: '7.674200',
      longitude: '36.834600',
      phone: '0471112233',
      deliveryFeeEtb: '50.00',
      status: 'ACTIVE',
      merchant: { id: merchant.id },
    });
    const again = await asAdmin.post('/api/v1/admin/shops', shopBody(merchant.id)).expect(201);
    expect(again.body.data.slug).toBe('abebe-coffee-house-2');
  });

  it('validates coordinates, fee and the merchant reference', async () => {
    const merchant = await createUser('MERCHANT');
    const customer = await createUser('CUSTOMER');
    const badLat = await asAdmin
      .post('/api/v1/admin/shops', shopBody(merchant.id, { latitude: '91' }))
      .expect(400);
    expect(badLat.body.error.details[0].field).toBe('latitude');
    await asAdmin
      .post('/api/v1/admin/shops', shopBody(merchant.id, { deliveryFeeEtb: '-5' }))
      .expect(400);
    const notMerchant = await asAdmin.post('/api/v1/admin/shops', shopBody(customer.id)).expect(400);
    expect(notMerchant.body.error.details[0].field).toBe('merchantId');
  });

  it('registers a shop from a typed merchant name and does not duplicate the account', async () => {
    const { merchantId: _ignored, ...details } = shopBody('unused');
    const account = {
      merchantFullName: 'Abebe Bekele',
      merchantUsername: 'abebe_typed',
      merchantPhone: '0911223344',
    };
    const first = await asAdmin
      .post('/api/v1/admin/shops', { ...details, ...account, name: 'Abebe First Shop' })
      .expect(201);
    expect(first.body.data.merchant).toMatchObject({ fullName: 'Abebe Bekele', username: 'abebe_typed' });
    expect(first.body.data.merchantCredentials).toMatchObject({
      username: 'abebe_typed',
      mustChangePassword: true,
    });
    expect(first.body.data.merchantCredentials.temporaryPassword).toEqual(expect.any(String));
    expect(JSON.stringify(first.body.data)).not.toMatch(/passwordHash/);

    const second = await asAdmin
      .post('/api/v1/admin/shops', { ...details, ...account, name: 'Abebe Second Shop' })
      .expect(201);
    expect(second.body.data.merchant.id).toBe(first.body.data.merchant.id);
    expect(second.body.data.merchantCredentials).toBeNull();
    expect(await prisma.user.count({ where: { username: 'abebe_typed' } })).toBe(1);

    const customer = await createUser('CUSTOMER', { username: 'not_a_merchant' });
    const rejected = await asAdmin
      .post('/api/v1/admin/shops', {
        ...details,
        name: 'Should Fail',
        merchantFullName: 'Someone Else',
        merchantUsername: customer.username,
        merchantPhone: '0911000000',
      })
      .expect(400);
    expect(rejected.body.error.details[0].field).toBe('merchantUsername');

    const missing = await asAdmin.post('/api/v1/admin/shops', { ...details, name: 'No Merchant' }).expect(400);
    expect(missing.body.error.details[0].field).toBe('merchantFullName');
  });

  it('controls public visibility through status and reassigns ownership', async () => {
    const owner = await createUser('MERCHANT');
    const newOwner = await createUser('MERCHANT');
    const shop = await createShop(owner.id);

    await asAdmin.patch(`/api/v1/admin/shops/${shop.id}`, { status: 'SUSPENDED' }).expect(200);
    await api().get(`/api/v1/shops/${shop.slug}`).expect(404);
    await asAdmin.patch(`/api/v1/admin/shops/${shop.id}`, { status: 'ACTIVE' }).expect(200);
    await api().get(`/api/v1/shops/${shop.slug}`).expect(200);

    const moved = await asAdmin
      .patch(`/api/v1/admin/shops/${shop.id}`, {
        merchantId: newOwner.id,
        latitude: '7.680000',
        longitude: '36.840000',
      })
      .expect(200);
    expect(moved.body.data).toMatchObject({ merchant: { id: newOwner.id }, latitude: '7.680000' });

    await asAdmin.patch(`/api/v1/admin/shops/${shop.id}`, { latitude: '7.7' }).expect(400);

    const audit = await prisma.auditLog.findMany({
      where: { action: 'shop.updated', entityId: shop.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit).toHaveLength(3);
    expect(audit[2]?.metadata).toMatchObject({
      changes: { merchantId: { from: owner.id, to: newOwner.id } },
    });
  });

  it('uploads branding images and attaches them by id only', async () => {
    const upload = await api()
      .post('/api/v1/admin/uploads/images')
      .set(bearer(adminToken))
      .attach('image', PNG_1PX, { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);
    expect(upload.body.data.publicId).toMatch(/^shops\/.+\.png$/);

    const merchant = await createUser('MERCHANT');
    const shop = await asAdmin
      .post('/api/v1/admin/shops', shopBody(merchant.id, { logoImageId: upload.body.data.publicId }))
      .expect(201);
    expect(shop.body.data.logoUrl).toBe(`/uploads/${upload.body.data.publicId}`);

    await asAdmin
      .post('/api/v1/admin/shops', shopBody(merchant.id, { logoImageId: 'shops/../../etc/passwd' }))
      .expect(400);
  });
});

describe('overview and audit log', () => {
  it('summarises the marketplace', async () => {
    const merchant = await createUser('MERCHANT', { mustChangePassword: true });
    await createUser('CUSTOMER');
    const shop = await createShop(merchant.id);
    const category = await createCategory();
    await createProduct(shop.id, category.id, { stockQuantity: 0 });

    const response = await asAdmin.get('/api/v1/admin/overview').expect(200);
    expect(response.body.data).toMatchObject({
      shops: { total: 1, active: 1 },
      merchants: { total: 1, pendingPasswordChange: 1 },
      customers: { total: 1 },
      products: { total: 1, outOfStock: 1 },
      categories: { total: 1, active: 1 },
    });
    expect(response.body.data.recentShops[0]).toMatchObject({ id: shop.id });
  });

  it('lists audit entries newest first', async () => {
    await asAdmin.post('/api/v1/admin/categories', { name: 'Books' }).expect(201);
    const response = await asAdmin.get('/api/v1/admin/audit-logs?action=category').expect(200);
    expect(response.body.meta).toMatchObject({ total: 1, page: 1 });
    expect(response.body.data[0]).toMatchObject({ action: 'category.created', entityType: 'category' });
  });
});
