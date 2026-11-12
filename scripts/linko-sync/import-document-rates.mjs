// Заказы «Баланс»: the rate Linko booked each foreign-currency client document at.
//
// Linko's order list shows per order the financial account's balance in the base currency (market_internal_balance,
// with ORDER_LIST_ONLY_ACCEPTED_MARKET_BALANCE: its accepted client transactions only). Each transaction counts in
// the base currency at its own rate (client_transactions.internal: amount × its custom rate, else the rate of its
// moment) — a USD order of 2025-02 at 13 000 although the rate history said 12 970. The 11-06 copy kept the amounts
// but not those rates; this keeps them per document and currency in linko_document_rates (src as the client ledger
// names its sources: order, client_return, customer_payment, client_correction). Documents made in the app later
// have no row there and count at the rate history of their moment.
//
//   node scripts/linko-sync/import-document-rates.mjs     (raw: client_transactions; after the finance imports)
import { connect, currencyCode, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("document-rates")
// Linko client transaction type → the ledger's source and the local document id.
const SOURCE = {
  1: (t) => ["customer_payment", t.id],
  3: (t) => ["client_return", t.order_return?.id ?? t.order_return],
  4: (t) => ["order", t.order?.id ?? t.order],
  9: (t) => ["client_correction", t.id],
}
const sums = new Map()
for (const t of raw("client_transactions")) {
  const cur = currencyCode(t.currency)
  if (cur === "SUM" || !SOURCE[t.type]) continue
  const [src, id] = SOURCE[t.type](t)
  const amount = Number(t.amount)
  const internal = Number(t.internal)
  if (!id || !Number.isFinite(amount) || !Number.isFinite(internal) || Math.abs(amount) < 1e-12) continue
  const key = `${src}:${id}:${cur}`
  const sum = sums.get(key) ?? { src, id: Number(id), cur, amount: 0, internal: 0 }
  sum.amount += amount
  sum.internal += internal
  sums.set(key, sum)
}

const client = await connect()
await ensureRegistry(client)
const stats = { insert: 0, update: 0, same: 0, skipped: 0 }
try {
  await client.query("BEGIN")
  await client.query(`CREATE TABLE IF NOT EXISTS linko_document_rates (
    src TEXT NOT NULL,
    src_id INTEGER NOT NULL,
    cur TEXT NOT NULL,
    rate DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (src, src_id, cur)
  )`)
  for (const sum of sums.values()) {
    if (Math.abs(sum.amount) < 1e-12) {
      stats.skipped++
      continue
    }
    const rate = Math.round((sum.internal / sum.amount) * 1e9) / 1e9
    const key = `${sum.src}:${sum.id}:${sum.cur}`
    const previous = (await client.query("SELECT rate FROM linko_document_rates WHERE src = $1 AND src_id = $2 AND cur = $3", [sum.src, sum.id, sum.cur])).rows[0]
    if (previous && Math.abs(Number(previous.rate) - rate) < 1e-9) {
      stats.same++
      continue
    }
    await client.query(
      `INSERT INTO linko_document_rates (src, src_id, cur, rate) VALUES ($1, $2, $3, $4)
       ON CONFLICT (src, src_id, cur) DO UPDATE SET rate = EXCLUDED.rate`,
      [sum.src, sum.id, sum.cur, rate],
    )
    await register(client, run, "linko_document_rates", key, previous ? "update" : "insert", previous ? { rate: Number(previous.rate) } : null)
    stats[previous ? "update" : "insert"]++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(`document rates: ${stats.insert} new, ${stats.update} changed, ${stats.same} unchanged, ${stats.skipped} without an amount`)
