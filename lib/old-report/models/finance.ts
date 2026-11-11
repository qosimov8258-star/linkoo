import "server-only"

import { listLedgerMovements, type LedgerMovement } from "@/lib/finance/ledger"
import { MOVEMENT_LABELS, type BalanceDateMode } from "@/lib/finance/types"

import { defineModel, type FilterDef, type ModelImpl, type RunContext } from "../context"
import { nameKey, type ClientInfo, type EmployeeInfo } from "../directory"
import { clientGroups, PAY_TYPE_OPTIONS, payTypeLabel, YES_NO } from "../facets"
import { count, dayGroups, dmy, dmyTime, sum, yesNo, type GroupDef, type MeasureFn } from "../pivot"

// The money models of the old report builder — one record per movement of the finance ledger (lib/finance: the
// one source of the balance pages), for the readers of company money:
//   client_transaction           «Взаиморасчеты с клиентами»: the clients' movements (orders, returns, payments,
//                                corrections) on the day they were made;
//   accepted_client_transaction  «… по дате реализации»: the same on the day the goods left / the money came in;
//   transaction                  «Транзакция»: the movements of the cashboxes;
//   salary_transaction           «Баланс сотрудников»: the employees' accruals, payouts, fines and corrections.
// An amount is in its document's currency; the "основная валюта" columns convert it at the rate of its day.

type Move = LedgerMovement & { toBase: number; currency: string; client?: ClientInfo; employee?: EmployeeInfo; entity: string }

const days = dayGroups<Move>((move) => move.ts)
const text = (pick: (move: Move) => string | number | null | undefined): GroupDef<Move> => ({ label: pick })
const eq = (pick: FilterDef<Move>["value"], options?: FilterDef<Move>["options"]): FilterDef<Move> => ({ value: pick, options })
const number = (move: Move) => (move.src_id === null ? move.doc : String(move.src_id))
const moment: GroupDef<Move> = { label: (move) => dmyTime(move.ts), sort: (move) => move.ts }
const day: GroupDef<Move> = { label: (move) => dmy(move.ts), sort: (move) => move.ts.slice(0, 10) }

const amounts = (): Record<string, MeasureFn<Move>> => ({
  amount: sum((move) => move.amt, 2),
  plus_amount: sum((move) => (move.amt > 0 ? move.amt : 0), 2),
  minus_amount: sum((move) => (move.amt < 0 ? move.amt : 0), 2),
})

async function load(context: RunContext, kind: "client" | "cashbox" | "employee", mode: BalanceDateMode = "created"): Promise<Move[]> {
  const { dir, money, db } = context
  const rows = await listLedgerMovements(kind, { from: context.from, to: context.to, mode }, db)
  const [clients, employees] = await Promise.all([kind === "client" ? dir.clients() : null, kind === "employee" ? dir.employees() : null])
  const cashboxes = new Map<string, string>()
  if (kind === "cashbox") for (const row of (await db.prepare("SELECT id, name FROM cashboxes").all()) as { id: number; name: string }[]) cashboxes.set(String(row.id), String(row.name ?? ""))
  const moves: Move[] = []
  for (const row of rows) {
    const client = clients?.get(Number(row.ek))
    const employee = employees?.get(Number(row.ek))
    const branch = client?.branch ?? employee?.branch ?? row.br
    if (context.branch && nameKey(branch) !== nameKey(context.branch)) continue
    const fx = money.rate(row.cur, row.ts)
    // The ledger's amounts are already in the app currency when one is chosen.
    moves.push({ ...row, toBase: money.base(1, row.cur, row.ts), currency: fx.name, client, employee, entity: client?.name ?? employee?.name ?? cashboxes.get(row.ek) ?? row.cp })
  }
  return moves
}

// ---------------------------------------------------------------- Взаиморасчеты с клиентами

/** The reference's names of a client movement. */
const CLIENT_TYPE: Record<string, string> = { order: "Заказ", order_return: "Возврат", payment: "Оплата", none_type_plus: "Баланс", none_type_minus: "Баланс" }
const client = clientGroups<Move>((move) => move.client, (move) => move.entity)
const accepted = (move: Move) => move.col !== "payment" || !move.pending

const CLIENT_GROUPS: Record<string, GroupDef<Move>> = {
  market_id: client.name,
  market_code: client.code,
  created_date_2: moment,
  currency_id: text((move) => move.currency),
  id: text(number),
  type: text((move) => CLIENT_TYPE[move.col] ?? move.title),
  payment_type: text((move) => payTypeLabel(move.pt)),
  border_id: client.zone,
  user_id: text((move) => move.cby),
  // The ledger keeps the client's deliverer, not the one of each payment.
  delivery_man: client.deliverer,
  market_responsible_agent_id: client.agent,
  cashbox_name: text((move) => move.cb),
  cashbox_currency_name: text((move) => (move.cb ? move.currency : "")),
  accepted_time: { label: (move) => (accepted(move) ? dmyTime(move.ts) : ""), sort: (move) => move.ts },
  created_date_day: days.byDay,
  created_date_week: days.byWeek,
  created_date_month: days.byMonth,
  division_name: text((move) => move.org),
}

