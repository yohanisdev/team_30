import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import {
  PASSWORD,
  api,
  bearer,
  createAndLogin,
  createUser,
  login,
  refreshCookieOf,
} from './helpers.js';

describe('POST /auth/register', () => {
  it('creates a customer, returns a session and sets an HttpOnly refresh cookie', async () => {
    const response = await api()
      .post('/api/v1/auth/register')
      .send({ fullName: 'Liya Bekele', username: '  Liya_B ', password: 'a-suitable-password' })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user).toMatchObject({
      role: 'CUSTOMER',
      username: 'liya_b',
      fullName: 'Liya Bekele',
      mustChangePassword: false,
    });
    expect(typeof response.body.data.accessToken).toBe('string');
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');

    const cookie = (response.headers['set-cookie'] as unknown as string[]).find((value) =>
      value.startsWith('refresh_token='),
    );
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);

    const stored = await prisma.user.findUniqueOrThrow({ where: { username: 'liya_b' } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('rejects a duplicate username with 409', async () => {
    await createUser('CUSTOMER', { username: 'taken' });
    const response = await api()
      .post('/api/v1/auth/register')
      .send({ fullName: 'Someone', username: 'TAKEN', password: 'a-suitable-password' })
      .expect(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('validates input and rejects unknown fields such as role', async () => {
    const short = await api()
      .post('/api/v1/auth/register')
      .send({ fullName: 'A', username: 'ab', password: 'short' })
      .expect(400);
    expect(short.body.error.code).toBe('VALIDATION_ERROR');
    expect(short.body.error.details.map((detail: { field: string }) => detail.field)).toEqual(
      expect.arrayContaining(['fullName', 'username', 'password']),
    );

    const escalation = await api()
      .post('/api/v1/auth/register')
      .send({ fullName: 'Mallory', username: 'mallory', password: 'a-suitable-password', role: 'SUPER_ADMIN' })
      .expect(400);
    expect(escalation.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.user.count({ where: { username: 'mallory' } })).toBe(0);
  });
});

describe('POST /auth/login', () => {
  it('signs in any role and records the login time', async () => {
    const user = await createUser('MERCHANT');
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ username: user.username.toUpperCase(), password: PASSWORD })
      .expect(200);
    expect(response.body.data.user).toMatchObject({ id: user.id, role: 'MERCHANT' });
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.lastLoginAt).not.toBeNull();
  });

  it('signs in a Super Admin who still has to change their password', async () => {
    const user = await createUser('SUPER_ADMIN', { mustChangePassword: true });
    const response = await api()
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: PASSWORD })
      .expect(200);
    expect(response.body.data.user).toMatchObject({
      role: 'SUPER_ADMIN',
      mustChangePassword: true,
    });
    const blocked = await api()
      .get('/api/v1/admin/overview')
      .set(bearer(response.body.data.accessToken))
      .expect(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('gives the same answer for a wrong password, an unknown user and a suspended account', async () => {
    const active = await createUser('CUSTOMER');
    const suspended = await createUser('CUSTOMER', { status: 'SUSPENDED' });
    const attempts = [
      { username: active.username, password: 'wrong-password' },
      { username: 'nobody_here', password: PASSWORD },
      { username: suspended.username, password: PASSWORD },
    ];
    for (const attempt of attempts) {
      const response = await api().post('/api/v1/auth/login').send(attempt).expect(401);
      expect(response.body.error).toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Invalid username or password.',
      });
    }
  });
});

describe('refresh token rotation', () => {
  it('rotates the cookie and returns a new access token', async () => {
    const { user, cookie } = await createAndLogin('CUSTOMER');
    const response = await api().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(200);
    expect(response.body.data.user.id).toBe(user.id);
    expect(refreshCookieOf(response)).not.toBe(cookie);
  });

  it('treats replay of a rotated token as theft and revokes every session', async () => {
    const { user, cookie } = await createAndLogin('CUSTOMER');
    const rotated = refreshCookieOf(
      await api().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(200),
    );
    // Push the first rotation outside the concurrent-tab grace window.
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    await api().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
    // The legitimate newer token is now dead too.
    await api().post('/api/v1/auth/refresh').set('Cookie', rotated).expect(401);
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
  });

  it('rejects a missing or unknown cookie and a request from a foreign origin', async () => {
    await api().post('/api/v1/auth/refresh').expect(401);
    await api().post('/api/v1/auth/refresh').set('Cookie', 'refresh_token=forged').expect(401);
    const { cookie } = await createAndLogin('CUSTOMER');
    await api()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .expect(403);
  });
});

describe('logout, me and change-password', () => {
  it('logout revokes the refresh token and is idempotent', async () => {
    const { cookie } = await createAndLogin('CUSTOMER');
    const response = await api().post('/api/v1/auth/logout').set('Cookie', cookie).expect(200);
    expect(response.body.data).toEqual({ loggedOut: true });
    await api().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
    await api().post('/api/v1/auth/logout').expect(200);
  });

  it('GET /auth/me requires a valid bearer token', async () => {
    await api().get('/api/v1/auth/me').expect(401);
    await api().get('/api/v1/auth/me').set(bearer('not-a-jwt')).expect(401);
    const { user, token } = await createAndLogin('CUSTOMER');
    const response = await api().get('/api/v1/auth/me').set(bearer(token)).expect(200);
    expect(response.body.data).toMatchObject({ id: user.id, status: 'ACTIVE' });
  });

  it('a temporary password limits the account to me, change-password and logout', async () => {
    const { token } = await createAndLogin('MERCHANT', { mustChangePassword: true });

    const blocked = await api().get('/api/v1/merchant/dashboard').set(bearer(token)).expect(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await api().get('/api/v1/auth/me').set(bearer(token)).expect(200);

    const changed = await api()
      .post('/api/v1/auth/change-password')
      .set(bearer(token))
      .send({ currentPassword: PASSWORD, newPassword: 'my-own-new-password' })
      .expect(200);
    expect(changed.body.data).toMatchObject({ passwordChanged: true });
    expect(changed.body.data.user.mustChangePassword).toBe(false);

    // The old access token is invalidated by the token version bump.
    await api().get('/api/v1/auth/me').set(bearer(token)).expect(401);
    await api()
      .get('/api/v1/merchant/dashboard')
      .set(bearer(changed.body.data.accessToken))
      .expect(200);
  });

  it('change-password rejects a wrong current password and revokes other sessions on success', async () => {
    const { user, token } = await createAndLogin('CUSTOMER');
    const other = await login(user.username);

    const wrong = await api()
      .post('/api/v1/auth/change-password')
      .set(bearer(token))
      .send({ currentPassword: 'not-my-password', newPassword: 'brand-new-password' })
      .expect(400);
    expect(wrong.body.error.details[0].field).toBe('currentPassword');

    await api()
      .post('/api/v1/auth/change-password')
      .set(bearer(token))
      .send({ currentPassword: PASSWORD, newPassword: 'brand-new-password' })
      .expect(200);
    await api().post('/api/v1/auth/refresh').set('Cookie', other.cookie).expect(401);
    await login(user.username, 'brand-new-password');
  });
});

describe('role-based access control', () => {
  it('returns 401 without a token and 403 for the wrong role', async () => {
    await api().get('/api/v1/admin/overview').expect(401);

    const customer = await createAndLogin('CUSTOMER');
    const merchant = await createAndLogin('MERCHANT');
    const admin = await createAndLogin('SUPER_ADMIN');

    const forbidden = [
      [customer.token, '/api/v1/admin/overview'],
      [merchant.token, '/api/v1/admin/shops'],
      [customer.token, '/api/v1/merchant/products'],
      [admin.token, '/api/v1/merchant/dashboard'],
      [merchant.token, '/api/v1/cart'],
      [admin.token, '/api/v1/cart'],
    ] as const;
    for (const [token, path] of forbidden) {
      const response = await api().get(path).set(bearer(token)).expect(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
    await api().get('/api/v1/admin/overview').set(bearer(admin.token)).expect(200);
  });

  it('suspension takes effect on the next request even with an unexpired token', async () => {
    const admin = await createAndLogin('SUPER_ADMIN');
    const customer = await createAndLogin('CUSTOMER');
    await api().get('/api/v1/cart').set(bearer(customer.token)).expect(200);

    await api()
      .patch(`/api/v1/admin/customers/${customer.user.id}/status`)
      .set(bearer(admin.token))
      .send({ status: 'SUSPENDED' })
      .expect(200);

    await api().get('/api/v1/cart').set(bearer(customer.token)).expect(401);
    await api().post('/api/v1/auth/refresh').set('Cookie', customer.cookie).expect(401);
  });
});
