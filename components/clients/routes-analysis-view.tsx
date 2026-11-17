"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { RouteAgentsPanel, boardCounts, useRouteAgents } from "@/components/clients/route-agents"
import { planVisitText } from "@/components/tracking/agents-tracking-data"
import { RI, RefButton, RefHeader } from "@/components/ref/list-kit"
import type { FieldTotals } from "@/lib/field-activity/types"
import { formatMoney } from "@/lib/finance/currency"
import { todayIso } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

const PIN_PATHS = [
  "M-243.3,395.8c1.5,0,2.7-1.2,2.7-2.7c0-1.5-1.2-2.7-2.7-2.7c-1.5,0-2.7,1.2-2.7,2.7C-246,394.6-244.8,395.8-243.3,395.8z M-243.3,391.1c1.1,0,2,0.9,2,2c0,1.1-0.9,2-2,2s-2-0.9-2-2C-245.2,392-244.4,391.1-243.3,391.1z",
  "M-235.7,400.2h-2.8l1.2-1.7c2.3-3,1.9-8-0.7-10.6c-1.4-1.4-3.3-2.2-5.3-2.2c-2,0-3.9,0.8-5.3,2.2c-2.6,2.6-3,7.6-0.7,10.6 l1.2,1.7h-2.9l-4.3,9h24L-235.7,400.2z M-248.7,398c-2-2.7-1.7-7.2,0.6-9.6c1.3-1.3,3-2,4.8-2s3.5,0.7,4.8,2 c2.4,2.4,2.7,6.8,0.6,9.6l-5.4,7.8l-3.9-5.6l0,0L-248.7,398z M-250.6,400.9h3l4.3,6.2l4.3-6.2h2.9l3.6,7.5h-21.5L-250.6,400.9z",
]
const CART_PATH = "M11 9h2V6h3V4h-3V1h-2v3H8v2h3v3zm-4 9c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2zm-9.83-3.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.86-7.01L19.42 4h-.01l-1.1 2-2.76 5H8.53l-.13-.27L6.16 6l-.95-2-.94-2H1v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.13 0-.25-.11-.25-.25z"
const DOLLAR_PATH = "M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"

/** One agent of the day's board (/api/agent-visits, lib/agent-visits-repo.ts getRoutesBoard). */
type BoardAgent = {
  employeeId: number
  name: string
  /** Local "YYYY-MM-DD HH:mm:ss" of the first visit start. */
  firstVisit: string
  visited: number
  plan: number
  outside: number
  /** Counted orders of the day in `currency` (the base currency). */
  salesSum: number
  currency: string
  idleMinutes: number
  lastClient: string
  lastDurationSec: number
}
/** The day's plan of an agent (every agent with one): planned clients and the next one (km from its last location). */
type BoardPlan = { employeeId: number; plan: number; next: { clientId: number; name: string; distanceKm: number | null } | null }
type Board = { currency: string; problems: BoardAgent[]; active: BoardAgent[]; plans: BoardPlan[] }
/** The day's money of an agent in the base currency: counted orders (board) and collected payments (field events). */
type Money = { currency: string; sales: number; payments: number }


/** An amount in the company's base currency (Валюты), two decimals. */
const formatSum = (value: number, currency: string) => `${formatMoney(value)}${currency ? ` ${currency}` : ""}`

