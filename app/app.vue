<script setup lang="ts">
const { totalItems } = useCart()
</script>

<template>
  <div class="flex min-h-screen flex-col bg-stone-50 text-stone-800">
    <NuxtRouteAnnouncer />

    <header class="sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <NuxtLink to="/" class="flex items-center gap-2 text-lg font-bold">
          <span class="grid size-8 place-items-center rounded-full bg-amber-400 text-white">☀</span>
          SunSun Print
        </NuxtLink>

        <NuxtLink
          to="/cart"
          class="relative rounded-full border border-stone-200 px-4 py-2 text-sm font-medium hover:border-amber-400 hover:text-amber-700"
        >
          ตะกร้าสินค้า
          <ClientOnly>
            <span
              v-if="totalItems > 0"
              class="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-amber-500 text-xs text-white"
            >
              {{ totalItems }}
            </span>
          </ClientOnly>
        </NuxtLink>
      </div>
    </header>

    <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <NuxtPage />
    </main>

    <footer class="border-t border-stone-200 py-6 text-center text-sm text-stone-500">
      ร้านค้าจำลองสำหรับทดสอบระบบ ไม่มีการเก็บเงินจริง
    </footer>
  </div>
</template>
