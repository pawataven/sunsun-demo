<script setup lang="ts">
const MAX_SLIP_BYTES = 4 * 1024 * 1024
const ALLOWED_SLIP_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const STATUSES_THAT_CHANGE_ORDER = ['PAID', 'NEEDS_REVIEW', 'NOT_ACCEPTING']

interface SlipFeedback {
  status: string
  message: string
}

const route = useRoute()
const accessToken = route.params.accessToken as string

const { data: order, error, refresh } = await useFetch(`/api/orders/${accessToken}`)
if (error.value) {
  throw createError({ statusCode: error.value.statusCode ?? 500, statusMessage: errorMessageOf(error.value), fatal: true })
}

useHead({ title: () => `คำสั่งซื้อ ${order.value?.orderNumber ?? ''} | SunSun Print` })

const statusLabels: Record<string, { label: string, tone: string }> = {
  PENDING_PAYMENT: { label: 'รอชำระเงิน', tone: 'bg-amber-100 text-amber-800' },
  PAYMENT_REVIEW: { label: 'รอตรวจสอบสลิป', tone: 'bg-sky-100 text-sky-800' },
  PAID: { label: 'ชำระเงินแล้ว', tone: 'bg-emerald-100 text-emerald-800' },
  IN_PRODUCTION: { label: 'กำลังผลิต', tone: 'bg-indigo-100 text-indigo-800' },
  READY: { label: 'พร้อมส่ง', tone: 'bg-indigo-100 text-indigo-800' },
  SHIPPED: { label: 'จัดส่งแล้ว', tone: 'bg-emerald-100 text-emerald-800' },
  COMPLETED: { label: 'เสร็จสมบูรณ์', tone: 'bg-emerald-100 text-emerald-800' },
  CANCELLED: { label: 'ยกเลิก', tone: 'bg-stone-200 text-stone-700' }
}

const feedbackTones: Record<string, string> = {
  PAID: 'bg-emerald-50 text-emerald-800',
  NEEDS_REVIEW: 'bg-sky-50 text-sky-800',
  RETRY_LATER: 'bg-amber-50 text-amber-800',
  RATE_LIMITED: 'bg-amber-50 text-amber-800',
  IN_PROGRESS: 'bg-amber-50 text-amber-800'
}

const currentStatus = computed(() => statusLabels[order.value?.status ?? ''] ?? { label: order.value?.status, tone: 'bg-stone-100' })

const { csrfFetch } = useCsrfToken()
const slipFile = ref<File | null>(null)
const isUploading = ref(false)
const slipFeedback = ref<SlipFeedback | null>(null)

const slipFileProblem = computed(() => {
  const file = slipFile.value
  if (!file) return ''
  if (!ALLOWED_SLIP_TYPES.includes(file.type)) return 'กรุณาเลือกรูปสลิปเป็นไฟล์ JPG, PNG หรือ WEBP'
  if (file.size > MAX_SLIP_BYTES) return 'ไฟล์ใหญ่เกินไป กรุณาเลือกรูปขนาดไม่เกิน 4 MB'
  return ''
})

function onSlipSelected(event: Event) {
  slipFile.value = (event.target as HTMLInputElement).files?.[0] ?? null
  slipFeedback.value = null
}

async function readSlipFeedback(response: Response): Promise<SlipFeedback> {
  const body = await response.json().catch(() => null)
  if (typeof body?.status === 'string' && typeof body?.message === 'string') {
    return { status: body.status, message: body.message }
  }
  return { status: 'ERROR', message: 'ส่งสลิปไม่สำเร็จ กรุณาลองใหม่' }
}

