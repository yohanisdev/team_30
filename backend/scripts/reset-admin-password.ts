/**
 * Explicit Super Admin password reset. Not run by application startup or by `db:seed`.
 *
 *   read -rsp "New admin password: " ADMIN_INITIAL_PASSWORD
 *   echo
 *   export ADMIN_USERNAME="gebeya"
 *   export ADMIN_INITIAL_PASSWORD
 *   npm run db:reset-admin-password
 *   unset ADMIN_INITIAL_PASSWORD ADMIN_USERNAME
 *
 * ADMIN_MUST_CHANGE_PASSWORD=false keeps the new password for normal sign-in.
 * The default requires a password change after the next successful sign-in.
 * ADMIN_REACTIVATE=true is required to reset a suspended Super Admin; status is
 * otherwise left unchanged.
 */
import { prisma } from '../src/lib/prisma.js';
import {
  AdminPasswordResetError,
  resetSuperAdminPassword,
} from '../src/modules/identity/reset-admin-password.js';

function enabled(value: string | undefined): boolean {
  return value === 'true';
}

async function main() {
  const mustChangePassword = process.env.ADMIN_MUST_CHANGE_PASSWORD !== 'false';
  const result = await resetSuperAdminPassword({
    username: process.env.ADMIN_USERNAME ?? '',
    password: process.env.ADMIN_INITIAL_PASSWORD ?? '',
    mustChangePassword,
    reactivate: enabled(process.env.ADMIN_REACTIVATE),
  });
  const followUp = result.mustChangePassword
    ? 'Password change required at next sign-in.'
    : 'The new password can be used as-is.';
  const status = result.reactivated ? ' The account was reactivated.' : '';
  console.log(`Reset Super Admin "${result.username}". ${followUp}${status}`);
}

main()
  .catch((error: unknown) => {
    if (error instanceof AdminPasswordResetError) {
      console.error(error.message);
    } else {
      console.error(error instanceof Error ? error.message : 'Password reset failed.');
    }
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