export function RoutesAnalysisView() {
  const { t } = useLanguage()
  const agents = useRouteAgents()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [routeMenu, setRouteMenu] = useState(false)
  const router = useRouter()
  const [board, setBoard] = useState<Board>({ currency: "", problems: [], active: [], plans: [] })
  // Payments collected today per employee (base currency) and the base currency itself, from the field events.
  const [payments, setPayments] = useState<{ baseCurrency: string; byEmployee: Map<number, number> }>({ baseCurrency: "", byEmployee: new Map() })
  const today = todayIso()

  useEffect(() => {
    let cancelled = false
    // The business day (Asia/Tashkent), the day the field data is kept in.
    const date = todayIso()
    fetch(`/api/agent-visits?date=${date}`)
      .then(async (response) => (response.ok ? ((await response.json()) as Board) : null))
      .then((data) => {
        if (!cancelled && data) setBoard({ currency: data.currency ?? "", problems: data.problems ?? [], active: data.active ?? [], plans: data.plans ?? [] })
      })
      .catch(() => {})
    fetch(`/api/field-activity/summary?from=${date}&to=${date}&kind=payment`, { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as FieldTotals) : null))
      .then((data) => {
        if (cancelled || !data) return
        const byEmployee = new Map<number, number>()
        for (const entry of data.byEmployee ?? []) if (entry.employeeId !== null) byEmployee.set(entry.employeeId, entry.byKind.payment?.amountBase ?? 0)
        setPayments({ baseCurrency: data.baseCurrency ?? "", byEmployee })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const onBoard = [...board.problems, ...board.active]
  const working = new Set(onBoard.map((agent) => agent.employeeId))
  // Linko's cards: the active agents (login order) that are not out today.
  const notOut = agents.filter((agent) => agent.active && !working.has(agent.employeeId))
  const planOf = new Map(board.plans.map((entry) => [entry.employeeId, entry]))
  const counts = boardCounts(agents, board)
  const baseCurrency = board.currency || payments.baseCurrency
  const moneyOf = (employeeId: number, agent?: BoardAgent): Money => ({
    currency: agent?.currency || baseCurrency,
    sales: agent?.salesSum ?? 0,
    payments: payments.byEmployee.get(employeeId) ?? 0,
  })

  return (
    <main className={`min-h-[calc(100vh-50px)] bg-[#f2f5f8] pb-10 pt-px text-[#333] transition-[padding] duration-200 ${drawerOpen ? "pr-[330px]" : ""}`}>
      <div className="pl-[28px] pr-[8px]">
        <RefHeader title={t("Анализ маршрутов")}>
          <div className="flex items-center gap-0">
            {!drawerOpen && <div className="relative">
              <RefButton green icon={RI.edit} label={t("Установить маршрут")} onClick={() => setRouteMenu((open) => !open)} />
              {routeMenu && (
                <>
                  <button type="button" aria-label={t("Закрыть")} className="fixed inset-0 z-30 cursor-default" onClick={() => setRouteMenu(false)} />
                  <div role="menu" className="absolute right-[4px] top-[27px] z-40 w-[160px] rounded-[3px] bg-white py-[6px] shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
                    <button type="button" role="menuitem" onClick={() => { setRouteMenu(false); router.push("/clients") }} className="block h-[48px] w-full px-[16px] text-left text-[13px] hover:bg-[#f2f5f8]">{t("Через список")}</button>
                    <button type="button" role="menuitem" onClick={() => { setRouteMenu(false); router.push("/clients/territory?isSelectMarkets=true") }} className="block h-[48px] w-full px-[16px] text-left text-[13px] hover:bg-[#f2f5f8]">{t("Через карту")}</button>
                  </div>
                </>
              )}
            </div>}
            <button
              type="button"
              onClick={() => setDrawerOpen((open) => !open)}
              aria-label={t("Агенты")}
              aria-expanded={drawerOpen}
              className={`flex items-center justify-center bg-white shadow-[0_1px_4px_rgba(0,0,0,0.15)] ${drawerOpen ? "fixed right-[330px] top-[62px] z-[61] h-[38px] w-[25px]" : "ml-0 h-[30px] w-[28px]"}`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-black"><path d={drawerOpen ? "M9 6v12l8-6z" : "M15 6v12l-8-6z"} /></svg>
            </button>
          </div>
        </RefHeader>
      </div>

      <div className="-mt-px min-h-[calc(100vh-110px)] border-t border-[#e0e0e0] bg-[#f4f4f4] pt-[30px]">
        {board.problems.length > 0 && (
          <BoardSection title={t("Проблемные")} count={board.problems.length} tone="problem" drawerOpen={drawerOpen}>
            {board.problems.map((agent) => <RouteCard key={agent.employeeId} employeeId={agent.employeeId} name={agent.name} data={agent} plan={planOf.get(agent.employeeId)} day={today} money={moneyOf(agent.employeeId, agent)} problem />)}
          </BoardSection>
        )}
        {board.active.length > 0 && (
          <BoardSection title={t("Вышли")} count={board.active.length} tone="active" drawerOpen={drawerOpen}>
            {board.active.map((agent) => <RouteCard key={agent.employeeId} employeeId={agent.employeeId} name={agent.name} data={agent} plan={planOf.get(agent.employeeId)} day={today} money={moneyOf(agent.employeeId, agent)} />)}
          </BoardSection>
        )}
        <BoardSection title={t("Не Вышли")} count={notOut.length} tone="notOut" drawerOpen={drawerOpen}>
          {notOut.map((agent) => <RouteCard key={agent.employeeId} employeeId={agent.employeeId} name={agent.name} plan={planOf.get(agent.employeeId)} day={today} money={moneyOf(agent.employeeId)} />)}
        </BoardSection>
      </div>

      {drawerOpen && (
        <aside className="fixed right-0 top-0 z-[60] h-screen w-[330px] overflow-y-auto bg-white shadow-[0_0_10px_rgba(0,0,0,0.25)]">
          <RouteAgentsPanel agents={agents} counts={counts} onPick={(employeeId) => router.push(`/clients/routes/${employeeId}`)} />
        </aside>
      )}

    </main>
  )
}

const SECTION_TONE = {
  problem: { bar: "bg-[#ee667d]", count: "text-[#ee667d]" },
  active: { bar: "bg-[#3ac977]", count: "text-[#3ac977]" },
  notOut: { bar: "bg-[#1E4A9A]", count: "text-[#1E4A9A]" },
} as const

function BoardSection({ title, count, tone, drawerOpen, children }: { title: string; count: number; tone: keyof typeof SECTION_TONE; drawerOpen: boolean; children: React.ReactNode }) {
  const colors = SECTION_TONE[tone]
  return (
    <section className="mx-[31px] mb-[10px]">
      <div className={`flex h-[46px] items-center justify-between rounded-[3px] px-[10px] text-[15px] font-bold text-white ${colors.bar}`}>
        <span>{title}</span>
        <span className={`flex h-[26px] w-[26px] items-center justify-center rounded-full bg-white text-[14px] ${colors.count}`}>{count}</span>
      </div>
      <div className={`mt-[10px] grid grid-cols-1 gap-[20px] ${tone === "problem" ? "" : `md:grid-cols-2 ${drawerOpen ? "" : "xl:grid-cols-3"}`}`}>{children}</div>
    </section>
  )
}

/** An agent's card. Like Linko's, the whole card opens the agent's route (#/plan/:agentId → /clients/routes/:id). */
function RouteCard({
  employeeId,
  name,
  data,
  plan: dayPlan,
  day,
  money,
  problem = false,
}: {
  employeeId: number
  name: string
  data?: BoardAgent
  plan?: BoardPlan
  day: string
  money: Money
  problem?: boolean
}) {
  const { t, language } = useLanguage()
  const visited = data?.visited ?? 0
  const plan = dayPlan?.plan ?? data?.plan ?? 0
  const next = dayPlan?.next ?? null
  const seconds = data?.lastDurationSec ?? 0
  const duration = seconds < 60 ? `${seconds} ${t("сек.")}` : `${Math.floor(seconds / 60)} ${t("мин")} ${seconds % 60} ${t("сек.")}`
  return (
    <article className="relative overflow-hidden bg-white shadow-[0_1px_4px_rgba(0,0,0,0.15)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.22)]">
      <Link href={`/clients/routes/${employeeId}`} aria-label={name} className="absolute inset-0 z-20" />
      <div className="relative bg-[#f2f5f8] px-[20px] pb-[20px] pt-[18px]">
        <div className="pr-[60px] text-[15px] font-bold leading-[20px]">{name}</div>
        <p className="mt-[3px] text-[13px] text-[#777]">{t("Первый визит")}: {data ? formatDateText(data.firstVisit, language, { withTime: true }) : t("Не активный")}</p>
        {problem ? (
          <span className="absolute right-[20px] top-[20px] flex h-[46px] w-[46px] flex-col items-center justify-center rounded-full bg-[#ff0000] text-center text-[12px] font-bold leading-[13px] text-white">
            <span>{data?.idleMinutes}</span>
            <span>{t("мин")}</span>
          </span>
        ) : (
          <span className={`absolute right-[20px] top-[20px] flex h-[46px] w-[46px] items-center justify-center rounded-full px-[6px] text-center text-[10px] font-bold leading-[11px] text-white ${data ? "bg-[#3ac977]" : "bg-[#1E4A9A]"}`}>{data ? t("На маршруте") : t("Не вышел")}</span>
        )}
        <div className="mt-[25px] grid grid-cols-[122px_122px_122px] justify-between gap-[6px]">
          <Metric
            icon={<svg viewBox="-255.4 385.6 24 23.5" className="h-6 w-6 fill-current">{PIN_PATHS.map((d) => <path key={d} d={d} />)}</svg>}
            text={<>{visited}/{plan}{(data?.outside ?? 0) > 0 && <span className="ml-[4px] text-[#ee667d]">+ {data?.outside}</span>}</>}
          />
          <Metric icon={<svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d={CART_PATH} /></svg>} text={formatSum(money.sales, money.currency)} />
          <Metric icon={<svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d={DOLLAR_PATH} /></svg>} text={formatSum(money.payments, money.currency)} />
        </div>
      </div>
      <div className="relative min-h-[148px] px-[20px] py-[18px]">
        <span className={`absolute left-[30px] top-[38px] border-l-2 border-[#c8c8c8] h-[44px]`} />
        <div className="relative flex items-start gap-[20px]">
          <span className="relative z-10 h-[20px] w-[20px] shrink-0 rounded-full border-[3px] border-[#70c981] bg-white" />
          {data ? (
            <span className="flex flex-col"><span className="text-[14px] font-semibold leading-[20px]">{data.lastClient}</span><span className="mt-[3px] text-[13px] text-[#777]">{t("Обслуживание заняло")} {duration}</span></span>
          ) : (
            <span className="text-[14px] font-semibold">{t("Не посещал клиента")}</span>
          )}
        </div>
        <div className={`relative flex items-center gap-[20px] ${data ? "mt-[27px]" : "mt-[47px]"}`}>
          <span className="relative z-10 h-[20px] w-[20px] shrink-0 rounded-full border-[3px] border-[#1E4A9A] bg-white" />
          {next ? (
            // Linko's next client: the nearest planned one not visited yet, with its distance and the day to visit it.
            <span className="flex min-w-0 flex-1 items-start justify-between gap-[10px]">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[14px] font-semibold uppercase">{next.name}</span>
                <span className="mt-[3px] text-[13px] text-[#777]">{planVisitText(day, t)}</span>
              </span>
              {next.distanceKm !== null && (
                <span className="shrink-0 rounded-[10px] bg-[#536fe1] px-[10px] py-[2px] text-[13px] text-white">
                  {next.distanceKm.toFixed(3)} {t("км")}.
                </span>
              )}
            </span>
          ) : (
            <span className="text-[14px] font-semibold">{t("Нет следующего клиента")}</span>
          )}
        </div>
      </div>
    </article>
  )
}

function Metric({ icon, text }: { icon: React.ReactNode; text: React.ReactNode }) {
  return <div className="flex h-[40px] items-center justify-start gap-[5px] pl-[15px] rounded-[6px] bg-white text-[13px] font-semibold"><span className="text-[#1E4A9A]">{icon}</span>{text}</div>
}
