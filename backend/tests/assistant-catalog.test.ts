import { describe, expect, it } from 'vitest';
import { Prisma } from '../src/generated/prisma/client.js';
import { prisma } from '../src/lib/prisma.js';
import {
  compareProducts,
  findNearby,
  getProduct,
  getShop,
  searchProducts,
} from '../src/modules/catalog/assistant-catalog.service.js';
import { ASSISTANT_PRODUCT_KEYS, ASSISTANT_SHOP_KEYS } from '../src/modules/catalog/assistant-dto.js';
import { createCategory, createProduct, createShop, createUser } from './helpers.js';

const ORIGIN = { latitude: 7.6667, longitude: 36.8333 };

async function shoesCatalog() {
  const merchant = await createUser('MERCHANT');
  const hiddenMerchant = await createUser('MERCHANT', { status: 'SUSPENDED' });
  const fashion = await createCategory('Fashion');
  const electronics = await createCategory('Electronics');
  const near = await createShop(merchant.id, {
    name: 'Near Shoes',
    latitude: new Prisma.Decimal('7.666700'),
    longitude: new Prisma.Decimal('36.833300'),
    bankAccountNumber: 'SECRET-BANK-NEAR',
  });
  const mid = await createShop(merchant.id, {
    name: 'Mid Shoes',
    latitude: new Prisma.Decimal('7.686700'),
    longitude: new Prisma.Decimal('36.833300'),
    bankAccountNumber: 'SECRET-BANK-MID',
  });
  const far = await createShop(merchant.id, {
    name: 'Far Shoes',
    latitude: new Prisma.Decimal('9.030000'),
    longitude: new Prisma.Decimal('38.740000'),
  });
  const hiddenShop = await createShop(hiddenMerchant.id, { name: 'Hidden Shoes' });
  const cheap = await createProduct(near.id, fashion.id, {
    name: 'Running shoes',
    description: 'Lightweight trainers',
    price: new Prisma.Decimal('12500.00'),
  });
  const midPrice = await createProduct(mid.id, fashion.id, {
    name: 'Leather shoes',
    price: new Prisma.Decimal('15000.00'),
  });
  await createProduct(near.id, electronics.id, {
    name: 'Phone',
    price: new Prisma.Decimal('14000.00'),
  });
  await createProduct(far.id, fashion.id, {
    name: 'Far running shoes',
    price: new Prisma.Decimal('9000.00'),
  });
  await createProduct(near.id, fashion.id, {
    name: 'Sold-out shoes',
    price: new Prisma.Decimal('8000.00'),
    stockQuantity: 0,
  });
  await createProduct(hiddenShop.id, fashion.id, { name: 'Secret shoes', price: new Prisma.Decimal('1000.00') });
  return { fashion, electronics, near, mid, cheap, midPrice };
}

