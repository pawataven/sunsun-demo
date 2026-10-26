import { randomInt } from 'node:crypto'
import { Prisma } from '../../generated/prisma/client'
import { generateAccessToken } from '../../services/order-access'

interface OrderRequestBody {
  customer: {
    name: string
    email?: string
    phone: string
    shippingAddress: string
  }
  items: {
    slug: string
    quantity: number
    selections: OptionSelections
  }[]
}

const ORDER_NUMBER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// Order numbers carry the shop's local date; UTC would roll over at 07:00 in Thailand.
const bangkokDateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  year: '2-digit',
  month: '2-digit',
  day: '2-digit'
})

function bangkokDateStamp(date: Date) {
  const parts = Object.fromEntries(bangkokDateFormat.formatToParts(date).map(part => [part.type, part.value]))
  return `${parts.year}${parts.month}${parts.day}`
}

function generateOrderNumber() {
  const datePart = bangkokDateStamp(new Date())
  const randomPart = Array.from({ length: 6 }, () => ORDER_NUMBER_ALPHABET[randomInt(ORDER_NUMBER_ALPHABET.length)]).join('')
  return `SS${datePart}-${randomPart}`
}

export default defineEventHandler(async (event) => {
  const body = await readBody<OrderRequestBody>(event)
  const customer = body?.customer
  const requestedItems = body?.items ?? []

  if (!customer?.name?.trim() || !customer.phone?.trim() || !customer.shippingAddress?.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'กรุณากรอกชื่อ เบอร์โทร และที่อยู่จัดส่ง' })
  }
  if (requestedItems.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'ตะกร้าสินค้าว่าง' })
  }

  const products = await prisma.product.findMany({
    where: { slug: { in: requestedItems.map(item => item.slug) }, isActive: true },
    include: productWithPricingInclude
  })

  const pricedItems = requestedItems.map((item) => {
    const product = products.find(candidate => candidate.slug === item.slug)
    if (!product) {
      throw createError({ statusCode: 400, statusMessage: 'มีสินค้าในตะกร้าที่ไม่มีขายแล้ว' })
    }
    return { product, price: calculatePrice(product, Number(item.quantity), item.selections ?? {}) }
  })

  const subtotal = pricedItems.reduce((sum, item) => sum.plus(item.price.lineTotal), new Prisma.Decimal(0))

  const order = await prisma.$transaction(async (tx) => {
    const createdOrder = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        accessToken: generateAccessToken(),
        customerName: customer.name.trim(),
        customerEmail: customer.email?.trim() || null,
        customerPhone: customer.phone.trim(),
        shippingAddress: customer.shippingAddress.trim(),
        subtotal,
        total: subtotal,
        items: {
          create: pricedItems.map(({ product, price }) => ({
            productId: product.id,
            productName: product.name,
            selectedOptions: price.selectedOptions as unknown as Prisma.InputJsonValue,
            quantity: price.quantity,
            unitPrice: price.unitPrice,
            lineTotal: price.lineTotal
          }))
        },
        events: {
          create: { toStatus: 'PENDING_PAYMENT', actor: 'customer' }
        }
      }
    })

    await tx.auditLog.create({
      data: {
        action: 'order.created',
        entityType: 'Order',
        entityId: createdOrder.id,
        after: { orderNumber: createdOrder.orderNumber, total: createdOrder.total.toString() },
        ipAddress: getRequestIP(event, { xForwardedFor: true }) ?? null,
        userAgent: getRequestHeader(event, 'user-agent') ?? null
      }
    })

    return createdOrder
  })

  return { accessToken: order.accessToken }
})
