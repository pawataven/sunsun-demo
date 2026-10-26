import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@csrf-armor/nuxt', '@nuxt/eslint', '@nuxt/fonts', '@nuxt/image', '@dargmuesli/nuxt-cookie-control', '@nuxt/icon/module'],
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  app: {
    head: {
      htmlAttrs: { lang: 'th' },
      title: 'SunSun Print'
    }
  },
  css: ['~/assets/css/main.css'],
  runtimeConfig: {
    promptpayId: '',
    easyslipApiKey: '',
    easyslipDailyCap: 200,
    paymentReceiverBankNumber: '',
    paymentSlipMaxAgeHours: 24
  },
  csrfArmor: {
    secret: process.env.CSRF_SECRET,
    cookie: { secure: process.env.NODE_ENV === 'production' }
  },
  vite: {
    plugins: [tailwindcss()]
  }
})
