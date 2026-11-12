import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { baseReportCurrency, loadCurrencyContext } from "@/lib/finance/context"
import { roundMoney } from "@/lib/finance/currency"
import { nameKey } from "@/lib/finance/entities"
import { listLedgerMovements } from "@/lib/finance/ledger"
import { loadRateHistory, loadSalesLines, rateAt } from "@/lib/finance/pnl"

// «Продажа и оплата по магазинам» (Аналитика → Продажа и оплата по клиентам), as Linko's dynamic report
// market_order_and_payment: per shop, in the base currency,
//   Продажа / Себестоимость продаж — the shop's released orders (В пути / Доставлено) by the day they were accepted,
//     after line discounts, and the cost of their goods (the cost ledger, as P&L);
//   Возврат / Себестоимость возврата — its accepted returns and their cost;
//   Факт продаж / Себестоимость факт — sales minus returns;
//   Оплата — its payments by the day they were accepted (the client ledger in realization mode), each converted at
//     the rate of the day it was made (Валюты rate history), as Linko does;
//   Сумма скидок — what the line discounts took off its sales (a 100 % bonus line counts whole).
// Documents in other currencies are converted at the rate of their creation (orders, returns) / payment day.
// Every shop with a document or a payment in the period, the largest sale first; the «Итого» row adds them up.

export const CLIENT_SALES_COLUMNS = [
  "order_price",
  "order_net_cost",
  "return_price",
  "return_net_cost",
  "fact_price",
  "fact_net_cost",
  "payment",
  "discount_price",
] as const
export type ClientSalesColumn = (typeof CLIENT_SALES_COLUMNS)[number]

export type ClientSalesRow = { clientId: number | null; market: string } & Record<ClientSalesColumn, number>

export type ClientSalesFilters = {
  /** The shop's responsible agent (clients.agent). */
  agents?: string[]
  /** The documents' organization. */
  organizations?: string[]
  /** The shop's type, zone and branch. */
  clientTypes?: string[]
  zones?: string[]
  branches?: string[]
}

export type ClientSalesResult = { from: string; to: string; baseCurrency: string; rows: ClientSalesRow[]; total: Record<ClientSalesColumn, number> }

type ClientInfo = { id: number; name: string; agent: string; type: string; zone: string; branch: string }

const EMPTY = (): Record<ClientSalesColumn, number> => ({
  order_price: 0,
  order_net_cost: 0,
  return_price: 0,
  return_net_cost: 0,
  fact_price: 0,
  fact_net_cost: 0,
  payment: 0,
  discount_price: 0,
})

