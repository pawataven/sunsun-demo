import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../server/generated/prisma/client'
import type { PriceRuleType } from '../server/generated/prisma/client'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

// Every product sells for this many baht per piece with no minimum, so real PromptPay
// transfers can be tried cheaply. Set to null to seed the catalogue prices below instead.
const TEST_UNIT_PRICE_BAHT: number | null = 1

interface SeedOptionValue {
  code: string
  label: string
  unitPriceAdd?: number
}

interface SeedProduct {
  slug: string
  name: string
  description: string
  options: { code: string, name: string, values: SeedOptionValue[] }[]
  rules: { name: string, type: PriceRuleType, amount: number, minQuantity?: number, maxQuantity?: number, priority?: number }[]
}

const seedProducts: SeedProduct[] = [
  {
    slug: 'business-cards',
    name: 'นามบัตร',
    description: 'นามบัตรขนาดมาตรฐาน 9 x 5.5 ซม. พิมพ์ระบบดิจิทัล สีคมชัด',
    options: [
      {
        code: 'paper', name: 'กระดาษ', values: [
          { code: 'art-card-260', label: 'อาร์ตการ์ด 260 แกรม' },
          { code: 'art-card-310', label: 'อาร์ตการ์ด 310 แกรม', unitPriceAdd: 0.5 }
        ]
      },
      {
        code: 'sides', name: 'จำนวนหน้าพิมพ์', values: [
          { code: 'single', label: 'พิมพ์หน้าเดียว' },
          { code: 'double', label: 'พิมพ์สองหน้า', unitPriceAdd: 0.8 }
        ]
      },
      {
        code: 'coating', name: 'เคลือบ', values: [
          { code: 'none', label: 'ไม่เคลือบ' },
          { code: 'matte', label: 'เคลือบด้าน', unitPriceAdd: 0.6 },
          { code: 'gloss', label: 'เคลือบเงา', unitPriceAdd: 0.6 }
        ]
      }
    ],
    rules: [
      { name: '100–299 ใบ', type: 'UNIT_PRICE', amount: 2.5, minQuantity: 100, maxQuantity: 299 },
      { name: '300–999 ใบ', type: 'UNIT_PRICE', amount: 1.8, minQuantity: 300, maxQuantity: 999 },
      { name: '1,000 ใบขึ้นไป', type: 'UNIT_PRICE', amount: 1.2, minQuantity: 1000 },
      { name: 'ส่วนลด 5% เมื่อสั่ง 2,000 ใบขึ้นไป', type: 'PERCENT_ADJUST', amount: -5, minQuantity: 2000 },
      { name: 'ราคาขั้นต่ำ', type: 'MINIMUM_CHARGE', amount: 250 }
    ]
  },
  {
    slug: 'die-cut-stickers',
    name: 'สติ๊กเกอร์ไดคัท',
    description: 'สติ๊กเกอร์ไดคัทตามรูปทรง เหมาะกับฉลากสินค้าและแพ็กเกจจิ้ง',
    options: [
      {
        code: 'material', name: 'เนื้อสติ๊กเกอร์', values: [
          { code: 'pp-white', label: 'PP ขาวด้าน' },
          { code: 'pp-clear', label: 'PP ใส', unitPriceAdd: 0.5 },
          { code: 'pvc-waterproof', label: 'PVC กันน้ำ', unitPriceAdd: 1 }
        ]
      },
      {
        code: 'size', name: 'ขนาด', values: [
          { code: '5x5', label: '5 x 5 ซม.' },
          { code: '7x7', label: '7 x 7 ซม.', unitPriceAdd: 1.5 },
          { code: '10x10', label: '10 x 10 ซม.', unitPriceAdd: 3.5 }
        ]
      }
    ],
    rules: [
      { name: '50–199 ดวง', type: 'UNIT_PRICE', amount: 6, minQuantity: 50, maxQuantity: 199 },
      { name: '200–499 ดวง', type: 'UNIT_PRICE', amount: 4.5, minQuantity: 200, maxQuantity: 499 },
      { name: '500 ดวงขึ้นไป', type: 'UNIT_PRICE', amount: 3.2, minQuantity: 500 },
      { name: 'ค่าบล็อกไดคัท', type: 'FLAT_FEE', amount: 100 },
      { name: 'ราคาขั้นต่ำ', type: 'MINIMUM_CHARGE', amount: 300 }
    ]
  },
  {
    slug: 'flyers-a5',
    name: 'ใบปลิว A5',
    description: 'ใบปลิวขนาด A5 (14.8 x 21 ซม.) สำหรับโปรโมชันและแจกงานอีเวนต์',
    options: [
      {
        code: 'paper', name: 'กระดาษ', values: [
          { code: 'art-105', label: 'อาร์ตมัน 105 แกรม' },
          { code: 'art-160', label: 'อาร์ตมัน 160 แกรม', unitPriceAdd: 0.6 }
        ]
      },
      {
        code: 'sides', name: 'จำนวนหน้าพิมพ์', values: [
          { code: 'single', label: 'พิมพ์หน้าเดียว' },
          { code: 'double', label: 'พิมพ์สองหน้า', unitPriceAdd: 0.9 }
        ]
      }
    ],
    rules: [
      { name: '100–499 แผ่น', type: 'UNIT_PRICE', amount: 3.5, minQuantity: 100, maxQuantity: 499 },
      { name: '500–1,999 แผ่น', type: 'UNIT_PRICE', amount: 2.2, minQuantity: 500, maxQuantity: 1999 },
      { name: '2,000 แผ่นขึ้นไป', type: 'UNIT_PRICE', amount: 1.4, minQuantity: 2000 },
      { name: 'ราคาขั้นต่ำ', type: 'MINIMUM_CHARGE', amount: 350 }
    ]
  },
  {
    slug: 'vinyl-banners',
    name: 'ป้ายไวนิล',
    description: 'ป้ายไวนิลหมึก Eco-solvent ทนแดดทนฝน ใช้ได้ทั้งในและนอกอาคาร',
    options: [
      {
        code: 'size', name: 'ขนาด', values: [
          { code: '60x120', label: '60 x 120 ซม.', unitPriceAdd: 290 },
          { code: '100x200', label: '100 x 200 ซม.', unitPriceAdd: 650 },
          { code: '120x240', label: '120 x 240 ซม.', unitPriceAdd: 950 }
        ]
      },
      {
        code: 'finishing', name: 'งานตกแต่ง', values: [
          { code: 'trim', label: 'ตัดขอบเรียบ' },
          { code: 'eyelets', label: 'เจาะตาไก่รอบป้าย', unitPriceAdd: 50 }
        ]
      }
    ],
    rules: [
      { name: 'ส่วนลด 10% เมื่อสั่ง 5 ผืนขึ้นไป', type: 'PERCENT_ADJUST', amount: -10, minQuantity: 5 }
    ]
  }
]

