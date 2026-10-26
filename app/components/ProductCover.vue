<script setup lang="ts">
const props = defineProps<{
  slug: string
  name: string
}>()

const gradientBySlug: Record<string, string> = {
  'business-cards': 'from-amber-300 to-orange-400',
  'die-cut-stickers': 'from-rose-300 to-pink-500',
  'flyers-a5': 'from-sky-300 to-indigo-400',
  'vinyl-banners': 'from-emerald-300 to-teal-500'
}

const gradient = computed(() => gradientBySlug[props.slug] ?? 'from-stone-300 to-stone-500')
</script>

<template>
  <div class="grid aspect-4/3 place-items-center bg-linear-to-br text-2xl font-bold text-white drop-shadow-sm" :class="gradient">
    {{ name }}
  </div>
</template>