async function uploadSlip() {
  if (!slipFile.value || slipFileProblem.value || isUploading.value) return
  isUploading.value = true
  slipFeedback.value = null

  try {
    const formData = new FormData()
    formData.append('slip', slipFile.value)
    const response = await csrfFetch(`/api/orders/${accessToken}/slip`, { method: 'POST', body: formData })
    slipFeedback.value = await readSlipFeedback(response)
    if (STATUSES_THAT_CHANGE_ORDER.includes(slipFeedback.value.status)) {
      await refresh()
    }
  }
  catch {
    slipFeedback.value = { status: 'ERROR', message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่' }
  }
  finally {
    isUploading.value = false
  }
}
</script>

<template>
  <section v-if="order" class="grid gap-8 lg:grid-cols-[1fr_380px]">
    <div class="space-y-6">
      <div>
        <p class="text-sm text-stone-500">คำสั่งซื้อ</p>
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="text-3xl font-bold">{{ order.orderNumber }}</h1>
          <span class="rounded-full px-3 py-1 text-sm font-medium" :class="currentStatus.tone">{{ currentStatus.label }}</span>
        </div>
        <p class="mt-1 text-sm text-stone-500">บันทึกลิงก์หน้านี้ไว้เพื่อกลับมาดูสถานะคำสั่งซื้อ</p>
      </div>

      <div class="rounded-2xl border border-stone-200 bg-white">
        <ul class="divide-y divide-stone-100">
          <li v-for="item in order.items" :key="item.id" class="flex justify-between gap-4 p-4">
            <div>
              <p class="font-semibold">{{ item.productName }}</p>
              <p class="text-sm text-stone-500">
                {{ formatQuantity(item.quantity) }} ชิ้น × {{ formatBaht(item.unitPrice) }}
              </p>
              <p class="text-sm text-stone-500">
                {{ item.selectedOptions.map(option => option.valueLabel).join(' · ') }}
              </p>
            </div>
            <p class="font-semibold">{{ formatBaht(item.lineTotal) }}</p>
          </li>
        </ul>
        <div class="flex justify-between border-t border-stone-200 p-4 text-lg font-bold">
          <span>ยอดชำระ</span>
          <span class="text-amber-600">{{ formatBaht(order.total) }}</span>
        </div>
      </div>

      <div class="rounded-2xl border border-stone-200 bg-white p-4 text-sm">
        <h2 class="mb-2 font-semibold">จัดส่งถึง</h2>
        <p>{{ order.customerName }} · {{ order.customerPhone }}</p>
        <p class="whitespace-pre-line text-stone-600">{{ order.shippingAddress }}</p>
      </div>
    </div>

    <aside class="h-fit space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
      <p
        v-if="slipFeedback"
        role="status"
        class="rounded-lg p-3 text-sm"
        :class="feedbackTones[slipFeedback.status] ?? 'bg-red-50 text-red-700'"
      >
        {{ slipFeedback.message }}
      </p>

      <template v-if="order.status === 'PENDING_PAYMENT'">
        <div>
          <h2 class="text-lg font-semibold">ชำระเงินผ่าน PromptPay</h2>
          <p class="mt-1 text-sm text-stone-500">สแกน QR ด้วยแอปธนาคาร ยอดเงินจะถูกกรอกให้อัตโนมัติ</p>
        </div>

        <img
          v-if="order.promptPayQrDataUrl"
          :src="order.promptPayQrDataUrl"
          :alt="`QR PromptPay ยอด ${formatBaht(order.total)}`"
          class="mx-auto w-64 rounded-lg ring-1 ring-stone-200"
        >
        <p v-else class="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          ยังไม่ได้ตั้งค่าเบอร์ PromptPay ของร้าน (NUXT_PROMPTPAY_ID)
        </p>

        <form class="space-y-3 border-t border-stone-100 pt-4" @submit.prevent="uploadSlip">
          <label class="block text-sm">
            <span class="mb-1 block font-medium">แนบสลิปการโอน</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              required
              :disabled="isUploading"
              class="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-stone-100 file:px-3 file:py-2 file:font-medium hover:file:bg-stone-200"
              @change="onSlipSelected"
            >
          </label>
          <p v-if="slipFileProblem" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ slipFileProblem }}</p>
          <button
            type="submit"
            :disabled="!slipFile || !!slipFileProblem || isUploading"
            class="w-full rounded-xl bg-amber-500 py-3 font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{ isUploading ? 'กำลังตรวจสลิป…' : 'ส่งสลิป' }}
          </button>
          <p class="text-xs text-stone-400">ระบบจะตรวจสลิปกับธนาคารให้อัตโนมัติ อาจใช้เวลาสักครู่</p>
        </form>
      </template>

      <template v-else-if="order.status === 'PAYMENT_REVIEW'">
        <h2 class="text-lg font-semibold">ได้รับสลิปแล้ว</h2>
        <p class="text-sm text-stone-600">ร้านกำลังตรวจสอบการชำระเงิน เมื่อยืนยันแล้วสถานะจะเปลี่ยนเป็น "ชำระเงินแล้ว"</p>
      </template>

      <template v-else>
        <h2 class="text-lg font-semibold">{{ currentStatus.label }}</h2>
        <p class="text-sm text-stone-600">ขอบคุณที่สั่งซื้อกับ SunSun Print</p>
      </template>

      <NuxtLink to="/" class="block text-center text-sm text-stone-500 hover:text-amber-700">เลือกซื้อสินค้าเพิ่ม</NuxtLink>
    </aside>
  </section>
</template>
