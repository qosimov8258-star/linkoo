// Продажи → Возвраты: every client return of the Linko account (accepted, pending and cancelled) with its products,
// into client_returns / client_return_items (the tables the returns page, the stock ledger and the client ledger read).
// An accepted return adds its goods to its warehouse; the client is credited what Linko credited (client_credit).
// The card keeps what Linko's return card shows: the price list, the return's own branch, its payment type and
// financial account (left column), and per line Linko's order line id, the bonus flag and the promotion.
//
//   node scripts/linko-sync/import-returns.mjs                (raw files: order_returns, order_returns_detail, order_products)
//   node scripts/linko-sync/import-returns.mjs --card-fields  (only those card facts of the returns already copied:
//                                                              statuses, amounts and lines stay as they are here)
//   … --dry-run                                               (either mode: prints the counts, keeps nothing)
import { bumpSequence, connect, currencyCode, ensureRegistry, fullName, raw, register, runId, sqlDateTime, upsertById, utcIso } from "./lib.mjs"

const STATUS = { 0: "pending", 1: "pending", 2: "accepted", 3: "cancelled" }
const CARD_ONLY = process.argv.includes("--card-fields")

const list = raw("order_returns")
const details = raw("order_returns_detail")
// Linko's client ledger: what it credited per return and currency (client transactions of type 3), also for returns
// still pending. A return can credit in two currencies (a line priced in another one).
const credits = new Map()
const creditPayment = new Map()
for (const t of CARD_ONLY ? [] : raw("client_transactions")) {
  if (t.type !== 3 || !t.order_return) continue
  const id = t.order_return?.id ?? t.order_return
  if (t.payment_type === "bank" || t.payment_type === "cash") creditPayment.set(id, t.payment_type)
  const byCurrency = credits.get(id) ?? new Map()
  const code = currencyCode(t.currency)
  byCurrency.set(code, (byCurrency.get(code) ?? 0) + Number(t.amount))
  credits.set(id, byCurrency)
}
const round9 = (value) => Math.round(value * 1e9) / 1e9
/** The credit in the return's own currency, and the credits in other currencies ({"USD": 0.0091}) or null. */
function creditOf(id, currency) {
  const byCurrency = credits.get(id) ?? new Map()
  const other = Object.fromEntries([...byCurrency].filter(([code, amount]) => code !== currency && Math.abs(amount) > 1e-9).map(([code, amount]) => [code, round9(amount)]))
  return { main: round9(byCurrency.get(currency) ?? 0), other: Object.keys(other).length ? JSON.stringify(other) : null }
}

/** The left column of Linko's return card: price list, the return's own branch ('' = none), its custom payment type's
 * name (with the local payment_type it is shown for, so an edit to another payment type drops it) and its financial
 * account (with the shop it was written for, so an edit to another shop drops it). */
function cardFields(row, detail, paymentType) {
  const payment = detail.custom_payment_type ?? row.custom_payment_type
  const account = detail.client ?? row.client
  // The return's own payment type (Linko's list icon, payment filters and the 1C «Оплата наличными») when it differs
  // from the ledger's (payment_type here): kept as `own` beside the same key.
  const ownType = row.payment_type ?? detail.payment_type
  const own = (ownType === "cash" || ownType === "bank") && ownType !== (paymentType ?? "") ? ownType : null
  return {
    price_list: detail.price_list?.name ?? "",
    linko_branch: detail.branch?.name ?? "",
    linko_payment_type: payment?.name || own ? JSON.stringify({ name: payment?.name ?? "", key: paymentType ?? "", ...(own ? { own } : {}) }) : "",
    linko_account: account?.id ? JSON.stringify({ id: account.id, name: account.name ?? "", market: row.market?.id ?? account.id }) : "",
  }
}
/** A line's Linko facts: its order line id («Заказ: N от … (id)»), the bonus flag and the promotion name. */
const lineFields = (p) => ({ linko_order_product_id: p.order_product ?? null, is_bonus: p.is_bonus === true ? 1 : 0, promotion: p.promotion?.name ?? "" })
const sameLineFields = (a, b) => (a.linko_order_product_id ?? null) === (b.linko_order_product_id ?? null) && Number(a.is_bonus ?? -1) === b.is_bonus && (a.promotion ?? "") === b.promotion

const run = runId(CARD_ONLY ? "returns-card" : "returns")

