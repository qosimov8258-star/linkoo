"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { User } from "lucide-react"

import { useCanManage } from "@/components/analytics/cash-management-shared"
import { RouteAgentsPanel, boardCounts, useRouteAgents, type RouteBoard } from "@/components/clients/route-agents"
import { SalesPlanDialog } from "@/components/clients/sales-plan-dialog"
import { RefHeader } from "@/components/ref/list-kit"
import { RefTip } from "@/components/ref/ref-tip"
import { AgentDayView } from "@/components/tracking/agent-day-view"
import { SHOP_DRAWER, shopHref, useAddressShop, writeShopParam } from "@/components/clients/shop-open-address"
import { EmbeddedShopCard } from "@/components/tracking/shop-drawer-swap"
import { MONTHS_NOMINATIVE } from "@/lib/dashboard-date-range"
import type { FieldTotals } from "@/lib/field-activity/types"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import type { MonthlyPlan } from "@/lib/monthly-plans-repo"
import type { TrackingDay } from "@/lib/tracking-types"

// Анализ маршрутов → an agent (Linko's #/plan/:agentId, opened by a card of the list or the list on the right): the
// agent's card — the name, «Сумма продаж» of the shown day's month (the agent's orders of the month but the cancelled
// ones, in the base currency: Linko's month_order_total_price), «план продаж» (the month's plan: «добавить» opens «План
// на продукты») and «Данные за <месяц> <год>г.» — over the agent's day (сделки, посещено, the three counters, the day
// switcher and the clients in two columns around the day's line), and the agents with their visited / planned clients
// of the day on the right; one of them opens here on the same day. A client of the day (a link) opens its shop card in
// the right drawer's place (Linko: drawer=shop&openShop=<id>; the card's X writes openShop=0&drawer=drawer_agent_visit
// and the agents come back; both are history entries). Linko shows the card 334 px wide there, its tabs and columns
// running into each other; here the drawer widens to the card's usual 580 px and the day's columns narrow beside it.

const DOLLAR = "M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"

const monthRange = (day: string) => {
  const [year, month] = day.split("-").map(Number)
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { year, month, from: `${day.slice(0, 7)}-01`, to: `${day.slice(0, 7)}-${String(last).padStart(2, "0")}` }
}

