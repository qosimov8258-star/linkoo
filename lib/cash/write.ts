import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import type { CurrencyContext } from "@/lib/finance/context"
import { normCurrency, roundMoney } from "@/lib/finance/currency"
import { customerPaymentColumns, insertCustomerPayment, russianDateTime, type CustomerPaymentValues } from "@/lib/finance/customer-payment"
import { nowLocalIso } from "@/lib/finance/dates"
import {
  CashError,
  currencyContext,
  findClientByName,
  findSupplierByName,
  isoDayOrEmpty,
  loadCashbox,
  loadCategory,
  loadClient,
  loadContract,
  loadEmployee,
  loadEmployees,
  loadSupplier,
  loadSupply,
  loadSupplyExpense,
  localDateTime,
  loyaltyCurrency,
  num,
  numOrNull,
  pickRate,
  type CashboxInfo,
  type CategoryInfo,
} from "@/lib/cash/common"
import { liveAcceptanceAmount } from "@/lib/cash/accept"
import { orderDue } from "@/lib/cash/orders"
import { claimFundRequest, lockFundRequest, releaseFundRequest } from "@/lib/cash/request-links"
import { ensureCashSchema } from "@/lib/cash/schema"
import {
  CASH_OP,
  CASH_OP_LABELS,
  CATEGORY_OPTIONS,
  operationKey,
  parseOperationKey,
  type CashOperationInput,
  type CashSource,
  type CashWriteResult,
  type CategoryOptionKey,
} from "@/lib/cash/types"

// Writers of the "Приход" / "Расход" dialog (create, edit, duplicate, delete,
// verify). Each input is routed to the ONE table that owns its money:
//   income  + client option (+ client)        → customer_payments  op 6
//   income  + order option (+ order)          → customer_payments  op 3 (client from the order)
//   income  + provider option (+ supplier)    → supplier_payments  op 4, amount < 0 (refund)
//   expense + provider/supply (+ supplier/supply) or a money request → supplier_payments op 5 / 10
//   expense + client                          → cash entry op 7 (client "Снято со счета клиента")
//   expense + client_card_out/client_contract → cash entry op 22 + loyalty_card_transactions −X
//   expense + supply_expense                  → cash entry op 9 (+ supplier_incoming_expenses.transaction_id)
//   staff_expense / staff_income              → cash entry op 5 / 4 + cash_entry_staff
//   anything else (detalization, amortization) → cash entry op 4 / 5 (+ cash_entry_children)
// All writes run in one DB transaction; deletes are soft (is_deleted = 1).

type CashValues = Record<string, unknown>

type SupplierValues = Record<string, unknown>

type CashPlan = {
  owner: "cash"
  values: CashValues
  staff: Array<{ employeeId: number; amount: number }>
  children: Array<{ name: string; amount: number }>
  loyalty: { clientId: number; amount: number; currency: string } | null
  supplyExpenseId: number | null
}

type CustomerPlan = { owner: "customer"; values: CustomerPaymentValues }

type SupplierPlan = {
  owner: "supplier"
  values: SupplierValues
  moneyRequestId: number | null
  supplyId: number | null
}

type Plan = CashPlan | CustomerPlan | SupplierPlan

const TABLE: Record<Exclude<CashSource, "acceptance" | "reference">, string> = {
  cash: "cash_management_entries",
  customer: "customer_payments",
  supplier: "supplier_payments",
}

type OwnerRow = { source: CashSource; id: number; docNo: number; row: Record<string, unknown> }

async function lockOwner(tx: PgDb, key: string): Promise<OwnerRow> {
  const parsed = parseOperationKey(key)
  if (!parsed) throw new CashError("Операция не найдена", 404)
  // Archived reference operations (cash_reference_rows) are list-only; their money is already part of the cashbox balance.
  if (parsed.source === "reference") throw new CashError("Эта операция загружена из архива и не может быть изменена или удалена", 409)
  const table = parsed.source === "acceptance" ? "cash_acceptances" : TABLE[parsed.source]
  const row = (await tx.prepare(`SELECT * FROM ${table} WHERE id = @id FOR UPDATE`).get({ id: parsed.id })) as Record<string, unknown> | undefined
  if (!row) throw new CashError("Операция не найдена", 404)
  return { source: parsed.source, id: parsed.id, docNo: Number(row.doc_no), row }
}

function signedOpOf(owner: OwnerRow): number {
  const op = numOrNull(owner.row.op_type)
  if (op) return op
  if (owner.source === "cash") {
    const category = String(owner.row.category ?? "")
    const amount = num(owner.row.amount)
    if (category === "Перевод") return amount < 0 ? 1 : 2
    return amount >= 0 ? 4 : 5
  }
  if (owner.source === "customer") return owner.row.order_id ? 3 : 6
  if (owner.source === "supplier") return 5
  return 8
}

// --- input → plan ------------------------------------------------------------

function applicableOptions(category: CategoryInfo | null, kind: "income" | "expense"): CategoryOptionKey[] {
  return (category?.options ?? []).filter((key) => CATEGORY_OPTIONS[key][kind])
}

function positive(value: number | undefined | null): number {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? amount : 0
}

type Common = {
  kind: "income" | "expense"
  cashbox: CashboxInfo
  category: CategoryInfo | null
  date: string
  isVerified: boolean
  comment: string
  organization: string
  branch: string
  rateType: string
  cashRate: number | null
  user: string
}

