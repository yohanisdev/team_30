/**
 * Base seed, safe to run repeatedly and in production:
 *  - the Super Admin from ADMIN_USERNAME / ADMIN_INITIAL_PASSWORD (created only if missing)
 *  - the starter categories (created only if missing)
 *
 * An existing username is left completely unchanged, including its password.
 * A different ADMIN_USERNAME creates a second Super Admin; it does not rename
 * or re-password the first one. Replace a password with `npm run db:reset-admin-password`.
 */
import { passwordSchema, usernameSchema, fullNameSchema } from '@marketplace/contracts';
import { hashPassword } from '../src/lib/passwords.js';
import { prisma } from '../src/lib/prisma.js';
import { slugify } from '../src/lib/slug.js';

export const STARTER_CATEGORIES = [
  { name: 'Coffee & Tea', description: 'Jimma coffee beans, roasted coffee and tea' },
  { name: 'Groceries', description: 'Food staples, spices and everyday essentials' },
  { name: 'Electronics', description: 'Phones, accessories and small electronics' },
  { name: 'Fashion', description: 'Clothing, shoes and accessories' },
  { name: 'Home & Kitchen', description: 'Household items, cookware and decor' },
  { name: 'Health & Beauty', description: 'Personal care and cosmetics' },
  { name: 'Books & Stationery', description: 'Books, school and office supplies' },
  { name: 'Handicrafts', description: 'Traditional and handmade goods' },
];

async function seedSuperAdmin() {
  const username = usernameSchema.safeParse(process.env.ADMIN_USERNAME ?? '');
  const password = passwordSchema.safeParse(process.env.ADMIN_INITIAL_PASSWORD ?? '');
  const fullName = fullNameSchema.safeParse(
    process.env.ADMIN_FULL_NAME?.trim() || 'Platform Administrator',
  );
  if (!username.success || !password.success || !fullName.success) {
    throw new Error(
      'Set ADMIN_USERNAME (3-30 lowercase letters, digits, _) and ADMIN_INITIAL_PASSWORD (8-128 characters) in .env',
    );
  }

  const existing = await prisma.user.findUnique({ where: { username: username.data } });
  if (existing) {
    if (existing.role !== 'SUPER_ADMIN') {
      throw new Error(`User "${username.data}" exists but is not a Super Admin. Pick another ADMIN_USERNAME.`);
    }
    console.log(
      `Super Admin "${username.data}" already exists. The password, role, and status were left unchanged. ` +
        'To replace the password, run: npm run db:reset-admin-password',
    );
    return;
  }
  await prisma.user.create({
    data: {
      role: 'SUPER_ADMIN',
      username: username.data,
      fullName: fullName.data,
      passwordHash: await hashPassword(password.data),
      // The .env password is only a bootstrap secret; it must be replaced at first sign-in.
      mustChangePassword: true,
    },
  });
  console.log(`Created Super Admin "${username.data}" (password change required at first sign-in).`);
}

async function seedCategories() {
  let created = 0;
  for (const category of STARTER_CATEGORIES) {
    const slug = slugify(category.name);
    const exists = await prisma.category.findFirst({
      where: { OR: [{ slug }, { name: category.name }] },
      select: { id: true },
    });
    if (!exists) {
      await prisma.category.create({ data: { ...category, slug } });
      created += 1;
    }
  }
  console.log(`Categories: ${created} created, ${STARTER_CATEGORIES.length - created} already present.`);
}

async function main() {
  await seedSuperAdmin();
  await seedCategories();
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
