import { Prisma } from '../generated/prisma/client'
import type { PaymentSlipStatus, PrismaClient } from '../generated/prisma/client'
import type { EasySlipClient, VerifyBankData, VerifyBankOutcome } from './easyslip'
import { toSatang } from './money'
import { isAccessTokenFormat } from './order-access'
import { paymentConfigProblems } from './payment-config'
import type { PaymentConfig } from './payment-config'
import { extractSlipImage, MAX_SLIP_REQUEST_BYTES } from './slip-file'
import type { MultipartPart } from './slip-file'
import { decideSlip } from './slip-verification'
import type {
  RetryLaterReason,
  SlipDecision,
  SlipFacts,
  SlipRejectReason,
  SlipReviewReason,
  VerifiedSlip
} from './slip-verification'

const ORDER_ATTEMPT_LIMIT = 5
const ORDER_ATTEMPT_WINDOW_MS = 15 * 60 * 1000
const DAILY_CAP_WINDOW_MS = 24 * 60 * 60 * 1000
// One verification per order at a time; an attempt left unfinished (e.g. the host killed
// the request at its 120 s limit) stops blocking the order after this long.
const IN_FLIGHT_WINDOW_MS = 2 * 60 * 1000
const IN_FLIGHT_RESULT_CODE = 'RECEIVED'
// Serialises the attempt counters so concurrent uploads cannot get past the limits together.
const SLIP_ATTEMPT_LOCK_KEY = 581_204
const VERIFIER_ACTOR = 'system:easyslip'

export type SlipSubmissionStatus =
  | 'PAID'
  | 'REJECTED'
  | 'NEEDS_REVIEW'
  | 'RETRY_LATER'
  | 'INVALID_FILE'
  | 'INVALID_REQUEST'
  | 'RATE_LIMITED'
  | 'IN_PROGRESS'
  | 'NOT_FOUND'
  | 'NOT_ACCEPTING'

export interface SlipSubmissionResult {
  httpStatus: number
  body: { status: SlipSubmissionStatus, message: string }
}

type LogLevel = 'info' | 'warn' | 'error'
export type SlipLogger = Record<LogLevel, (message: string, details?: Record<string, unknown>) => void>

export interface SlipSubmissionDeps {
  prisma: PrismaClient
  easySlip: EasySlipClient
  config: PaymentConfig
  logger?: SlipLogger
  now?: () => Date
}

export interface SlipSubmissionRequest {
  accessToken: string
  contentLength: number | null
  readParts: () => Promise<MultipartPart[] | undefined>
}

type ReviewRecordReason = SlipRejectReason | SlipReviewReason | 'DOUBLE_PAYMENT' | 'ORDER_NOT_PENDING'

interface SlipRecordContext {
  orderId: string
  mimeType: string
  sizeBytes: number
  rawResponse: VerifyBankData | null
}

interface AppliedDecision {
  response: SlipSubmissionResult
  resultCode: string
  logLevel: LogLevel
}

const MESSAGES = {
  paid: 'ชำระเงินเรียบร้อยแล้ว ขอบคุณที่สั่งซื้อ',
  alreadyPaid: 'คำสั่งซื้อนี้ชำระเงินแล้ว',
  notFound: 'ไม่พบคำสั่งซื้อ',
  invalidRequest: 'คำขอไม่ถูกต้อง กรุณาลองใหม่',
  fileTooLarge: 'ไฟล์ใหญ่เกินไป กรุณาแนบรูปขนาดไม่เกิน 4 MB',
  invalidFile: 'กรุณาแนบรูปสลิปเป็นไฟล์ JPG, PNG หรือ WEBP ขนาดไม่เกิน 4 MB',
  underReview: 'ร้านกำลังตรวจสอบการชำระเงินของคำสั่งซื้อนี้',
  notAccepting: 'คำสั่งซื้อนี้ไม่ได้อยู่ในสถานะรอชำระเงิน',
  tooManyAttempts: 'ส่งสลิปบ่อยเกินไป กรุณารอ 15 นาทีแล้วลองใหม่',
  inProgress: 'กำลังตรวจสลิปของคำสั่งซื้อนี้อยู่ กรุณารอสักครู่แล้วรีเฟรชหน้า',
  adminWillCheck: 'ระบบตรวจสลิปขัดข้องชั่วคราว แอดมินจะตรวจให้',
  tryAgainShortly: 'ระบบตรวจสลิปขัดข้องชั่วคราว กรุณาลองใหม่ในอีกสักครู่',
  doublePayment: 'คำสั่งซื้อนี้ได้รับชำระจากสลิปอื่นแล้ว ร้านจะติดต่อกลับเรื่องยอดที่โอนซ้ำ',
  orderChanged: 'คำสั่งซื้อนี้ไม่ได้รอชำระเงินแล้ว ร้านจะตรวจสอบสลิปนี้และติดต่อกลับ'
} as const

