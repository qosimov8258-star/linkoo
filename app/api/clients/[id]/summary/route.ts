import { NextResponse } from "next/server"

import { parseId } from "@/lib/auth-request"
import { getClient } from "@/lib/clients-repo"
import { getCurrentUser } from "@/lib/current-user"
import { todayIso } from "@/lib/finance/dates"
import { getBalanceList } from "@/lib/finance/ledger"

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

// GET /api/clients/[id]/summary?from&to (default: the last 30 days) → the
// client card figures from the client ledger: balance at the start / end of
// the period, orders (by creation), actual sales (shipped, by realization),
// returns and payments per currency, last order / payment day.
export async function GET(request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const id = parseId((await params).id)
  const client = id ? await getClient(id, { withBalances: false }) : null
  if (!id || !client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })

  const search = new URL(request.url).searchParams
  const to = search.get("to") ?? todayIso()
  const from = search.get("from") ?? shift(to, -30)
  if (!validDay(from) || !validDay(to) || from > to) return NextResponse.json({ error: "from/to: YYYY-MM-DD, from ≤ to" }, { status: 400 })

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
      }
    })
    .filter((entry, index) => index === 0 || Object.entries(entry).some(([key, value]) => key !== "currency" && value !== 0))
  const lastOrder = typeof row?.info.last_order === "string" ? row.info.last_order : null
  const lastPayment = typeof row?.info.last_payment === "string" ? row.info.last_payment : null
  const today = todayIso()
  const daysSince = (day: string | null) => (day ? Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000)) : null)
  return NextResponse.json({
    from,
    to,
    baseCurrency: created.baseCurrency,
    currencies,
    lastOrder,
    lastPayment,
    daysSinceLastOrder: daysSince(lastOrder),
    daysSinceLastPayment: daysSince(lastPayment),
  })
}