describe('assistant catalog', () => {
  it('searches shoes below 20,000 ETB and omits private shop fields', async () => {
    const { cheap, midPrice } = await shoesCatalog();
    const products = await searchProducts({
      query: 'shoes',
      maxPrice: '20000',
      availableOnly: true,
      limit: 10,
    });
    expect(products.map((product) => product.name).sort()).toEqual(
      ['Far running shoes', 'Leather shoes', 'Running shoes'].sort(),
    );
    expect(products.find((product) => product.productId === cheap.id)).toMatchObject({
      name: 'Running shoes',
      price: '12500.00',
      currency: 'ETB',
      available: true,
      shopName: 'Near Shoes',
    });
    for (const product of products) {
      expect(Object.keys(product).sort()).toEqual([...ASSISTANT_PRODUCT_KEYS].sort());
    }
    expect(JSON.stringify(products)).not.toContain('SECRET-BANK');
    expect(JSON.stringify(products)).not.toContain('stockQuantity');
  });

  it('filters by category and price and hides products that cannot be purchased', async () => {
    const { fashion, electronics } = await shoesCatalog();
    const fashionOnly = await searchProducts({
      category: fashion.slug,
      availableOnly: false,
      limit: 10,
    });
    expect(fashionOnly.every((product) => product.categorySlug === fashion.slug)).toBe(true);
    expect(fashionOnly.map((product) => product.name)).toContain('Sold-out shoes');

    const phones = await searchProducts({
      category: electronics.slug,
      maxPrice: '15000',
      minPrice: '10000',
      availableOnly: true,
      limit: 10,
    });
    expect(phones.map((product) => product.name)).toEqual(['Phone']);

    const inStock = await searchProducts({ query: 'sold-out', availableOnly: true, limit: 10 });
    expect(inStock).toEqual([]);
  });

  it('returns one public product and one public shop, and hides suspended records', async () => {
    const { cheap, near } = await shoesCatalog();
    const product = await getProduct(cheap.id);
    expect(product).toMatchObject({ productId: cheap.id, description: 'Lightweight trainers' });
    const shop = await getShop(near.id);
    expect(shop).toMatchObject({
      shopId: near.id,
      name: 'Near Shoes',
      phone: '0471112233',
      addressText: 'Jimma center',
    });
    expect(Object.keys(shop ?? {}).sort()).toEqual([...ASSISTANT_SHOP_KEYS].sort());
    expect(JSON.stringify(shop)).not.toContain('SECRET-BANK');

    const archived = await prisma.product.findFirstOrThrow({ where: { name: 'Running shoes' } });
    await prisma.product.update({ where: { id: archived.id }, data: { status: 'ARCHIVED' } });
    expect(await getProduct(archived.id)).toBeNull();

    await prisma.shop.update({ where: { id: near.id }, data: { status: 'SUSPENDED' } });
    expect(await getShop(near.id)).toBeNull();
    expect(await getProduct(cheap.id)).toBeNull();
  });

  it('sorts nearby shops by server-calculated distance and applies the radius and price', async () => {
    const { near, mid } = await shoesCatalog();
    const groups = await findNearby({
      query: 'shoes',
      maxPrice: '20000',
      availableOnly: true,
      limit: 10,
      radiusKm: 10,
      origin: ORIGIN,
      area: null,
    });
    expect(groups.map((group) => group.shop.shopId)).toEqual([near.id, mid.id]);
    expect(groups[0]?.shop.distanceKm).toBeLessThan(0.2);
    expect(groups[1]?.shop.distanceKm).toBeGreaterThan(2);
    expect(groups[1]?.shop.distanceKm).toBeLessThan(2.5);
    expect(groups[0]?.products.map((product) => product.name)).toEqual(['Running shoes']);
    expect(JSON.stringify(groups)).not.toMatch(/latitude|longitude|SECRET-BANK/);

    const tight = await findNearby({
      query: 'shoes',
      availableOnly: true,
      limit: 10,
      radiusKm: 1,
      origin: ORIGIN,
      area: null,
    });
    expect(tight.map((group) => group.shop.shopId)).toEqual([near.id]);
  });

  it('searches by area text when the shopper did not share a location', async () => {
    const { near } = await shoesCatalog();
    await prisma.shop.update({ where: { id: near.id }, data: { addressText: 'Hermata market, Jimma' } });
    const groups = await findNearby({
      query: 'shoes',
      availableOnly: true,
      limit: 5,
      radiusKm: 10,
      origin: null,
      area: 'Hermata',
    });
    expect(groups.map((group) => group.shop.shopId)).toEqual([near.id]);
    expect(groups[0]?.shop.distanceKm).toBeNull();
  });

  it('compares the requested products in the requested order using catalog prices', async () => {
    const { cheap, midPrice } = await shoesCatalog();
    const compared = await compareProducts([midPrice.id, cheap.id, '00000000-0000-4000-8000-000000000099']);
    expect(compared.map((product) => product.productId)).toEqual([midPrice.id, cheap.id]);
    expect(compared.map((product) => product.price)).toEqual(['15000.00', '12500.00']);
  });
});
