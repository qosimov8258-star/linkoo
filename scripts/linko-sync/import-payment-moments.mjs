// Финансы → Оплаты от клиентов: Linko keeps a payment's moment to the microsecond (client_transaction created_date
// "2025-12-05T12:07:04.957809") and lists payments of the same second by it (newest first, then by №). payment_date keeps
// whole seconds (the form every other reader parses), so the fraction goes into customer_payments.created_micros
// (lib/cash/customer-payments.ts adds the column and orders by it). Only rows whose payment_date still equals Linko's
// moment cut to the second are written (a payment re-dated here keeps its own order). Each change is registered in
// linko_sync_rows with the previous value.
//
//   node scripts/linko-sync/import-payment-moments.mjs     (raw file: client_transactions; RAW=<dir> picks the folder)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"
import { localIso } from "./finance-lib.mjs"

/** "…:04.957809" → 957809; "…:04" → null. */
function micros(value) {
  const match = String(value ?? "").match(/T\d{2}:\d{2}:\d{2}\.(\d{1,6})/)
  return match ? Number(match[1].padEnd(6, "0")) : null
}

const transactions = raw("client_transactions").filter((row) => row.type === 1)
const run = runId("payment-moments")
const client = await connect()
await ensureRegistry(client)
const stats = { update: 0, same: 0, missing: 0, redated: 0 }
try {
  await client.query("BEGIN")
  // Same column as lib/cash/customer-payments.ts adds (its DDL).
  await client.query("ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS created_micros INTEGER")
  for (const transaction of transactions) {
    const wanted = micros(transaction.created_date)
    const row = (await client.query("SELECT id, payment_date, created_micros FROM customer_payments WHERE id = $1", [transaction.id])).rows[0]
    if (!row) {
      stats.missing++
      continue
    }
    if ((row.payment_date ?? "") !== localIso(transaction.created_date)) {
      stats.redated++
      continue
    }
    if ((row.created_micros ?? null) === wanted) {
      stats.same++
      continue
    }
    await client.query("UPDATE customer_payments SET created_micros = $2 WHERE id = $1", [row.id, wanted])
    await register(client, run, "customer_payments", row.id, "update", { created_micros: row.created_micros ?? null })
    stats.update++
  }
  await client.query("COMMIT")
  console.log("payment moments:", stats)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
