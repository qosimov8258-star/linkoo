"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { SelectField } from "./select-field"
import { AgentVisitsFilterPanel } from "./agent-visits-filter-panel"
import { CARD_CLASS } from "./stat-cards"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"

const COLUMN_DEFS: { key: string; label: string }[] = [
  { key: "firstVisit", label: "Первый визит" },
  { key: "lastVisit", label: "Посл.Визит" },
  { key: "visitPlan", label: "План визитов" },
  { key: "visited", label: "Посещено" },
  { key: "orders", label: "Заказы" },
  { key: "refusals", label: "Отказы" },
  { key: "notVisited", label: "Не посещено" },
  { key: "akb", label: "АКБ" },
  { key: "routeCompletion", label: "Вып.мар." },
  { key: "sales", label: "Продажи" },
]

const BRANCH_COLUMNS = [
  "Филиал",
  "Продажа",
  "План",
  "Выполнение маршрута",
  "АКБ",
  "Посещенные по плану",
  "Не посещено",
  "Внеплановый визит",
  "% внепланового визита",
  "Рез.визит",
  "Отказ",
  "Среднее",
]

const GROUPINGS = ["По товарам", "По брендам", "По категориям", "По клиентам"]
const MEASURES = ["Факт продажи", "Факт АКБ", "Факт"]
const ORDER_DATES = ["По дате создания", "По дате доставки"]

type Person = { id: number; firstName: string; lastName: string; position: string }

function SortHead({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <th className={`whitespace-nowrap px-[17px] py-[8px] text-left align-middle text-[13px] font-semibold ${className}`}>
      <span className="inline-flex items-center gap-1">
        {children}
        <span className="flex flex-col text-[#888]">
          <ChevronDown className="-mb-[5px] h-[15px] w-[15px] rotate-180" />
          <ChevronDown className="-mt-[5px] h-[15px] w-[15px]" />
        </span>
      </span>
    </th>
  )
}

function SummaryBox({ value, label, tone }: { value: string; label: string; tone: "green" | "red" | "neutral" }) {
  const { t } = useLanguage()
  if (tone === "neutral") {
    const [first, ...rest] = value.split(" / ")
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 border-r border-[#efefef] bg-white px-3 py-4 text-center last:border-r-0">
        <span className="text-[18px] leading-6">
          <span className="text-[#0d99ff]">{first}</span>
          {rest.length > 0 && <span> / {rest.join(" / ")}</span>}
        </span>
        <span className="text-[13px] text-[#666]">{t(label)}</span>
      </div>
    )
  }
  return (
    <div className={`flex flex-1 flex-col items-center justify-center gap-1 px-3 py-4 text-center text-white ${tone === "green" ? "bg-[#3ac977]" : "bg-[#ff5e5e]"}`}>
      <span className="text-[18px] leading-6">{value}</span>
      <span className="text-[13px]">{t(label)}</span>
    </div>
  )
}

