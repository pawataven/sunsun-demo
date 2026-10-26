export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const product = await prisma.product.findFirst({
    where: { slug, isActive: true },
    include: productWithPricingInclude
  })

  if (!product) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบสินค้า' })
  }

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    imageUrl: product.imageUrl,
    defaultQuantity: smallestTierQuantity(product),
    defaultSelections: firstValueSelections(product),
    options: product.options.map(option => ({
      code: option.code,
      name: option.name,
      isRequired: option.isRequired,
      values: option.values.map(value => ({ code: value.code, label: value.label }))
    })),
    quantityTiers: product.priceRules
      .filter(rule => rule.type === 'UNIT_PRICE' && !rule.optionValueId)
      .map(rule => ({ minQuantity: rule.minQuantity, maxQuantity: rule.maxQuantity, unitPrice: rule.amount }))
  }
})
