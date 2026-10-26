import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../server/generated/prisma/client'

export function requireTestDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    throw new Error('Set TEST_DATABASE_URL to a disposable database (see .env.example) to run integration tests')
  }
  // The tests truncate tables, so refuse anything that does not look like a test database.
  if (!new URL(url).pathname.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL must point to a database whose name ends with _test')
  }
  return url
}

export function createTestPrisma() {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: requireTestDatabaseUrl() }) })
}

export async function resetDatabase(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "orders", "audit_logs" RESTART IDENTITY CASCADE')
}