/** Debt side of client / supplier money: credited amount in `debtCurrency`. */
function debtSide(cash: number, common: Common, cc: CurrencyContext, input: CashOperationInput, fallbackCurrency?: string) {
  const cashCur = common.cashbox.currency
  const debtCur = normCurrency(input.debtCurrency || fallbackCurrency || cashCur, cc.base)
  const internal = common.cashRate ? cash * common.cashRate : null
  if (debtCur === cashCur) return { amount: cash, currency: debtCur, internal, debtRate: null as number | null }
  if (internal === null) throw new CashError("Курс валюты не задан", 400, "currencyRate")
  const debtRate = pickRate(debtCur, cc, common.rateType === "custom" ? input.debtRate : null)
  if (!debtRate) throw new CashError("Курс валюты не задан", 400, "currencyRate")
  return { amount: roundMoney(internal / debtRate, 5), currency: debtCur, internal, debtRate }
}

function cashEntryValues(common: Common, op: number, signedAmount: number, extra: CashValues = {}): CashValues {
  const verifiedNow = common.isVerified
  return {
    cashbox_id: common.cashbox.id,
    description: CASH_OP_LABELS[op as keyof typeof CASH_OP_LABELS] ?? "",
    category: common.category?.name ?? "",
    client_name: "",
    branch: common.branch,
    organization: common.organization,
    comment: common.comment,
    entry_date: common.date,
    amount: signedAmount,
    op_type: op,
    income_category_id: common.category?.kind === "income" ? common.category.id : null,
    expense_category_id: common.category?.kind === "expense" ? common.category.id : null,
    client_id: null,
    supply_id: null,
    supply_expense_id: null,
    employee_id: null,
    employee_name: "",
    currency: common.cashbox.currency,
    payment_type: common.cashbox.type,
    internal_amount: common.cashRate ? roundMoney(signedAmount * common.cashRate, 5) : null,
    custom_rate: common.cashRate,
    rate_type: common.rateType,
    is_verified: verifiedNow ? 1 : 0,
    verified_at: verifiedNow ? nowLocalIso() : "",
    verified_by: verifiedNow ? common.user : "",
    amortization_from: "",
    amortization_to: "",
    ...extra,
  }
}

type PlanOptions = {
  /** Group income: a client income even when the category lacks the client option (or there is no category). */
  forceClient?: boolean
}

