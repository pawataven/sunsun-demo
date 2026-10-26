import type { Prisma } from '../generated/prisma/client'

export function toSatang(baht: Prisma.Decimal): number {
  const satang = baht.times(100)
  if (!satang.isInteger()) {
    throw new Error('Amount has more than two decimal places')
  }
  return satang.toNumber()
}

export function satangToBahtString(satang: number): string {
  if (!Number.isSafeInteger(satang)) {
    throw new Error('Satang amount must be an integer')
  }
  return (satang / 100).toFixed(2)
}
