export default defineEventHandler(async () => {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    include: productWithPricingInclude
  })

  return products.map((product) => {
    const quantity = smallestTierQuantity(product)
    const startingPrice = calculatePrice(product, quantity, firstValueSelections(product))
    return {
      slug: product.slug,
      name: product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      startingQuantity: quantity,
      startingUnitPrice: startingPrice.unitPrice
    }
  })
})
