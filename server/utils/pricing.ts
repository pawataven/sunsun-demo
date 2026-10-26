import { createError } from 'h3'
import { Prisma } from '../generated/prisma/client'
import type { PriceRule, Product, ProductOption, ProductOptionValue } from '../generated/prisma/client'

type Decimal = Prisma.Decimal

export type PricedProduct = Product & {
  options: (ProductOption & { values: ProductOptionValue[] })[]
  priceRules: PriceRule[]
}

export type OptionSelections = Record<string, string>

export interface SelectedOptionSnapshot {
  optionCode: string
  optionName: string
  valueCode: string
  valueLabel: string
}

export interface PriceQuote {
  quantity: number
  unitPrice: Decimal
  lineTotal: Decimal
  selectedOptions: SelectedOptionSnapshot[]
}

export const productWithPricingInclude = {
  options: {
    orderBy: { sortOrder: 'asc' },
    include: { values: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } }
  },
  priceRules: { where: { isActive: true }, orderBy: { priority: 'asc' } }
} satisfies Prisma.ProductInclude

function resolveSelections(product: PricedProduct, selections: OptionSelections) {
  const snapshots: SelectedOptionSnapshot[] = []
  const selectedValueIds = new Set<string>()

  for (const option of product.options) {
    const valueCode = selections[option.code]
    if (!valueCode) {
      if (option.isRequired) {
        throw createError({ statusCode: 400, statusMessage: `กรุณาเลือก${option.name}` })
      }
      continue
    }

    const value = option.values.find(candidate => candidate.code === valueCode)
    if (!value) {
      throw createError({ statusCode: 400, statusMessage: `ตัวเลือก${option.name}ไม่ถูกต้อง` })
    }

    selectedValueIds.add(value.id)
    snapshots.push({
      optionCode: option.code,
      optionName: option.name,
      valueCode: value.code,
      valueLabel: value.label
    })
  }

  return { snapshots, selectedValueIds }
}

function isRuleApplicable(rule: PriceRule, quantity: number, selectedValueIds: Set<string>, now: Date) {
  if (rule.validFrom && rule.validFrom > now) return false
  if (rule.validUntil && rule.validUntil < now) return false
  if (rule.minQuantity !== null && quantity < rule.minQuantity) return false
  if (rule.maxQuantity !== null && quantity > rule.maxQuantity) return false
  if (rule.optionValueId && !selectedValueIds.has(rule.optionValueId)) return false
  return true
}

// Order of application: per-unit prices × quantity, then flat fees, then percent
// adjustments (compounding, by priority), and finally the minimum charge floor.
export function calculatePrice(product: PricedProduct, quantity: number, selections: OptionSelections): PriceQuote {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw createError({ statusCode: 400, statusMessage: 'จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป' })
  }

  const { snapshots, selectedValueIds } = resolveSelections(product, selections)
  const now = new Date()
  const applicableRules = product.priceRules.filter(rule => isRuleApplicable(rule, quantity, selectedValueIds, now))

  const hasBaseTiers = product.priceRules.some(isBaseTierRule)
  if (hasBaseTiers && !applicableRules.some(isBaseTierRule)) {
    throw createError({ statusCode: 400, statusMessage: `สั่งขั้นต่ำ ${smallestTierQuantity(product).toLocaleString('th-TH')} ชิ้น` })
  }

  const ruleAmountSum = (type: PriceRule['type']) =>
    applicableRules
      .filter(rule => rule.type === type)
      .reduce((sum, rule) => sum.plus(rule.amount), new Prisma.Decimal(0))

  let lineTotal = ruleAmountSum('UNIT_PRICE').times(quantity).plus(ruleAmountSum('FLAT_FEE'))

  for (const rule of applicableRules.filter(rule => rule.type === 'PERCENT_ADJUST')) {
    lineTotal = lineTotal.times(new Prisma.Decimal(100).plus(rule.amount).dividedBy(100))
  }

  const minimumCharge = applicableRules
    .filter(rule => rule.type === 'MINIMUM_CHARGE')
    .reduce((highest, rule) => Prisma.Decimal.max(highest, rule.amount), new Prisma.Decimal(0))
  lineTotal = Prisma.Decimal.max(lineTotal, minimumCharge).toDecimalPlaces(2)

  return {
    quantity,
    unitPrice: lineTotal.dividedBy(quantity).toDecimalPlaces(2),
    lineTotal,
    selectedOptions: snapshots
  }
}

function isBaseTierRule(rule: PriceRule) {
  return rule.type === 'UNIT_PRICE' && !rule.optionValueId
}

export function smallestTierQuantity(product: PricedProduct) {
  const tierMinimums = product.priceRules
    .filter(rule => isBaseTierRule(rule) && rule.minQuantity !== null)
    .map(rule => rule.minQuantity!)
  return tierMinimums.length > 0 ? Math.min(...tierMinimums) : 1
}

export function firstValueSelections(product: PricedProduct): OptionSelections {
  return Object.fromEntries(
    product.options
      .filter(option => option.isRequired && option.values.length > 0)
      .map(option => [option.code, option.values[0]!.code])
  )
}
