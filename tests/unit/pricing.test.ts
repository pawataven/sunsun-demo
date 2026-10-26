import { describe, expect, it } from 'vitest'
import { Prisma } from '../../server/generated/prisma/client'
import type { PriceRule, PriceRuleType } from '../../server/generated/prisma/client'
import { calculatePrice, firstValueSelections, smallestTierQuantity } from '../../server/utils/pricing'
import type { PricedProduct } from '../../server/utils/pricing'

const createdAt = new Date('2026-01-01T00:00:00Z')

function rule(type: PriceRuleType, amount: number, overrides: Partial<PriceRule> = {}): PriceRule {
  return {
    id: `rule-${type}-${amount}-${overrides.minQuantity ?? ''}-${overrides.optionValueId ?? ''}`,
    productId: 'cards',
    optionValueId: null,
    name: type,
    type,
    amount: new Prisma.Decimal(amount),
    minQuantity: null,
    maxQuantity: null,
    priority: 0,
    isActive: true,
    validFrom: null,
    validUntil: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides
  }
}

function businessCards(priceRules: PriceRule[]): PricedProduct {
  return {
    id: 'cards',
    slug: 'business-cards',
    name: 'นามบัตร',
    description: null,
    imageUrl: null,
    isActive: true,
    sortOrder: 0,
    createdAt,
    updatedAt: createdAt,
    options: [
      {
        id: 'paper',
        productId: 'cards',
        code: 'paper',
        name: 'กระดาษ',
        inputType: 'SELECT',
        isRequired: true,
        sortOrder: 0,
        createdAt,
        updatedAt: createdAt,
        values: [
          { id: 'paper-260', optionId: 'paper', code: 'art-card-260', label: '260 แกรม', isActive: true, sortOrder: 0, createdAt, updatedAt: createdAt },
          { id: 'paper-310', optionId: 'paper', code: 'art-card-310', label: '310 แกรม', isActive: true, sortOrder: 1, createdAt, updatedAt: createdAt }
        ]
      }
    ],
    priceRules
  }
}

const tieredRules = [
  rule('UNIT_PRICE', 2.5, { minQuantity: 100, maxQuantity: 299 }),
  rule('UNIT_PRICE', 1.8, { minQuantity: 300 }),
  rule('UNIT_PRICE', 0.5, { optionValueId: 'paper-310' })
]

describe('calculatePrice', () => {
  it('uses the quantity tier and adds the selected option per unit', () => {
    const price = calculatePrice(businessCards(tieredRules), 500, { paper: 'art-card-310' })
    expect(price.lineTotal.toString()).toBe('1150')
    expect(price.unitPrice.toString()).toBe('2.3')
  })

  it('ignores add-ons for options that were not selected', () => {
    expect(calculatePrice(businessCards(tieredRules), 100, { paper: 'art-card-260' }).lineTotal.toString()).toBe('250')
  })

  it('adds flat fees once, then applies percent adjustments', () => {
    const product = businessCards([
      ...tieredRules,
      rule('FLAT_FEE', 100),
      rule('PERCENT_ADJUST', -10, { minQuantity: 300 })
    ])
    expect(calculatePrice(product, 300, { paper: 'art-card-260' }).lineTotal.toString()).toBe('576')
  })

  it('never charges less than the minimum charge', () => {
    const product = businessCards([...tieredRules, rule('MINIMUM_CHARGE', 300)])
    expect(calculatePrice(product, 100, { paper: 'art-card-260' }).lineTotal.toString()).toBe('300')
  })

  it('skips rules outside their validity window', () => {
    const product = businessCards([
      ...tieredRules,
      rule('FLAT_FEE', 999, { validUntil: new Date('2020-01-01T00:00:00Z') })
    ])
    expect(calculatePrice(product, 100, { paper: 'art-card-260' }).lineTotal.toString()).toBe('250')
  })

  it('refuses quantities below the smallest tier', () => {
    expect(() => calculatePrice(businessCards(tieredRules), 10, { paper: 'art-card-260' })).toThrowError('สั่งขั้นต่ำ 100 ชิ้น')
  })

  it('requires every required option', () => {
    expect(() => calculatePrice(businessCards(tieredRules), 100, {})).toThrowError('กรุณาเลือกกระดาษ')
  })

  it('refuses unknown option values', () => {
    expect(() => calculatePrice(businessCards(tieredRules), 100, { paper: 'gold-leaf' })).toThrowError('ตัวเลือกกระดาษไม่ถูกต้อง')
  })

  it.each([0, -1, 1.5, Number.NaN])('refuses quantity %s', (quantity) => {
    expect(() => calculatePrice(businessCards(tieredRules), quantity, { paper: 'art-card-260' })).toThrowError('จำนวนต้องเป็นจำนวนเต็ม')
  })
})

describe('pricing helpers', () => {
  it('finds the smallest tier quantity', () => {
    expect(smallestTierQuantity(businessCards(tieredRules))).toBe(100)
  })

  it('defaults to one piece when there are no tiers', () => {
    expect(smallestTierQuantity(businessCards([rule('UNIT_PRICE', 1)]))).toBe(1)
  })

  it('selects the first value of each required option', () => {
    expect(firstValueSelections(businessCards(tieredRules))).toEqual({ paper: 'art-card-260' })
  })
})
