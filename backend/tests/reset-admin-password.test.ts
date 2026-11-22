import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import {
  AdminPasswordResetError,
  resetSuperAdminPassword,
} from '../src/modules/identity/reset-admin-password.js';
import { PASSWORD, api, bearer, createAndLogin, createUser, login } from './helpers.js';

const NEXT_PASSWORD = 'replacement-password';

describe('Super Admin password reset', () => {
  it('replaces the password, revokes sessions, and leaves other accounts alone', async () => {
    const admin = await createAndLogin('SUPER_ADMIN', { username: 'reset_admin' });
    const customer = await createUser('CUSTOMER', { username: 'reset_customer' });
    const customerBefore = await prisma.user.findUniqueOrThrow({ where: { id: customer.id } });

    const result = await resetSuperAdminPassword({
      username: 'RESET_ADMIN',
      password: NEXT_PASSWORD,
      mustChangePassword: true,
      reactivate: false,
    });
    expect(result).toEqual({
      username: 'reset_admin',
      mustChangePassword: true,
      reactivated: false,
    });

    await api().post('/api/v1/auth/login').send({ username: 'reset_admin', password: PASSWORD }).expect(401);
    await api().post('/api/v1/auth/refresh').set('Cookie', admin.cookie).expect(401);
    await api().get('/api/v1/auth/me').set(bearer(admin.token)).expect(401);

    const signedIn = await api()
      .post('/api/v1/auth/login')
      .send({ username: 'reset_admin', password: NEXT_PASSWORD })
      .expect(200);
    expect(signedIn.body.data.user).toMatchObject({
      role: 'SUPER_ADMIN',
      username: 'reset_admin',
      mustChangePassword: true,
    });
    expect(JSON.stringify(signedIn.body)).not.toContain('passwordHash');
    expect(await prisma.refreshToken.count({ where: { userId: admin.user.id, revokedAt: null } })).toBe(1);

    const blocked = await api()
      .get('/api/v1/admin/overview')
      .set(bearer(signedIn.body.data.accessToken))
      .expect(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await api()
      .post('/api/v1/auth/change-password')
      .set(bearer(signedIn.body.data.accessToken))
      .send({ currentPassword: NEXT_PASSWORD, newPassword: 'chosen-admin-password' })
      .expect(200);
    expect(changed.body.data.user.mustChangePassword).toBe(false);
    await api().get('/api/v1/admin/overview').set(bearer(changed.body.data.accessToken)).expect(200);
    await api()
      .post('/api/v1/auth/login')
      .send({ username: 'reset_admin', password: NEXT_PASSWORD })
      .expect(401);
    await login('reset_admin', 'chosen-admin-password');

    const customerAfter = await prisma.user.findUniqueOrThrow({ where: { id: customer.id } });
    expect(customerAfter.passwordHash).toBe(customerBefore.passwordHash);
    expect(customerAfter.tokenVersion).toBe(customerBefore.tokenVersion);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toBe(admin.user.passwordHash);
    expect(stored.tokenVersion).toBe(admin.user.tokenVersion + 2);
  });

  it('does not reset a customer, a merchant, a missing account, or a suspended admin', async () => {
    const customer = await createUser('CUSTOMER', { username: 'keep_customer' });
    const merchant = await createUser('MERCHANT', { username: 'keep_merchant' });
    const suspended = await createUser('SUPER_ADMIN', { username: 'suspended_admin', status: 'SUSPENDED' });

    await expect(
      resetSuperAdminPassword({
        username: customer.username,
        password: NEXT_PASSWORD,
        mustChangePassword: true,
        reactivate: false,
      }),
    ).rejects.toBeInstanceOf(AdminPasswordResetError);
    await expect(
      resetSuperAdminPassword({
        username: merchant.username,
        password: NEXT_PASSWORD,
        mustChangePassword: true,
        reactivate: false,
      }),
    ).rejects.toBeInstanceOf(AdminPasswordResetError);
    await expect(
      resetSuperAdminPassword({
        username: 'missing_admin',
        password: NEXT_PASSWORD,
        mustChangePassword: true,
        reactivate: false,
      }),
    ).rejects.toThrow(/Nothing was created/);
    await expect(
      resetSuperAdminPassword({
        username: suspended.username,
        password: NEXT_PASSWORD,
        mustChangePassword: false,
        reactivate: false,
      }),
    ).rejects.toThrow(/password was not changed/);

    for (const user of [customer, merchant, suspended]) {
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.passwordHash).toBe(user.passwordHash);
      expect(stored.status).toBe(user.status);
      expect(stored.tokenVersion).toBe(user.tokenVersion);
    }
    expect(await prisma.user.findUnique({ where: { username: 'missing_admin' } })).toBeNull();

    await api().post('/api/v1/auth/login').send({ username: suspended.username, password: PASSWORD }).expect(401);
  });

  it('reactivates a suspended Super Admin only when asked', async () => {
    const suspended = await createUser('SUPER_ADMIN', { username: 'reactivate_admin', status: 'SUSPENDED' });
    const result = await resetSuperAdminPassword({
      username: suspended.username,
      password: NEXT_PASSWORD,
      mustChangePassword: false,
      reactivate: true,
    });
    expect(result.reactivated).toBe(true);

    const signedIn = await api()
      .post('/api/v1/auth/login')
      .send({ username: suspended.username, password: NEXT_PASSWORD })
      .expect(200);
    expect(signedIn.body.data.user.mustChangePassword).toBe(false);
    await api().get('/api/v1/admin/overview').set(bearer(signedIn.body.data.accessToken)).expect(200);

    const customer = await createAndLogin('CUSTOMER');
    const merchant = await createAndLogin('MERCHANT');
    await api().get('/api/v1/admin/overview').set(bearer(customer.token)).expect(403);
    await api().get('/api/v1/admin/overview').set(bearer(merchant.token)).expect(403);
  });
});
