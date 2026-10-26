export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  const { quantity, ...selections } = getQuery<Record<string, string>>(event)
  const product = await prisma.product.findFirst({
    where: { slug, isActive: true },
    include: productWithPricingInclude
  })

  if (!product) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบสินค้า' })
  }

  return calculatePrice(product, Number(quantity), selections)
})