const client = await connect()
await ensureRegistry(client)
const stats = { insert: 0, update: 0, same: 0, items: 0, lineFacts: 0, skipped: [] }
try {
  await client.query("BEGIN")
  await client.query("ALTER TABLE client_returns ADD COLUMN IF NOT EXISTS client_credit DOUBLE PRECISION, ADD COLUMN IF NOT EXISTS client_credit_other TEXT, ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT ''")
  // The card columns (the same as lib/client-returns-repo.ts adds).
  await client.query(
    "ALTER TABLE client_returns ADD COLUMN IF NOT EXISTS price_list TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS linko_branch TEXT, ADD COLUMN IF NOT EXISTS linko_payment_type TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS linko_account TEXT NOT NULL DEFAULT ''",
  )
  await client.query("ALTER TABLE client_return_items ADD COLUMN IF NOT EXISTS linko_order_product_id INTEGER, ADD COLUMN IF NOT EXISTS is_bonus INTEGER, ADD COLUMN IF NOT EXISTS promotion TEXT NOT NULL DEFAULT ''")
  // Local order line of a returned line: Linko's order line matched the way import-orders.mjs copied it (same order,
  // same product, same quantity first, in Linko's line order), else the first local line of (order, product).
  const lines = (await client.query("SELECT id, order_id, product_id, quantity FROM order_items ORDER BY id")).rows
  const lineOf = new Map()
  const localByOrder = new Map()
  for (const line of lines) {
    const key = `${line.order_id}:${line.product_id}`
    if (!lineOf.has(key)) lineOf.set(key, line.id)
    if (!localByOrder.has(line.order_id)) localByOrder.set(line.order_id, [])
    localByOrder.get(line.order_id).push(line)
  }
  const linkoLineOf = new Map()
  if (!CARD_ONLY) {
    const linkoByOrder = new Map()
    for (const line of raw("order_products")) {
      if (!linkoByOrder.has(line.order_id)) linkoByOrder.set(line.order_id, [])
      linkoByOrder.get(line.order_id).push(line)
    }
    for (const [orderId, want] of linkoByOrder) {
      const have = localByOrder.get(orderId) ?? []
      const used = new Set()
      for (const line of want.sort((a, b) => a.id - b.id)) {
        const qty = Number(line.amount)
        const match = have.find((h) => !used.has(h.id) && h.product_id === line.product_id && Math.abs(h.quantity - qty) < 1e-6) ?? have.find((h) => !used.has(h.id) && h.product_id === line.product_id)
        if (!match) continue
        used.add(match.id)
        linkoLineOf.set(line.id, match.id)
      }
    }
  }
  for (const row of list) {
    const detail = details[row.id]
    if (!detail || detail.__status) throw new Error(`return ${row.id}: detail missing (${detail?.__status})`)
    const products = detail.returned_products ?? []

    if (CARD_ONLY) {
      // Only returns copied before; their own fields and lines stay.
      const local = (await client.query("SELECT payment_type FROM client_returns WHERE id = $1", [row.id])).rows[0]
      if (!local) {
        stats.skipped.push(row.id)
        continue
      }
      stats[await upsertById(client, run, "client_returns", row.id, cardFields(row, detail, local.payment_type))]++
      const have = (await client.query("SELECT id, product_id, quantity, linko_order_product_id, is_bonus, promotion FROM client_return_items WHERE return_id = $1 ORDER BY id", [row.id])).rows
      const matches = have.length === products.length && have.every((h, i) => h.product_id === (products[i].product?.id ?? null) && Math.abs(Number(h.quantity) - Number(products[i].amount)) < 1e-9)
      if (!matches) {
        stats.skipped.push(`${row.id} (lines differ)`)
        continue
      }
      for (const [i, h] of have.entries()) {
        const facts = lineFields(products[i])
        if (sameLineFields(h, facts)) continue
        await client.query("UPDATE client_return_items SET linko_order_product_id = $2, is_bonus = $3, promotion = $4 WHERE id = $1", [h.id, facts.linko_order_product_id, facts.is_bonus, facts.promotion])
        await register(client, run, "client_return_items", h.id, "update", { linko_order_product_id: h.linko_order_product_id, is_bonus: h.is_bonus, promotion: h.promotion })
        stats.lineFacts++
      }
      continue
    }

    const status = STATUS[Number(row.status)] ?? "pending"
    const created = sqlDateTime(row.created_date)
    const acceptedAt = status === "accepted" ? utcIso(row.accepted_time ?? detail.accepted_time ?? row.created_date) : null
    const credit = creditOf(row.id, currencyCode(row.currency))
    const paymentType = creditPayment.get(row.id) ?? ""
    const values = {
      client_id: row.market?.id ?? row.client?.id ?? null,
      client: row.market?.name ?? row.client?.name ?? "",
      warehouse: row.stock?.name ?? detail.stock?.name ?? "",
      order_id: detail.order ?? null,
      return_date: created,
      status,
      currency: currencyCode(row.currency),
      amount: Number(row.total_price) || 0,
      comment: row.comment ?? detail.comment ?? "",
      created_by: fullName(row.created_by),
      created_at: created,
      accepted_at: acceptedAt,
      accepted_by: status === "accepted" ? fullName(row.accepted_by ?? detail.accepted_by) || fullName(row.created_by) : "",
      deliverer: fullName(row.delivery_man ?? detail.delivery_man),
      agent: fullName(row.responsible_agent ?? detail.responsible_agent),
      organization: row.division?.name ?? detail.division_name ?? "",
      cancelled_at: status === "cancelled" ? created : null,
      cancelled_by: status === "cancelled" ? fullName(row.created_by) : "",
      client_credit: credit.main,
      client_credit_other: credit.other,
      payment_type: paymentType,
      ...cardFields(row, detail, paymentType),
    }
    stats[await upsertById(client, run, "client_returns", row.id, values)]++

    // Lines: replaced as a whole (they have no id of their own here); only Linko's line facts changed → kept, updated.
    const wanted = products.map((p) => ({
      product_id: p.product?.id ?? null,
      product_name: p.product?.name ?? "",
      unit: p.product?.measurement?.name ?? "",
      quantity: Number(p.amount) || 0,
      price: Number(p.price) || 0,
      order_item_id: linkoLineOf.get(p.order_product) ?? lineOf.get(`${p.order ?? detail.order}:${p.product?.id}`) ?? null,
      ...lineFields(p),
    }))
    const have = (await client.query("SELECT id, product_id, product_name, unit, quantity, price, order_item_id, linko_order_product_id, is_bonus, promotion FROM client_return_items WHERE return_id = $1 ORDER BY id", [row.id])).rows
    const same = have.length === wanted.length && have.every((h, i) => h.product_id === wanted[i].product_id && Math.abs(h.quantity - wanted[i].quantity) < 1e-9 && Math.abs(h.price - wanted[i].price) < 1e-9 && h.product_name === wanted[i].product_name && h.unit === wanted[i].unit && h.order_item_id === wanted[i].order_item_id)
    if (!same) {
      await client.query("DELETE FROM client_return_items WHERE return_id = $1", [row.id])
      for (const item of wanted) {
        await client.query(
          "INSERT INTO client_return_items (return_id, product_id, product_name, unit, quantity, price, order_item_id, linko_order_product_id, is_bonus, promotion) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
          [row.id, item.product_id, item.product_name, item.unit, item.quantity, item.price, item.order_item_id, item.linko_order_product_id, item.is_bonus, item.promotion],
        )
        stats.items++
      }
      await register(client, run, "client_return_items", `return:${row.id}`, "replace", have)
    } else {
      for (const [i, h] of have.entries()) {
        if (sameLineFields(h, wanted[i])) continue
        await client.query("UPDATE client_return_items SET linko_order_product_id = $2, is_bonus = $3, promotion = $4 WHERE id = $1", [h.id, wanted[i].linko_order_product_id, wanted[i].is_bonus, wanted[i].promotion])
        await register(client, run, "client_return_items", h.id, "update", { linko_order_product_id: h.linko_order_product_id, is_bonus: h.is_bonus, promotion: h.promotion })
        stats.lineFacts++
      }
    }
  }
  // Returns that are not in Linko (none expected): reported, not deleted.
  const ids = list.map((row) => row.id)
  const extra = (await client.query("SELECT id FROM client_returns WHERE NOT (id = ANY($1::int[]))", [ids])).rows.map((r) => r.id)
  if (!CARD_ONLY) await bumpSequence(client, "client_returns")
  // --dry-run: the same counts, nothing kept.
  await client.query(process.argv.includes("--dry-run") ? "ROLLBACK" : "COMMIT")
  console.log(
    `returns${CARD_ONLY ? " (card fields)" : ""}: ${list.length} in Linko; inserted ${stats.insert}, updated ${stats.update}, unchanged ${stats.same}; lines written ${stats.items}, line facts updated ${stats.lineFacts}` +
      `${stats.skipped.length ? `; skipped ${stats.skipped.join(",")}` : ""}${extra.length ? `; local-only returns kept: ${extra.join(",")}` : ""}`,
  )
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