const REJECT_MESSAGES: Record<SlipRejectReason, string> = {
  RECEIVER_MISMATCH: 'บัญชีผู้รับในสลิปไม่ใช่บัญชีของร้าน หากโอนไปแล้วกรุณาติดต่อร้าน',
  AMOUNT_MISMATCH: 'ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ หากโอนไปแล้วกรุณาติดต่อร้าน',
  CURRENCY_MISMATCH: 'สลิปนี้ไม่ใช่การโอนเงินบาทภายในประเทศ หากโอนไปแล้วกรุณาติดต่อร้าน',
  SLIP_DATE_OUT_OF_RANGE: 'วันเวลาในสลิปไม่อยู่ในช่วงของคำสั่งซื้อนี้ หากโอนไปแล้วกรุณาติดต่อร้าน',
  SLIP_ALREADY_USED: 'สลิปนี้ถูกใช้กับคำสั่งซื้ออื่นแล้ว',
  SLIP_UNREADABLE: 'อ่านสลิปไม่ได้ กรุณาแนบรูปที่เห็น QR ชัดเจน',
  INVALID_FILE: 'ไฟล์ไม่ถูกต้อง กรุณาลองใหม่'
}

const REVIEW_MESSAGES: Record<SlipReviewReason, string> = {
  DUPLICATE_NOT_RECORDED: 'ได้รับสลิปแล้ว ร้านกำลังตรวจสอบการชำระเงิน',
  ALREADY_SUBMITTED: 'สลิปนี้ส่งมาแล้ว ร้านกำลังตรวจสอบ'
}

const RETRY_MESSAGES: Record<RetryLaterReason, string> = {
  PROVIDER_UNAVAILABLE: MESSAGES.tryAgainShortly,
  INVALID_PROVIDER_DATA: MESSAGES.tryAgainShortly,
  PROVIDER_MISCONFIGURED: MESSAGES.adminWillCheck,
  QUOTA_EXCEEDED: MESSAGES.adminWillCheck,
  SLIP_PENDING: 'ธนาคารยังไม่ยืนยันรายการนี้ กรุณารอประมาณ 5 นาทีแล้วลองใหม่'
}

const RETRY_LOG_LEVELS: Record<RetryLaterReason, LogLevel> = {
  PROVIDER_UNAVAILABLE: 'warn',
  INVALID_PROVIDER_DATA: 'error',
  PROVIDER_MISCONFIGURED: 'error',
  QUOTA_EXCEEDED: 'error',
  SLIP_PENDING: 'info'
}

class OrderNotPendingError extends Error {}

function respond(httpStatus: number, status: SlipSubmissionStatus, message: string): SlipSubmissionResult {
  return { httpStatus, body: { status, message } }
}

