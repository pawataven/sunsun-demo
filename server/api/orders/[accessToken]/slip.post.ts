import { createEasySlipClient } from '../../../services/easyslip'
import { readPaymentConfig } from '../../../services/payment-config'
import { parseContentLength } from '../../../services/slip-file'
import { submitSlip } from '../../../services/slip-submission'

export default defineEventHandler(async (event) => {
  const config = readPaymentConfig(useRuntimeConfig(event))
  const { httpStatus, body } = await submitSlip(
    {
      prisma,
      easySlip: createEasySlipClient({ apiKey: config.easyslipApiKey, fetch: globalThis.fetch }),
      config
    },
    {
      accessToken: getRouterParam(event, 'accessToken') ?? '',
      contentLength: parseContentLength(getRequestHeader(event, 'content-length')),
      readParts: () => readMultipartFormData(event)
    }
  )

  setResponseStatus(event, httpStatus)
  return body
})
