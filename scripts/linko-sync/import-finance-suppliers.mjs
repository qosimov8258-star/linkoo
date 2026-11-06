// Баланс поставщиков / Ожидаемые расходы: the supplier ledger entries of the Linko account that are not supplies,
// supply returns or payments, into supplier_balance_transactions (lib/supplier-balance-repo.ts):
//   provider transaction type 6 "Нет типа"            → kind 'add' (+) / 'expense' (−)   (id = Linko id)
//   provider transaction type 4 (supply expense charged to the supplier, "Доп. Расход № …")
//                                                      → kind 'expense' (the local ledger has no supplier column for
//                                                        supply expenses: it counts under "Прочие расходы", same balance)
//   finance/money_request (Ожидаемые расходы)          → kind 'fund_request' with its status (id = Linko request id;
//                                                        a given request points at the supplier payment that paid it)
// Supplies (type 3), supply returns (type 7) and payments (types 1, 8) come from their own documents
// (supplier_incomings, supplier_returns, supplier_payments — import-finance-cash.mjs for the payments).
// Rows that are not Linko records (the parity baselines) are removed.
//
//   node scripts/linko-sync/import-finance-suppliers.mjs     (raw: provider_transactions, fin_provider_acts,
//                                                             fin_money_requests_all, cash_transactions)
import { connect, currencyCode, ensureRegistry, raw, runId } from "./lib.mjs"
import { bumpIdSequence, counter, deleteOthers, localIso, money, name, putRow, text, utcText } from "./finance-lib.mjs"

const providerTx = raw("provider_transactions")
const acts = raw("fin_provider_acts")
const requests = raw("fin_money_requests_all")
const cashTx = raw("cash_transactions")
const actRow = new Map(Object.values(acts).flatMap((a) => a.transactions ?? []).map((t) => [t.id, t]))
const paidBy = new Map()
for (const c of cashTx) {
  const request = c.money_request?.id ?? (typeof c.money_request === "number" ? c.money_request : null)
  if (!request) continue
  const payment = providerTx.find((p) => p.transaction_id === c.id && (p.type === 1 || p.type === 8))
  if (payment) paidBy.set(request, payment.id)
}

const manual = providerTx.filter((x) => x.type === 6 || x.type === 4)
const keep = new Set([...manual.map((x) => x.id), ...requests.map((r) => r.id)])
if (keep.size !== manual.length + requests.length) throw new Error("money request ids collide with provider transaction ids")

const run = runId("finance-suppliers")
const stats = counter()
const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  stats.del("supplier_balance_transactions", await deleteOthers(client, run, "supplier_balance_transactions", keep))
  for (const x of manual) {
    const act = actRow.get(x.id)
    const amount = money(x.amount)
    const kind = x.type === 6 && amount >= 0 ? "add" : "expense"
    const comment = x.type === 4 ? text(act?.comment) || `Доп. Расход № ${act?.supply_id ?? ""}`.trim() : text(x.comment)
    stats.add(
      "supplier_balance_transactions",
      await putRow(client, run, "supplier_balance_transactions", x.id, {
        supplier_id: x.provider.id,
        kind,
        currency: currencyCode(x.currency),
        amount: Math.abs(amount),
        date: localIso(x.created_date).slice(0, 16),
        comment,
        payment_type: x.payment_type === "bank" ? "bank" : x.payment_type === "cash" ? "cash" : "",
        organization: text(x.division?.name ?? act?.division?.name),
        branch: text(act?.branch?.name),
        created_by: name(x.user),
        status: "",
        responsible_user: "",
        approved_at: "",
        payment_id: null,
        log: "[]",
        created_at: utcText(x.created_date),
        updated_at: utcText(x.created_date),
      }),
    )
  }
  for (const r of requests) {
    const status = ["pending", "approved", "given", "cancelled"].includes(r.status) ? r.status : r.status === "rejected" ? "cancelled" : "pending"
    stats.add(
      "supplier_balance_transactions",
      await putRow(client, run, "supplier_balance_transactions", r.id, {
        supplier_id: r.provider.id,
        kind: "fund_request",
        currency: currencyCode(r.currency),
        amount: Math.abs(money(r.amount)),
        date: localIso(r.created_date).slice(0, 16),
        comment: text(r.comment),
        payment_type: "",
        organization: "",
        branch: "",
        created_by: name(r.created_by),
        status,
        responsible_user: name(r.responsible_user),
        approved_at: "",
        payment_id: paidBy.get(r.id) ?? null,
        log: "[]",
        created_at: utcText(r.created_date),
        updated_at: utcText(r.created_date),
      }),
    )
  }
  await bumpIdSequence(client, "supplier_balance_transactions")
  await client.query("COMMIT")
  stats.print(`supplier ledger: ${manual.length} manual entries (types 6, 4), ${requests.length} money requests (Linko)`)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
