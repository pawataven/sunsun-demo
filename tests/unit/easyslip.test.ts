import { describe, expect, it } from 'vitest'
import { createEasySlipClient } from '../../server/services/easyslip'
import type { VerifyBankRequest } from '../../server/services/easyslip'
import {
  errorBody,
  fakeFetch,
  hangUntilAborted,
  jsonResponse,
  PNG_BYTES,
  successBody,
  TEST_API_KEY
} from '../fixtures/easyslip'

const request: VerifyBankRequest = {
  image: PNG_BYTES,
  mimeType: 'image/png',
  remark: 'SS261026-TEST01',
  expectedAmountSatang: 150050
}

function client(fetch: typeof globalThis.fetch) {
  return createEasySlipClient({ apiKey: TEST_API_KEY, fetch, timeoutMs: 20 })
}

describe('EasySlip client', () => {
  it('sends the slip with the bearer key and the expected form fields', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse(200, successBody()))
    const outcome = await client(fetch).verifyBank(request)

    expect(outcome).toMatchObject({ kind: 'SUCCESS', retried: false })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.easyslip.com/v2/verify/bank')

    const headers = new Headers(calls[0]!.init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${TEST_API_KEY}`)
    expect(headers.has('content-type')).toBe(false)

    const form = calls[0]!.init?.body as FormData
    expect(form.get('remark')).toBe('SS261026-TEST01')
    expect(form.get('matchAccount')).toBe('true')
    expect(form.get('checkDuplicate')).toBe('true')
    expect((form.get('image') as File).type).toBe('image/png')
    expect(form.has('payload')).toBe(false)
    expect(form.has('url')).toBe(false)
  })

  it.each([
    [150050, '1500.50'],
    [100, '1.00'],
    [1, '0.01']
  ])('sends %i satang as %s baht', async (satang, baht) => {
    const { fetch, calls } = fakeFetch(jsonResponse(200, successBody()))
    await client(fetch).verifyBank({ ...request, expectedAmountSatang: satang })
    expect((calls[0]!.init?.body as FormData).get('matchAmount')).toBe(baht)
  })

  it('retries once on a 5xx and reports a retry when it fails again', async () => {
    const { fetch, calls } = fakeFetch(
      jsonResponse(500, errorBody('API_SERVER_ERROR')),
      jsonResponse(502, { message: 'bad gateway' })
    )
    expect(await client(fetch).verifyBank(request)).toEqual({ kind: 'RETRY_LATER', cause: 'SERVER_ERROR' })
    expect(calls).toHaveLength(2)
  })

  it('uses the retry result when the second call succeeds', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse(503, {}), jsonResponse(200, successBody()))
    expect(await client(fetch).verifyBank(request)).toMatchObject({ kind: 'SUCCESS', retried: true })
    expect(calls).toHaveLength(2)
  })

  it('does not retry a 4xx', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse(404, errorBody('SLIP_NOT_FOUND')))
    expect(await client(fetch).verifyBank(request)).toEqual({ kind: 'PROVIDER_ERROR', code: 'SLIP_NOT_FOUND', httpStatus: 404 })
    expect(calls).toHaveLength(1)
  })

  it('reports a retry after timing out twice', async () => {
    const { fetch, calls } = fakeFetch(hangUntilAborted, hangUntilAborted)
    expect(await client(fetch).verifyBank(request)).toEqual({ kind: 'RETRY_LATER', cause: 'TIMEOUT' })
    expect(calls).toHaveLength(2)
  })

  it('reports a retry after network errors', async () => {
    const { fetch } = fakeFetch(new TypeError('fetch failed'), new TypeError('fetch failed'))
    expect(await client(fetch).verifyBank(request)).toEqual({ kind: 'RETRY_LATER', cause: 'NETWORK_ERROR' })
  })

  it('fails safely when a success response has the wrong shape', async () => {
    const { fetch, calls } = fakeFetch(jsonResponse(200, { success: true, data: { isDuplicate: 'no' } }))
    expect(await client(fetch).verifyBank(request)).toEqual({ kind: 'INVALID_RESPONSE', httpStatus: 200 })
    expect(calls).toHaveLength(1)
  })

  it('fails safely when the body is not JSON', async () => {
    const { fetch } = fakeFetch(new Response('<html>oops</html>', { status: 200 }))
    expect(await client(fetch).verifyBank(request)).toEqual({ kind: 'INVALID_RESPONSE', httpStatus: 200 })
  })

  it('fails safely when an error response has the wrong shape', async () => {
    const { fetch } = fakeFetch(jsonResponse(401, { message: 'unauthorized' }))
    expect(await client(fetch).verifyBank(request)).toEqual({ kind: 'INVALID_RESPONSE', httpStatus: 401 })
  })

  it('never puts the API key in what it returns', async () => {
    const leakyError = new TypeError(`connect failed with Bearer ${TEST_API_KEY}`)
    const { fetch } = fakeFetch(
      jsonResponse(401, errorBody('INVALID_API_KEY', `Key ${TEST_API_KEY} is invalid`)),
      leakyError,
      leakyError
    )
    const easySlip = client(fetch)

    const outcomes = [await easySlip.verifyBank(request), await easySlip.verifyBank(request)]
    expect(JSON.stringify(outcomes)).not.toContain(TEST_API_KEY)
  })
})
