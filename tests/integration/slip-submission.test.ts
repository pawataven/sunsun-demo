import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '../../server/generated/prisma/client'
import type { OrderStatus } from '../../server/generated/prisma/client'
import { createEasySlipClient } from '../../server/services/easyslip'
import { generateAccessToken } from '../../server/services/order-access'
import type { PaymentConfig } from '../../server/services/payment-config'
import type { MultipartPart } from '../../server/services/slip-file'
import { submitSlip } from '../../server/services/slip-submission'
import type { SlipLogger } from '../../server/services/slip-submission'
import {
  bangkokIso,
  DEFAULT_TRANS_REF,
  errorBody,
  fakeFetch,
  jsonResponse,
  RECEIVER_BANK_NUMBER,
  RECEIVER_PROMPTPAY_ID,
  SENDER_ACCOUNT,
  SENDER_NAME,
  slipPart,
  successBody,
  TEST_API_KEY,
  verifyBankData
} from '../fixtures/easyslip'
import type { SlipOverrides } from '../fixtures/easyslip'
import { createTestPrisma, resetDatabase } from './test-database'

const prisma = createTestPrisma()
const NOW = new Date()
const ORDER_CREATED_AT = new Date(NOW.getTime() - 10 * 60 * 1000)
const SLIP_DATE = bangkokIso(new Date(NOW.getTime() - 2 * 60 * 1000))

const config: PaymentConfig = {
  easyslipApiKey: TEST_API_KEY,
  easyslipDailyCap: 200,
  receiverBankNumber: RECEIVER_BANK_NUMBER,
  receiverPromptPayId: RECEIVER_PROMPTPAY_ID,
  slipMaxAgeHours: 24
}

let orderSequence = 0

async function createOrder(options: { status?: OrderStatus, totalBaht?: string } = {}) {
  orderSequence += 1
  const total = new Prisma.Decimal(options.totalBaht ?? '1.00')
  return prisma.order.create({
    data: {
      orderNumber: `SS-TEST-${String(orderSequence).padStart(4, '0')}`,
      accessToken: generateAccessToken(),
      status: options.status ?? 'PENDING_PAYMENT',
      customerName: 'ลูกค้า ทดสอบ',
      customerPhone: '0800000000',
      shippingAddress: 'กรุงเทพฯ',
      subtotal: total,
      total,
      createdAt: ORDER_CREATED_AT
    }
  })
}

function slipResponse(overrides: SlipOverrides = {}) {
  return jsonResponse(200, successBody(verifyBankData({ date: SLIP_DATE, ...overrides })))
}

function captureLogger() {
  const entries: unknown[][] = []
  const logger: SlipLogger = {
    info: (...args) => { entries.push(['info', ...args]) },
    warn: (...args) => { entries.push(['warn', ...args]) },
    error: (...args) => { entries.push(['error', ...args]) }
  }
  return { logger, entries }
}

interface SubmitOptions {
  replies?: Parameters<typeof fakeFetch>
  easySlipFetch?: ReturnType<typeof fakeFetch>
  contentLength?: number | null
  parts?: MultipartPart[]
  config?: PaymentConfig
  logger?: SlipLogger
}

async function submit(accessToken: string, options: SubmitOptions = {}) {
  const { fetch, calls } = options.easySlipFetch ?? fakeFetch(...(options.replies ?? []))
  const readParts = vi.fn(async () => options.parts ?? [slipPart()])
  const result = await submitSlip(
    {
      prisma,
      easySlip: createEasySlipClient({ apiKey: TEST_API_KEY, fetch, timeoutMs: 50 }),
      config: options.config ?? config,
      logger: options.logger ?? captureLogger().logger,
      now: () => NOW
    },
    { accessToken, contentLength: options.contentLength === undefined ? 2048 : options.contentLength, readParts }
  )
  return { result, calls, readParts }
}

