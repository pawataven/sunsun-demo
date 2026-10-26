<script setup lang="ts">
const route = useRoute()
const slug = route.params.slug as string

const { data: product, error } = await useFetch(`/api/products/${slug}`)
if (error.value) {
  throw createError({ statusCode: error.value.statusCode ?? 500, statusMessage: errorMessageOf(error.value), fatal: true })
}

useHead({ title: () => product.value ? `${product.value.name} | SunSun Print` : 'SunSun Print' })

const quantity = ref(product.value?.defaultQuantity ?? 1)
const selections = ref<Record<string, string>>({ ...product.value?.defaultSelections })

const debouncedQuantity = ref(quantity.value)
let quantityDebounceTimer: ReturnType<typeof setTimeout> | undefined
watch(quantity, (newQuantity) => {
  clearTimeout(quantityDebounceTimer)
  quantityDebounceTimer = setTimeout(() => {
    debouncedQuantity.value = newQuantity
  }, 300)
})

const priceQuery = computed(() => ({ quantity: debouncedQuantity.value, ...selections.value }))
const { data: price, error: priceError, status: priceStatus } = await useFetch(`/api/products/${slug}/price`, {
  query: priceQuery
})

const { addItem } = useCart()
const justAdded = ref(false)

function selectedOptionLabels() {
  return price.value?.selectedOptions.map(option => `${option.optionName}: ${option.valueLabel}`) ?? []
}

function addToCart() {
  if (!product.value || !price.value) return
  addItem({
    slug,
    productName: product.value.name,
    quantity: price.value.quantity,
    selections: { ...selections.value },
    selectedOptionLabels: selectedOptionLabels(),
    lineTotal: String(price.value.lineTotal)
  })
  justAdded.value = true
}

watch([quantity, selections], () => {
  justAdded.value = false
}, { deep: true })

function tierLabel(tier: { minQuantity: number | null, maxQuantity: number | null }) {
  if (tier.minQuantity !== null && tier.maxQuantity !== null) {
    return `${formatQuantity(tier.minQuantity)} – ${formatQuantity(tier.maxQuantity)}`
  }
  if (tier.minQuantity !== null) return `${formatQuantity(tier.minQuantity)} ขึ้นไป`
  return 'ทุกจำนวน'
}
</script>

<template>
  <div v-if="product">
    <NuxtLink to="/" class="text-sm text-stone-500 hover:text-amber-700">← กลับไปหน้าสินค้า</NuxtLink>

    <div class="mt-4 grid gap-8 lg:grid-cols-2">
      <div class="space-y-6">
        <ProductCover :slug="product.slug" :name="product.name" class="rounded-2xl" />

        <div v-if="product.quantityTiers.length > 0" class="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 class="font-semibold">ราคาตามจำนวน (ตัวเลือกพื้นฐาน)</h2>
          <table class="mt-3 w-full text-sm">
            <thead class="text-left text-stone-500">
              <tr>
                <th class="py-1 font-normal">จำนวน</th>
                <th class="py-1 text-right font-normal">ราคา / ชิ้น</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tier in product.quantityTiers" :key="`${tier.minQuantity}`" class="border-t border-stone-100">
                <td class="py-2">{{ tierLabel(tier) }}</td>
                <td class="py-2 text-right font-medium">{{ formatBaht(tier.unitPrice) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h1 class="text-3xl font-bold">{{ product.name }}</h1>
        <p class="mt-2 text-stone-600">{{ product.description }}</p>

        <form class="mt-6 space-y-6" @submit.prevent="addToCart">
          <fieldset v-for="option in product.options" :key="option.code">
            <legend class="mb-2 font-medium">
              {{ option.name }}
              <span v-if="option.isRequired" class="text-amber-600">*</span>
            </legend>
            <div class="flex flex-wrap gap-2">
              <label
                v-for="value in option.values"
                :key="value.code"
                class="cursor-pointer rounded-lg border px-4 py-2 text-sm transition has-focus-visible:ring-2 has-focus-visible:ring-amber-400"
                :class="selections[option.code] === value.code
                  ? 'border-amber-500 bg-amber-50 text-amber-800'
                  : 'border-stone-200 bg-white hover:border-stone-400'"
              >
                <input v-model="selections[option.code]" type="radio" :name="option.code" :value="value.code" class="sr-only">
                {{ value.label }}
              </label>
            </div>
          </fieldset>

          <div>
            <label for="quantity" class="mb-2 block font-medium">จำนวน (ชิ้น)</label>
            <input
              id="quantity"
              v-model.number="quantity"
              type="number"
              :min="product.defaultQuantity"
              step="1"
              class="w-40 rounded-lg border border-stone-300 bg-white px-3 py-2 focus:border-amber-500 focus:outline-none"
            >
          </div>

          <div class="rounded-2xl bg-white p-5 ring-1 ring-stone-200">
            <p v-if="priceError" class="text-sm text-red-600">{{ errorMessageOf(priceError) }}</p>
            <template v-else-if="price">
              <div class="flex items-baseline justify-between">
                <span class="text-stone-500">ราคารวม</span>
                <span class="text-3xl font-bold text-amber-600" :class="{ 'opacity-50': priceStatus === 'pending' }">
                  {{ formatBaht(price.lineTotal) }}
                </span>
              </div>
              <p class="mt-1 text-right text-sm text-stone-500">
                เฉลี่ย {{ formatBaht(price.unitPrice) }} / ชิ้น
              </p>
            </template>

            <button
              type="submit"
              :disabled="!price || !!priceError || priceStatus === 'pending'"
              class="mt-4 w-full rounded-xl bg-amber-500 py-3 font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ใส่ตะกร้า
            </button>

            <p v-if="justAdded" class="mt-3 text-center text-sm text-emerald-700">
              เพิ่มลงตะกร้าแล้ว ·
              <NuxtLink to="/cart" class="font-medium underline">ไปที่ตะกร้า</NuxtLink>
            </p>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
