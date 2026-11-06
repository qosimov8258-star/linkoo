// Баланс сотрудников / Баланс филиалов / Баланс вансел / Долги доставщиков: the manual ledger entries of the Linko
// account into the local manual tables; the other movements of these ledgers come from their own documents (cash
// entries with staff allocations, salary credits, internal transfers, cash transfers, client documents):
//   employee salary act rows "Нет типа" / "Штраф"     → employee_balance_transactions (type none_type / penalty)
//   branch transactions "Нет типа"                     → branch_balance_transactions
//   van-sell transactions "Нет типа"                   → vansell_transactions (type none_type)
//   deliverer corrections                              → none in Linko: the parity rows of deliverer_balance_transactions go
// The parity rows ("Reference balance alignment", the 2026-09-30 baselines) of these tables are removed.
//
//   node scripts/linko-sync/import-finance-ledgers.mjs   (raw: fin_salary_acts, fin_branch_transactions, fin_vansell_transactions)
import { connect, currencyCode, ensureRegistry, raw, runId } from "./lib.mjs"
import { bumpIdSequence, counter, deleteOthers, localIso, money, name, putRow, text, utcText } from "./finance-lib.mjs"

const CURRENCY = { 1: "SUM", 2: "USD", 3: "EUR" }
const salaryRows = Object.entries(raw("fin_salary_acts")).flatMap(([user, act]) => (act.transactions ?? []).map((t) => ({ ...t, user: Number(user) })))
const employeeManual = salaryRows.filter((t) => t.type === "none_type" || t.type === "penalty")
const branchManual = Object.values(raw("fin_branch_transactions"))
  .flatMap((rows) => (Array.isArray(rows) ? rows : []))
  .filter((t) => t.type === "none_type")
const vansellManual = Object.entries(raw("fin_vansell_transactions"))
  .flatMap(([user, rows]) => (Array.isArray(rows) ? rows.map((t) => ({ ...t, vuser: Number(user) })) : []))
  .filter((t) => t.type === "none_type")

/** "Нет типа | вввв" → "вввв", "Штраф | 123" → "123", "Штраф" → "" (the act prints the type before the comment). */
const actComment = (value) => text(value).replace(/^(Нет типа|Штраф)\s*(\|\s*)?/, "").trim()

const run = runId("finance-ledgers")
const stats = counter()
const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  stats.del("employee_balance_transactions", await deleteOthers(client, run, "employee_balance_transactions", new Set(employeeManual.map((t) => t.id))))
  for (const t of employeeManual) {
    const amount = money(t.amount)
    stats.add(
      "employee_balance_transactions",
      await putRow(client, run, "employee_balance_transactions", t.id, {
        employee_id: t.user,
        kind: amount < 0 ? "expense" : "add",
        currency: CURRENCY[t.currency_id] ?? "SUM",
        amount: Math.abs(amount),
        date: localIso(t.created_date).slice(0, 16),
        comment: actComment(t.comment),
        type: t.type,
        created_by: "",
        created_at: utcText(t.created_date),
      }),
    )
  }

  stats.del("branch_balance_transactions", await deleteOthers(client, run, "branch_balance_transactions", new Set(branchManual.map((t) => t.id))))
  for (const t of branchManual) {
    const amount = money(t.amount)
    stats.add(
      "branch_balance_transactions",
      await putRow(client, run, "branch_balance_transactions", t.id, {
        branch_id: t.branch?.id,
        branch_name: text(t.branch?.name),
        kind: amount < 0 ? "expense" : "add",
        currency: currencyCode(t.currency),
        amount: Math.abs(amount),
        date: localIso(t.created_date).slice(0, 16),
        comment: text(t.comment),
        created_by: name(t.user),
        created_at: utcText(t.created_date),
      }),
    )
  }

  stats.del("vansell_transactions", await deleteOthers(client, run, "vansell_transactions", new Set(vansellManual.map((t) => t.id))))
  for (const t of vansellManual) {
    stats.add(
      "vansell_transactions",
      await putRow(client, run, "vansell_transactions", t.id, {
        employee_id: t.vuser,
        currency: currencyCode(t.currency),
        amount: money(t.amount),
        type: "none_type",
        comment: text(t.comment),
        created_date: localIso(t.created_date).slice(0, 16),
        created_by: name(t.user),
        created_at: utcText(t.created_date),
        updated_at: utcText(t.created_date),
        is_deleted: 0,
      }),
    )
  }

  stats.del("deliverer_balance_transactions", await deleteOthers(client, run, "deliverer_balance_transactions", new Set()))

  for (const table of ["employee_balance_transactions", "branch_balance_transactions", "vansell_transactions", "deliverer_balance_transactions"]) await bumpIdSequence(client, table)
  await client.query("COMMIT")
  stats.print(`manual ledgers: employees ${employeeManual.length}, branches ${branchManual.length}, van-sell ${vansellManual.length} (Linko)`)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
