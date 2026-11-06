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
import { connect, currencyCode, ensureRegistry, raw, register, runId } from "./lib.mjs"
import { bumpIdSequence, counter, deleteOthers, localIso, money, name, putRow, text, utcText } from "./finance-lib.mjs"

const CURRENCY = { 1: "SUM", 2: "USD", 3: "EUR" }
const salaryRows = Object.entries(raw("fin_salary_acts")).flatMap(([user, act]) => (act.transactions ?? []).map((t) => ({ ...t, user: Number(user) })))
const employeeManual = salaryRows.filter((t) => t.type === "none_type" || t.type === "penalty")
// Баланс филиалов / Баланс вансел: every Linko movement (manual ones, stock transfers, money handed in, returns), as
// Linko booked them. The app's own document rules (transfers between branches / to a van, van-sell cashbox transfers)
// apply only after the import moment (linko_history), so nothing is counted twice.
const branchManual = Object.values(raw("fin_branch_transactions")).flatMap((rows) => (Array.isArray(rows) ? rows : []))
const vansellManual = Object.entries(raw("fin_vansell_transactions")).flatMap(([user, rows]) => (Array.isArray(rows) ? rows.map((t) => ({ ...t, vuser: Number(user) })) : []))
/** Linko branch movement → branch_balance_transactions.kind (signed kinds keep the amount's sign). */
function branchKind(t, amount) {
  if (t.type === "stock_transfer") return amount < 0 ? "stock_transfer_minus" : "stock_transfer_plus"
  if (t.type === "cash_transfer" || t.type === "bank_transfer") return "transfer_payments"
  return amount < 0 ? "expense" : "add"
}
/** Linko van-sell movement → vansell_transactions.type (a column of the van-sell ledger). */
function vansellType(t, amount) {
  if (t.type === "stock_transfer") return amount < 0 ? "stock_transfer_minus" : "stock_transfer_plus"
  if (t.type === "cash_transfer") return "cash_transfer_plus"
  if (t.type === "bank_transfer") return "bank_transfer_plus"
  if (t.type === "order_return") return "order_return_plus"
  return "none_type"
}

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
    const kind = branchKind(t, amount)
    stats.add(
      "branch_balance_transactions",
      await putRow(client, run, "branch_balance_transactions", t.id, {
        branch_id: t.branch?.id,
        branch_name: text(t.branch?.name),
        kind,
        currency: currencyCode(t.currency),
        amount: kind === "add" || kind === "expense" ? Math.abs(amount) : amount,
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
        type: vansellType(t, money(t.amount)),
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
  // Which branches Linko lists in Баланс филиалов (show_balance and not its own "is_main").
  await client.query("ALTER TABLE branches ADD COLUMN IF NOT EXISTS in_balance INTEGER")
  for (const b of raw("branches")) {
    const listed = b.show_balance && !b.is_main ? 1 : 0
    const before = (await client.query("SELECT in_balance FROM branches WHERE id = $1", [b.id])).rows[0]
    if (!before || before.in_balance === listed) continue
    await client.query("UPDATE branches SET in_balance = $2 WHERE id = $1", [b.id, listed])
    await register(client, run, "branches", b.id, "update", { in_balance: before.in_balance })
  }
  // From this moment the branch and van-sell ledgers add the app's own document movements (Tashkent wall clock, as the
  // ledger's timestamps).
  await client.query("CREATE TABLE IF NOT EXISTS linko_history (ledger TEXT PRIMARY KEY, until TEXT NOT NULL)")
  for (const ledger of ["branch", "vansell"]) {
    await client.query(
      `INSERT INTO linko_history (ledger, until) VALUES ($1, to_char(now() AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD HH24:MI:SS'))
       ON CONFLICT (ledger) DO UPDATE SET until = EXCLUDED.until`,
      [ledger],
    )
  }
  await client.query("COMMIT")
  stats.print(`manual ledgers: employees ${employeeManual.length}, branches ${branchManual.length}, van-sell ${vansellManual.length} (Linko)`)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
