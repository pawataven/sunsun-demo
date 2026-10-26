const bahtFormatter = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 2
})

export function formatBaht(amount: string | number) {
  return bahtFormatter.format(Number(amount))
}

export function formatQuantity(quantity: number) {
  return quantity.toLocaleString('th-TH')
}

export function errorMessageOf(error: unknown, fallback = 'เกิดข้อผิดพลาด กรุณาลองใหม่') {
  const data = (error as { data?: { statusMessage?: string } })?.data
  return data?.statusMessage ?? fallback
}
