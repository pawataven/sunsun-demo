import type { VerifyBankData } from '../../server/services/easyslip'
import type { MultipartPart } from '../../server/services/slip-file'

export const TEST_API_KEY = 'test-easyslip-key-must-never-leak'
export const RECEIVER_BANK_NUMBER = '1234567890'
export const RECEIVER_PROMPTPAY_ID = '0992930186'
export const SENDER_NAME = 'นาย ผู้โอน ทดสอบ'
export const SENDER_ACCOUNT = 'xxx-x-x9876-x'
export const DEFAULT_TRANS_REF = '68370160657749I376388B35'

export const PNG_BYTES = new Uint8Array(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
))

type Account = { type: string, account: string } | null

export interface SlipOverrides {
  transRef?: string
  amount?: number
  date?: string
  countryCode?: string | null
  currency?: string | null
  isAmountMatched?: boolean | null
  isDuplicate?: boolean
  matchedBankNumber?: string | null
  receiverProxy?: Account
  receiverBankAccount?: Account
}

function pick<T>(overrides: SlipOverrides, key: keyof SlipOverrides, fallback: T): T {
  return key in overrides ? overrides[key] as T : fallback
}

export function bangkokIso(date: Date) {
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, '+07:00')
}

export function verifyBankData(overrides: SlipOverrides = {}): VerifyBankData {
  const amount = overrides.amount ?? 1
  const matchedBankNumber = pick<string | null>(overrides, 'matchedBankNumber', '123-4-56789-0')

  return {
    remark: 'SS261026-TEST01',
    isDuplicate: overrides.isDuplicate ?? false,
    matchedAccount: matchedBankNumber === null
      ? null
      : {
          bank: { nameTh: 'กสิกรไทย', nameEn: 'KASIKORNBANK', code: '004', shortCode: 'KBANK' },
          nameTh: 'นาย ร้าน ซันซัน',
          nameEn: 'MR SHOP SUNSUN',
          type: 'PERSONAL',
          bankNumber: matchedBankNumber
        },
    amountInOrder: amount,
    amountInSlip: amount,
    isAmountMatched: pick<boolean | null>(overrides, 'isAmountMatched', true),
    rawSlip: {
      payload: '004100060000010103004022001234567890123456789',
      transRef: overrides.transRef ?? DEFAULT_TRANS_REF,
      date: overrides.date ?? '2026-10-26T10:00:00+07:00',
      countryCode: pick<string | null>(overrides, 'countryCode', 'TH'),
      amount: { amount, local: { amount, currency: pick<string | null>(overrides, 'currency', '764') } },
      fee: 0,
      ref1: '',
      ref2: '',
      ref3: '',
      sender: {
        bank: { id: '014', name: 'ไทยพาณิชย์', short: 'SCB' },
        account: { name: { th: SENDER_NAME }, bank: { type: 'BANKAC', account: SENDER_ACCOUNT } }
      },
      receiver: {
        bank: { id: '004', name: 'กสิกรไทย', short: 'KBANK' },
        account: {
          name: { th: 'นาย ร้าน ซันซัน' },
          bank: pick<Account>(overrides, 'receiverBankAccount', { type: 'BANKAC', account: 'xxx-x-x6789-x' }),
          proxy: pick<Account>(overrides, 'receiverProxy', { type: 'MSISDN', account: 'xxx-xxx-0186' })
        },
        merchantId: null
      }
    }
  }
}

export function successBody(data: VerifyBankData = verifyBankData()) {
  return { success: true, message: 'Bank slip verified successfully', data }
}

export function errorBody(code: string, message = 'error') {
  return { success: false, error: { code, message } }
}

export function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

type FakeReply = Response | Error | ((init: RequestInit | undefined) => Promise<Response>)

export interface RecordedCall {
  url: string
  init: RequestInit | undefined
}

export function fakeFetch(...replies: FakeReply[]) {
  const calls: RecordedCall[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const reply = replies.shift()
    if (!reply) throw new Error('Unexpected EasySlip call')
    if (reply instanceof Error) throw reply
    if (typeof reply === 'function') return reply(init)
    return reply
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

export function hangUntilAborted(init: RequestInit | undefined) {
  return new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
  })
}

export function slipPart(overrides: Partial<MultipartPart> = {}): MultipartPart {
  return { name: 'slip', filename: 'slip.png', type: 'image/png', data: PNG_BYTES, ...overrides }
}