export function AgentRouteView({ employeeId, initialDate }: { employeeId: number; initialDate?: string }) {
  const { t } = useLanguage()
  const router = useRouter()
  const agents = useRouteAgents()
  const canPlan = useCanManage(["clients.manage"])
  const [day, setDay] = useState(() => initialDate || todayIso())
  const [board, setBoard] = useState<RouteBoard | null>(null)
  const [sales, setSales] = useState<{ key: string; amount: number; currency: string } | null>(null)
  const [plan, setPlan] = useState<{ key: string; data: MonthlyPlan } | null>(null)
  const [planOpen, setPlanOpen] = useState(false)
  const [planTick, setPlanTick] = useState(0)
  /** The shop card shown in the agents list's place (?openShop=<id>, also on a reload, Back / Forward). */
  const shop = useAddressShop("openShop")
  const { year, month, from, to } = monthRange(day)
  const salesKey = `${employeeId}|${from}`
  const planKey = `${employeeId}|${year}|${month}|${planTick}`

  // The list's visited / planned of the shown day.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/agent-visits?date=${day}`)
      .then(async (response) => (response.ok ? ((await response.json()) as RouteBoard) : null))
      .then((data) => {
        if (!cancelled && data) setBoard(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [day])

  // «Сумма продаж»: the agent's orders of the month, cancelled ones aside (unconfirmed ones count, as in Linko).
  useEffect(() => {
    let cancelled = false
    fetch(`/api/field-activity/summary?from=${from}&to=${to}&kind=order&orders=not_cancelled&employeeId=${employeeId}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as FieldTotals) : null))
      .then((data) => {
        if (!cancelled && data) setSales({ key: salesKey, amount: data.byKind.order?.amountBase ?? 0, currency: data.baseCurrency ?? "" })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [employeeId, from, to, salesKey])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/monthly-plans?employeeId=${employeeId}&year=${year}&month=${month}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as MonthlyPlan) : null))
      .then((data) => {
        if (!cancelled && data) setPlan({ key: planKey, data })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [employeeId, year, month, planKey])

  const openShop = useCallback((clientId: number) => writeShopParam("openShop", clientId, { drawer: SHOP_DRAWER }), [])
  const closeShop = useCallback(() => writeShopParam("openShop", null), [])
  const clientHref = useCallback((clientId: number) => shopHref("openShop", clientId, { drawer: SHOP_DRAWER }), [])

  const agent = agents.find((entry) => entry.employeeId === employeeId)
  const counts = boardCounts(agents, board)
  const currency = sales?.key === salesKey ? currencyLabel(sales.currency) : ""
  const monthPlan = plan?.key === planKey ? plan.data : null

  const header = useCallback(
    ({ data }: { day: string; data: TrackingDay | null }) => (
      <AgentPlanHeader
        lastName={agent?.lastName ?? ""}
        firstName={agent?.firstName ?? data?.employee.name ?? ""}
        position={data?.employee.position ?? ""}
        sales={sales?.key === salesKey ? sales.amount : null}
        currency={currency}
        plan={monthPlan}
        month={month}
        year={year}
        onPlan={() => setPlanOpen(true)}
      />
    ),
    [agent, sales, salesKey, currency, monthPlan, month, year],
  )

  return (
    <main className={`min-h-[calc(100vh-50px)] bg-[#f2f5f8] pb-10 ${shop !== null ? "pr-[580px]" : "pr-[330px]"} pt-px text-[#333]`}>
      <div className="pl-[28px] pr-[8px]">
        <RefHeader title={t("Анализ маршрутов")} />
      </div>
      <div className="-mt-px min-h-[calc(100vh-110px)] border-t border-[#e0e0e0] bg-[#f4f4f4] px-[30px] pt-[20px]">
        <AgentDayView variant="plan" employeeId={employeeId} date={day} onClose={() => router.push("/clients/routes")} onDayChange={setDay} planHeader={header} onOpenClient={openShop} clientHref={clientHref} />
      </div>

      <aside className={`fixed right-0 top-0 z-[60] h-screen ${shop !== null ? "w-[580px] max-w-full" : "w-[330px] overflow-y-auto"} bg-white shadow-[0_0_10px_rgba(0,0,0,0.25)]`}>
        {shop !== null ? (
          <EmbeddedShopCard clientId={shop} onClose={closeShop} />
        ) : (
          <RouteAgentsPanel
            agents={agents}
            counts={counts}
            activeId={employeeId}
            onPick={(id) => {
              if (id !== employeeId) router.push(`/clients/routes/${id}${day === todayIso() ? "" : `?date=${day}`}`)
            }}
          />
        )}
      </aside>

      {planOpen && (
        <SalesPlanDialog
          employeeId={employeeId}
          year={year}
          month={month}
          currency={currency}
          canEdit={canPlan}
          onClose={() => setPlanOpen(false)}
          onSaved={() => setPlanTick((value) => value + 1)}
        />
      )}
    </main>
  )
}

/** Linko's agentInfo header: the agent (hover: the position), «Сумма продаж» / «план продаж» and «Данные за». */
function AgentPlanHeader({
  lastName,
  firstName,
  position,
  sales,
  currency,
  plan,
  month,
  year,
  onPlan,
}: {
  lastName: string
  firstName: string
  position: string
  sales: number | null
  currency: string
  plan: MonthlyPlan | null
  month: number
  year: number
  onPlan: () => void
}) {
  const { t } = useLanguage()
  const planned = (plan?.organizations ?? []).filter((row) => (row.summa ?? 0) > 0 || (row.akb ?? 0) > 0)
  const hasPlan = planned.length > 0 || (plan?.plannedProducts ?? 0) > 0
  // The plan's lines: «organization - sum» (and the number of products with a quantity).
  const planTip = [
    ...planned.map((row) => `${row.name} - ${formatMoney(row.summa ?? 0)}${currency ? ` ${currency}` : ""}${row.akb ? ` · ${t("АКБ")} ${formatMoney(row.akb)}` : ""}`),
    ...((plan?.plannedProducts ?? 0) > 0 ? [`${t("План на продукты")}: ${plan?.plannedProducts}`] : []),
  ].join("\n")
  return (
    <div className="flex min-h-[55px] items-center justify-between border border-b-0 border-[#e6e6e6] bg-[#e3e3e3] px-[20px] py-[8px] text-[13px] text-[#333]">
      <RefTip text={[position, t("Наименование зоны")].filter(Boolean).join("\n")} side="bottom">
        <span className="flex items-center gap-[10px]">
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[#d5d9e0] text-white">
            <User className="h-5 w-5" />
          </span>
          <span className="font-semibold uppercase leading-[17px]">
            {lastName}
            {lastName && <br />}
            {firstName}
          </span>
        </span>
      </RefTip>
      <div className="flex items-center">
        <svg viewBox="0 0 24 24" aria-hidden className="mr-[5px] h-[32px] w-[32px] fill-[#999]">
          <path d={DOLLAR} />
        </svg>
        <span className="flex flex-col leading-[18px]">
          <span className="text-[#555]">{t("Сумма продаж")}</span>
          <span>
            <big className="text-[18px] font-semibold">{sales === null ? "…" : formatMoney(sales)}</big> {currency}
          </span>
        </span>
        <span aria-hidden className="mx-[12px] h-[36px] w-[2px] rotate-[20deg] bg-[#333]" />
        <span className="flex flex-col leading-[18px]">
          <span className="text-[#555]">{t("план продаж")}</span>
          {hasPlan ? (
            <RefTip text={planTip} side="bottom">
              <button type="button" onClick={onPlan} className="text-left font-semibold text-[#1E4A9A] hover:underline">
                {t("Посмотреть план")}
              </button>
            </RefTip>
          ) : (
            <button type="button" onClick={onPlan} className="text-left font-semibold text-[#1E4A9A] hover:underline">
              {t("добавить")}
            </button>
          )}
        </span>
      </div>
      <div className="flex flex-col text-right leading-[18px]">
        <span>{t("Данные за")}</span>
        <b>
          {t(MONTHS_NOMINATIVE[month - 1] ?? "")} {year}
          {t("г.")}
        </b>
      </div>
    </div>
  )
}
