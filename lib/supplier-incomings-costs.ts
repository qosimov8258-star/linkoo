import "server-only"

import { getDb } from "@/lib/db"
import { supplyCostLines } from "@/components/analytics/supplier-incomings-data"
import { costsFromLedger, loadCostLedger } from "@/lib/stock/costs"
import { loadStockCatalog } from "@/lib/stock/catalog"
import { currencyRates } from "@/lib/supplier-refs"
import { getIncoming } from "@/lib/supplier-incomings-repo"

/** One line of the supply card's «Себестоимость» tab (Linko's stock/supply_product/with_net_cost/), base currency. */
export type SupplyCostRow = {
  product: string
  /** The line's catalog key («product:12», «raw_material:3»; "" when it matches no live item). */
  key: string
  /** Linko's product.code (shown under the name), when the product has one. */
  code: string
  qty: number
  /** «Закупочная цена»: the unit price of the line. */
  purchasePrice: number
  /** «Доп. расход»: the unit price with the line's share of the additional costs. */
  withExpense: number
  /** «Себестоимость»: what one unit came in at on the stock (0 while the supply is not accepted). */
  netCost: number
  /** «Остаток в складе»: the stock the supply was blended with (before it came in; 0 while not accepted). */
  balance: number
  /** «Усред. Себ.»: the average cost after the supply came in (0 while not accepted). */
  avgNetCost: number
}

const round6 = (value: number) => {
  const rounded = Math.round((Number(value) || 0) * 1e6) / 1e6
  return Object.is(rounded, -0) ? 0 : rounded
}

/** The «Себестоимость» lines of a supply: the purchase and expense columns from the supply itself, the received cost,
 * the stock it was blended with and the resulting average from the cost ledger (lib/stock/costs.ts). null = no such
 * supply. */
export async function supplyCostRows(id: number): Promise<SupplyCostRow[] | null> {
  const incoming = await getIncoming(id)
  if (!incoming) return null
  const db = getDb()
  const [rates, catalog] = await Promise.all([currencyRates(db), loadStockCatalog(db)])
  const rate = incoming.rateToBase ?? rates.rateOf(incoming.currency) ?? 1
  const byName = new Map<string, string>()
  for (const item of catalog) if (!byName.has(item.name.trim().toLowerCase())) byName.set(item.name.trim().toLowerCase(), item.key)
  const codes = (await db.prepare("SELECT id, COALESCE(integration_code, '') AS code FROM products").all()) as Array<{ id: number; code: string }>
  const codeOf = new Map(codes.map((row) => [`product:${row.id}`, String(row.code ?? "").trim()]))
  const accepted = incoming.status === "принят"
  const ledger = accepted ? await loadCostLedger(db) : null
  const lines = supplyCostLines(incoming)
  return incoming.items.map((item, index) => {
    const line = lines[index]
    const key = item.key || byName.get(item.product.trim().toLowerCase()) || ""
    let netCost = 0
    let balance = 0
    let avgNetCost = 0
    const postings = ledger && key ? (ledger.postings.get(key) ?? []) : []
    const mine = (posting: (typeof postings)[number]) => posting.docType === "supplier_incomings" && posting.docId === id
    const first = postings.findIndex(mine)
    if (first >= 0) {
      // The supply's own movement (its revaluations carry no quantity), the stock before its first posting and the
      // moving average right after its last one (cumulative value / quantity, as the ledger blends them).
      const own = postings.filter((posting) => mine(posting) && posting.kind === "supply")
      const qty = own.reduce((sum, posting) => sum + posting.qty, 0)
      const value = own.reduce((sum, posting) => sum + posting.value, 0)
      netCost = qty ? value / qty : 0
      balance = postings.slice(0, first).reduce((sum, posting) => sum + posting.qty, 0)
      let last = first
      postings.forEach((posting, index) => {
        if (mine(posting)) last = index
      })
      const upTo = postings.slice(0, last + 1)
      const totalQty = upTo.reduce((sum, posting) => sum + posting.qty, 0)
      const totalValue = upTo.reduce((sum, posting) => sum + posting.value, 0)
      avgNetCost = totalQty > 0 ? totalValue / totalQty : (costsFromLedger(ledger!, postings[last].day).get(key) ?? 0)
    }
    return {
      product: item.product,
      key,
      code: codeOf.get(key) ?? "",
      qty: item.qty,
      purchasePrice: round6(item.cost * rate),
      withExpense: round6((accepted && netCost ? netCost : line.unitCost * rate)),
      netCost: round6(netCost),
      balance: round6(balance),
      avgNetCost: round6(avgNetCost),
    }
  })
}
