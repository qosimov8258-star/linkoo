// Переоценка: the products of every repricing (Linko's main/reprice/{id}/ "products"; the list the first copy read
// has none, so every document showed «Товары нет»). Each product becomes a line of repricings.items as the app
// stores it (lib/repricings-read.ts StoredLine): the quantity, the old price and its currency, the new price. The
// old price's factor into the document currency (oldRate) is the one Linko's own «Сумма до» used
// (total_old_price / (old_price × amount)), so the lines and the document totals equal Linko's. total / total_old /
// total_new follow the lines.
//
//   node scripts/linko-sync/import-reprice-items.mjs
import { connect, currencyCode, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("reprice-items")
const details = raw("reprices_detail")
const stats = { documents: 0, lines: 0, skipped: [], missing: [] }
const round = (value, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits

const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  const units = new Map((await client.query("SELECT id, COALESCE(unit, '') AS unit FROM products")).rows.map((row) => [Number(row.id), row.unit]))
  for (const [id, detail] of Object.entries(details)) {
    if (!detail || !Array.isArray(detail.products)) {
      stats.skipped.push(id)
      continue
    }
    const current = (await client.query("SELECT id, items, total, total_old, total_new FROM repricings WHERE id = $1", [Number(id)])).rows[0]
    if (!current) {
      stats.missing.push(id)
      continue
    }
    const docCurrency = currencyCode(detail.currency)
    let totalOld = 0
    let totalNew = 0
    const lines = detail.products
      .filter((line) => line?.product?.id)
      .map((line) => {
        const productId = Number(line.product.id)
        const amount = Number(line.amount) || 0
        const price = Number(line.price) || 0
        const oldPrice = line.old_price === null || line.old_price === undefined ? null : Number(line.old_price)
        const oldCurrency = currencyCode(line.old_currency ?? detail.currency)
        const lineOld = Number(line.total_old_price) || 0
        const lineNew = Number(line.total_price) || 0
        totalOld += lineOld
        totalNew += lineNew
        // Linko's «Сумма до» = old price × amount in the document currency: the factor it applied.
        const base = (oldPrice ?? 0) * amount
        const oldRate = oldCurrency === docCurrency ? 1 : base !== 0 ? round(lineOld / base, 9) : undefined
        const name = String(line.product.name ?? "").trim()
        return {
          kind: "product",
          id: productId,
          key: `product:${productId}`,
          name,
          product: name,
          unit: units.get(productId) ?? "",
          amount,
          oldPrice,
          oldCurrency,
          ...(oldRate === undefined ? {} : { oldRate }),
          price,
        }
      })
    const items = JSON.stringify(lines)
    const next = { items, total: round(totalNew - totalOld, 2), total_old: round(totalOld, 2), total_new: round(totalNew, 2) }
    if (current.items === next.items && Number(current.total) === next.total && Number(current.total_old) === next.total_old && Number(current.total_new) === next.total_new) continue
    await client.query("UPDATE repricings SET items = $1, total = $2, total_old = $3, total_new = $4 WHERE id = $5", [next.items, next.total, next.total_old, next.total_new, Number(id)])
    await register(client, run, "repricings", Number(id), "update", { items: current.items, total: current.total, total_old: current.total_old, total_new: current.total_new })
    stats.documents++
    stats.lines += lines.length
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(
  `reprice items: ${stats.documents} repricings got ${stats.lines} lines; Linko gave no detail for ${stats.skipped.join(",") || "none"}; not here: ${stats.missing.join(",") || "none"}`,
)
