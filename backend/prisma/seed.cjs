/**
 * Seeds the first municipality staff account so the dashboard has a
 * login. Idempotent: re-running updates the password/role of the same
 * email instead of duplicating it.
 *
 * Usage:
 *   pnpm run seed        (builds first — the Prisma client is compiled
 *                         into dist/generated/prisma by `nest build`)
 * Credentials come from env (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD) or
 * fall back to the values in backend/.env.
 */
const { PrismaClient } = require('../dist/generated/prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { hash } = require('bcryptjs');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@bazourieh.gov.lb').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD (min 8 chars) must be set in backend/.env');
  }

  const passwordHash = await hash(password, 12);

  const user = await prisma.municipalityUser.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      fullName: 'Bazourieh Administrator',
      role: 'SUPER_ADMIN',
      municipalityName: 'Al Bazourieh',
      isActive: true,
    },
    update: { passwordHash, isActive: true },
  });

  console.log(`Seeded municipality staff account: ${user.email} (${user.role})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