async function resolvePlan(db: PgDb, input: CashOperationInput, user: string, cc: CurrencyContext, existing: OwnerRow | null, opts: PlanOptions = {}): Promise<Plan> {
  const kind = input.kind
  const cashbox = await loadCashbox(db, input.cashboxId, cc.base)
  const category = input.categoryId ? await loadCategory(db, kind, input.categoryId) : null
  // A category is required, except when paying a money request or an order (no "Заказ" income category yet).
  if (!category && !(kind === "expense" && input.moneyRequestId) && !(kind === "income" && (input.orderId || opts.forceClient))) {
    throw new CashError("Укажите категорию", 400, kind === "income" ? "incomeCategory" : "expenseCategory")
  }
  const options = applicableOptions(category, kind)
  const has = (key: CategoryOptionKey) => options.includes(key)
  const rateType = input.rateType ?? (input.customRate ? "custom" : "current")
  const common: Common = {
    kind,
    cashbox,
    category,
    date: localDateTime(input.date),
    isVerified: input.isVerified !== false,
    comment: input.comment?.trim() ?? "",
    organization: input.organization?.trim() ?? "",
    branch: input.branch?.trim() ?? "",
    rateType,
    cashRate: pickRate(cashbox.currency, cc, rateType === "custom" ? input.customRate : null),
    user,
  }

  // The category's first option decides which counterparty the dialog must collect.
  const first = options[0]
  const requires = first && !opts.forceClient ? CATEGORY_OPTIONS[first].requires : null
  if (!(kind === "expense" && input.moneyRequestId)) {
    if (requires === "client" && !input.clientId && !input.orderId) throw new CashError("Укажите клиента", 400, "client")
    if (requires === "provider" && !input.supplierId && !input.supplyId) throw new CashError("Укажите поставщика", 400, "provider")
    if (requires === "supply" && !input.supplyId) throw new CashError("Укажите поставку", 400, "supply")
    if (requires === "order" && !input.orderId) throw new CashError("Укажите заказ", 400, "order")
    if (requires === "supply_expense" && !input.supplyExpenseId) throw new CashError("Укажите доп. расход", 400, "supplyExpense")
  }

  const staff = (input.staff ?? []).filter((item) => positive(item.amount) > 0).map((item) => ({ employeeId: item.employeeId, amount: positive(item.amount) }))
  const children = (input.children ?? [])
    .map((item) => ({ name: String(item.name ?? "").trim(), amount: positive(item.amount) }))
    .filter((item) => item.name && item.amount > 0)
  const staffMode = (kind === "expense" && has("staff_expense")) || (kind === "income" && has("staff_income"))
  if (requires === "staff" && !staff.length) throw new CashError("Укажите сумму хотя бы одному сотруднику", 400, "staffs")
  if (requires === "children" && !children.length) throw new CashError("Добавьте детализацию", 400, "transactionChild")

  let cash = positive(input.amount)
  if (staffMode && staff.length) cash = roundMoney(staff.reduce((sum, item) => sum + item.amount, 0), 5)
  else if (has("transaction_child") && children.length) cash = roundMoney(children.reduce((sum, item) => sum + item.amount, 0), 5)

  // --- supplier money -------------------------------------------------------
  if (kind === "expense" && input.moneyRequestId) {
    const request = await lockFundRequest(db, input.moneyRequestId)
    const paidByThis = existing?.source === "supplier" && request.payment_id === existing.id
    if (!paidByThis && request.status !== "approved") throw new CashError("Запрос должен быть подтвержден", 409, "moneyRequest")
    const supplier = await loadSupplier(db, request.supplier_id)
    if (!cash) {
      const converted = request.currency === cashbox.currency ? request.amount : null
      if (converted !== null) cash = converted
      else {
        const reqRate = pickRate(request.currency, cc)
        if (!reqRate || !common.cashRate) throw new CashError("Курс валюты не задан", 400, "currencyRate")
        cash = roundMoney((request.amount * reqRate) / common.cashRate, 5)
      }
    }
    const internal = common.cashRate ? cash * common.cashRate : null
    const supply = input.supplyId ? await loadSupply(db, input.supplyId, cc.base) : null
    return supplierPlan(common, cc, {
      op: supply ? CASH_OP.OUTCOME_FOR_SUPPLY : CASH_OP.OUTCOME,
      supplier,
      cash,
      debt: { amount: request.amount, currency: request.currency, internal, debtRate: pickRate(request.currency, cc) },
      moneyRequestId: request.id,
      supplyId: supply?.id ?? null,
    })
  }
  if (kind === "expense" && (has("supply") || has("provider")) && (input.supplyId || input.supplierId)) {
    if (!cash) throw new CashError("Укажите сумму", 400, "amount")
    let supplier = input.supplierId ? await loadSupplier(db, input.supplierId) : null
    let supplyId: number | null = null
    if (input.supplyId) {
      const supply = await loadSupply(db, input.supplyId, cc.base)
      if (supply.status === "отменен") throw new CashError("Поставка отменена", 400, "supply")
      if (supplier && supplier.name.trim().toLowerCase() !== supply.supplier.trim().toLowerCase()) throw new CashError("Поставка другого поставщика", 400, "supply")
      supplier ??= await findSupplierByName(db, supply.supplier)
      supplyId = supply.id
    }
    if (!supplier) throw new CashError("Укажите поставщика", 400, "provider")
    return supplierPlan(common, cc, {
      op: supplyId ? CASH_OP.OUTCOME_FOR_SUPPLY : CASH_OP.OUTCOME,
      supplier,
      cash,
      debt: debtSide(cash, common, cc, input),
      moneyRequestId: null,
      supplyId,
    })
  }
  if (kind === "income" && has("provider") && input.supplierId) {
    if (!cash) throw new CashError("Укажите сумму", 400, "amount")
    const supplier = await loadSupplier(db, input.supplierId)
    const debt = debtSide(cash, common, cc, input)
    return supplierPlan(common, cc, {
      op: CASH_OP.INCOME,
      supplier,
      cash: -cash,
      debt: { ...debt, amount: -debt.amount, internal: debt.internal === null ? null : -debt.internal },
      moneyRequestId: null,
      supplyId: null,
    })
  }

  // --- client money ---------------------------------------------------------
  const orderMode = kind === "income" && Boolean(input.orderId) && (has("order") || !category)
  if (orderMode || (kind === "income" && (has("client") || opts.forceClient) && input.clientId)) {
    if (!cash) throw new CashError("Укажите сумму", 400, "amount")
    let client = input.clientId ? await loadClient(db, input.clientId) : null
    let orderId: number | null = null
    let orderCurrency: string | undefined
    if (orderMode && input.orderId) {
      const due = await orderDue(db, input.orderId, cc)
      if (!due) throw new CashError("Заказ не найден", 404, "order")
      if (due.status === "Отменен") throw new CashError("Заказ отменен", 400, "order")
      const orderClient = await findClientByName(db, due.client)
      if (!orderClient) throw new CashError("Клиент заказа не найден", 404, "order")
      client = orderClient
      orderId = due.id
      if (due.currencies.length === 1) orderCurrency = due.currencies[0].currency
    }
    if (!client) throw new CashError("Укажите клиента", 400, "client")
    const contract = await loadContract(db, input.contractId)
    const responsible = input.responsibleId ? await loadEmployee(db, input.responsibleId) : null
    const debt = debtSide(cash, common, cc, input, orderCurrency)
    return {
      owner: "customer",
      values: {
        client,
        cashbox: { id: cashbox.id, name: cashbox.name, currency: cashbox.currency, isBank: cashbox.type === "bank" },
        amount: debt.amount,
        currency: debt.currency,
        realAmount: cash,
        realCurrency: cashbox.currency,
        sumEquivalent: debt.internal,
        date: common.date,
        accepted: common.isVerified,
        acceptedAt: common.date,
        acceptedBy: user,
        organization: common.organization,
        branch: common.branch,
        deliveryMan: responsible?.name ?? "",
        deliveryManId: responsible?.id ?? null,
        incomeCategory: category?.name ?? "",
        incomeCategoryId: category?.id ?? null,
        comment: common.comment,
        createdBy: user,
        opType: orderId ? CASH_OP.ORDER : CASH_OP.INCOME_TO_CLIENT,
        orderId,
        contractId: contract?.id ?? null,
        contract: contract?.label ?? "",
        customRate: common.cashRate,
        debtRate: debt.debtRate,
        rateType: common.rateType,
      },
    }
  }

  // --- cash entries -----------------------------------------------------------
  if (!cash) throw new CashError(staffMode ? "Укажите сумму хотя бы одному сотруднику" : "Укажите сумму", 400, staffMode ? "staffs" : "amount")
  const signed = kind === "income" ? cash : -cash
  const amortization = has("amortization")
    ? { amortization_from: isoDayOrEmpty(input.amortizationFrom, "amortization"), amortization_to: isoDayOrEmpty(input.amortizationTo, "amortization") }
    : {}
  const responsible = input.responsibleId ? await loadEmployee(db, input.responsibleId) : null
  const responsibleCols = responsible ? { employee_id: responsible.id, employee_name: responsible.name } : {}

  if (kind === "expense" && (has("client_card_out") || has("client_contract") || has("client")) && input.clientId) {
    const client = await loadClient(db, input.clientId)
    const cashback = has("client_card_out") || has("client_contract")
    const op = cashback ? CASH_OP.CLIENT_CONTRACT_OUT : CASH_OP.OUTCOME_FROM_CLIENT
    return {
      owner: "cash",
      values: cashEntryValues(common, op, signed, {
        client_id: client.id,
        client_name: client.name,
        description: `${CASH_OP_LABELS[op]} ${client.name}`,
        ...responsibleCols,
        ...amortization,
      }),
      staff: [],
      children: [],
      loyalty: cashback ? { clientId: client.id, amount: -cash, currency: loyaltyCurrency(cashbox.currency) } : null,
      supplyExpenseId: null,
    }
  }
  if (kind === "expense" && has("supply_expense") && input.supplyExpenseId) {
    const expense = await loadSupplyExpense(db, input.supplyExpenseId, cc.base)
    return {
      owner: "cash",
      values: cashEntryValues(common, CASH_OP.SUPPLY_EXPENSE, signed, {
        supply_id: expense.incomingId,
        supply_expense_id: expense.id,
        description: `Доп. расход № ${expense.id} на поставку № ${expense.incomingId}`,
        ...responsibleCols,
      }),
      staff: [],
      children: [],
      loyalty: null,
      supplyExpenseId: expense.id,
    }
  }
  if (staffMode && staff.length) await loadEmployees(db, staff.map((item) => item.employeeId))
  return {
    owner: "cash",
    values: cashEntryValues(common, kind === "income" ? CASH_OP.INCOME : CASH_OP.OUTCOME, signed, {
      ...responsibleCols,
      ...amortization,
    }),
    staff: staffMode ? staff : [],
    children: has("transaction_child") ? children : [],
    loyalty: null,
    supplyExpenseId: null,
  }
}

