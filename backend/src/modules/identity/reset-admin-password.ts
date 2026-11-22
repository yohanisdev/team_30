import { passwordSchema, usernameSchema } from '@marketplace/contracts';
import { hashPassword } from '../../lib/passwords.js';
import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../audit/audit.service.js';

/** Thrown by the admin password reset. The message never includes the password. */
export class AdminPasswordResetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminPasswordResetError';
  }
}

export interface ResetSuperAdminPasswordInput {
  username: string;
  password: string;
  /** When true, the next sign-in must replace this password. */
  mustChangePassword: boolean;
  /** When true, a suspended Super Admin is set back to ACTIVE inside the same transaction. */
  reactivate: boolean;
}

export interface ResetSuperAdminPasswordResult {
  username: string;
  mustChangePassword: boolean;
  reactivated: boolean;
}

/**
 * Replaces the password of an existing Super Admin.
 * Refuses to create an account, to touch any other role, or to reactivate a
 * suspended account unless `reactivate` is set.
 */
export async function resetSuperAdminPassword(
  input: ResetSuperAdminPasswordInput,
): Promise<ResetSuperAdminPasswordResult> {
  const username = usernameSchema.safeParse(input.username);
  if (!username.success) {
    throw new AdminPasswordResetError(
      'ADMIN_USERNAME must be 3-30 characters: lowercase letters, digits, or underscores.',
    );
  }
  const password = passwordSchema.safeParse(input.password);
  if (!password.success) {
    throw new AdminPasswordResetError(
      'ADMIN_INITIAL_PASSWORD must be 8-128 characters. The password was not printed.',
    );
  }

  const user = await prisma.user.findUnique({
    where: { username: username.data },
    select: { id: true, role: true, status: true, username: true },
  });
  if (!user) {
    throw new AdminPasswordResetError(
      `No account named "${username.data}". Nothing was created or changed.`,
    );
  }
  if (user.role !== 'SUPER_ADMIN') {
    throw new AdminPasswordResetError(
      `Account "${username.data}" is not a Super Admin. Its password was not changed.`,
    );
  }
  if (user.status !== 'ACTIVE' && !input.reactivate) {
    throw new AdminPasswordResetError(
      `Super Admin "${username.data}" is ${user.status}. The password was not changed. Set ADMIN_REACTIVATE=true to reactivate this account in the same step.`,
    );
  }

  const passwordHash = await hashPassword(password.data);
  const reactivated = user.status !== 'ACTIVE';

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: input.mustChangePassword,
        tokenVersion: { increment: 1 },
        ...(reactivated ? { status: 'ACTIVE' } : {}),
      },
    });
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAudit(
      tx,
      { actorUserId: user.id, ipAddress: null, userAgent: 'cli:reset-admin-password' },
      {
        action: 'auth.admin_password_reset',
        entityType: 'user',
        entityId: user.id,
        metadata: {
          username: user.username,
          mustChangePassword: input.mustChangePassword,
          reactivated,
        },
      },
    );
  });

  return { username: user.username, mustChangePassword: input.mustChangePassword, reactivated };
}
