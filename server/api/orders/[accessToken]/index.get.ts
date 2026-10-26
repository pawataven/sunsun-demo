import generatePromptPayPayload from 'promptpay-qr'
import QRCode from 'qrcode'
import { isAccessTokenFormat } from '../../../services/order-access'
import type { SelectedOptionSnapshot } from '../../../utils/pricing'

export default defineEventHandler(async (event) => {
  const accessToken = getRouterParam(event, 'accessToken')
  const order = isAccessTokenFormat(accessToken)
    ? await prisma.order.findUnique({ where: { accessToken }, include: { items: true } })
    : null

  if (!order) {
    throw createError({ statusCode: 404, statusMessage: 'ไม่พบคำสั่งซื้อ' })
  }

  const { promptpayId } = useRuntimeConfig(event)
  const promptPayQrDataUrl = order.status === 'PENDING_PAYMENT' && promptpayId
    ? await QRCode.toDataURL(generatePromptPayPayload(String(promptpayId), { amount: order.total.toNumber() }), { margin: 1, width: 320 })
    : null

  return {
    orderNumber: order.orderNumber,
    status: order.status,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    shippingAddress: order.shippingAddress,
    subtotal: order.subtotal,
    shippingFee: order.shippingFee,
    total: order.total,
    createdAt: order.createdAt,
    items: order.items.map(item => ({
      id: item.id,
      productName: item.productName,
      selectedOptions: item.selectedOptions as unknown as SelectedOptionSnapshot[],
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal
    })),
    promptPayQrDataUrl
  }
})
