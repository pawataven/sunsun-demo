<script setup lang="ts">
const { data: products, error } = await useFetch('/api/products')
</script>

<template>
  <section>
    <div class="mb-8">
      <h1 class="text-3xl font-bold">สินค้าทั้งหมด</h1>
      <p class="mt-2 text-stone-500">เลือกสินค้า กำหนดสเปก แล้วดูราคาได้ทันที</p>
    </div>

    <p v-if="error" class="rounded-lg bg-red-50 p-4 text-red-700">
      โหลดรายการสินค้าไม่สำเร็จ กรุณาตรวจสอบว่าเปิดฐานข้อมูลแล้ว
    </p>

    <div v-else class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      <NuxtLink
        v-for="product in products"
        :key="product.slug"
        :to="`/products/${product.slug}`"
        class="group overflow-hidden rounded-2xl border border-stone-200 bg-white transition hover:-translate-y-0.5 hover:shadow-lg"
      >
        <ProductCover :slug="product.slug" :name="product.name" />
        <div class="p-4">
          <h2 class="font-semibold group-hover:text-amber-700">{{ product.name }}</h2>
          <p class="mt-1 line-clamp-2 text-sm text-stone-500">{{ product.description }}</p>
          <p class="mt-3 text-sm">
            เริ่มต้น
            <span class="text-lg font-bold text-amber-600">{{ formatBaht(product.startingUnitPrice) }}</span>
            / ชิ้น
          </p>
          <p class="text-xs text-stone-400">ขั้นต่ำ {{ formatQuantity(product.startingQuantity) }} ชิ้น</p>
        </div>
      </NuxtLink>
    </div>
  </section>
</template>