export async function getClientSalesPayments(params: { from: string; to: string } & ClientSalesFilters, db: PgDb = getDb()): Promise<ClientSalesResult> {
  const cc = await loadCurrencyContext(db)
  const shown = baseReportCurrency(cc)
  const wanted = (values?: string[]) => new Set((values ?? []).map(nameKey).filter(Boolean))
  const agents = wanted(params.agents)
  const types = wanted(params.clientTypes)
  const zones = wanted(params.zones)
  const branches = wanted(params.branches)
  const organizations = wanted(params.organizations)

  const clients = new Map<number, ClientInfo>(
    ((await db.prepare("SELECT id, name, agent, type, zone, branch FROM clients").all()) as Array<Record<string, unknown>>).map((row) => [
      Number(row.id),
      { id: Number(row.id), name: String(row.name ?? ""), agent: String(row.agent ?? ""), type: String(row.type ?? ""), zone: String(row.zone ?? ""), branch: String(row.branch ?? "") },
    ]),
  )
  const shopMatches = (client: ClientInfo | undefined) =>
    (!agents.size || agents.has(nameKey(client?.agent))) &&
    (!types.size || types.has(nameKey(client?.type))) &&
    (!zones.size || zones.has(nameKey(client?.zone))) &&
    (!branches.size || branches.has(nameKey(client?.branch)))

  // lastDoc: the newest order / return of the shop in the period (0 = payments only).
  const byShop = new Map<string, { clientId: number | null; market: string; sums: Record<ClientSalesColumn, number>; lastDoc: number }>()
  const shop = (clientId: number | null, name: string) => {
    const key = clientId === null ? `name:${nameKey(name)}` : String(clientId)
    let entry = byShop.get(key)
    if (!entry) byShop.set(key, (entry = { clientId, market: clientId === null ? name : (clients.get(clientId)?.name ?? name), sums: EMPTY(), lastDoc: 0 }))
    return entry
  }

  const { lines } = await loadSalesLines({ from: params.from, to: params.to, basis: "accepted", withCost: true, historicalRates: true }, db)
  // A return counts its own total (client_returns.amount, what Linko shows on the document), its lines give the cost:
  // an imported return's lines can add up a little differently. Orders count their lines (as Linko sums them).
  const docIds = (kind: "sale" | "return") => [...new Set(lines.filter((line) => line.kind === kind && line.docId !== null).map((line) => line.docId as number))]
  const headTotals = { sale: new Map<number, number>(), return: new Map<number, number>() }
  const docRates = lines.length ? await loadRateHistory(db) : null
  const readHeads = async (kind: "sale" | "return", sql: string) => {
    const ids = docIds(kind)
    if (!ids.length || !docRates) return
    const heads = (await db.prepare(sql).all({ ids, base: cc.base }).catch(() => [])) as Array<{ id: number; amount: number | null; cur: string; at: string }>
    for (const head of heads) {
      if (head.amount === null || head.amount === undefined || !Number.isFinite(Number(head.amount))) continue
      const rate = head.cur === cc.base ? 1 : (rateAt(docRates, head.cur, String(head.at).replace("T", " ").slice(0, 19)) ?? cc.rates[head.cur] ?? 0)
      headTotals[kind].set(Number(head.id), Number(head.amount) * rate * shown.factor)
    }
  }
  await readHeads("return", "SELECT id, amount::float8 AS amount, COALESCE(fin_cur(currency), @base) AS cur, created_at::text AS at FROM client_returns WHERE id = ANY(@ids::int[])")
  const counted = { sale: new Set<number>(), return: new Set<number>() }
  const docAmount = (line: (typeof lines)[number]) => {
    const head = line.docId === null ? undefined : headTotals[line.kind].get(line.docId)
    if (head === undefined) return line.amount
    if (counted[line.kind].has(line.docId as number)) return 0
    counted[line.kind].add(line.docId as number)
    return head
  }
  for (const line of lines) {
    if (organizations.size && !organizations.has(nameKey(line.organization))) continue
    if (!shopMatches(line.clientId === null ? undefined : clients.get(line.clientId))) continue
    const entry = shop(line.clientId, line.client)
    entry.lastDoc = Math.max(entry.lastDoc, line.docId ?? 1)
    const sums = entry.sums
    if (line.kind === "return") {
      sums.return_price += docAmount(line)
      sums.return_net_cost += line.cost
    } else {
      sums.order_price += line.amount
      sums.order_net_cost += line.cost
      sums.discount_price += line.discount
    }
  }

  // Payments accepted in the period. A payment in another currency counts at its own rate (customer_payments.debt_rate:
  // the rate of its debt currency, Linko's custom_rate on the client transaction); without one, at the rate of the
  // day it was made (its moment in the ledger's "created" mode). With an app currency the ledger already gives them
  // converted.
  const accepted = (await listLedgerMovements("client", { from: params.from, to: params.to, mode: "realization" }, db)).filter((move) => move.col === "payment")
  const foreign = cc.work ? [] : accepted.filter((move) => move.cur !== cc.base)
  const ownRate = new Map<number, number>()
  const paymentIds = foreign.filter((move) => move.src === "customer_payment" && move.src_id !== null).map((move) => Number(move.src_id))
  if (paymentIds.length) {
    const rated = (await db
      .prepare("SELECT id, debt_rate::float8 AS rate FROM customer_payments WHERE id = ANY(@ids::int[]) AND debt_rate IS NOT NULL AND debt_rate::float8 > 0")
      .all({ ids: paymentIds })
      .catch(() => [])) as Array<{ id: number; rate: number }>
    for (const row of rated) ownRate.set(Number(row.id), Number(row.rate))
  }
  const madeAt = new Map<string, string>()
  if (foreign.some((move) => !(move.src === "customer_payment" && ownRate.has(Number(move.src_id))))) {
    const made = await listLedgerMovements("client", { from: "2000-01-01", to: params.to, mode: "created" }, db)
    for (const move of made) if (move.col === "payment") madeAt.set(`${move.src}:${move.src_id}`, move.ts)
  }
  const history = madeAt.size ? await loadRateHistory(db) : null
  // Ledger moments are Tashkent wall clock; the rate history is kept in UTC.
  const utc = (local: string) => new Date(Date.parse(`${local.slice(0, 19)}Z`) - 5 * 3600_000).toISOString().replace("T", " ").slice(0, 19)
  const rateOf = (move: (typeof accepted)[number]) => {
    if (cc.work || move.cur === cc.base) return 1
    const own = move.src === "customer_payment" ? ownRate.get(Number(move.src_id)) : undefined
    if (own) return own
    const made = madeAt.get(`${move.src}:${move.src_id}`) ?? move.ts
    return (history && made ? rateAt(history, move.cur, utc(made)) : null) ?? cc.rates[move.cur] ?? 0
  }
  for (const move of accepted) {
    if (organizations.size && !organizations.has(nameKey(move.org))) continue
    const clientId = Number(move.ek)
    const client = Number.isFinite(clientId) && move.ek !== "" ? clients.get(clientId) : undefined
    // A payment without a shop (booked on a financial account only) is listed under an empty name, as in Linko.
    if (client ? !shopMatches(client) : agents.size || types.size || zones.size || branches.size) continue
    shop(client ? client.id : null, client ? client.name : "").sums.payment += move.amt * rateOf(move) * (cc.work ? 1 : shown.factor)
  }

  // Every shop with a document or a payment in the period (also when its figures add up to 0). Largest sale first;
  // equal sales: shops with orders / returns (by their newest document, oldest first), then the ones with payments only (by shop),
  // the payments without a shop last — the order Linko lists them in.
  const entries = [...byShop.values()].sort((a, b) => {
    const sale = b.sums.order_price - a.sums.order_price
    if (Math.abs(sale) > 1e-9) return sale
    if (Boolean(a.lastDoc) !== Boolean(b.lastDoc)) return a.lastDoc ? -1 : 1
    if (a.lastDoc !== b.lastDoc) return a.lastDoc - b.lastDoc
    if ((a.clientId === null) !== (b.clientId === null)) return a.clientId === null ? 1 : -1
    return (a.clientId ?? 0) - (b.clientId ?? 0)
  })
  const rows: ClientSalesRow[] = []
  const total = EMPTY()
  for (const entry of entries) {
    const sums = entry.sums
    sums.fact_price = sums.order_price - sums.return_price
    sums.fact_net_cost = sums.order_net_cost - sums.return_net_cost
    for (const column of CLIENT_SALES_COLUMNS) sums[column] = roundMoney(sums[column])
    for (const column of CLIENT_SALES_COLUMNS) total[column] += sums[column]
    rows.push({ clientId: entry.clientId, market: entry.market, ...sums })
  }
  for (const column of CLIENT_SALES_COLUMNS) total[column] = roundMoney(total[column])
  return { from: params.from, to: params.to, baseCurrency: shown.code, rows, total }
}