function supplierPlan(
  common: Common,
  cc: CurrencyContext,
  p: {
    op: number
    supplier: { id: number | null; name: string }
    /** Signed like `amount` (+ paid to the supplier, − refund), cashbox currency. */
    cash: number
    debt: { amount: number; currency: string; internal: number | null; debtRate: number | null }
    moneyRequestId: number | null
    supplyId: number | null
  },
): SupplierPlan {
  const verified = common.isVerified
  return {
    owner: "supplier",
    moneyRequestId: p.moneyRequestId,
    supplyId: p.supplyId,
    values: {
      supplier: p.supplier.name,
      supplier_id: p.supplier.id,
      paid_at: russianDateTime(common.date),
      payment_date: common.date,
      organization: common.organization,
      amount: p.debt.amount,
      currency: p.debt.currency,
      cash_amount: Math.abs(p.cash),
      kassa: common.cashbox.name,
      comment: common.comment || "Не указано",
      icon: common.cashbox.type === "bank" ? "card" : "cash",
      op_type: p.op,
      cashbox_id: common.cashbox.id,
      supply_id: p.supplyId,
      money_request_id: p.moneyRequestId,
      expense_category_id: common.category?.kind === "expense" ? common.category.id : null,
      income_category_id: common.category?.kind === "income" ? common.category.id : null,
      category: common.category?.name ?? "",
      branch: common.branch,
      real_amount: p.cash,
      real_currency: common.cashbox.currency,
      custom_rate: common.cashRate,
      debt_rate: p.debt.debtRate,
      rate_type: common.rateType,
      internal_amount: p.debt.internal === null ? (common.cashRate ? roundMoney(p.cash * common.cashRate, 5) : null) : roundMoney(p.debt.internal, 5),
      is_verified: verified ? 1 : 0,
      verified_at: verified ? nowLocalIso() : "",
      verified_by: verified ? common.user : "",
    },
  }
}

// --- row helpers ---------------------------------------------------------------