beforeEach(async () => {
  await resetDatabase(prisma)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('submitSlip', () => {
  it('marks the order paid in one transaction when the slip checks out', async () => {
    const order = await createOrder()
    const { result, calls } = await submit(order.accessToken, { replies: [slipResponse()] })

    expect(result).toEqual({ httpStatus: 200, body: { status: 'PAID', message: expect.any(String) } })
    expect(calls).toHaveLength(1)

    const paidOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { paymentSlips: true, events: true, slipAttempts: true } })
    expect(paidOrder.status).toBe('PAID')
    expect(paidOrder.paidAt).not.toBeNull()
    expect(paidOrder.paymentSlips).toMatchObject([{ transRef: DEFAULT_TRANS_REF, amountSatang: 100, status: 'VERIFIED' }])
    expect(paidOrder.events).toMatchObject([{ fromStatus: 'PENDING_PAYMENT', toStatus: 'PAID', actor: 'system:easyslip' }])
    expect(paidOrder.slipAttempts).toMatchObject([{ resultCode: 'PAID' }])
  })

  it('answers 413 for an oversized request without reading it or calling EasySlip', async () => {
    const order = await createOrder()
    const { result, calls, readParts } = await submit(order.accessToken, { contentLength: 5 * 1024 * 1024 })

    expect(result.httpStatus).toBe(413)
    expect(readParts).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
  })

  it('refuses a request without a Content-Length', async () => {
    const order = await createOrder()
    const { result, calls } = await submit(order.accessToken, { contentLength: null })

    expect(result.httpStatus).toBe(411)
    expect(calls).toHaveLength(0)
  })

  it('rejects a .jpg that is really HTML without calling EasySlip', async () => {
    const order = await createOrder()
    const html = new TextEncoder().encode('<!doctype html><title>not a slip</title>')
    const { result, calls } = await submit(order.accessToken, {
      parts: [slipPart({ filename: 'slip.jpg', type: 'image/jpeg', data: html })]
    })

    expect(result).toMatchObject({ httpStatus: 400, body: { status: 'INVALID_FILE' } })
    expect(calls).toHaveLength(0)
    expect(await prisma.slipAttempt.findMany({ where: { orderId: order.id } })).toMatchObject([{ resultCode: 'INVALID_FILE' }])
  })

  it('does not call EasySlip for an order that is already paid', async () => {
    const order = await createOrder({ status: 'PAID' })
    const { result, calls } = await submit(order.accessToken, { replies: [slipResponse()] })

    expect(result).toMatchObject({ httpStatus: 200, body: { status: 'PAID' } })
    expect(calls).toHaveLength(0)
  })

  it('does not call EasySlip for a cancelled order', async () => {
    const order = await createOrder({ status: 'CANCELLED' })
    const { result, calls } = await submit(order.accessToken, { replies: [slipResponse()] })

    expect(result).toMatchObject({ httpStatus: 409, body: { status: 'NOT_ACCEPTING' } })
    expect(calls).toHaveLength(0)
  })

  it('answers 404 the same way for unknown and malformed order codes', async () => {
    const unknown = await submit(generateAccessToken())
    const malformed = await submit('SS261026-ABCDEF')

    expect(unknown.result).toEqual(malformed.result)
    expect(unknown.result.httpStatus).toBe(404)
  })

  it('does not call EasySlip once an order hits its attempt limit', async () => {
    const order = await createOrder()
    await prisma.slipAttempt.createMany({
      data: Array.from({ length: 5 }, () => ({ orderId: order.id, resultCode: 'REJECTED:SLIP_UNREADABLE', createdAt: NOW }))
    })
    const { result, calls } = await submit(order.accessToken, { replies: [slipResponse()] })

    expect(result).toMatchObject({ httpStatus: 429, body: { status: 'RATE_LIMITED' } })
    expect(calls).toHaveLength(0)
  })

  it('does not call EasySlip once the daily cap is reached', async () => {
    const order = await createOrder()
    const other = await createOrder()
    await prisma.slipAttempt.createMany({
      data: Array.from({ length: 3 }, () => ({ orderId: other.id, resultCode: 'PAID', createdAt: NOW }))
    })
    const { result, calls } = await submit(order.accessToken, { replies: [slipResponse()], config: { ...config, easyslipDailyCap: 3 } })

    expect(result).toMatchObject({ httpStatus: 503, body: { status: 'RETRY_LATER' } })
    expect(calls).toHaveLength(0)
  })

  it('fails closed without calling EasySlip when the API key is missing', async () => {
    const order = await createOrder()
    const { result, calls } = await submit(order.accessToken, { replies: [slipResponse()], config: { ...config, easyslipApiKey: '' } })

    expect(result).toMatchObject({ httpStatus: 503, body: { status: 'RETRY_LATER' } })
    expect(calls).toHaveLength(0)
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING_PAYMENT')
  })

  it('rejects a slip whose transRef already paid another order', async () => {
    const first = await createOrder()
    const second = await createOrder()
    await submit(first.accessToken, { replies: [slipResponse()] })

    const { result } = await submit(second.accessToken, { replies: [slipResponse({ isDuplicate: true })] })

    expect(result).toMatchObject({ httpStatus: 422, body: { status: 'REJECTED' } })
    expect((await prisma.order.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('PENDING_PAYMENT')
    expect(await prisma.paymentSlip.count()).toBe(1)
  })

  it('pays only once when the same slip is submitted twice at the same time', async () => {
    const order = await createOrder()
    const easySlipFetch = fakeFetch(slipResponse(), slipResponse({ isDuplicate: true }))
    const submissions = await Promise.all([
      submit(order.accessToken, { easySlipFetch }),
      submit(order.accessToken, { easySlipFetch })
    ])

    expect(submissions.map(({ result }) => result.body.status).sort()).toEqual(['IN_PROGRESS', 'PAID'])
    expect(easySlipFetch.calls).toHaveLength(1)
    expect(await prisma.paymentSlip.count()).toBe(1)
    expect(await prisma.orderEvent.count({ where: { orderId: order.id, toStatus: 'PAID' } })).toBe(1)
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID')
  })

  it('lets one slip pay only one of two orders submitted at the same time', async () => {
    const first = await createOrder()
    const second = await createOrder()
    const submissions = await Promise.all([
      submit(first.accessToken, { replies: [slipResponse()] }),
      submit(second.accessToken, { replies: [slipResponse()] })
    ])

    expect(submissions.map(({ result }) => result.body.status).sort()).toEqual(['PAID', 'REJECTED'])
    expect(await prisma.paymentSlip.count()).toBe(1)
    expect(await prisma.order.count({ where: { status: 'PAID' } })).toBe(1)
  })

  it('frees the order for a new attempt after an unexpected failure', async () => {
    const order = await createOrder()
    const brokenEasySlip = {
      verifyBank: async () => {
        throw new Error('unexpected bug')
      }
    }
    await expect(submitSlip(
      { prisma, easySlip: brokenEasySlip, config, logger: captureLogger().logger, now: () => NOW },
      { accessToken: order.accessToken, contentLength: 2048, readParts: async () => [slipPart()] }
    )).rejects.toThrow('unexpected bug')

    const { result } = await submit(order.accessToken, { replies: [slipResponse()] })
    expect(result.body.status).toBe('PAID')
  })

  it('keeps a second valid slip as a double payment when the order was paid meanwhile', async () => {
    const order = await createOrder()
    const payElsewhereFirst = async () => {
      await prisma.order.update({ where: { id: order.id }, data: { status: 'PAID' } })
      return slipResponse({ transRef: 'SECONDSLIP0000000001' })
    }
    const { result } = await submit(order.accessToken, { replies: [payElsewhereFirst] })

    expect(result).toMatchObject({ httpStatus: 202, body: { status: 'NEEDS_REVIEW' } })
    expect(await prisma.paymentSlip.findMany()).toMatchObject([{ transRef: 'SECONDSLIP0000000001', status: 'NEEDS_REVIEW', reason: 'DOUBLE_PAYMENT' }])
  })

  it('rejects a wrong amount and keeps the slip for an admin', async () => {
    const order = await createOrder()
    const { result } = await submit(order.accessToken, { replies: [slipResponse({ amount: 2, isAmountMatched: false })] })

    expect(result).toMatchObject({ httpStatus: 422, body: { status: 'REJECTED' } })
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING_PAYMENT')
    expect(await prisma.paymentSlip.findMany()).toMatchObject([{ status: 'NEEDS_REVIEW', reason: 'AMOUNT_MISMATCH', amountSatang: 200 }])
  })

  it('holds the order for review when EasySlip saw the slip but we never stored it', async () => {
    const order = await createOrder()
    const { result } = await submit(order.accessToken, { replies: [slipResponse({ isDuplicate: true })] })

    expect(result).toMatchObject({ httpStatus: 202, body: { status: 'NEEDS_REVIEW' } })
    const heldOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { events: true } })
    expect(heldOrder.status).toBe('PAYMENT_REVIEW')
    expect(heldOrder.events).toMatchObject([{ toStatus: 'PAYMENT_REVIEW', actor: 'system:easyslip', reason: 'DUPLICATE_NOT_RECORDED' }])
  })

  it('keeps the order pending and alerts when the EasySlip quota is exhausted', async () => {
    const order = await createOrder()
    const { logger, entries } = captureLogger()
    const { result } = await submit(order.accessToken, { replies: [jsonResponse(403, errorBody('QUOTA_EXCEEDED'))], logger })

    expect(result).toMatchObject({ httpStatus: 503, body: { status: 'RETRY_LATER' } })
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING_PAYMENT')
    expect(await prisma.slipAttempt.findMany({ where: { orderId: order.id } })).toMatchObject([{ resultCode: 'RETRY_LATER:QUOTA_EXCEEDED' }])
    expect(entries.some(([level]) => level === 'error')).toBe(true)
  })

  it('never returns or logs slip details, sender data or the API key', async () => {
    const paidOrder = await createOrder()
    const rejectedOrder = await createOrder()
    const { logger, entries } = captureLogger()

    const paid = await submit(paidOrder.accessToken, { replies: [slipResponse()], logger })
    const rejected = await submit(rejectedOrder.accessToken, {
      replies: [slipResponse({ transRef: 'OTHERSLIP00000000001', amount: 5 })],
      logger
    })

    for (const { result } of [paid, rejected]) {
      expect(Object.keys(result.body).sort()).toEqual(['message', 'status'])
    }
    const exposed = JSON.stringify([paid.result, rejected.result, entries])
    for (const secret of [TEST_API_KEY, SENDER_NAME, SENDER_ACCOUNT, DEFAULT_TRANS_REF, 'rawSlip']) {
      expect(exposed).not.toContain(secret)
    }
  })
})