const CLIENT_MEASURES: Record<string, MeasureFn<Move>> = {
  real_amount: sum((move) => move.amt, 2),
  ...amounts(),
  internal: sum((move) => move.amt * move.toBase, 2),
  plus_internal: sum((move) => (move.amt > 0 ? move.amt * move.toBase : 0), 2),
  minus_internal: sum((move) => (move.amt < 0 ? move.amt * move.toBase : 0), 2),
}

const CLIENT_FILTERS: Record<string, FilterDef<Move>> = {
  client_transaction_type: eq((move) => CLIENT_TYPE[move.col] ?? move.title, () => [...new Set(Object.values(CLIENT_TYPE))]),
  market: eq((move) => move.entity),
  Cashbox: eq((move) => move.cb),
  responsible_agent_name: eq((move) => move.cby),
  market_user_name: eq((move) => move.client?.agent),
  payment_type_filter: eq((move) => payTypeLabel(move.pt), () => PAY_TYPE_OPTIONS),
  Branch: eq((move) => move.client?.branch),
  MarketType: eq((move) => move.client?.type),
  Division: eq((move) => move.org),
  boolean_is_accepted: eq((move) => yesNo(accepted(move)), () => YES_NO),
  delivery_man_name: eq((move) => move.client?.deliverer),
  boolean_null_delivery_man: eq((move) => (move.client?.deliverer ? 1 : 0)),
  transaction_id: eq(number),
}

const clientModel = (mode: BalanceDateMode): ModelImpl<Move> =>
  defineModel<Move>({ access: "money", load: (context) => load(context, "client", mode), groups: CLIENT_GROUPS, measures: CLIENT_MEASURES, filters: CLIENT_FILTERS })

export const clientTransactionModel = clientModel("created")
export const acceptedClientTransactionModel = clientModel("realization")

// ---------------------------------------------------------------- Транзакция (кассы)

const cashType = (move: Move) => MOVEMENT_LABELS.cashbox[move.col as keyof typeof MOVEMENT_LABELS.cashbox] ?? move.title

export const transactionModel = defineModel<Move>({
  access: "money",
  load: (context) => load(context, "cashbox"),
  groups: {
    cashbox_id: text((move) => move.entity),
    client_name: text((move) => move.cp),
    currency_id: text((move) => move.currency),
    type: text(cashType),
    id: text(number),
    comment: text((move) => move.cmt),
    created_date_2: day,
    date: day,
    created_date_day: days.byDay,
    created_date_week: days.byWeek,
    created_date_month: days.byMonth,
    expense_category_name: text((move) => (move.amt < 0 ? move.cat : "")),
    income_category_name: text((move) => (move.amt > 0 ? move.cat : "")),
    division_name: text((move) => move.org),
    created_by_id: text((move) => move.cby),
  },
  measures: {
    ...amounts(),
    internal_amount: sum((move) => move.amt * move.toBase, 2),
    plus_internal_amount: sum((move) => (move.amt > 0 ? move.amt * move.toBase : 0), 2),
    minus_internal_amount: sum((move) => (move.amt < 0 ? move.amt * move.toBase : 0), 2),
    count_id: count(),
  },
  filters: {
    ExpenseCategory: eq((move) => (move.amt < 0 ? move.cat : "")),
    IncomeCategory: eq((move) => (move.amt > 0 ? move.cat : "")),
    Division: eq((move) => move.org),
    Cashbox: eq((move) => move.entity),
    Branch: eq((move) => move.br),
    amount_filter: eq((move) => move.amt),
  },
})

// ---------------------------------------------------------------- Баланс сотрудников

export const salaryTransactionModel = defineModel<Move>({
  access: "money",
  load: (context) => load(context, "employee"),
  groups: {
    created_date_2: moment,
    currency_id: text((move) => move.currency),
    id: text(number),
    type: text((move) => MOVEMENT_LABELS.employee[move.col as keyof typeof MOVEMENT_LABELS.employee] ?? move.title),
    user_id: text((move) => move.entity),
    created_date_day: days.byDay,
    created_date_week: days.byWeek,
    created_date_month: days.byMonth,
  },
  measures: amounts(),
  filters: { user_name: eq((move) => move.entity) },
})
