// Баланс филиалов → «Информация по балансу филиала» (the branch act): the document number and the organization Linko
// prints for each copied branch movement — «Транзакция № <cash transaction>», «Перемещение на склад № <stock transfer>»
// and the «Организация» column (its division). import-finance-ledgers.mjs copies the movements
// (branch_balance_transactions.id = Linko id); this step sets doc_ref / organization from the same raw file. Re-running
// updates in place; every change is kept in linko_sync_rows.
//
//   node scripts/linko-sync/import-branch-docs.mjs   (raw: fin_branch_transactions)
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const movements = Object.values(raw("fin_branch_transactions")).flatMap((rows) => (Array.isArray(rows) ? rows : []))
const run = runId("branch-docs")
let changed = 0
const missing = []
const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  // The same columns lib/finance/schema.ts (LEDGER_EXTENSIONS) adds.
  await client.query("ALTER TABLE branch_balance_transactions ADD COLUMN IF NOT EXISTS doc_ref INTEGER")
  await client.query("ALTER TABLE branch_balance_transactions ADD COLUMN IF NOT EXISTS organization TEXT NOT NULL DEFAULT ''")
  const local = new Map((await client.query("SELECT id, doc_ref, organization FROM branch_balance_transactions")).rows.map((row) => [Number(row.id), row]))
  for (const t of movements) {
    const row = local.get(Number(t.id))
    if (!row) {
      missing.push(t.id)
      continue
    }
    const ref = t.transaction ?? t.stock_transfer ?? null
    const docRef = ref == null ? null : Number(typeof ref === "object" ? ref.id : ref)
    const organization = String(t.division?.name ?? "").trim()
    const before = { doc_ref: row.doc_ref == null ? null : Number(row.doc_ref), organization: row.organization ?? "" }
    if (before.doc_ref === docRef && before.organization === organization) continue
    await client.query("UPDATE branch_balance_transactions SET doc_ref = $1, organization = $2 WHERE id = $3", [docRef, organization, t.id])
    await register(client, run, "branch_balance_transactions", t.id, "update", before)
    changed++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(`branch documents: ${changed} of ${movements.length} movements got Linko's document number / organization; missing here: ${missing.join(",") || "none"}`)