async function insertRow(tx: PgDb, table: string, values: Record<string, unknown>): Promise<{ id: number; docNo: number }> {
  const names = Object.keys(values)
  const row = (await tx
    .prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map((name) => `@${name}`).join(", ")}) RETURNING id, doc_no`)
    .get(values)) as { id: number; doc_no: string | number }
  return { id: Number(row.id), docNo: Number(row.doc_no) }
}

async function updateRow(tx: PgDb, table: string, id: number, values: Record<string, unknown>): Promise<void> {
  const names = Object.keys(values)
  await tx.prepare(`UPDATE ${table} SET ${names.map((name) => `${name} = @${name}`).join(", ")}, updated_at = datetime('now') WHERE id = @__id`).run({ ...values, __id: id })
}

async function clearCashExtras(tx: PgDb, entryId: number): Promise<void> {
  await tx.prepare("DELETE FROM cash_entry_staff WHERE entry_id = @id").run({ id: entryId })
  await tx.prepare("DELETE FROM cash_entry_children WHERE entry_id = @id").run({ id: entryId })
  await tx.prepare("DELETE FROM loyalty_card_transactions WHERE transaction_id = @id").run({ id: entryId })
  const exists = (await tx.prepare("SELECT to_regclass('supplier_incoming_expenses') IS NOT NULL AS ok").get()) as { ok: boolean }
  if (exists.ok) await tx.prepare("UPDATE supplier_incoming_expenses SET transaction_id = NULL WHERE transaction_id = @id").run({ id: entryId })
}

async function addCashExtras(tx: PgDb, entryId: number, docNo: number, plan: CashPlan, currency: string): Promise<void> {
  for (const item of plan.staff) {
    await tx
      .prepare("INSERT INTO cash_entry_staff (entry_id, employee_id, amount, currency) VALUES (@entryId, @employeeId, @amount, @currency)")
      .run({ entryId, employeeId: item.employeeId, amount: item.amount, currency })
  }
  let position = 0
  for (const item of plan.children) {
    await tx
      .prepare("INSERT INTO cash_entry_children (entry_id, name, amount, position) VALUES (@entryId, @name, @amount, @position)")
      .run({ entryId, name: item.name, amount: item.amount, position: position++ })
  }
  if (plan.loyalty) {
    await tx
      .prepare("INSERT INTO loyalty_card_transactions (client_id, currency, amount, comment, transaction_id) VALUES (@clientId, @currency, @amount, @comment, @entryId)")
      .run({ ...plan.loyalty, comment: `${CASH_OP_LABELS[22]} № ${docNo}`, entryId })
  }
  if (plan.supplyExpenseId) {
    await tx.prepare("UPDATE supplier_incoming_expenses SET transaction_id = @entryId WHERE id = @id").run({ entryId, id: plan.supplyExpenseId })
  }
}

/** supplier_incomings.paid = Σ live, verified supplier payments linked to the supply, in the supply currency. */
export async function recomputeSupplyPaid(tx: PgDb, supplyIds: Array<number | null | undefined>, cc: CurrencyContext): Promise<void> {
  const ids = [...new Set(supplyIds.filter((id): id is number => Boolean(id)))]
  for (const id of ids) {
    const supply = (await tx.prepare("SELECT id, currency FROM supplier_incomings WHERE id = @id FOR UPDATE").get({ id })) as { id: number; currency?: string } | undefined
    if (!supply) continue
    const supplyCur = normCurrency(supply.currency, cc.base)
    const payments = (await tx
      .prepare("SELECT amount, currency FROM supplier_payments WHERE supply_id = @id AND is_deleted = 0 AND is_verified <> 0")
      .all({ id })) as Array<{ amount: number; currency: string }>
    let paid = 0
    for (const payment of payments) {
      const cur = normCurrency(payment.currency, cc.base)
      if (cur === supplyCur) paid += num(payment.amount)
      else {
        const from = pickRate(cur, cc)
        const to = pickRate(supplyCur, cc)
        paid += from && to ? (num(payment.amount) * from) / to : num(payment.amount)
      }
    }
    await tx.prepare("UPDATE supplier_incomings SET paid = @paid WHERE id = @id").run({ id, paid: roundMoney(paid) })
  }
}

async function insertPlan(tx: PgDb, plan: Plan, user: string, docNo: number | null): Promise<CashWriteResult> {
  if (plan.owner === "customer") {
    const created = await insertCustomerPayment(tx, { ...plan.values, docNo })
    return { key: operationKey("customer", created.id), source: "customer", id: created.id, docNo: created.docNo }
  }
  if (plan.owner === "supplier") {
    const created = await insertRow(tx, "supplier_payments", { ...plan.values, created_by: user, ...(docNo ? { doc_no: docNo } : {}) })
    if (plan.moneyRequestId) await claimFundRequest(tx, await lockFundRequest(tx, plan.moneyRequestId), created.id, created.docNo, user)
    return { key: operationKey("supplier", created.id), source: "supplier", id: created.id, docNo: created.docNo }
  }
  const created = await insertRow(tx, "cash_management_entries", { ...plan.values, created_by: user, ...(docNo ? { doc_no: docNo } : {}) })
  await addCashExtras(tx, created.id, created.docNo, plan, String(plan.values.currency ?? ""))
  return { key: operationKey("cash", created.id), source: "cash", id: created.id, docNo: created.docNo }
}

/** Removes the side effects of an owner row (before an edit or a delete). */
async function releaseOwner(tx: PgDb, owner: OwnerRow, user: string, keepRequestId: number | null = null): Promise<void> {
  if (owner.source === "cash") await clearCashExtras(tx, owner.id)
  if (owner.source === "supplier") {
    const requestId = numOrNull(owner.row.money_request_id)
    if (requestId && requestId !== keepRequestId) await releaseFundRequest(tx, requestId, owner.id, user)
  }
}

// --- public operations -----------------------------------------------------------

/** "Приход" / "Расход" (and pay-money-request mode with moneyRequestId). */
export async function createCashOperation(input: CashOperationInput, user: string): Promise<CashWriteResult> {
  await ensureCashSchema()
  const cc = await currencyContext(getDb())
  return withTransaction(async (tx) => {
    const plan = await resolvePlan(tx, input, user, cc, null)
    const result = await insertPlan(tx, plan, user, null)
    if (plan.owner === "supplier") await recomputeSupplyPaid(tx, [plan.supplyId], cc)
    return result
  })
}

/** Several client incomes in one transaction ("Груповой приход" of the cash
 * page): every input becomes a customer payment (op 6) even when the
 * category has no client option. */
export async function createClientIncomes(inputs: CashOperationInput[], user: string): Promise<CashWriteResult[]> {
  await ensureCashSchema()
  const cc = await currencyContext(getDb())
  return withTransaction(async (tx) => {
    const results: CashWriteResult[] = []
    for (const input of inputs) {
      if (!input.clientId) throw new CashError("Укажите клиента", 400, "client")
      const plan = await resolvePlan(tx, { ...input, kind: "income", orderId: undefined }, user, cc, null, { forceClient: true })
      results.push(await insertPlan(tx, plan, user, null))
    }
    return results
  })
}

/** Edit ("Изменить"): same owner table → updated in place (id and № kept);
 * the routing changed (e.g. another category option) → the old row is
 * removed and the new one keeps the same №. Transfers and acceptance rows
 * are edited elsewhere (409). */
export async function updateCashOperation(key: string, input: CashOperationInput, user: string): Promise<CashWriteResult> {
  await ensureCashSchema()
  const cc = await currencyContext(getDb())
  return withTransaction(async (tx) => {
    const owner = await lockOwner(tx, key)
    if (owner.source === "acceptance") throw new CashError("Приемку изменяйте через «Изменить транзакцию»", 409)
    if (num(owner.row.is_deleted)) throw new CashError("Операция удалена", 409)
    const op = signedOpOf(owner)
    if (op === CASH_OP.FROM_TRANSFER || op === CASH_OP.TO_TRANSFER) throw new CashError("Перевод нельзя изменить", 409)
    if (owner.source === "customer" && owner.row.accept_id) throw new CashError("Оплата входит в приемку наличных — измените приемку", 409)

    const plan = await resolvePlan(tx, input, user, cc, owner)
    const keepRequest = plan.owner === "supplier" ? plan.moneyRequestId : null
    await releaseOwner(tx, owner, user, owner.source === "supplier" && plan.owner === "supplier" ? keepRequest : null)
    const oldSupply = owner.source === "supplier" ? numOrNull(owner.row.supply_id) : null

    let result: CashWriteResult
    if (plan.owner === owner.source) {
      if (plan.owner === "customer") {
        const values = customerPaymentColumns(plan.values)
        // Keep who created it and the agent context.
        delete values.agent
        delete values.agent_cashbox_id
        await updateRow(tx, "customer_payments", owner.id, values)
      } else if (plan.owner === "supplier") {
        await updateRow(tx, "supplier_payments", owner.id, plan.values)
        if (plan.moneyRequestId) await claimFundRequest(tx, await lockFundRequest(tx, plan.moneyRequestId), owner.id, owner.docNo, user)
      } else {
        await updateRow(tx, "cash_management_entries", owner.id, plan.values)
        await addCashExtras(tx, owner.id, owner.docNo, plan, String(plan.values.currency ?? ""))
      }
      result = { key: operationKey(owner.source, owner.id), source: owner.source, id: owner.id, docNo: owner.docNo }
    } else {
      await tx.prepare(`DELETE FROM ${TABLE[owner.source as Exclude<CashSource, "acceptance" | "reference">]} WHERE id = @id`).run({ id: owner.id })
      result = await insertPlan(tx, plan, user, owner.docNo)
    }
    await recomputeSupplyPaid(tx, [oldSupply, plan.owner === "supplier" ? plan.supplyId : null], cc)
    return result
  })
}

/** "Дублировать": a new operation with the same fields (date = `date` or now; a paid money request is not copied). */
export async function duplicateCashOperation(key: string, user: string, date?: string): Promise<CashWriteResult> {
  const input = await getOperationInput(key)
  if (!input) throw new CashError("Операция не найдена", 404)
  const copy: CashOperationInput = { ...input, date: date ?? undefined, moneyRequestId: undefined }
  if (input.moneyRequestId && !copy.categoryId) throw new CashError("Оплату запроса нельзя дублировать", 409)
  return createCashOperation(copy, user)
}

/** "Удалить": soft delete (is_deleted = 1) of the owner row; a transfer leg deletes
 * the whole transfer; an acceptance returns its payments to "not accepted". */
export async function deleteCashOperation(key: string, user: string): Promise<{ key: string; deleted: string[] }> {
  await ensureCashSchema()
  const cc = await currencyContext(getDb())
  return withTransaction(async (tx) => {
    const owner = await lockOwner(tx, key)
    if (num(owner.row.is_deleted)) return { key, deleted: [] }
    const stamp = { is_deleted: 1, deleted_at: nowLocalIso(), deleted_by: user }
    const deleted: string[] = []
    if (owner.source === "acceptance") {
      await updateRow(tx, "cash_acceptances", owner.id, { ...stamp, amount: await liveAcceptanceAmount(tx, owner.id, cc.base) })
      await tx
        .prepare(
          `UPDATE customer_payments SET accepted = 0, cashbox_id = NULL, kassa = '', accept_id = NULL, accepted_at = '', accepted_by = '',
             updated_at = datetime('now') WHERE accept_id = @id`,
        )
        .run({ id: owner.id })
      return { key, deleted: [key] }
    }
    const op = signedOpOf(owner)
    const transferId = owner.source === "cash" ? numOrNull(owner.row.transfer_id) : null
    if ((op === CASH_OP.FROM_TRANSFER || op === CASH_OP.TO_TRANSFER) && transferId) {
      const legs = (await tx.prepare("SELECT id FROM cash_management_entries WHERE transfer_id = @id FOR UPDATE").all({ id: transferId })) as Array<{ id: number }>
      for (const leg of legs) {
        await updateRow(tx, "cash_management_entries", leg.id, stamp)
        deleted.push(operationKey("cash", leg.id))
      }
      await tx.prepare("UPDATE cash_transfers SET is_deleted = 1, deleted_at = @at, deleted_by = @by WHERE id = @id").run({ id: transferId, at: stamp.deleted_at, by: user })
      return { key, deleted }
    }
    await releaseOwner(tx, owner, user)
    if (owner.source === "cash") {
      // Staff allocations and detalization stay (they follow the entry's is_deleted); the loyalty row was removed.
      await updateRow(tx, "cash_management_entries", owner.id, stamp)
    } else {
      await updateRow(tx, TABLE[owner.source as Exclude<CashSource, "acceptance" | "reference">], owner.id, stamp)
      if (owner.source === "supplier") await recomputeSupplyPaid(tx, [numOrNull(owner.row.supply_id)], cc)
    }
    return { key, deleted: [key] }
  })
}

/** "Подтвердить" (clock dialog): counts the operation from now on; `verifyDate`
 * ("YYYY-MM-DD") moves its business date (null = keep). Idempotent. */
export async function verifyCashOperation(key: string, verifyDate: string | null | undefined, user: string): Promise<CashWriteResult> {
  await ensureCashSchema()
  const cc = await currencyContext(getDb())
  return withTransaction(async (tx) => {
    const owner = await lockOwner(tx, key)
    if (owner.source === "acceptance") return { key: operationKey("acceptance", owner.id), source: owner.source, id: owner.id, docNo: owner.docNo }
    if (num(owner.row.is_deleted)) throw new CashError("Операция удалена", 409)
    const date = verifyDate ? localDateTime(verifyDate, "verify_date") : null
    const now = nowLocalIso()
    if (owner.source === "cash") {
      await updateRow(tx, "cash_management_entries", owner.id, { is_verified: 1, verified_at: now, verified_by: user, ...(date ? { entry_date: date } : {}) })
    } else if (owner.source === "customer") {
      if (!owner.row.cashbox_id && !owner.row.kassa) throw new CashError("Оплата не привязана к кассе — используйте «Принять деньги»", 409)
      const when = date ?? (String(owner.row.payment_date || "") || now)
      await updateRow(tx, "customer_payments", owner.id, {
        accepted: 1,
        accepted_at: russianDateTime(when),
        accepted_by: user,
        ...(date ? { payment_date: date, paid_at: russianDateTime(date) } : {}),
      })
    } else {
      await updateRow(tx, "supplier_payments", owner.id, {
        is_verified: 1,
        verified_at: now,
        verified_by: user,
        ...(date ? { payment_date: date, paid_at: russianDateTime(date) } : {}),
      })
      await recomputeSupplyPaid(tx, [numOrNull(owner.row.supply_id)], cc)
    }
    return { key: operationKey(owner.source, owner.id), source: owner.source, id: owner.id, docNo: owner.docNo }
  })
}

/** Prefill of the edit/duplicate dialog for an archived reference row (saving it is refused by lockOwner). */
async function referenceOperationInput(id: number, db: PgDb): Promise<CashOperationInput | null> {
  const row = (await db.prepare("SELECT * FROM cash_reference_rows WHERE id = @id").get({ id })) as Record<string, unknown> | undefined
  if (!row) return null
  const amount = num(row.amount)
  const kind = amount >= 0 ? "income" : "expense"
  const table = kind === "income" ? "income_categories" : "expense_categories"
  const category = row.category_name
    ? ((await db.prepare(`SELECT id FROM ${table} WHERE lower(name) = lower(@name) ORDER BY id LIMIT 1`).get({ name: String(row.category_name) })) as { id: number } | undefined)
    : undefined
  const iso = row.ts instanceof Date ? row.ts.toISOString().slice(0, 19) : String(row.ts ?? "").replace(" ", "T").slice(0, 19)
  const extra = (() => {
    try {
      return JSON.parse(String(row.extra ?? "{}")) as { children?: Array<{ name: string; amount: number }> }
    } catch {
      return {}
    }
  })()
  return {
    kind,
    date: iso || undefined,
    cashboxId: num(row.cashbox_id),
    branch: String(row.branch ?? "") || undefined,
    organization: String(row.organization ?? "") || undefined,
    categoryId: category?.id,
    amount: Math.abs(amount),
    comment: String(row.comment ?? "") || undefined,
    isVerified: num(row.verified) !== 0,
    clientId: numOrNull(row.client_id) ?? undefined,
    supplierId: numOrNull(row.supplier_id) ?? undefined,
    children: extra.children?.map((item) => ({ name: item.name, amount: num(item.amount) })),
  }
}

/** Form values of an operation (edit / duplicate prefill). null for unknown keys and acceptances. */
export async function getOperationInput(key: string, db: PgDb = getDb()): Promise<CashOperationInput | null> {
  const parsed = parseOperationKey(key)
  if (!parsed || parsed.source === "acceptance") return null
  await ensureCashSchema(db)
  if (parsed.source === "reference") return referenceOperationInput(parsed.id, db)
  const row = (await db.prepare(`SELECT * FROM ${TABLE[parsed.source]} WHERE id = @id`).get({ id: parsed.id })) as Record<string, unknown> | undefined
  if (!row) return null
  const str = (value: unknown) => (value === null || value === undefined ? undefined : String(value) || undefined)
  const id = (value: unknown) => numOrNull(value) ?? undefined
  const rate = (value: unknown) => numOrNull(value) ?? undefined
  const rateType = (str(row.rate_type) as CashOperationInput["rateType"]) ?? undefined
  if (parsed.source === "cash") {
    const amount = num(row.amount)
    const kind = amount >= 0 ? "income" : "expense"
    const staff = (await db.prepare("SELECT employee_id, amount FROM cash_entry_staff WHERE entry_id = @id ORDER BY id").all({ id: parsed.id })) as Array<{
      employee_id: number
      amount: number
    }>
    const children = (await db.prepare("SELECT name, amount FROM cash_entry_children WHERE entry_id = @id ORDER BY position, id").all({ id: parsed.id })) as Array<{
      name: string
      amount: number
    }>
    return {
      kind,
      date: str(row.entry_date),
      cashboxId: num(row.cashbox_id),
      branch: str(row.branch),
      organization: str(row.organization),
      categoryId: id(kind === "income" ? row.income_category_id : row.expense_category_id),
      amount: Math.abs(amount),
      comment: str(row.comment),
      isVerified: num(row.is_verified) !== 0,
      clientId: id(row.client_id),
      supplyExpenseId: id(row.supply_expense_id),
      responsibleId: id(row.employee_id),
      staff: staff.map((item) => ({ employeeId: item.employee_id, amount: num(item.amount) })),
      children: children.map((item) => ({ name: item.name, amount: num(item.amount) })),
      amortizationFrom: str(row.amortization_from),
      amortizationTo: str(row.amortization_to),
      rateType,
      customRate: rateType === "custom" ? rate(row.custom_rate) : undefined,
    }
  }
  if (parsed.source === "customer") {
    const realCurrency = String(row.real_currency || row.currency || "")
    const currency = String(row.currency || "")
    return {
      kind: "income",
      date: str(row.payment_date) ?? str(row.paid_at),
      cashboxId: num(row.cashbox_id),
      branch: str(row.branch),
      organization: str(row.organization),
      categoryId: id(row.income_category_id),
      amount: Math.abs(num(row.real_amount ?? row.amount)),
      comment: row.comment === "Не указано" ? undefined : str(row.comment),
      isVerified: num(row.accepted) === 1,
      clientId: id(row.client_id),
      orderId: id(row.order_id),
      contractId: id(row.contract_id),
      responsibleId: id(row.delivery_man_id),
      debtCurrency: normCurrency(currency) !== normCurrency(realCurrency) ? normCurrency(currency) : undefined,
      rateType,
      customRate: rateType === "custom" ? rate(row.custom_rate) : undefined,
      debtRate: rateType === "custom" ? rate(row.debt_rate) : undefined,
    }
  }
  const amount = num(row.amount)
  const kind = amount >= 0 ? "expense" : "income"
  const realCurrency = String(row.real_currency || row.currency || "")
  const currency = String(row.currency || "")
  return {
    kind,
    date: str(row.payment_date) ?? str(row.paid_at),
    cashboxId: num(row.cashbox_id),
    branch: str(row.branch),
    organization: str(row.organization),
    categoryId: id(kind === "expense" ? row.expense_category_id : row.income_category_id),
    amount: Math.abs(num(row.real_amount ?? row.amount)),
    comment: row.comment === "Не указано" ? undefined : str(row.comment),
    isVerified: num(row.is_verified) !== 0,
    supplierId: id(row.supplier_id),
    supplyId: id(row.supply_id),
    moneyRequestId: id(row.money_request_id),
    debtCurrency: normCurrency(currency) !== normCurrency(realCurrency) ? normCurrency(currency) : undefined,
    rateType,
    customRate: rateType === "custom" ? rate(row.custom_rate) : undefined,
    debtRate: rateType === "custom" ? rate(row.debt_rate) : undefined,
  }
}
