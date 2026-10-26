import type { SlipParty, VerifyBankData, VerifyBankOutcome } from './easyslip'

const CLOCK_TOLERANCE_MS = 5 * 60 * 1000
const TRANS_REF_PATTERN = /^[A-Za-z0-9]{6,64}$/
const EXPLICIT_TIMEZONE_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/
const PROXY_TYPES_WITH_NUMBERS = new Set(['MSISDN', 'NATID', 'EWALLETID'])
// EasySlip reports the ISO 4217 numeric code ("764") taken from the slip's QR payload.
const THAI_BAHT_CODES = new Set(['764', 'THB'])

export type SlipRejectReason =
  | 'RECEIVER_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'SLIP_DATE_OUT_OF_RANGE'
  | 'SLIP_ALREADY_USED'
  | 'SLIP_UNREADABLE'
  | 'INVALID_FILE'

export type SlipReviewReason = 'DUPLICATE_NOT_RECORDED' | 'ALREADY_SUBMITTED'

export type RetryLaterReason =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_MISCONFIGURED'
  | 'QUOTA_EXCEEDED'
  | 'SLIP_PENDING'
  | 'INVALID_PROVIDER_DATA'

export interface SlipFacts {
  transRef: string
  amountSatang: number
  slipDate: Date | null
}

export interface VerifiedSlip extends SlipFacts {
  slipDate: Date
}

export type SlipDecision =
  | { result: 'PAID', slip: VerifiedSlip }
  | { result: 'ALREADY_PAID' }
  | { result: 'REJECTED', reason: SlipRejectReason, recordForReview: SlipFacts | null }
  | { result: 'NEEDS_REVIEW', reason: SlipReviewReason, recordForReview: SlipFacts | null, lockOrder: boolean }
  | { result: 'RETRY_LATER', reason: RetryLaterReason }

export interface SlipDecisionInput {
  outcome: VerifyBankOutcome
  order: { id: string, totalSatang: number, createdAt: Date }
  existingSlip: { orderId: string, orderStatus: string } | null
  config: { receiverBankNumber: string, receiverPromptPayId: string, slipMaxAgeHours: number }
  now: Date
}

function decideProviderError(code: string): SlipDecision {
  switch (code) {
    case 'SLIP_NOT_FOUND':
      return { result: 'REJECTED', reason: 'SLIP_UNREADABLE', recordForReview: null }
    case 'VALIDATION_ERROR':
    case 'IMAGE_SIZE_TOO_LARGE':
    case 'INVALID_IMAGE_FORMAT':
      return { result: 'REJECTED', reason: 'INVALID_FILE', recordForReview: null }
    case 'SLIP_PENDING':
      return { result: 'RETRY_LATER', reason: 'SLIP_PENDING' }
    case 'QUOTA_EXCEEDED':
      return { result: 'RETRY_LATER', reason: 'QUOTA_EXCEEDED' }
    case 'API_SERVER_ERROR':
      return { result: 'RETRY_LATER', reason: 'PROVIDER_UNAVAILABLE' }
    default:
      return { result: 'RETRY_LATER', reason: 'PROVIDER_MISCONFIGURED' }
  }
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, '')
}

// Slips mask most digits (e.g. "xxx-xxx-0186"); the visible ones keep their position
// counted from the right, so they are compared right-aligned.
function maskedNumberMatches(masked: string, expected: string) {
  const characters = masked.replace(/[\s().+-]/g, '')
  if (characters.length > expected.length) return false
  const offset = expected.length - characters.length
  return [...characters].every((character, index) => !/\d/.test(character) || character === expected[offset + index])
}

function contradictsExpectedNumbers(masked: string, candidates: string[]) {
  return /\d/.test(masked) && !candidates.some(candidate => maskedNumberMatches(masked, candidate))
}

function promptPayCandidates(promptPayId: string) {
  return /^0\d{9}$/.test(promptPayId) ? [promptPayId, `66${promptPayId.slice(1)}`] : [promptPayId]
}

function isReceiverNumberConsistent(receiver: SlipParty, config: SlipDecisionInput['config']) {
  const proxy = receiver.account.proxy
  if (proxy && PROXY_TYPES_WITH_NUMBERS.has(proxy.type)
    && contradictsExpectedNumbers(proxy.account, promptPayCandidates(config.receiverPromptPayId))) {
    return false
  }

  const bankAccount = receiver.account.bank
  if (bankAccount?.type === 'BANKAC' && contradictsExpectedNumbers(bankAccount.account, [config.receiverBankNumber])) {
    return false
  }
  return true
}

