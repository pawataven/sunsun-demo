export interface PaymentConfig {
  easyslipApiKey: string
  easyslipDailyCap: number
  receiverBankNumber: string
  receiverPromptPayId: string
  slipMaxAgeHours: number
}

function digitsOnly(value: unknown) {
  return String(value ?? '').replace(/\D/g, '')
}

// Nuxt parses env overrides with destr, so numeric-looking values may arrive as numbers.
export function readPaymentConfig(runtimeConfig: Record<string, unknown>): PaymentConfig {
  return {
    easyslipApiKey: String(runtimeConfig.easyslipApiKey ?? '').trim(),
    easyslipDailyCap: Number(runtimeConfig.easyslipDailyCap),
    receiverBankNumber: digitsOnly(runtimeConfig.paymentReceiverBankNumber),
    receiverPromptPayId: digitsOnly(runtimeConfig.promptpayId),
    slipMaxAgeHours: Number(runtimeConfig.paymentSlipMaxAgeHours)
  }
}

export function paymentConfigProblems(config: PaymentConfig): string[] {
  const problems: string[] = []
  if (!config.easyslipApiKey) {
    problems.push('NUXT_EASYSLIP_API_KEY is not set')
  }
  if (!/^\d{10,15}$/.test(config.receiverBankNumber)) {
    problems.push('NUXT_PAYMENT_RECEIVER_BANK_NUMBER must be 10-15 digits')
  }
  if (!/^(\d{10}|\d{13}|\d{15})$/.test(config.receiverPromptPayId)) {
    problems.push('NUXT_PROMPTPAY_ID must be a 10-digit phone, 13-digit national ID or 15-digit e-wallet ID')
  }
  if (!Number.isInteger(config.easyslipDailyCap) || config.easyslipDailyCap < 1) {
    problems.push('NUXT_EASYSLIP_DAILY_CAP must be a positive integer')
  }
  if (!Number.isFinite(config.slipMaxAgeHours) || config.slipMaxAgeHours <= 0) {
    problems.push('NUXT_PAYMENT_SLIP_MAX_AGE_HOURS must be a positive number')
  }
  return problems
}