function applied(response: SlipSubmissionResult, resultCode: string, logLevel: LogLevel): AppliedDecision {
  return { response, resultCode, logLevel }
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function providerDetails(outcome: VerifyBankOutcome) {
  switch (outcome.kind) {
    case 'SUCCESS':
      return { provider: outcome.kind, retried: outcome.retried }
    case 'PROVIDER_ERROR':
      return { provider: outcome.kind, code: outcome.code, httpStatus: outcome.httpStatus }
    case 'RETRY_LATER':
      return { provider: outcome.kind, cause: outcome.cause }
    case 'INVALID_RESPONSE':
      return { provider: outcome.kind, httpStatus: outcome.httpStatus }
  }
}

async function readPartsSafely(readParts: SlipSubmissionRequest['readParts']) {
  try {
    return await readParts()
  }
  catch {
    return undefined
  }
}

type AttemptReservation =
  | { kind: 'RESERVED', attemptId: string }
  | { kind: 'ORDER_LIMIT' }
  | { kind: 'IN_PROGRESS' }
  | { kind: 'DAILY_CAP' }

async function reserveAttempt(prisma: PrismaClient, orderId: string, now: Date, dailyCap: number) {
  const since = (windowMs: number) => new Date(now.getTime() - windowMs)

  return prisma.$transaction(async (tx): Promise<AttemptReservation> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SLIP_ATTEMPT_LOCK_KEY}::bigint)`

    const orderAttempts = await tx.slipAttempt.count({
      where: { orderId, createdAt: { gte: since(ORDER_ATTEMPT_WINDOW_MS) } }
    })
    if (orderAttempts >= ORDER_ATTEMPT_LIMIT) return { kind: 'ORDER_LIMIT' }

    const inFlightAttempts = await tx.slipAttempt.count({
      where: { orderId, resultCode: IN_FLIGHT_RESULT_CODE, createdAt: { gte: since(IN_FLIGHT_WINDOW_MS) } }
    })
    if (inFlightAttempts > 0) return { kind: 'IN_PROGRESS' }

    const recentAttempts = await tx.slipAttempt.count({
      where: { createdAt: { gte: since(DAILY_CAP_WINDOW_MS) } }
    })
    if (recentAttempts >= dailyCap) return { kind: 'DAILY_CAP' }

    const attempt = await tx.slipAttempt.create({ data: { orderId, resultCode: IN_FLIGHT_RESULT_CODE, createdAt: now } })
    return { kind: 'RESERVED', attemptId: attempt.id }
  })
}

async function recordAttemptResult(prisma: PrismaClient, attemptId: string, resultCode: string) {
  await prisma.slipAttempt.update({ where: { id: attemptId }, data: { resultCode } })
}

async function findSlipOwner(prisma: PrismaClient, transRef: string) {
  const slip = await prisma.paymentSlip.findUnique({
    where: { transRef },
    select: { orderId: true, order: { select: { status: true } } }
  })
  return slip ? { orderId: slip.orderId, orderStatus: slip.order.status } : null
}

function slipRecord(facts: SlipFacts, status: PaymentSlipStatus, reason: string | null, context: SlipRecordContext) {
  return {
    orderId: context.orderId,
    transRef: facts.transRef,
    amountSatang: facts.amountSatang,
    slipDate: facts.slipDate,
    status,
    reason,
    rawResponse: (context.rawResponse ?? undefined) as Prisma.InputJsonValue | undefined,
    mimeType: context.mimeType,
    sizeBytes: context.sizeBytes
  } satisfies Prisma.PaymentSlipUncheckedCreateInput
}

async function respondToRecordedSlip(prisma: PrismaClient, transRef: string, orderId: string): Promise<AppliedDecision> {
  const owner = await findSlipOwner(prisma, transRef)
  if (owner && owner.orderId !== orderId) {
    return applied(respond(422, 'REJECTED', REJECT_MESSAGES.SLIP_ALREADY_USED), 'REJECTED:SLIP_ALREADY_USED', 'warn')
  }
  if (owner?.orderStatus === 'PAID') {
    return applied(respond(200, 'PAID', MESSAGES.alreadyPaid), 'ALREADY_PAID', 'info')
  }
  return applied(respond(202, 'NEEDS_REVIEW', REVIEW_MESSAGES.ALREADY_SUBMITTED), 'NEEDS_REVIEW:ALREADY_SUBMITTED', 'warn')
}

async function recordSlipForReview(
  prisma: PrismaClient,
  facts: SlipFacts,
  reason: ReviewRecordReason,
  context: SlipRecordContext,
  lockOrder: boolean
): Promise<'RECORDED' | 'ALREADY_RECORDED'> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.paymentSlip.create({ data: slipRecord(facts, 'NEEDS_REVIEW', reason, context) })
      if (!lockOrder) return

      const { count } = await tx.order.updateMany({
        where: { id: context.orderId, status: 'PENDING_PAYMENT' },
        data: { status: 'PAYMENT_REVIEW' }
      })
      if (count === 1) {
        await tx.orderEvent.create({
          data: { orderId: context.orderId, fromStatus: 'PENDING_PAYMENT', toStatus: 'PAYMENT_REVIEW', actor: VERIFIER_ACTOR, reason }
        })
      }
    })
    return 'RECORDED'
  }
  catch (error) {
    if (isUniqueViolation(error)) return 'ALREADY_RECORDED'
    throw error
  }
}

async function markOrderPaid(prisma: PrismaClient, now: () => Date, slip: VerifiedSlip, context: SlipRecordContext): Promise<AppliedDecision> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.paymentSlip.create({ data: slipRecord(slip, 'VERIFIED', null, context) })
      const { count } = await tx.order.updateMany({
        where: { id: context.orderId, status: 'PENDING_PAYMENT' },
        data: { status: 'PAID', paidAt: now() }
      })
      if (count !== 1) throw new OrderNotPendingError()
      await tx.orderEvent.create({
        data: { orderId: context.orderId, fromStatus: 'PENDING_PAYMENT', toStatus: 'PAID', actor: VERIFIER_ACTOR, reason: `transRef ${slip.transRef}` }
      })
    })
    return applied(respond(200, 'PAID', MESSAGES.paid), 'PAID', 'info')
  }
  catch (error) {
    if (isUniqueViolation(error)) return respondToRecordedSlip(prisma, slip.transRef, context.orderId)
    if (!(error instanceof OrderNotPendingError)) throw error
  }

  // The order stopped waiting for payment while this slip was being checked, but the
  // transfer is real money, so it is kept for an admin to refund or reconcile.
  const order = await prisma.order.findUniqueOrThrow({ where: { id: context.orderId }, select: { status: true } })
  const reason = order.status === 'PAID' ? 'DOUBLE_PAYMENT' : 'ORDER_NOT_PENDING'
  const recorded = await recordSlipForReview(prisma, slip, reason, context, false)
  if (recorded === 'ALREADY_RECORDED') return respondToRecordedSlip(prisma, slip.transRef, context.orderId)
  const message = reason === 'DOUBLE_PAYMENT' ? MESSAGES.doublePayment : MESSAGES.orderChanged
  return applied(respond(202, 'NEEDS_REVIEW', message), `NEEDS_REVIEW:${reason}`, 'warn')
}

async function applyDecision(prisma: PrismaClient, now: () => Date, decision: SlipDecision, context: SlipRecordContext): Promise<AppliedDecision> {
  switch (decision.result) {
    case 'PAID':
      return markOrderPaid(prisma, now, decision.slip, context)
    case 'ALREADY_PAID':
      return applied(respond(200, 'PAID', MESSAGES.alreadyPaid), 'ALREADY_PAID', 'info')
    case 'REJECTED':
      if (decision.recordForReview) {
        await recordSlipForReview(prisma, decision.recordForReview, decision.reason, context, false)
      }
      return applied(
        respond(422, 'REJECTED', REJECT_MESSAGES[decision.reason]),
        `REJECTED:${decision.reason}`,
        decision.reason === 'SLIP_UNREADABLE' ? 'info' : 'warn'
      )
    case 'NEEDS_REVIEW':
      if (decision.recordForReview) {
        const recorded = await recordSlipForReview(prisma, decision.recordForReview, decision.reason, context, decision.lockOrder)
        if (recorded === 'ALREADY_RECORDED') return respondToRecordedSlip(prisma, decision.recordForReview.transRef, context.orderId)
      }
      return applied(respond(202, 'NEEDS_REVIEW', REVIEW_MESSAGES[decision.reason]), `NEEDS_REVIEW:${decision.reason}`, 'warn')
    case 'RETRY_LATER':
      return applied(respond(503, 'RETRY_LATER', RETRY_MESSAGES[decision.reason]), `RETRY_LATER:${decision.reason}`, RETRY_LOG_LEVELS[decision.reason])
  }
}

interface PendingOrder {
  id: string
  orderNumber: string
  total: Prisma.Decimal
  createdAt: Date
}

async function verifyReservedAttempt(
  deps: SlipSubmissionDeps,
  request: SlipSubmissionRequest,
  order: PendingOrder,
  attemptId: string,
  logger: SlipLogger,
  now: () => Date
): Promise<SlipSubmissionResult> {
  const { prisma, config } = deps

  const file = extractSlipImage(await readPartsSafely(request.readParts))
  if (!file.ok) {
    await recordAttemptResult(prisma, attemptId, 'INVALID_FILE')
    return respond(400, 'INVALID_FILE', MESSAGES.invalidFile)
  }

  const totalSatang = toSatang(order.total)
  const outcome = await deps.easySlip.verifyBank({
    image: file.image,
    mimeType: file.mimeType,
    remark: order.orderNumber,
    expectedAmountSatang: totalSatang
  })
  const existingSlip = outcome.kind === 'SUCCESS' ? await findSlipOwner(prisma, outcome.data.rawSlip.transRef) : null
  const decision = decideSlip({
    outcome,
    order: { id: order.id, totalSatang, createdAt: order.createdAt },
    existingSlip,
    config,
    now: now()
  })

  const result = await applyDecision(prisma, now, decision, {
    orderId: order.id,
    mimeType: file.mimeType,
    sizeBytes: file.image.length,
    rawResponse: outcome.kind === 'SUCCESS' ? outcome.data : null
  })
  await recordAttemptResult(prisma, attemptId, result.resultCode)
  logger[result.logLevel](`[slip] ${result.resultCode}`, { orderNumber: order.orderNumber, ...providerDetails(outcome) })
  return result.response
}

export async function submitSlip(deps: SlipSubmissionDeps, request: SlipSubmissionRequest): Promise<SlipSubmissionResult> {
  const { prisma, config } = deps
  const logger = deps.logger ?? console
  const now = deps.now ?? (() => new Date())

  if (request.contentLength === null) return respond(411, 'INVALID_REQUEST', MESSAGES.invalidRequest)
  if (request.contentLength > MAX_SLIP_REQUEST_BYTES) return respond(413, 'INVALID_FILE', MESSAGES.fileTooLarge)

  const order = isAccessTokenFormat(request.accessToken)
    ? await prisma.order.findUnique({
        where: { accessToken: request.accessToken },
        select: { id: true, orderNumber: true, status: true, total: true, createdAt: true }
      })
    : null
  if (!order) return respond(404, 'NOT_FOUND', MESSAGES.notFound)
  if (order.status === 'PAID') return respond(200, 'PAID', MESSAGES.alreadyPaid)
  if (order.status !== 'PENDING_PAYMENT') {
    return respond(409, 'NOT_ACCEPTING', order.status === 'PAYMENT_REVIEW' ? MESSAGES.underReview : MESSAGES.notAccepting)
  }

  if (paymentConfigProblems(config).length > 0) {
    logger.error('[slip] payment verification is not configured', { orderNumber: order.orderNumber })
    return respond(503, 'RETRY_LATER', MESSAGES.adminWillCheck)
  }

  const reservation = await reserveAttempt(prisma, order.id, now(), config.easyslipDailyCap)
  if (reservation.kind === 'ORDER_LIMIT') return respond(429, 'RATE_LIMITED', MESSAGES.tooManyAttempts)
  if (reservation.kind === 'IN_PROGRESS') return respond(409, 'IN_PROGRESS', MESSAGES.inProgress)
  if (reservation.kind === 'DAILY_CAP') {
    logger.error('[slip] daily EasySlip cap reached', { dailyCap: config.easyslipDailyCap })
    return respond(503, 'RETRY_LATER', MESSAGES.adminWillCheck)
  }

  try {
    return await verifyReservedAttempt(deps, request, order, reservation.attemptId, logger, now)
  }
  catch (error) {
    await recordAttemptResult(prisma, reservation.attemptId, 'ERROR').catch(() => {})
    throw error
  }
}