function isReceiverOurs(data: VerifyBankData, config: SlipDecisionInput['config']) {
  const matchedDigits = data.matchedAccount ? digitsOnly(data.matchedAccount.bankNumber) : ''
  return matchedDigits !== ''
    && matchedDigits === config.receiverBankNumber
    && isReceiverNumberConsistent(data.rawSlip.receiver, config)
}

function isAmountExact(data: VerifyBankData, amountSatang: number, totalSatang: number) {
  return data.isAmountMatched === true && amountSatang > 0 && amountSatang === totalSatang
}

function isThaiBaht(rawSlip: VerifyBankData['rawSlip']) {
  const currency = rawSlip.amount.local?.currency
  return rawSlip.countryCode === 'TH' && (currency === undefined || currency === null || THAI_BAHT_CODES.has(currency))
}

function parseSlipDate(value: string) {
  if (!EXPLICIT_TIMEZONE_PATTERN.test(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function isWithinOrderWindow(slipDate: Date, orderCreatedAt: Date, now: Date, maxAgeHours: number) {
  const slipTime = slipDate.getTime()
  return slipTime >= orderCreatedAt.getTime() - CLOCK_TOLERANCE_MS
    && slipTime <= now.getTime() + CLOCK_TOLERANCE_MS
    && slipTime >= now.getTime() - maxAgeHours * 60 * 60 * 1000
}

function decideVerifiedSlip(data: VerifyBankData, input: SlipDecisionInput): SlipDecision {
  const { rawSlip } = data
  if (!TRANS_REF_PATTERN.test(rawSlip.transRef)) {
    return { result: 'RETRY_LATER', reason: 'INVALID_PROVIDER_DATA' }
  }

  const amountSatang = Math.round(rawSlip.amount.amount * 100)
  const slipDate = parseSlipDate(rawSlip.date)
  const facts: SlipFacts = { transRef: rawSlip.transRef, amountSatang, slipDate }
  // A transRef already in our database cannot be stored again, so only new slips are recorded.
  const recordForReview = input.existingSlip ? null : facts
  const reject = (reason: SlipRejectReason): SlipDecision => ({ result: 'REJECTED', reason, recordForReview })

  if (!isReceiverOurs(data, input.config)) return reject('RECEIVER_MISMATCH')
  if (!isAmountExact(data, amountSatang, input.order.totalSatang)) return reject('AMOUNT_MISMATCH')
  if (!isThaiBaht(rawSlip)) return reject('CURRENCY_MISMATCH')
  if (!slipDate || !isWithinOrderWindow(slipDate, input.order.createdAt, input.now, input.config.slipMaxAgeHours)) {
    return reject('SLIP_DATE_OUT_OF_RANGE')
  }

  if (input.existingSlip) {
    if (input.existingSlip.orderId !== input.order.id) {
      return { result: 'REJECTED', reason: 'SLIP_ALREADY_USED', recordForReview: null }
    }
    if (input.existingSlip.orderStatus === 'PAID') return { result: 'ALREADY_PAID' }
    return { result: 'NEEDS_REVIEW', reason: 'ALREADY_SUBMITTED', recordForReview: null, lockOrder: false }
  }

  // EasySlip has seen this slip but we never stored it (e.g. our earlier save failed),
  // so it may already have paid for something: hold the order for a person to check.
  if (data.isDuplicate) {
    return { result: 'NEEDS_REVIEW', reason: 'DUPLICATE_NOT_RECORDED', recordForReview: facts, lockOrder: true }
  }

  return { result: 'PAID', slip: { transRef: rawSlip.transRef, amountSatang, slipDate } }
}

export function decideSlip(input: SlipDecisionInput): SlipDecision {
  const { outcome } = input
  switch (outcome.kind) {
    case 'RETRY_LATER':
      return { result: 'RETRY_LATER', reason: 'PROVIDER_UNAVAILABLE' }
    case 'INVALID_RESPONSE':
      return { result: 'RETRY_LATER', reason: 'INVALID_PROVIDER_DATA' }
    case 'PROVIDER_ERROR':
      return decideProviderError(outcome.code)
    case 'SUCCESS':
      return decideVerifiedSlip(outcome.data, input)
  }
}