function ShowMore({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  const { t } = useLanguage()
  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-[18px] my-[10px] flex h-[30px] w-[calc(100%-36px)] items-center justify-center gap-1.5 rounded-full bg-[#f2f5f8] text-[13px] text-[#4f71dc]"
    >
      {expanded ? t("Свернуть") : t("Показать еще")}
      <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
    </button>
  )
}

function useOrders() {
  const [orders, setOrders] = useState<OrderLite[]>([])
  useEffect(() => {
    let cancelled = false
    fetch("/api/orders?balances=0")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: OrderLite[]) => {
        if (!cancelled && Array.isArray(data)) setOrders(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return orders
}

function useEmployees() {
  const [people, setPeople] = useState<Person[]>([])
  useEffect(() => {
    let cancelled = false
    fetch("/api/employees")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: Person[]) => {
        if (!cancelled && Array.isArray(data)) setPeople(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return people
}

type OrderLite = { client: string; agent: string; created: string; status: string; product: string }

const RU_MONTH_INDEX: Record<string, number> = { янв: 0, фев: 1, мар: 2, апр: 3, мая: 4, май: 4, июн: 5, июл: 6, авг: 7, сен: 8, окт: 9, ноя: 10, дек: 11 }

function orderDay(created: string): number | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(created)
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) / 86400000
  const ru = /^(\d{1,2})\s+([А-Яа-я]+)/.exec(created)
  if (ru) {
    const month = RU_MONTH_INDEX[ru[2].slice(0, 3).toLowerCase()]
    if (month !== undefined) return Date.UTC(new Date().getFullYear(), month, Number(ru[1])) / 86400000
  }
  return null
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values)
  const points = values.map((value, index) => `${(index / Math.max(1, values.length - 1)) * 100},${34 - (value / max) * 30}`).join(" ")
  return (
    <svg viewBox="0 0 100 38" preserveAspectRatio="none" className="h-[38px] w-full" aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function AxisChart({ values }: { values: number[] }) {
  const max = Math.max(5, ...values)
  const step = Math.ceil(max / 5)
  const top = step * 5
  const ticks = [0, 1, 2, 3, 4, 5]
  const points = values.map((value, index) => `${62 + (index / Math.max(1, values.length - 1)) * 550},${310 - (value / top) * 280}`).join(" ")
  return (
    <svg viewBox="0 0 640 340" className="h-[340px] w-full" aria-hidden>
      {ticks.map((tick) => (
        <g key={`y${tick}`}>
          <line x1="50" x2="620" y1={310 - tick * 56} y2={310 - tick * 56} stroke="#e8ecef" />
          <text x="22" y={314 - tick * 56} fontSize="11" fill="#333">{tick * step}</text>
        </g>
      ))}
      {values.map((_, index) => (
        <g key={`x${index}`}>
          <line x1={62 + (index / Math.max(1, values.length - 1)) * 550} x2={62 + (index / Math.max(1, values.length - 1)) * 550} y1="306" y2="312" stroke="#bbb" />
          <text x={58 + (index / Math.max(1, values.length - 1)) * 550} y="332" fontSize="11" fill="#333">{index + 1}</text>
        </g>
      ))}
      <polyline points={points} fill="none" stroke="#4f71dc" strokeWidth="2" />
      {values.map((value, index) => (
        <circle key={index} cx={62 + (index / Math.max(1, values.length - 1)) * 550} cy={310 - (value / top) * 280} r="3" fill="#4f71dc" />
      ))}
    </svg>
  )
}

export function AgentBranchVisitsWidget({ showTrends = true, showCouriers = true }: { showTrends?: boolean; showCouriers?: boolean }) {
  const { t } = useLanguage()
  const [tab, setTab] = useState<"all" | "one">("all")
  const [grouping, setGrouping] = useState(GROUPINGS[0])
  const [measure, setMeasure] = useState(MEASURES[0])
  const [orderDate, setOrderDate] = useState(ORDER_DATES[0])
  const [filterOpen, setFilterOpen] = useState(false)
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[]>(() => COLUMN_DEFS.map((column) => column.key))
  const [agentsExpanded, setAgentsExpanded] = useState(false)
  const [couriersExpanded, setCouriersExpanded] = useState(false)
  const people = useEmployees()
  const orders = useOrders()

  const total = orders.length
  const byProduct = useMemo(() => {
    const map = new Map<string, number>()
    for (const order of orders) map.set(order.product || "—", (map.get(order.product || "—") ?? 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [orders])
  const cancelled = orders.filter((order) => order.status === "Отменен").length
  const agentCount = new Set(orders.map((order) => order.agent)).size
  const akbClients = new Set(orders.map((order) => order.client)).size
  const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0)
  const dailyCounts = useMemo(() => {
    const days = orders.map((order) => orderDay(order.created)).filter((day): day is number => day !== null)
    const last = days.length ? Math.max(...days) : 0
    const counts = Array(10).fill(0) as number[]
    for (const day of days) {
      const slot = 9 - (last - day)
      if (slot >= 0 && slot <= 9) counts[slot] += 1
    }
    return counts
  }, [orders])

  const courierStats = (name: string) => {
    const own = orders.filter((order) => order.agent === name)
    const shipped = own.filter((order) => order.status === "В пути" || order.status === "Доставлено").length
    const delivered = own.filter((order) => order.status === "Доставлено").length
    const returned = own.filter((order) => order.status === "Отменен").length
    return { shipped, delivered, returned }
  }
  const totalShipped = orders.filter((order) => order.status === "В пути" || order.status === "Доставлено").length
  const totalDelivered = orders.filter((order) => order.status === "Доставлено").length

  // Orders per agent over the 10 days ending at the most recent order.
  const trends = useMemo(() => {
    const days = orders.map((order) => orderDay(order.created)).filter((day): day is number => day !== null)
    const last = days.length ? Math.max(...days) : 0
    const byAgent = new Map<string, { sales: number[]; clients: Set<string>[] }>()
    for (const order of orders) {
      const day = orderDay(order.created)
      if (day === null) continue
      const slot = 9 - (last - day)
      if (slot < 0 || slot > 9) continue
      const entry = byAgent.get(order.agent) ?? { sales: Array(10).fill(0), clients: Array.from({ length: 10 }, () => new Set<string>()) }
      entry.sales[slot] += 1
      entry.clients[slot].add(order.client)
      byAgent.set(order.agent, entry)
    }
    return byAgent
  }, [orders])

  const visibleColumns = COLUMN_DEFS.filter((column) => visibleColumnKeys.includes(column.key))
  const fullName = (person: Person) => `${person.firstName} ${person.lastName}`.trim()
  const agents = people.length ? people : []
  const agentRows = agentsExpanded ? agents : agents.slice(0, 7)
  const courierRows = couriersExpanded ? agents : agents.slice(0, 7)

  return (
    <div className="space-y-5">
      <div className={`${CARD_CLASS} flex overflow-hidden`}>
        <SummaryBox value={String(agentCount)} label="Активные" tone="green" />
        <SummaryBox value={`${total - cancelled} / ${total} (${pct(total - cancelled, total)}%)`} label="Визиты по маршруту" tone="neutral" />
        <SummaryBox value={`${cancelled} / ${total} (${pct(cancelled, total)}%)`} label="Не посещено" tone="neutral" />
        <SummaryBox value={`0 / ${total} (0%)`} label="Вне маршрута" tone="neutral" />
        <SummaryBox value={String(cancelled)} label="Проблемные" tone="red" />
      </div>

      <div className={`${CARD_CLASS} overflow-x-auto pb-5`}>
        <table className="w-full min-w-[1100px] border-collapse text-[13px]">
          <thead>
            <tr>
              <SortHead>{t("Агент")}</SortHead>
              {visibleColumns.map((column) => (
                <SortHead key={column.key}>{t(column.label)}</SortHead>
              ))}
            </tr>
          </thead>
          <tbody />
        </table>
      </div>

      <div className={`${CARD_CLASS} overflow-hidden`}>
        <div className="grid grid-cols-3 divide-x divide-white/60 bg-[#3ac977] text-center text-[13px] font-semibold text-white">
          <button type="button" onClick={() => setTab("all")} className={`h-10 ${tab === "all" ? "bg-black/[0.06]" : ""}`}>
            {t("Все")}
          </button>
          <button type="button" onClick={() => setTab("one")} className={`h-10 ${tab === "one" ? "bg-black/[0.06]" : ""}`}>
            {t("Один")}
          </button>
          <button
            type="button"
            onClick={() => downloadExcelTable("visity-agenta-po-filialam.xls", [["Агент", ...visibleColumns.map((column) => column.label)]])}
            className="h-10"
          >
            {t("Скачать Excel")}
          </button>
        </div>
        <div className="overflow-x-auto pb-5">
          <table className="w-full min-w-[1100px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-[#f7f9fb]">
                {BRANCH_COLUMNS.map((column) => (
                  <SortHead key={column}>{t(column)}</SortHead>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="bg-[#454545] text-white">
                <td className="border-r border-[#666] px-[17px] py-3 font-bold">{t("Итого")}</td>
                {BRANCH_COLUMNS.slice(1).map((column, index) => (
                  <td key={column} className="border-r border-[#666] px-[17px] py-3 font-bold">
                    {index === 2 ? (
                      <span className={`rounded px-2 py-1 ${pct(total - cancelled, total) > 50 ? "bg-[#d4f5e0] text-[#2e9e5b]" : "bg-[#ffd9d9] text-[#e57373]"}`}>{pct(total - cancelled, total)}%</span>
                    ) : index === 7 ? (
                      <span className="rounded bg-[#d4f5e0] px-2 py-1 text-[#2e9e5b]">0%</span>
                    ) : (
                      [total, total, null, akbClients, total - cancelled, cancelled, 0, null, totalDelivered, cancelled, agentCount ? Math.round(total / agentCount) : 0][index]
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className={`${CARD_CLASS} flex flex-wrap items-end justify-between gap-4 px-[30px] py-[10px]`}>
        <div className="grid flex-1 grid-cols-1 gap-[44px] sm:grid-cols-3">
          <SelectField label={t("Группировка")} options={GROUPINGS} value={grouping} onChange={setGrouping} />
          <SelectField label={t("Измерять")} options={MEASURES} value={measure} onChange={setMeasure} />
          <SelectField label={t("Дата заказа")} options={ORDER_DATES} value={orderDate} onChange={setOrderDate} />
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setFilterOpen((open) => !open)}
            aria-expanded={filterOpen}
            className="flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] pl-3 text-[13px] font-semibold text-white hover:brightness-95"
          >
            <svg viewBox="0 0 24 24" className="mb-1 h-[18px] w-[18px] fill-white" aria-hidden>
              <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
            </svg>
            <span className="pl-2 pr-4">{t("Показать фильтр")}</span>
          </button>
          {filterOpen && (
            <AgentVisitsFilterPanel
              columns={COLUMN_DEFS}
              selected={visibleColumnKeys}
              onClose={() => setFilterOpen(false)}
              onSave={(keys) => {
                setVisibleColumnKeys(keys)
                setFilterOpen(false)
              }}
            />
          )}
        </div>
      </div>

      {byProduct.length === 0 ? (
        <div className={`${CARD_CLASS} flex h-[330px] flex-col items-center justify-center`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/robot-empty.png" alt="" className="w-[120px]" />
          <span className="-mt-[22px] text-[13px] text-[#888]">{t("Нет продаж")}</span>
        </div>
      ) : (
        <div className={`${CARD_CLASS} h-[330px] overflow-y-auto px-[30px] py-5`}>
          {byProduct.map(([name, count]) => (
            <div key={name} className="mb-3 flex items-center gap-3">
              <span className="w-[220px] shrink-0 truncate text-[13px]">{name}</span>
              <span className="h-[18px] rounded-[3px] bg-[#4f71dc]" style={{ width: `${(count / byProduct[0][1]) * 70}%` }} />
              <span className="text-[13px] font-semibold">{count}</span>
            </div>
          ))}
        </div>
      )}

      {showTrends && (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className={`${CARD_CLASS} overflow-hidden`}>
          <div className="grid grid-cols-4 border-b border-[#efefef] text-center">
            {[
              { value: String(total - cancelled), label: "Посещено", color: "#333" },
              { value: String(akbClients), label: "АКБ", color: "#81c784" },
              { value: String(cancelled), label: "Отказали", color: "#e57373" },
              { value: `${pct(totalDelivered, total)}%`, label: "Эф.маршрута", color: "#333" },
            ].map((cell) => (
              <div key={cell.label} className="border-r border-[#efefef] py-4 last:border-r-0">
                <div className="text-[18px] leading-6" style={{ color: cell.color }}>{cell.value}</div>
                <div className="text-[13px] text-[#666]">{t(cell.label)}</div>
              </div>
            ))}
          </div>
          <div className="px-5 pb-8 pt-10">
            <AxisChart values={dailyCounts} />
          </div>
        </div>
        <div className={`${CARD_CLASS} overflow-hidden`}>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[#efefef]">
                <th className="px-[17px] py-[18px] text-left font-semibold">{t("Агент")}</th>
                <th className="border-l border-[#efefef] px-[17px] py-[18px] text-left font-semibold">{t("Тенденция продаж (посл. 10 дней)")}</th>
                <th className="border-l border-[#efefef] px-[17px] py-[18px] text-left font-semibold">{t("Тенденция АКБ (посл. 10 дней)")}</th>
              </tr>
            </thead>
            <tbody>
              {agentRows.map((person) => (
                <tr key={person.id} className="h-[46px] border-b border-[#efefef]">
                  <td className="w-[140px] px-[17px]">{fullName(person)}</td>
                  <td className="border-l border-[#efefef] px-[10px]">
                    {trends.get(fullName(person)) && <Sparkline values={trends.get(fullName(person))!.sales} color="#4f71dc" />}
                  </td>
                  <td className="border-l border-[#efefef] px-[10px]">
                    {trends.get(fullName(person)) && <Sparkline values={trends.get(fullName(person))!.clients.map((set) => set.size)} color="#81c784" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {agents.length > 7 && <ShowMore expanded={agentsExpanded} onClick={() => setAgentsExpanded((value) => !value)} />}
        </div>
      </div>
      )}

      {showCouriers && (
      <div className={`${CARD_CLASS} overflow-hidden`}>
        <div className="grid grid-cols-2 sm:grid-cols-6">
          {[
            { value: String(totalShipped), label: `Отгружено: ${totalShipped} точек`, color: "#0d99ff" },
            { value: String(cancelled), label: "Возвраты с отг. заказов", color: "#e57373" },
            { value: String(cancelled), label: "Возвраты за период", color: "#e57373" },
            { value: `${totalDelivered} / ${totalShipped} (${totalShipped ? Math.round((totalDelivered / totalShipped) * 100) : 0}%)`, label: `Доставлено. Осталось: ${totalShipped - totalDelivered}`, color: "#0d99ff" },
            { value: String(totalDelivered), label: `Оплаты: ${totalDelivered} точек`, color: "#81c784" },
            { value: String(totalDelivered), label: "Кассир принял", color: "#81c784" },
          ].map((cell) => (
            <div key={cell.label} className="border-r border-[#efefef] py-4 text-center last:border-r-0">
              <div className="text-[18px] leading-6" style={{ color: cell.color }}>{cell.value}</div>
              <div className="text-[13px] text-[#666]">{t(cell.label)}</div>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] border-collapse text-[13px]">
            <thead>
              <tr className="bg-[#f7f9fb]">
                <th className="px-[17px] py-[10px] text-left font-semibold">{t("Доставщик")}</th>
                {["Отгружено", "Возвраты с отг. заказов", "Возвраты за период", "Посещено", "Не посещено", "Оплаты", "Кассир принял"].map((column) => (
                  <SortHead key={column}>{t(column)}</SortHead>
                ))}
              </tr>
            </thead>
            <tbody>
              {courierRows.map((person) => (
                <tr key={person.id} className="h-[46px] border-b border-[#efefef]">
                  <td className="px-[17px]">{fullName(person)}</td>
                  <td className="border-l border-[#efefef] px-[17px]">{courierStats(fullName(person)).shipped}</td>
                  <td className="border-l border-[#efefef] px-[17px]">{courierStats(fullName(person)).returned}</td>
                  <td className="border-l border-[#efefef] px-[17px]">{courierStats(fullName(person)).returned}</td>
                  <td className="border-l border-[#efefef] px-[17px]">{courierStats(fullName(person)).delivered} / {courierStats(fullName(person)).shipped}</td>
                  <td className="border-l border-[#efefef] px-[17px]">{courierStats(fullName(person)).shipped - courierStats(fullName(person)).delivered}</td>
                  <td className="border-l border-[#efefef] px-[17px]">{courierStats(fullName(person)).delivered}</td>
                  <td className="border-l border-[#efefef] px-[17px]">
                    <span className={`rounded px-[10px] py-[6px] ${courierStats(fullName(person)).delivered ? "bg-[#d4f5e0] text-[#2e9e5b]" : "bg-[#fde4e4] text-[#e57373]"}`}>{courierStats(fullName(person)).delivered}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {agents.length > 7 && <ShowMore expanded={couriersExpanded} onClick={() => setCouriersExpanded((value) => !value)} />}
      </div>
      )}
    </div>
  )
}
