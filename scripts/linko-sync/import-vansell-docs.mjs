// Баланс вансел → «Информация по баланс вэнсел»: the document number Linko prints after each copied van-sell movement —
// «Оплата на кассу (Передача № <cash transaction>)», «Передача склада (Передача № <stock transfer>)», «Передача (Отход №
// <order return>)». import-finance-ledgers.mjs copies the movements (vansell_transactions.id = Linko id); this step sets
// their doc_ref from the same raw file. Re-running updates in place; every change is kept in linko_sync_rows.
//
//   node scripts/linko-sync/import-vansell-docs.mjs   (raw: fin_vansell_transactions)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const movements = Object.values(raw("fin_vansell_transactions")).flatMap((rows) => (Array.isArray(rows) ? rows : []))
const run = runId("vansell-docs")
let changed = 0
const missing = []
const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  // The same column lib/finance/schema.ts (LEDGER_EXTENSIONS) adds.
  await client.query("ALTER TABLE vansell_transactions ADD COLUMN IF NOT EXISTS doc_ref INTEGER")
  const local = new Map((await client.query("SELECT id, doc_ref FROM vansell_transactions")).rows.map((row) => [Number(row.id), row]))
  for (const t of movements) {
    const row = local.get(Number(t.id))
    if (!row) {
      missing.push(t.id)
      continue
    }
    const ref = t.transaction ?? t.stock_transfer ?? t.order_return ?? null
    const value = ref == null ? null : Number(typeof ref === "object" ? ref.id : ref)
    const before = row.doc_ref == null ? null : Number(row.doc_ref)
    if (before === value) continue
    await client.query("UPDATE vansell_transactions SET doc_ref = $1 WHERE id = $2", [value, t.id])
    await register(client, run, "vansell_transactions", t.id, "update", { doc_ref: before })
    changed++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(`van-sell documents: ${changed} of ${movements.length} movements got Linko's document number; missing here: ${missing.join(",") || "none"}`)
