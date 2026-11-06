// Касса, Оплаты от клиентов, Оплаты поставщикам: every money transaction of the Linko account into the cash core's
// tables, one money fact per row exactly as lib/cash writes them (lib/cash/types.ts "One money fact = one row in one
// table"):
//   client payment (client_transaction type 1)        → customer_payments  (id = Linko client transaction id;
//                                                         doc_no = its cash transaction №; agent collections accepted
//                                                         together point at their acceptance by accept_id)
//   agent cash acceptance (finance/transaction type 8) → cash_acceptances   (id = doc_no = Linko №)
//   supplier payment / supplier income (provider types 1, 8 with their cash transaction)
//                                                       → supplier_payments  (id = Linko provider transaction id)
//   every other cash transaction (transfers, income, expenses, client withdrawals, supply expenses, cashback payouts,
//   and the client-money transactions whose client transaction no longer exists in Linko)
//                                                       → cash_management_entries (id = doc_no = Linko №)
//   transfer headers → cash_transfers, staff allocations → cash_entry_staff, detalization → cash_entry_children,
//   cashback history (accruals, manual changes, payouts) → loyalty_card_transactions.
// Rows of these tables that are not Linko records (demo / parity / QA rows) are removed; each removed row is kept in
// linko_sync_rows. Re-running updates in place.
//
//   node scripts/linko-sync/import-finance-cash.mjs
//   raw: client_transactions, cash_transactions, provider_transactions, cashboxes, fin_staff_expense_items,
//        fin_cashback_details, fin_cashback_requests, fin_contracts_all
import { connect, currencyCode, ensureRegistry, raw, register, runId } from "./lib.mjs"
import {
  bumpCashDocSequence,
  bumpIdSequence,
  counter,
  deleteOthers,
  localIso,
  money,
  name,
  num,
  putRow,
  rateType,
  russianDateTime,
  text,
  utcText,
} from "./finance-lib.mjs"

const OP_LABEL = {
  1: "Перевод с кассы",
  2: "Перевод на кассу",
  3: "Оплата заказа",
  4: "Приход",
  5: "Расход",
  6: "Приход на счет клиента",
  7: "Снято со счета клиента",
  8: "Приемка наличных с агента",
  9: "Доп. расход на поставку",
  10: "Расход на поставку",
  22: "Выдача денег для Кэшбека",
}

const cashTx = raw("cash_transactions")
const clientTx = raw("client_transactions")
const providerTx = raw("provider_transactions")
const cashboxes = new Map(raw("cashboxes").map((c) => [c.id, c]))
const staffItems = raw("fin_staff_expense_items")
const cashbackRows = Object.values(raw("fin_cashback_details")).flatMap((rows) => (Array.isArray(rows) ? rows : []))
const contracts = new Map(raw("fin_contracts_all").map((c) => [c.id, c]))

const cashById = new Map(cashTx.map((c) => [c.id, c]))
const payments = clientTx.filter((x) => x.type === 1)
const paymentsByCash = new Map()
for (const p of payments) if (p.transaction) paymentsByCash.set(p.transaction, [...(paymentsByCash.get(p.transaction) ?? []), p])
const withdrawalByCash = new Map(clientTx.filter((x) => x.type === 5 && x.transaction).map((x) => [x.transaction, x]))
const supplierByCash = new Map(providerTx.filter((x) => (x.type === 1 || x.type === 8) && x.transaction_id).map((x) => [x.transaction_id, x]))

const round9 = (value) => Math.round(value * 1e9) / 1e9
const cashboxType = (id) => (cashboxes.get(id)?.type === "bank" ? "bank" : "cash")
const cashboxName = (cashbox) => cashbox?.name ?? cashboxes.get(cashbox?.id)?.name ?? ""
const contractLabel = (id) => {
  const c = contracts.get(id)
  return c ? `${c.contract_prefix ?? ""}${c.full_number ?? c.contract_number ?? c.id}${c.contract_suffix ?? ""}` : ""
}

