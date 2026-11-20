import { NextResponse } from "next/server"
import { getDb } from "@/lib/db"

import { parseId } from "@/lib/auth-request"
import { getClient } from "@/lib/clients-repo"
import { getCurrentUser } from "@/lib/current-user"
import { roundMoney } from "@/lib/finance/currency"
import { todayIso } from "@/lib/finance/dates"
import { getBalanceList } from "@/lib/finance/ledger"
import { invalidFieldResponse } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function validDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function shift(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const round2 = (value: number) => Math.round((Number(value) || 0) * 100) / 100
/** The drawer's «Баланс» tiles as Linko prints them: to the decimals of Настройки → Округление сумм (its
 * ROUND_AMOUNT_FOR_CURRENCY), a half away from zero on the shortest decimal (roundMoney). */
const roundTile = (value: number) => roundMoney(Number(value) || 0)

// GET /api/clients/[id]/summary?from&to (default: the last 30 days) → the
// client card figures from the client ledger: balance at the start / end of
// the period, orders (by creation), actual sales (shipped, by realization),
// returns and payments per currency, last order / payment day; order / orderReturn / payment / otherIncome /
// otherExpense are the ledger's columns as they are (the shop drawer's «Баланс» tiles).
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const id = parseId((await params).id)
  const client = id ? await getClient(id, { withBalances: false }) : null
  if (!id || !client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  const search = new URL(request.url).searchParams
  const to = search.get("to") ?? todayIso()
  // `to` first: the default `from` is counted back from it (a bad `to` used to end in a 500).
  if (!validDay(to)) return invalidFieldResponse("to", "YYYY-MM-DD")
  const from = search.get("from") ?? shift(to, -30)
  if (!validDay(from)) return invalidFieldResponse("from", "YYYY-MM-DD")
  if (from > to) return invalidFieldResponse("from", "from ≤ to", "Неверный период")

  const keys = [String(id)]
  const [created, realized] = await Promise.all([
    getBalanceList("client", { from, to, keys, mode: "created", pageSize: 0 }),
    getBalanceList("client", { from, to, keys, mode: "realization", pageSize: 0 }),
  ])
  const row = created.rows.find((entry) => entry.id === id)
  const fact = realized.rows.find((entry) => entry.id === id)
  const currencies = created.currencies
    .map((currency) => {
      const c = row?.currencies[currency.code]
      const r = fact?.currencies[currency.code]
      return {
        currency: currency.code,
        begin: round2(c?.begin_balance ?? 0),
        end: round2(c?.end_balance ?? 0),
        orders: round2(-(c?.order ?? 0)),
        actualSales: round2(-(r?.order ?? 0)),
        returns: round2(c?.order_return ?? 0),
        payments: round2(c?.payment ?? 0),
        // The drawer's «Баланс» tiles: the ledger's own columns, as «Баланс клиентов» shows them, to the setting's decimals.
        beginExact: roundTile(c?.begin_balance ?? 0),
        endExact: roundTile(c?.end_balance ?? 0),
        order: roundTile(c?.order ?? 0),
        orderReturn: roundTile(c?.order_return ?? 0),
        payment: roundTile(c?.payment ?? 0),
        otherIncome: roundTile(c?.none_type_plus ?? 0),
        otherExpense: roundTile(c?.none_type_minus ?? 0),
      }
    })
    .filter((entry, index) => index === 0 || Object.entries(entry).some(([key, value]) => key !== "currency" && value !== 0))
  const lastOrder = typeof row?.info.last_order === "string" ? row.info.last_order : null
  const lastPayment = typeof row?.info.last_payment === "string" ? row.info.last_payment : null
  // Linko's last_visit_date: the day of the client's latest visit (an order, a refusal and a photo report are each made
  // during one); an order made here without a visit counts as one too. Its last_reject_comment: the latest refusal's
  // comment, else its refusal type (Linko's «Точка закрыт»); a copied shop without refusals here keeps Linko's text.
  const db = getDb()
  const visit = (await db
    .prepare("SELECT to_char(max(started_at) AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM-DD') AS day FROM field_visits WHERE client_id = ?")
    .get(id)
    .catch(() => null)) as { day: string | null } | null
  const lastVisit = [visit?.day ?? null, lastOrder].filter((day): day is string => !!day).sort().pop() ?? null
  const refusal = (await db
    .prepare("SELECT comment, reason FROM field_refusals WHERE client_id = ? ORDER BY happened_at DESC, id DESC LIMIT 1")
    .get(id)
    .catch(() => null)) as { comment: string | null; reason: string | null } | null
  const linkoRefusal = refusal
    ? null
    : ((await db
        .prepare("SELECT last_reject_comment FROM linko_market_cards WHERE client_id = ?")
        .get(id)
        .catch(() => null)) as { last_reject_comment: string | null } | null)
  const today = todayIso()
  const daysSince = (day: string | null) => (day ? Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000)) : null)
  // The card counts like Linko from the shop's own last order / visit days (its field activity; an office order does
  // not move them); a shop without them (made here, never visited) falls back to its documents.
  const fieldOrder = client.lastOrderDay || null
  const fieldVisit = client.lastVisitDay || null
  return NextResponse.json({
    from,
    to,
    baseCurrency: created.baseCurrency,
    currencies,
    lastOrder,
    lastPayment,
    daysSinceLastOrder: daysSince(fieldOrder ?? lastOrder),
    daysSinceLastPayment: daysSince(lastPayment),
    lastVisit,
    daysSinceLastVisit: daysSince(fieldVisit ?? fieldOrder ?? lastVisit),
    lastRefusalComment: refusal?.comment?.trim() || refusal?.reason?.trim() || linkoRefusal?.last_reject_comment?.trim() || null,
  })
}
