import { paymentConfigProblems, readPaymentConfig } from '../services/payment-config'

export default defineNitroPlugin(() => {
  const problems = paymentConfigProblems(readPaymentConfig(useRuntimeConfig()))
  if (problems.length === 0) return

  if (import.meta.dev || import.meta.prerender) {
    console.warn(`[payment] Slip verification is unavailable until configured: ${problems.join('; ')}`)
    return
  }
  // Refusing to start beats running a shop whose payments can never be verified.
  throw new Error(`Payment configuration is incomplete: ${problems.join('; ')}`)
})
