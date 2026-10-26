import { z } from 'zod'
import { satangToBahtString } from './money'
import type { SlipImageType } from './slip-file'

export const EASYSLIP_BASE_URL = 'https://api.easyslip.com/v2'
const REQUEST_TIMEOUT_MS = 15_000

const FILE_EXTENSION_BY_TYPE: Record<SlipImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}

const partySchema = z.object({
  bank: z.object({
    id: z.string().nullish(),
    name: z.string().nullish(),
    short: z.string().nullish()
  }).nullish(),
  account: z.object({
    name: z.object({ th: z.string().nullish(), en: z.string().nullish() }).nullish(),
    bank: z.object({ type: z.string(), account: z.string() }).nullish(),
    proxy: z.object({ type: z.string(), account: z.string() }).nullish()
  })
})

const verifyBankDataSchema = z.object({
  remark: z.string().nullish(),
  isDuplicate: z.boolean(),
  matchedAccount: z.object({
    bank: z.object({
      nameTh: z.string().nullish(),
      nameEn: z.string().nullish(),
      code: z.string().nullish(),
      shortCode: z.string().nullish()
    }).nullish(),
    nameTh: z.string().nullish(),
    nameEn: z.string().nullish(),
    type: z.string().nullish(),
    bankNumber: z.string()
  }).nullish(),
  amountInOrder: z.number().nullish(),
  amountInSlip: z.number().nullish(),
  isAmountMatched: z.boolean().nullish(),
  rawSlip: z.object({
    payload: z.string().nullish(),
    transRef: z.string(),
    date: z.string(),
    countryCode: z.string().nullish(),
    amount: z.object({
      amount: z.number(),
      local: z.object({ amount: z.number().nullish(), currency: z.string().nullish() }).nullish()
    }),
    fee: z.number().nullish(),
    ref1: z.string().nullish(),
    ref2: z.string().nullish(),
    ref3: z.string().nullish(),
    sender: partySchema,
    receiver: partySchema.extend({ merchantId: z.string().nullish() })
  })
})

const successResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().nullish(),
  data: verifyBankDataSchema
})

const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({ code: z.string(), message: z.string().nullish() })
})

export type VerifyBankData = z.infer<typeof verifyBankDataSchema>
export type SlipParty = VerifyBankData['rawSlip']['receiver']

export type VerifyBankOutcome =
  | { kind: 'SUCCESS', data: VerifyBankData, retried: boolean }
  | { kind: 'PROVIDER_ERROR', code: string, httpStatus: number }
  | { kind: 'RETRY_LATER', cause: 'TIMEOUT' | 'NETWORK_ERROR' | 'SERVER_ERROR' }
  | { kind: 'INVALID_RESPONSE', httpStatus: number }

export interface VerifyBankRequest {
  image: Uint8Array<ArrayBuffer>
  mimeType: SlipImageType
  remark: string
  expectedAmountSatang: number
}

export interface EasySlipClient {
  verifyBank(request: VerifyBankRequest): Promise<VerifyBankOutcome>
}

export interface EasySlipClientOptions {
  apiKey: string
  fetch: typeof fetch
  timeoutMs?: number
}

interface AttemptResult {
  outcome: VerifyBankOutcome
  retryable: boolean
}

function isTimeoutError(error: unknown) {
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : undefined
  return name === 'TimeoutError' || name === 'AbortError'
}

function buildForm(request: VerifyBankRequest) {
  const form = new FormData()
  form.append('image', new Blob([request.image], { type: request.mimeType }), `slip.${FILE_EXTENSION_BY_TYPE[request.mimeType]}`)
  form.append('remark', request.remark)
  form.append('matchAccount', 'true')
  form.append('matchAmount', satangToBahtString(request.expectedAmountSatang))
  form.append('checkDuplicate', 'true')
  return form
}

export function createEasySlipClient(options: EasySlipClientOptions): EasySlipClient {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS

  async function attempt(request: VerifyBankRequest): Promise<AttemptResult> {
    let response: Response
    try {
      response = await options.fetch(`${EASYSLIP_BASE_URL}/verify/bank`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.apiKey}`, Accept: 'application/json' },
        body: buildForm(request),
        signal: AbortSignal.timeout(timeoutMs)
      })
    }
    catch (error) {
      return { retryable: true, outcome: { kind: 'RETRY_LATER', cause: isTimeoutError(error) ? 'TIMEOUT' : 'NETWORK_ERROR' } }
    }

    if (response.status >= 500) {
      return { retryable: true, outcome: { kind: 'RETRY_LATER', cause: 'SERVER_ERROR' } }
    }

    let body: unknown
    try {
      body = await response.json()
    }
    catch (error) {
      if (isTimeoutError(error)) {
        return { retryable: true, outcome: { kind: 'RETRY_LATER', cause: 'TIMEOUT' } }
      }
      return { retryable: false, outcome: { kind: 'INVALID_RESPONSE', httpStatus: response.status } }
    }

    if (response.ok) {
      const success = successResponseSchema.safeParse(body)
      if (success.success) {
        return { retryable: false, outcome: { kind: 'SUCCESS', data: success.data.data, retried: false } }
      }
    }

    const failure = errorResponseSchema.safeParse(body)
    if (failure.success) {
      return { retryable: false, outcome: { kind: 'PROVIDER_ERROR', code: failure.data.error.code, httpStatus: response.status } }
    }
    return { retryable: false, outcome: { kind: 'INVALID_RESPONSE', httpStatus: response.status } }
  }

  return {
    async verifyBank(request) {
      const first = await attempt(request)
      if (!first.retryable) return first.outcome

      const second = await attempt(request)
      return second.outcome.kind === 'SUCCESS' ? { ...second.outcome, retried: true } : second.outcome
    }
  }
}