const run = runId("finance-cash")
const stats = counter()
const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")

  // --- what goes where ---------------------------------------------------------------------------------------------------
  const acceptanceIds = new Set()
  const entryIds = new Set()
  const supplierPaymentIds = new Set()
  for (const c of cashTx) {
    if (supplierByCash.has(c.id)) supplierPaymentIds.add(supplierByCash.get(c.id).id)
    else if (c.type === 8 && paymentsByCash.has(c.id)) acceptanceIds.add(c.id)
    else if ((c.type === 3 || c.type === 6) && paymentsByCash.has(c.id)) continue // the customer_payments row is this money
    else entryIds.add(c.id)
  }
  const paymentIds = new Set(payments.map((p) => p.id))
  const transferIds = new Set(cashTx.filter((c) => c.transfer?.id).map((c) => c.transfer.id))
  const staffIds = new Set(staffItems.map((s) => s.id))
  const childIds = new Set(cashTx.flatMap((c) => (c.transaction_child ?? []).map((x) => x.id)))
  const loyaltyIds = new Set(cashbackRows.map((r) => r.id))

  stats.del("cash_entry_staff", await deleteOthers(client, run, "cash_entry_staff", staffIds))
  stats.del("cash_entry_children", await deleteOthers(client, run, "cash_entry_children", childIds))
  stats.del("customer_payments", await deleteOthers(client, run, "customer_payments", paymentIds))
  stats.del("cash_acceptances", await deleteOthers(client, run, "cash_acceptances", acceptanceIds))
  stats.del("cash_management_entries", await deleteOthers(client, run, "cash_management_entries", entryIds))
  stats.del("cash_transfers", await deleteOthers(client, run, "cash_transfers", transferIds))
  stats.del("supplier_payments", await deleteOthers(client, run, "supplier_payments", supplierPaymentIds))
  stats.del("loyalty_card_transactions", await deleteOthers(client, run, "loyalty_card_transactions", loyaltyIds))

  // --- cash acceptances (type 8 with the client payments it accepted) ----------------------------------------------------
  for (const id of acceptanceIds) {
    const c = cashById.get(id)
    const accepted = paymentsByCash.get(id)
    const agentCashboxes = [...new Set(accepted.map((p) => p.agent_cashbox?.id ?? null))]
    const deliverers = [...new Set(accepted.map((p) => name(p.delivery_man)))]
    stats.add(
      "cash_acceptances",
      await putRow(client, run, "cash_acceptances", c.id, {
        doc_no: c.id,
        cashbox_id: c.cashbox.id,
        agent: name(c.user),
        agent_id: c.user?.id ?? null,
        agent_cashbox_id: agentCashboxes.length === 1 ? agentCashboxes[0] : null,
        organization: text(c.division?.name),
        branch: text(c.branch?.name),
        currency: currencyCode(c.currency),
        amount: money(c.amount),
        date: localIso(c.date),
        comment: text(c.comment),
        delivery_man: deliverers.length === 1 ? deliverers[0] : "",
        delivery_man_id: deliverers.length === 1 ? (accepted[0].delivery_man?.id ?? null) : null,
        created_by: name(c.created_by),
        created_at: utcText(c.created_date),
        updated_at: utcText(c.created_date),
        is_deleted: c.is_delete ? 1 : 0,
        deleted_at: "",
        deleted_by: "",
      }),
    )
  }

  // --- customer payments ---------------------------------------------------------------------------------------------------
  for (const p of payments) {
    const cash = p.transaction ? cashById.get(p.transaction) : null
    const inAcceptance = cash?.type === 8 && acceptanceIds.has(cash.id)
    const accepted = Boolean(p.accepted_time)
    const cashbox = p.cashbox ?? cash?.cashbox ?? null
    const realAmount = num(p.real_amount) ?? money(p.amount)
    const contractId = cash?.contract?.id ?? (typeof cash?.contract === "number" ? cash.contract : null)
    stats.add(
      "customer_payments",
      await putRow(client, run, "customer_payments", p.id, {
        doc_no: p.transaction ?? null,
        client: text(p.market?.name ?? p.client?.name),
        client_code: null,
        // The shop; a payment Linko booked on a financial account without a shop has none (import-document-accounts.mjs
        // records the account).
        client_id: p.market?.id ?? null,
        created_by: name(p.user),
        paid_at: russianDateTime(p.created_date),
        payment_date: localIso(p.created_date),
        accepted: accepted ? 1 : 0,
        accepted_at: accepted ? russianDateTime(p.accepted_time) : "",
        accepted_by: accepted ? name(p.accepted_by) : "",
        agent: "",
        organization: text(p.division?.name),
        amount: money(p.amount),
        currency: currencyCode(p.currency),
        amount_sum_equivalent: num(p.internal),
        real_amount: realAmount,
        real_currency: currencyCode(p.real_currency ?? p.currency),
        cash_amount: cashbox && cashboxType(cashbox.id) !== "bank" ? realAmount : 0,
        kassa: accepted ? cashboxName(cashbox) : "",
        cashbox_id: accepted ? (cashbox?.id ?? null) : null,
        comment: text(p.comment) || "Не указано",
        icon: p.payment_type === "bank" ? "card" : "cash",
        branch: text(cash && !inAcceptance ? cash.branch?.name : (cash?.branch?.name ?? p.market?.branch?.name)),
        delivery_man: name(p.delivery_man),
        delivery_man_id: p.delivery_man?.id ?? null,
        income_category: cash && !inAcceptance ? text(cash.income_category?.name) : "",
        income_category_id: cash && !inAcceptance ? (cash.income_category?.id ?? null) : null,
        op_type: p.order ? 3 : 6,
        order_id: p.order ?? null,
        contract_id: contractId,
        contract: contractId ? contractLabel(contractId) : "",
        // Linko keeps the debt currency's rate on the client transaction (custom_rate) and the base equivalent
        // (internal); the cash core keeps the cash side's rate (custom_rate) and the debt side's one (debt_rate).
        custom_rate: realAmount ? round9(money(p.internal) / realAmount) : num(p.custom_rate),
        debt_rate: num(p.custom_rate),
        rate_type: rateType(p.rate_type),
        agent_cashbox_id: p.agent_cashbox?.id ?? null,
        accept_id: inAcceptance ? cash.id : null,
        client_confirmation: text(p.client_confirmation),
        invoice_date: text(p.invoice_date),
        is_deleted: 0,
        deleted_at: "",
        deleted_by: "",
        created_at: utcText(p.created_date),
        updated_at: utcText(p.accepted_time ?? p.created_date),
      }),
    )
  }

  // --- supplier payments ---------------------------------------------------------------------------------------------------
  for (const c of cashTx) {
    const s = supplierByCash.get(c.id)
    if (!s) continue
    const category = c.expense_category ?? c.income_category ?? null
    stats.add(
      "supplier_payments",
      await putRow(client, run, "supplier_payments", s.id, {
        doc_no: c.id,
        supplier: text(s.provider?.name),
        supplier_id: s.provider?.id ?? null,
        created_by: name(c.created_by),
        paid_at: russianDateTime(c.date),
        payment_date: localIso(c.date),
        organization: text(s.division?.name ?? c.division?.name),
        amount: money(s.amount),
        currency: currencyCode(s.currency),
        real_amount: -money(c.amount),
        real_currency: currencyCode(c.currency),
        cash_amount: Math.abs(money(c.amount)),
        kassa: cashboxName(c.cashbox),
        cashbox_id: c.cashbox.id,
        comment: text(c.comment) || "Не указано",
        icon: s.payment_type === "bank" ? "card" : "cash",
        // Linko's supplier income (cash type 11, provider type 8) is the local "Приход от поставщика" (op 4), which
        // "Оплаты поставщикам" leaves out like Linko's ?type=1 list; payments keep 10 (for a supply) or 5.
        op_type: c.type === 11 ? 4 : c.type,
        supply_id: c.supply?.id ?? null,
        money_request_id: c.money_request?.id ?? (typeof c.money_request === "number" ? c.money_request : null),
        expense_category_id: c.expense_category?.id ?? null,
        income_category_id: c.income_category?.id ?? null,
        category: text(category?.name),
        branch: text(c.branch?.name),
        custom_rate: num(c.custom_rate),
        // The debt side's rate: the cash side's base amount over the supplier amount when the currencies differ.
        debt_rate: currencyCode(s.currency) === currencyCode(c.currency) ? num(c.custom_rate) : money(s.amount) ? round9(Math.abs(money(c.internal_amount) / money(s.amount))) : null,
        rate_type: rateType(c.rate_type),
        internal_amount: c.internal_amount == null ? null : -money(c.internal_amount),
        is_verified: c.is_verified === false ? 0 : 1,
        verified_at: c.is_verified === false ? "" : localIso(c.created_date),
        verified_by: c.is_verified === false ? "" : name(c.created_by),
        is_deleted: c.is_delete ? 1 : 0,
        deleted_at: "",
        deleted_by: "",
        created_at: utcText(c.created_date),
        updated_at: utcText(c.created_date),
      }),
    )
  }

  // --- transfer headers ----------------------------------------------------------------------------------------------------
  const legsByTransfer = new Map()
  for (const c of cashTx) if (c.transfer?.id) legsByTransfer.set(c.transfer.id, [...(legsByTransfer.get(c.transfer.id) ?? []), c])
  for (const [id, legs] of legsByTransfer) {
    const t = legs[0].transfer
    const out = legs.find((c) => c.type === 1) ?? null
    const into = legs.find((c) => c.type === 2) ?? null
    const fromId = t.from_cashbox?.id ?? (typeof t.from_cashbox === "number" ? t.from_cashbox : out?.cashbox.id)
    const toId = t.to_cashbox?.id ?? (typeof t.to_cashbox === "number" ? t.to_cashbox : into?.cashbox.id)
    const amountFrom = out ? -money(out.amount) : money(into?.amount)
    const amountTo = into ? money(into.amount) : amountFrom
    const fromCur = currencyCode(cashboxes.get(fromId)?.currency ?? out?.currency)
    const toCur = currencyCode(cashboxes.get(toId)?.currency ?? into?.currency)
    stats.add(
      "cash_transfers",
      await putRow(client, run, "cash_transfers", id, {
        doc_no: (out ?? into).id,
        from_cashbox_id: fromId,
        to_cashbox_id: toId,
        from_currency: fromCur,
        to_currency: toCur,
        amount_from: amountFrom,
        amount_to: amountTo,
        rate: fromCur !== toCur && amountFrom ? Math.round((amountTo / amountFrom) * 1e9) / 1e9 : null,
        percentage: 0,
        from_organization: text(out?.division?.name),
        to_organization: text(into?.division?.name),
        from_branch: text(out?.branch?.name),
        to_branch: text(into?.branch?.name),
        date: localIso((out ?? into).date),
        comment: text(t.comment),
        accumulated_from: text(t.accumulated_money_begin_date),
        accumulated_to: text(t.accumulated_money_end_date),
        created_by: name(t.created_by ?? (out ?? into).created_by),
        created_at: utcText(t.created_date ?? (out ?? into).created_date),
        is_deleted: 0,
        deleted_at: "",
        deleted_by: "",
      }),
    )
  }

  // --- cash entries --------------------------------------------------------------------------------------------------------
  for (const id of entryIds) {
    const c = cashById.get(id)
    const op = c.type
    const transfer = c.transfer ?? null
    const isTransfer = op === 1 || op === 2
    const withdrawal = op === 7 ? withdrawalByCash.get(c.id) : null
    // A client money transaction whose client transaction is gone in Linko moves the cashbox only: the entry keeps the
    // client's name for the list, but a withdrawal (op 7) without its client transaction must not touch the client ledger.
    const clientLinked = (op === 7 && withdrawal) || op === 3 || op === 6 || op === 22
    const clientName = text(c.client?.name)
    const toName = cashboxName(transfer?.to_cashbox ?? { id: transfer?.to_cashbox })
    const fromName = cashboxName(transfer?.from_cashbox ?? { id: transfer?.from_cashbox })
    let description = OP_LABEL[op] ?? ""
    if (op === 1) description = `Перевод в ${toName}`
    else if (op === 2) description = `Перевод из ${fromName}`
    else if ((op === 7 || op === 22 || op === 3 || op === 6) && clientName) description = `${OP_LABEL[op]} ${clientName}`
    else if (op === 9) description = `Доп. расход № ${c.supply_expense?.id ?? c.supply_expense ?? ""} на поставку № ${c.supply?.id ?? c.supply ?? ""}`
    else if (op === 8) description = `${OP_LABEL[8]}${c.user ? " " + name(c.user) : ""}`
    const category = isTransfer ? "Перевод" : text((c.income_category ?? c.expense_category)?.name)
    const responsible = op === 4 || op === 5 ? c.user ?? null : null
    stats.add(
      "cash_management_entries",
      await putRow(client, run, "cash_management_entries", c.id, {
        doc_no: c.id,
        cashbox_id: c.cashbox.id,
        description,
        category,
        client_name: clientLinked ? clientName : "",
        client_id: clientLinked ? (c.client?.id ?? null) : null,
        branch: text(c.branch?.name),
        organization: text(c.division?.name),
        comment: text(c.comment),
        entry_date: localIso(c.date),
        amount: money(c.amount),
        created_by: name(c.created_by),
        op_type: op,
        income_category_id: c.income_category?.id ?? null,
        expense_category_id: c.expense_category?.id ?? null,
        supply_id: c.supply?.id ?? (typeof c.supply === "number" ? c.supply : null),
        supply_expense_id: c.supply_expense?.id ?? (typeof c.supply_expense === "number" ? c.supply_expense : null),
        employee_id: responsible?.id ?? null,
        employee_name: responsible ? name(responsible) : "",
        transfer_id: transfer?.id ?? null,
        currency: currencyCode(c.currency),
        payment_type: c.payment_type === "bank" ? "bank" : cashboxType(c.cashbox.id),
        internal_amount: num(c.internal_amount),
        custom_rate: num(c.custom_rate),
        rate_type: rateType(c.rate_type),
        is_verified: c.is_verified === false ? 0 : 1,
        verified_at: c.is_verified === false ? "" : localIso(c.created_date),
        verified_by: c.is_verified === false ? "" : name(c.created_by),
        is_deleted: c.is_delete ? 1 : 0,
        deleted_at: "",
        deleted_by: "",
        amortization_from: text(c.amortization_begin_date),
        amortization_to: text(c.amortization_end_date),
        created_at: utcText(c.created_date),
        updated_at: utcText(c.created_date),
      }),
    )
    // Detalization lines (transaction_child).
    let position = 0
    for (const child of c.transaction_child ?? []) {
      stats.add(
        "cash_entry_children",
        await putRow(client, run, "cash_entry_children", child.id, { entry_id: c.id, name: text(child.name), amount: money(child.amount), position: position++ }),
      )
    }
  }

  // --- staff allocations of "Расход на сотрудников" ------------------------------------------------------------------------
  for (const s of staffItems) {
    const entryId = s.transaction?.id ?? s.transaction
    if (!entryIds.has(entryId)) throw new Error(`staff expense ${s.id}: cash transaction ${entryId} is not a cash entry`)
    stats.add(
      "cash_entry_staff",
      await putRow(client, run, "cash_entry_staff", s.id, {
        entry_id: entryId,
        employee_id: s.staff.id,
        amount: Math.abs(money(s.amount)),
        currency: currencyCode(s.currency),
        created_at: utcText(s.transaction?.date ?? cashById.get(entryId)?.created_date),
      }),
    )
  }

  // --- cashback history (Накопительная карта) ------------------------------------------------------------------------------
  // Payouts are linked to their cash entry (op 22) by client, amount and moment.
  const payouts = cashTx.filter((c) => c.type === 22)
  for (const r of cashbackRows) {
    const code = currencyCode(r.currency)
    let transactionId = null
    if (r.type === "withdraw") {
      const match = payouts.find(
        (c) => c.client?.id === r.client.id && Math.abs(Math.abs(money(c.amount)) - Math.abs(money(r.price))) < 0.01 && localIso(c.date).slice(0, 16) === localIso(r.created_date).slice(0, 16),
      )
      transactionId = match?.id ?? null
    }
    const promo = r.promotion ? `${r.promotion.name ?? ""}`.trim() : ""
    stats.add(
      "loyalty_card_transactions",
      await putRow(client, run, "loyalty_card_transactions", r.id, {
        client_id: r.client.id,
        currency: code === "EUR" ? "euro" : code.toLowerCase(),
        amount: money(r.price),
        comment: text(r.comment) || (r.type === "withdraw" && transactionId ? `${OP_LABEL[22]} № ${transactionId}` : promo),
        type: r.type === "payment" ? "payment" : r.type === "withdraw" ? "withdraw" : "additional",
        transaction_id: transactionId,
        created_by: "",
        created_at: utcText(r.created_date),
        is_deleted: 0,
      }),
    )
  }

  // --- cashback withdrawal requests: only the Linko ones stay --------------------------------------------------------------
  const requests = raw("fin_cashback_requests")
  stats.del("cashback_withdrawal_requests", await deleteOthers(client, run, "cashback_withdrawal_requests", new Set(requests.map((r) => r.id))))
  for (const r of requests) {
    const exists = (await client.query("SELECT 1 FROM cashback_withdrawal_requests WHERE id = $1", [r.id])).rowCount
    const values = {
      client: text(r.market?.name),
      client_id: r.market?.id ?? null,
      amount: money(r.amount),
      currency: currencyCode(r.currency),
      status: r.status === "confirmed" ? "confirmed" : r.status === "rejected" ? "rejected" : "pending",
      cashbox_id: r.cashbox?.id ?? null,
      is_deleted: 0,
    }
    if (!exists) Object.assign(values, { source: "telegram", comment: "", created_by: "" })
    stats.add("cashback_withdrawal_requests", await putRow(client, run, "cashback_withdrawal_requests", r.id, values))
  }

  for (const table of ["customer_payments", "cash_management_entries", "supplier_payments", "cash_acceptances", "cash_transfers", "cash_entry_staff", "cash_entry_children", "loyalty_card_transactions", "cashback_withdrawal_requests"]) {
    await bumpIdSequence(client, table)
  }
  const docNo = await bumpCashDocSequence(client)
  await register(client, run, "cash_doc_seq", "cash_doc_seq", "setval", { value: docNo })
  await client.query("COMMIT")
  stats.print(`finance cash: ${cashTx.length} cash transactions, ${payments.length} client payments, ${supplierByCash.size} supplier payments (Linko)`)
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
