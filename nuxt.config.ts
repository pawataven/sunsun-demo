import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@csrf-armor/nuxt', '@nuxt/eslint', '@nuxt/fonts', '@nuxt/image', '@dargmuesli/nuxt-cookie-control', '@nuxt/icon/module'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()]
  }
})
