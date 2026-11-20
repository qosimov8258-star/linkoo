import "server-only"

import { getDb, outsideTransaction } from "@/lib/db"
import { todayIso } from "@/lib/finance/dates"
import { ensureOrdersSchema } from "@/lib/orders-repo"
import { listRecords } from "@/lib/ref-records-repo"

// The order card's promotions, as Linko shows them.
// - «Задействованные акции»: orders.promotions keeps the promotions Linko applied to an order (its order.promotions:
//   [{id, name, type}], Linko's order), copied by scripts/linko-sync/import-order-promotions.mjs. Mezon has no
//   promotion engine of its own, so the orders it creates keep '[]' («Для этого заказа нет акций»). The name and the
//   type come from the promotion itself (Маркетинговые акции, ref_records kind 'promo') while it exists.
// - «Ручная скидка»: Linko offers the active promotions of type discount whose discount kind is manual
//   (market/promotion/get_active?order=&type=discount&discount_type=manual).

export type OrderPromotion = { id: number; name: string; type: string }
export type ManualDiscountPromotion = { id: number; name: string; discount: number; products: Array<{ productId: number; percent: number }> }

/** Linko's promotion type keys → the labels its tab prints (the same labels Маркетинговые акции stores). */
const TYPE_LABELS: Record<string, string> = { bonus: "Бонус", discount: "Скидка", addup: "Надбавка", ball: "Балл", cash_back: "Кэшбэк" }

const DDL = `ALTER TABLE orders ADD COLUMN IF NOT EXISTS promotions TEXT NOT NULL DEFAULT '[]';`

declare global {
  var __linkoOrderPromotionsSchema: Promise<void> | undefined
}

/** Created once per process on the maintenance pool, never inside a request's transaction. */
function ensureSchema(): Promise<void> {
  if (!globalThis.__linkoOrderPromotionsSchema) {
    globalThis.__linkoOrderPromotionsSchema = ensureOrdersSchema()
      .then(() => outsideTransaction(() => getDb().exec(DDL)))
      .catch((error: unknown) => {
        globalThis.__linkoOrderPromotionsSchema = undefined
        throw error
      })
  }
  return globalThis.__linkoOrderPromotionsSchema
}

const text = (value: unknown) => (typeof value === "string" ? value : value == null ? "" : String(value))

/** The promotions applied to the order in Linko's order; null when the order does not exist. */
export async function listOrderPromotions(orderId: number): Promise<OrderPromotion[] | null> {
  await ensureSchema()
  const row = (await getDb().prepare("SELECT promotions FROM orders WHERE id = ?").get(orderId)) as { promotions: string | null } | undefined
  if (!row) return null
  let stored: unknown
  try {
    stored = JSON.parse(row.promotions || "[]")
  } catch {
    stored = []
  }
  const entries = (Array.isArray(stored) ? stored : []).flatMap((entry) => {
    const value = entry as { id?: unknown; name?: unknown; type?: unknown } | null
    const id = Number(value?.id)
    return Number.isSafeInteger(id) && id > 0 ? [{ id, name: text(value?.name), type: text(value?.type) }] : []
  })
  if (!entries.length) return []
  const records = new Map((await listRecords("promo")).map((record) => [record.id, record.data]))
  return entries.map((entry) => {
    const data = records.get(String(entry.id))
    return {
      id: entry.id,
      name: text(data?.name) || entry.name,
      type: text(data?.type) || TYPE_LABELS[entry.type.toLowerCase()] || "",
    }
  })
}

/** The promotions «Ручная скидка» may apply today: type discount, manual discount kind, running today. */
export async function listManualDiscountPromotions(): Promise<ManualDiscountPromotion[]> {
  const today = todayIso()
  return (await listRecords("promo")).flatMap((record) => {
    const ref = (record.data.ref ?? null) as Record<string, unknown> | null
    const id = Number(record.id)
    if (!ref || !Number.isSafeInteger(id) || ref.type !== "discount" || ref.discount_type !== "manual") return []
    const begin = text(ref.begin_date).slice(0, 10)
    const till = text(ref.till_date).slice(0, 10)
    if (!begin || !till || begin > today || today > till) return []
    const products = (Array.isArray(ref.products) ? ref.products : []).flatMap((entry) => {
      const value = entry as { product?: { id?: unknown }; amount?: unknown } | null
      const productId = Number(value?.product?.id)
      const percent = Number(value?.amount)
      return Number.isSafeInteger(productId) && percent >= 0 && percent <= 100 ? [{ productId, percent }] : []
    })
    const discount = Number(ref.discount)
    return [{ id, name: text(record.data.name) || text(ref.name), discount: discount >= 0 && discount <= 100 ? discount : 0, products }]
  })
}