async function seedProduct(seed: SeedProduct, sortOrder: number) {
  await prisma.product.deleteMany({ where: { slug: seed.slug } })

  const rules: SeedProduct['rules'] = TEST_UNIT_PRICE_BAHT === null
    ? seed.rules
    : [{ name: 'ราคาทดสอบ', type: 'UNIT_PRICE', amount: TEST_UNIT_PRICE_BAHT }]

  const product = await prisma.product.create({
    data: {
      slug: seed.slug,
      name: seed.name,
      description: seed.description,
      sortOrder,
      options: {
        create: seed.options.map((option, optionIndex) => ({
          code: option.code,
          name: option.name,
          sortOrder: optionIndex,
          values: {
            create: option.values.map((value, valueIndex) => ({ code: value.code, label: value.label, sortOrder: valueIndex }))
          }
        }))
      },
      priceRules: {
        create: rules.map(rule => ({ ...rule, priority: rule.priority ?? 0 }))
      }
    },
    include: { options: { include: { values: true } } }
  })

  if (TEST_UNIT_PRICE_BAHT !== null) return

  const optionValueRules = seed.options.flatMap(option => option.values
    .filter(value => value.unitPriceAdd)
    .map((value) => {
      const createdValue = product.options
        .find(createdOption => createdOption.code === option.code)!.values
        .find(createdOptionValue => createdOptionValue.code === value.code)!
      return {
        productId: product.id,
        optionValueId: createdValue.id,
        name: `${option.name}: ${value.label}`,
        type: 'UNIT_PRICE' as const,
        amount: value.unitPriceAdd!
      }
    }))

  await prisma.priceRule.createMany({ data: optionValueRules })
}

for (const [index, seed] of seedProducts.entries()) {
  await seedProduct(seed, index)
}

console.log(TEST_UNIT_PRICE_BAHT === null
  ? `Seeded ${seedProducts.length} products with catalogue prices`
  : `Seeded ${seedProducts.length} products at test price ${TEST_UNIT_PRICE_BAHT} baht/piece`)
await prisma.$disconnect()
