export interface CartItem {
  id: string
  slug: string
  productName: string
  quantity: number
  selections: Record<string, string>
  selectedOptionLabels: string[]
  lineTotal: string
}

const CART_STORAGE_KEY = 'sunsun-cart'

function readStoredCart(): CartItem[] {
  try {
    return JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? '[]')
  }
  catch {
    return []
  }
}

function storeCart(items: CartItem[]) {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items))
  }
  catch {
    // Private browsing can block storage; the cart still works for this visit.
  }
}

export function useCart() {
  const items = useState<CartItem[]>('cart-items', () => [])
  const isLoaded = useState('cart-loaded', () => false)

  if (import.meta.client && !isLoaded.value) {
    items.value = readStoredCart()
    isLoaded.value = true
    watch(items, storeCart, { deep: true })
  }

  const totalItems = computed(() => items.value.length)
  const subtotal = computed(() => items.value.reduce((sum, item) => sum + Number(item.lineTotal), 0))

  function addItem(item: Omit<CartItem, 'id'>) {
    items.value.push({ ...item, id: crypto.randomUUID() })
  }

  function removeItem(id: string) {
    items.value = items.value.filter(item => item.id !== id)
  }

  function clear() {
    items.value = []
  }

  return { items, totalItems, subtotal, addItem, removeItem, clear }
}
