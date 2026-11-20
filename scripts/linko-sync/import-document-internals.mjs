// Заказы «Баланс» to the last decimal: what each foreign-currency client document of Linko counts in the base
// currency (client_transactions.internal), as Linko stored it.
//
// Linko's market_internal_balance is the numeric sum of the account's client_transactions.internal. linko_document_rates
// (import-document-rates.mjs) keeps the rate as internal / amount to 9 decimals, so amount × that rate can miss
// Linko's figure in the fifth decimal of a large balance (-1 234 567 890,12345 instead of ,12346); a payment Linko
// took in SUM and booked in USD (amount = internal / rate) misses it more. This keeps Linko's own sums per document
// and currency in linko_document_internals: lib/finance/internal-balance.ts counts `internal` while the document's
// amount is still Linko's `amount`, and amount × rate once the document changed in the app.
//
//   node scripts/linko-sync/import-document-internals.mjs     (raw: client_transactions; after the finance imports)
import { connect, currencyCode, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("document-internals")
const SCALE = 9
const ZERO = BigInt(0)
const UNIT = BigInt(`1${"0".repeat(SCALE)}`)

/** "-4477.499960145" → its units of 10^-9 (Linko's numeric columns keep 9 decimals). null for a text that is not one. */
function units(text) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(text ?? "").trim())
  if (!match) return null
  const [, sign, whole, fraction = ""] = match
  if (fraction.length > SCALE && /[^0]/.test(fraction.slice(SCALE))) return null
  const value = BigInt(whole) * UNIT + BigInt(fraction.slice(0, SCALE).padEnd(SCALE, "0"))
  return sign ? -value : value
}

/** Units of 10^-9 → "-4477.499960145". */
function text(value) {
  const negative = value < ZERO
  const digits = (negative ? -value : value).toString().padStart(SCALE + 1, "0")
  return `${negative ? "-" : ""}${digits.slice(0, -SCALE)}.${digits.slice(-SCALE)}`
}

// Linko client transaction type → the ledger's source and the local document id (as import-document-rates.mjs).
const SOURCE = {
  1: (t) => ["customer_payment", t.id],
  3: (t) => ["client_return", t.order_return?.id ?? t.order_return],
  4: (t) => ["order", t.order?.id ?? t.order],
  9: (t) => ["client_correction", t.id],
}
const sums = new Map()
let unreadable = 0
for (const t of raw("client_transactions")) {
  const cur = currencyCode(t.currency)
  if (cur === "SUM" || !SOURCE[t.type]) continue
  const [src, id] = SOURCE[t.type](t)
  const amount = units(t.amount)
  const internal = units(t.internal)
  if (!id || amount === null || internal === null) {
    unreadable++
    continue
  }
  const key = `${src}:${id}:${cur}`
  const sum = sums.get(key) ?? { src, id: Number(id), cur, amount: ZERO, internal: ZERO }
  sum.amount += amount
  sum.internal += internal
  sums.set(key, sum)
}

const client = await connect()
await ensureRegistry(client)
const stats = { insert: 0, update: 0, same: 0 }
try {
  await client.query("BEGIN")
  await client.query(`CREATE TABLE IF NOT EXISTS linko_document_internals (
    src TEXT NOT NULL,
    src_id INTEGER NOT NULL,
    cur TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    internal NUMERIC NOT NULL,
    PRIMARY KEY (src, src_id, cur)
  )`)
  for (const sum of sums.values()) {
    const key = `${sum.src}:${sum.id}:${sum.cur}`
    const amount = text(sum.amount)
    const internal = text(sum.internal)
    const previous = (
      await client.query(
        "SELECT amount::text AS amount, internal::text AS internal FROM linko_document_internals WHERE src = $1 AND src_id = $2 AND cur = $3",
        [sum.src, sum.id, sum.cur],
      )
    ).rows[0]
    if (previous && units(previous.amount) === sum.amount && units(previous.internal) === sum.internal) {
      stats.same++
      continue
    }
    await client.query(
      `INSERT INTO linko_document_internals (src, src_id, cur, amount, internal) VALUES ($1, $2, $3, $4::numeric, $5::numeric)
       ON CONFLICT (src, src_id, cur) DO UPDATE SET amount = EXCLUDED.amount, internal = EXCLUDED.internal`,
      [sum.src, sum.id, sum.cur, amount, internal],
    )
    await register(client, run, "linko_document_internals", key, previous ? "update" : "insert", previous ?? null)
    stats[previous ? "update" : "insert"]++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(`document internals: ${stats.insert} new, ${stats.update} changed, ${stats.same} unchanged${unreadable ? `, ${unreadable} unreadable` : ""}`)
