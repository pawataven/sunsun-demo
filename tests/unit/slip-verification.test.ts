import { describe, expect, it } from 'vitest'
import type { VerifyBankData, VerifyBankOutcome } from '../../server/services/easyslip'
import { decideSlip } from '../../server/services/slip-verification'
import type { SlipDecisionInput } from '../../server/services/slip-verification'
import { RECEIVER_BANK_NUMBER, RECEIVER_PROMPTPAY_ID, verifyBankData } from '../fixtures/easyslip'

const config = { receiverBankNumber: RECEIVER_BANK_NUMBER, receiverPromptPayId: RECEIVER_PROMPTPAY_ID, slipMaxAgeHours: 24 }
const order = { id: 'order-1', totalSatang: 100, createdAt: new Date('2026-10-26T02:55:00Z') }
const now = new Date('2026-10-26T03:05:00Z')

function decide(data: VerifyBankData, overrides: Partial<SlipDecisionInput> = {}) {
  return decideSlip({ outcome: { kind: 'SUCCESS', data, retried: false }, order, existingSlip: null, config, now, ...overrides })
}

function decideOutcome(outcome: VerifyBankOutcome) {
  return decideSlip({ outcome, order, existingSlip: null, config, now })
}

describe('decideSlip', () => {
  it('marks the order paid when every check passes', () => {
    expect(decide(verifyBankData())).toEqual({
      result: 'PAID',
      slip: { transRef: '68370160657749I376388B35', amountSatang: 100, slipDate: new Date('2026-10-26T03:00:00Z') }
    })
  })

  describe('receiver', () => {
    it('is not paid when EasySlip matched no registered account', () => {
      expect(decide(verifyBankData({ matchedBankNumber: null }))).toMatchObject({ result: 'REJECTED', reason: 'RECEIVER_MISMATCH' })
    })

    it('is not paid when the matched account is not the configured one', () => {
      expect(decide(verifyBankData({ matchedBankNumber: '999-9-99999-9' }))).toMatchObject({ result: 'REJECTED', reason: 'RECEIVER_MISMATCH' })
    })

    it('is not paid when the visible PromptPay digits belong to someone else', () => {
      const data = verifyBankData({ receiverProxy: { type: 'MSISDN', account: 'xxx-xxx-5555' } })
      expect(decide(data)).toMatchObject({ result: 'REJECTED', reason: 'RECEIVER_MISMATCH' })
    })

    it('is not paid when the visible bank account digits belong to someone else', () => {
      const data = verifyBankData({ receiverBankAccount: { type: 'BANKAC', account: 'xxx-x-x1111-x' } })
      expect(decide(data)).toMatchObject({ result: 'REJECTED', reason: 'RECEIVER_MISMATCH' })
    })

    it('accepts a PromptPay number shown with the 66 country code', () => {
      const data = verifyBankData({ receiverProxy: { type: 'MSISDN', account: '66-xx-xxx-0186' } })
      expect(decide(data)).toMatchObject({ result: 'PAID' })
    })

    it('falls back to matchAccount when the slip shows no receiver digits', () => {
      const data = verifyBankData({ receiverProxy: null, receiverBankAccount: { type: 'BANKAC', account: 'xxx-x-xxxxx-x' } })
      expect(decide(data)).toMatchObject({ result: 'PAID' })
    })
  })

  describe('amount', () => {
    it('is not paid when isAmountMatched is true but the slip amount differs', () => {
      expect(decide(verifyBankData({ amount: 2, isAmountMatched: true }))).toMatchObject({ result: 'REJECTED', reason: 'AMOUNT_MISMATCH' })
    })

    it('is not paid when the amount is one satang short', () => {
      expect(decide(verifyBankData({ amount: 0.99 }))).toMatchObject({ result: 'REJECTED', reason: 'AMOUNT_MISMATCH' })
    })

    it('is not paid when EasySlip did not confirm the amount', () => {
      expect(decide(verifyBankData({ isAmountMatched: null }))).toMatchObject({ result: 'REJECTED', reason: 'AMOUNT_MISMATCH' })
    })

    it('converts fractional baht to exact satang', () => {
      const decision = decide(verifyBankData({ amount: 1500.5 }), { order: { ...order, totalSatang: 150050 } })
      expect(decision).toMatchObject({ result: 'PAID', slip: { amountSatang: 150050 } })
    })

    it('is not fooled by floating point rounding', () => {
      const decision = decide(verifyBankData({ amount: 1.15 }), { order: { ...order, totalSatang: 115 } })
      expect(decision).toMatchObject({ result: 'PAID', slip: { amountSatang: 115 } })
    })

    it('keeps the rejected slip for admin review', () => {
      expect(decide(verifyBankData({ amount: 2 }))).toMatchObject({ recordForReview: { amountSatang: 200 } })
    })
  })

  describe('currency and country', () => {
    it('is not paid for a slip from outside Thailand', () => {
      expect(decide(verifyBankData({ countryCode: 'LA' }))).toMatchObject({ result: 'REJECTED', reason: 'CURRENCY_MISMATCH' })
    })

    it('is not paid when the country is missing', () => {
      expect(decide(verifyBankData({ countryCode: null }))).toMatchObject({ result: 'REJECTED', reason: 'CURRENCY_MISMATCH' })
    })

    it('is paid when the currency is the numeric THB code that EasySlip returns', () => {
      expect(decide(verifyBankData({ currency: '764' }))).toMatchObject({ result: 'PAID' })
    })

    it('is paid when the currency is the alphabetic THB code', () => {
      expect(decide(verifyBankData({ currency: 'THB' }))).toMatchObject({ result: 'PAID' })
    })

    it('is not paid for a currency other than THB', () => {
      expect(decide(verifyBankData({ currency: 'USD' }))).toMatchObject({ result: 'REJECTED', reason: 'CURRENCY_MISMATCH' })
      expect(decide(verifyBankData({ currency: '840' }))).toMatchObject({ result: 'REJECTED', reason: 'CURRENCY_MISMATCH' })
    })
  })

  describe('slip date', () => {
    it('is not paid when the slip predates the order', () => {
      expect(decide(verifyBankData({ date: '2026-10-26T09:40:00+07:00' }))).toMatchObject({ result: 'REJECTED', reason: 'SLIP_DATE_OUT_OF_RANGE' })
    })

    it('allows five minutes of clock difference before the order', () => {
      expect(decide(verifyBankData({ date: '2026-10-26T09:51:00+07:00' }))).toMatchObject({ result: 'PAID' })
    })

    it('is not paid when the slip is in the future', () => {
      expect(decide(verifyBankData({ date: '2026-10-26T10:20:00+07:00' }))).toMatchObject({ result: 'REJECTED', reason: 'SLIP_DATE_OUT_OF_RANGE' })
    })

    it('is not paid when the slip is older than the maximum age', () => {
      const oldOrder = { ...order, createdAt: new Date('2026-10-20T00:00:00Z') }
      const decision = decide(verifyBankData({ date: '2026-10-25T02:00:00+07:00' }), { order: oldOrder })
      expect(decision).toMatchObject({ result: 'REJECTED', reason: 'SLIP_DATE_OUT_OF_RANGE' })
    })

    it('is not paid when the date has no timezone', () => {
      expect(decide(verifyBankData({ date: '2026-10-26T10:00:00' }))).toMatchObject({ result: 'REJECTED', reason: 'SLIP_DATE_OUT_OF_RANGE' })
    })

    it('is not paid when the date cannot be parsed', () => {
      expect(decide(verifyBankData({ date: 'yesterday+07:00' }))).toMatchObject({ result: 'REJECTED', reason: 'SLIP_DATE_OUT_OF_RANGE' })
    })
  })

  describe('transRef', () => {
    it('is not paid when transRef is empty', () => {
      expect(decide(verifyBankData({ transRef: '' }))).toEqual({ result: 'RETRY_LATER', reason: 'INVALID_PROVIDER_DATA' })
    })

    it('is not paid when transRef contains unexpected characters', () => {
      expect(decide(verifyBankData({ transRef: '6837016065774\'; DROP' }))).toEqual({ result: 'RETRY_LATER', reason: 'INVALID_PROVIDER_DATA' })
    })
  })

  describe('duplicates', () => {
    it('needs review when EasySlip saw the slip before but we never recorded it', () => {
      expect(decide(verifyBankData({ isDuplicate: true }))).toMatchObject({ result: 'NEEDS_REVIEW', reason: 'DUPLICATE_NOT_RECORDED', lockOrder: true })
    })

    it('reports already paid when the slip paid this same order', () => {
      const decision = decide(verifyBankData({ isDuplicate: true }), { existingSlip: { orderId: order.id, orderStatus: 'PAID' } })
      expect(decision).toEqual({ result: 'ALREADY_PAID' })
    })

    it('rejects a slip that already paid another order', () => {
      const decision = decide(verifyBankData({ isDuplicate: true }), { existingSlip: { orderId: 'order-2', orderStatus: 'PAID' } })
      expect(decision).toEqual({ result: 'REJECTED', reason: 'SLIP_ALREADY_USED', recordForReview: null })
    })

    it('does not record a mismatching slip again when it is already stored', () => {
      const decision = decide(verifyBankData({ amount: 2 }), { existingSlip: { orderId: order.id, orderStatus: 'PENDING_PAYMENT' } })
      expect(decision).toEqual({ result: 'REJECTED', reason: 'AMOUNT_MISMATCH', recordForReview: null })
    })
  })

  describe('provider failures', () => {
    it.each([
      ['SLIP_NOT_FOUND', { result: 'REJECTED', reason: 'SLIP_UNREADABLE', recordForReview: null }],
      ['VALIDATION_ERROR', { result: 'REJECTED', reason: 'INVALID_FILE', recordForReview: null }],
      ['INVALID_IMAGE_FORMAT', { result: 'REJECTED', reason: 'INVALID_FILE', recordForReview: null }],
      ['SLIP_PENDING', { result: 'RETRY_LATER', reason: 'SLIP_PENDING' }],
      ['QUOTA_EXCEEDED', { result: 'RETRY_LATER', reason: 'QUOTA_EXCEEDED' }],
      ['INVALID_API_KEY', { result: 'RETRY_LATER', reason: 'PROVIDER_MISCONFIGURED' }],
      ['IP_NOT_ALLOWED', { result: 'RETRY_LATER', reason: 'PROVIDER_MISCONFIGURED' }],
      ['SOMETHING_NEW', { result: 'RETRY_LATER', reason: 'PROVIDER_MISCONFIGURED' }]
    ])('maps %s without paying', (code, expected) => {
      expect(decideOutcome({ kind: 'PROVIDER_ERROR', code, httpStatus: 400 })).toEqual(expected)
    })

    it('asks to retry when EasySlip is unreachable', () => {
      expect(decideOutcome({ kind: 'RETRY_LATER', cause: 'TIMEOUT' })).toEqual({ result: 'RETRY_LATER', reason: 'PROVIDER_UNAVAILABLE' })
    })

    it('asks to retry when the response shape is wrong', () => {
      expect(decideOutcome({ kind: 'INVALID_RESPONSE', httpStatus: 200 })).toEqual({ result: 'RETRY_LATER', reason: 'INVALID_PROVIDER_DATA' })
    })
  })
})
