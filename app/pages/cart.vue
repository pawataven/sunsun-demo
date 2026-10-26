<script setup lang="ts">
useHead({ title: 'ตะกร้าสินค้า | SunSun Print' })

const { items, subtotal, removeItem, clear } = useCart()
const { csrfFetch } = useCsrfToken()

const customer = reactive({
  name: '',
  phone: '',
  email: '',
  shippingAddress: ''
})
const isSubmitting = ref(false)
const submitError = ref('')

async function placeOrder() {
  isSubmitting.value = true
  submitError.value = ''

  try {
    const response = await csrfFetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer,
        items: items.value.map(item => ({ slug: item.slug, quantity: item.quantity, selections: item.selections }))
      })
    })
    const result = await response.json()
    if (!response.ok) {
      submitError.value = result.statusMessage ?? 'สร้างคำสั่งซื้อไม่สำเร็จ'
      return
    }

    clear()
    await navigateTo(`/orders/${result.accessToken}`)
  }
  catch {
    submitError.value = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่'
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <section>
    <h1 class="mb-6 text-3xl font-bold">ตะกร้าสินค้า</h1>

    <ClientOnly>
      <div v-if="items.length === 0" class="rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center">
        <p class="text-stone-500">ยังไม่มีสินค้าในตะกร้า</p>
        <NuxtLink to="/" class="mt-4 inline-block rounded-xl bg-amber-500 px-5 py-2 font-medium text-white hover:bg-amber-600">
          เลือกซื้อสินค้า
        </NuxtLink>
      </div>

      <div v-else class="grid gap-8 lg:grid-cols-[1fr_380px]">
        <ul class="space-y-4">
          <li v-for="item in items" :key="item.id" class="flex gap-4 rounded-2xl border border-stone-200 bg-white p-4">
            <ProductCover :slug="item.slug" :name="''" class="w-24 shrink-0 rounded-lg" />
            <div class="flex-1">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <h2 class="font-semibold">{{ item.productName }}</h2>
                  <p class="text-sm text-stone-500">จำนวน {{ formatQuantity(item.quantity) }} ชิ้น</p>
                </div>
                <p class="font-semibold">{{ formatBaht(item.lineTotal) }}</p>
              </div>
              <ul class="mt-2 text-sm text-stone-500">
                <li v-for="label in item.selectedOptionLabels" :key="label">{{ label }}</li>
              </ul>
              <button type="button" class="mt-2 text-sm text-red-600 hover:underline" @click="removeItem(item.id)">
                ลบออก
              </button>
            </div>
          </li>
        </ul>

        <form class="h-fit space-y-4 rounded-2xl border border-stone-200 bg-white p-5" @submit.prevent="placeOrder">
          <h2 class="text-lg font-semibold">ข้อมูลผู้สั่งซื้อ</h2>

          <label class="block text-sm">
            <span class="mb-1 block font-medium">ชื่อ-นามสกุล *</span>
            <input v-model="customer.name" required autocomplete="name" class="w-full rounded-lg border border-stone-300 px-3 py-2 focus:border-amber-500 focus:outline-none">
          </label>
          <label class="block text-sm">
            <span class="mb-1 block font-medium">เบอร์โทร *</span>
            <input v-model="customer.phone" required type="tel" autocomplete="tel" class="w-full rounded-lg border border-stone-300 px-3 py-2 focus:border-amber-500 focus:outline-none">
          </label>
          <label class="block text-sm">
            <span class="mb-1 block font-medium">อีเมล</span>
            <input v-model="customer.email" type="email" autocomplete="email" class="w-full rounded-lg border border-stone-300 px-3 py-2 focus:border-amber-500 focus:outline-none">
          </label>
          <label class="block text-sm">
            <span class="mb-1 block font-medium">ที่อยู่จัดส่ง *</span>
            <textarea v-model="customer.shippingAddress" required rows="3" autocomplete="street-address" class="w-full rounded-lg border border-stone-300 px-3 py-2 focus:border-amber-500 focus:outline-none" />
          </label>

          <div class="flex items-baseline justify-between border-t border-stone-100 pt-4">
            <span class="text-stone-500">ยอดรวม</span>
            <span class="text-2xl font-bold text-amber-600">{{ formatBaht(subtotal) }}</span>
          </div>
          <p class="text-xs text-stone-400">ระบบจะคำนวณราคาอีกครั้งตอนยืนยันคำสั่งซื้อ</p>

          <p v-if="submitError" class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{{ submitError }}</p>

          <button
            type="submit"
            :disabled="isSubmitting"
            class="w-full rounded-xl bg-amber-500 py-3 font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            {{ isSubmitting ? 'กำลังสร้างคำสั่งซื้อ…' : 'ยืนยันคำสั่งซื้อ' }}
          </button>
        </form>
      </div>

      <template #fallback>
        <p class="text-stone-500">กำลังโหลดตะกร้า…</p>
      </template>
    </ClientOnly>
  </section>
</template>
