"use client"

import { FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { X } from "lucide-react"
import * as echarts from "echarts"
import { ReportPage, ReportSelectField, WidgetHeader, WidgetUserCard } from "@/components/ref/report-kit"
import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { formatRangeLabel, parseISODate } from "@/lib/dashboard-date-range"
import { useLanguage } from "@/lib/i18n/language-context"

type ZoneRow = {
  zone: string
  okb: number
  akb: number
  visits: number
  refusal: number
  newPoints: number
  stopped: number
  noOrder: number
}

type ClientRecord = { name: string; zone: string; type: string; inn?: string; zoneAgent: string; tab: string; balance?: number; inRoute?: boolean }
type OrderRecord = { client: string; created: string; createdAt?: string; status: string }

const ALL_CLIENT_TYPES = ""

function iso(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function CoverageAnalysisView() {
  const { t } = useLanguage()
  const router = useRouter()
  const now = useMemo(() => new Date(), [])
  // Like the reference, the tab opens on the current calendar month.
  const [period, setPeriod] = useState("МЕСЯЦ")
  const [from, setFrom] = useState(() => iso(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [to, setTo] = useState(() => iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)))
  const [clients, setClients] = useState<ClientRecord[]>([])
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [clientType, setClientType] = useState(ALL_CLIENT_TYPES)
  const [activeClientType, setActiveClientType] = useState(ALL_CLIENT_TYPES)
  const [territoryOpen, setTerritoryOpen] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const [daysOpen, setDaysOpen] = useState(false)
  const [activeDays, setActiveDays] = useState("14")
  const [inactiveDays, setInactiveDays] = useState("30")
  const [selectedZones, setSelectedZones] = useState<string[]>([])
  const [zonesInitialized, setZonesInitialized] = useState(false)
  const [sort, setSort] = useState<{ key: keyof ZoneRow; asc: boolean }>({ key: "okb", asc: false })
  const [tableVisible, setTableVisible] = useState(false)

  // The analytics menu opens the tab for today's date (?beginDate=…&endDate=…); the reference then shows "СВОЯ".
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const begin = params.get("beginDate")
    const end = params.get("endDate")
    if (!begin || !end) return
    const kinds: Record<string, string> = { today: "СЕГОДНЯ", yesterday: "ВЧЕРА", week: "ПОСЛ. 7", month: "МЕСЯЦ", ownDate: "СВОЯ" }
    setFrom(begin)
    setTo(end)
    setPeriod(kinds[params.get("typeDate") ?? ""] ?? "СВОЯ")
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/clients")
      .then((response) => (response.ok ? (response.json() as Promise<ClientRecord[]>) : Promise.reject()))
      .then((data) => {
        if (!cancelled) setClients(data)
      })
      .catch(() => {
        if (!cancelled) setClients([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/orders")
      .then((response) => (response.ok ? (response.json() as Promise<OrderRecord[]>) : Promise.reject()))
      .then((data) => {
        if (!cancelled) setOrders(data)
      })
      .catch(() => {
        if (!cancelled) setOrders([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const clientTypes = useMemo(
    () => [ALL_CLIENT_TYPES, ...Array.from(new Set(clients.map((client) => client.type).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ru"))],
    [clients],
  )

  // Per-client order history (ISO-dated orders only — legacy rows written in
  // display format like "25 июля 17:17" have no reliable year and are
  // skipped rather than guessed) used to derive АКБ, refusals, new points and
  // churn per zone below.
  const clientOrderStats = useMemo(() => {
    const stats = new Map<string, { orders: { date: string | null; status: string }[]; firstDate: string | null; lastDate: string | null }>()
    for (const order of orders) {
      const match = (order.createdAt || order.created).match(/^(\d{4}-\d{2}-\d{2})/)
      const date = match ? match[1] : null
      const entry = stats.get(order.client) ?? { orders: [], firstDate: null, lastDate: null }
      entry.orders.push({ date, status: order.status })
      if (date) {
        if (!entry.firstDate || date < entry.firstDate) entry.firstDate = date
        if (!entry.lastDate || date > entry.lastDate) entry.lastDate = date
      }
      stats.set(order.client, entry)
    }
    return stats
  }, [orders])

  // Real client base grouped by zone. ОКБ = clients registered in the zone;
  // В маршруте/Нет маршрута come from whether an agent route (zoneAgent) is
  // assigned; АКБ/Отказ/Новые точки come from that client's orders inside the
  // selected period; Перестали покупать/Нет заказа come from how long ago
  // (relative to today) their last known order was.
  const zones = useMemo<ZoneRow[]>(() => {
    const byZone = new Map<string, ZoneRow>()
    for (const client of clients) {
      if (activeClientType !== ALL_CLIENT_TYPES && client.type !== activeClientType) continue
      const zoneName = client.zone || "Не указано"
      const row = byZone.get(zoneName) ?? { zone: zoneName, okb: 0, akb: 0, visits: 0, refusal: 0, newPoints: 0, stopped: 0, noOrder: 0 }
      row.okb += 1

      const stats = clientOrderStats.get(client.name)
      if (!stats) {
        row.noOrder += 1
      } else {
        const inPeriod = stats.orders.filter((order) => order.date && order.date >= from && order.date <= to)
        if (inPeriod.length > 0) row.akb += 1
        row.refusal += inPeriod.filter((order) => order.status === "Отменен").length
        if (stats.firstDate && stats.firstDate >= from && stats.firstDate <= to) row.newPoints += 1
        if (stats.lastDate) {
          const daysSince = (now.getTime() - new Date(stats.lastDate).getTime()) / 86400000
          if (daysSince >= (Number(inactiveDays) || 30)) row.stopped += 1
        }
      }
      byZone.set(zoneName, row)
    }
    return Array.from(byZone.values()).sort((a, b) => a.zone.localeCompare(b.zone, "ru"))
  }, [clients, activeClientType, clientOrderStats, from, to, now, inactiveDays])

  useEffect(() => {
    if (!zonesInitialized && zones.length > 0) {
      setSelectedZones(zones.map((row) => row.zone))
      setZonesInitialized(true)
    }
  }, [zones, zonesInitialized])

  const visibleRows = useMemo(() => {
    return zones
      .filter((row) => selectedZones.includes(row.zone))
      .sort((a, b) => {
        const av = a[sort.key]
        const bv = b[sort.key]
        const compared = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "ru") : Number(av) - Number(bv)
        return sort.asc ? compared : -compared
      })
  }, [zones, selectedZones, sort])

  const totalOkb = visibleRows.reduce((sum, row) => sum + row.okb, 0)
  const totalAkb = visibleRows.reduce((sum, row) => sum + row.akb, 0)
  const totalNew = visibleRows.reduce((sum, row) => sum + row.newPoints, 0)
  const akbPercent = totalOkb ? (totalAkb / totalOkb) * 100 : 0

  // Clients belonging to the currently selected territories/type — the same
  // set the zone table shows — used for the tab/inn based breakdown metrics.
  const visibleClients = useMemo(() => {
    const zoneSet = new Set(selectedZones)
    return clients.filter((client) => {
      if (activeClientType !== ALL_CLIENT_TYPES && client.type !== activeClientType) return false
      return zoneSet.has(client.zone || "Не указано")
    })
  }, [clients, activeClientType, selectedZones])

  const planOkb = visibleClients.filter((client) => client.tab === "plan").length
  const unconfirmedCount = visibleClients.filter((client) => client.tab === "unconfirmed").length
  const closedCount = visibleClients.filter((client) => client.tab === "closing").length
  // Like the reference, the route / INN / territory problems are counted over the planned client base (ПЛАН ОКБ).
  const planClients = visibleClients.filter((client) => client.tab === "plan")
  const totalVisits = planClients.filter((client) => client.inRoute).length
  const noTerritoryCount = planClients.filter((client) => !client.zone).length
  const invalidInnCount = planOkb
  const noRouteCount = planOkb - totalVisits
  const routePercent = planOkb ? (totalVisits / planOkb) * 100 : 0

  function changePeriod(value: string) {
    setPeriod(value)
    const end = new Date()
    const start = new Date(end)
    if (value === "СЕГОДНЯ") start.setTime(end.getTime())
    if (value === "ВЧЕРА") { start.setDate(end.getDate() - 1); end.setDate(end.getDate() - 1) }
    if (value === "ПОСЛ. 7") start.setDate(end.getDate() - 6)
    if (value === "МЕСЯЦ") {
      start.setDate(1)
      end.setMonth(end.getMonth() + 1, 0)
    }
    if (value !== "СВОЯ") { setFrom(iso(start)); setTo(iso(end)) }
  }
  function apply(event: FormEvent) {
    event.preventDefault()
    setActiveClientType(clientType)
  }
  function download() {
    const csv = ["Зона;ОКБ;АКБ;Визит;Отказ;Новые точки;Перестали покупать;Нет заказа", ...visibleRows.map((row) => [row.zone, row.okb, row.akb, row.visits, row.refusal, row.newPoints, row.stopped, row.noOrder].join(";"))].join("\n")
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "coverage-analysis.csv"
    link.click()
    URL.revokeObjectURL(url)
  }
  function sortBy(key: keyof ZoneRow) {
    setSort((current) => ({ key, asc: current.key === key ? !current.asc : true }))
  }

  const card = "bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
  return (
    <ReportPage>
      <WidgetHeader active="ОХВАТ" />

      <WidgetUserCard
        rangeSlot={
          <div className="relative ml-auto mr-[15px]">
            <button type="button" onClick={() => setDateOpen((open) => !open)} className="text-[13px] font-bold capitalize text-[#4f71dc]">
              {formatRangeLabel(parseISODate(from), parseISODate(to))}
            </button>
            {dateOpen && (
              <DateRangePicker
                positionClassName="right-[-5px] top-[calc(100%+21px)]"
                begin={from}
                end={to}
                onClose={() => setDateOpen(false)}
                onApply={(begin, end) => {
                  setPeriod("СВОЯ")
                  setFrom(begin)
                  setTo(end)
                  setDateOpen(false)
                }}
              />
            )}
          </div>
        }
        period={period}
        onPeriod={(item) => (item === "СВОЯ" ? setPeriod("СВОЯ") : changePeriod(item))}
      >
        <button type="button" onClick={() => router.push("/clients/territory?openInfo=true")} className="ml-[11px] mr-[18px] h-[30px] rounded-[3px] bg-[#71ce87] px-[15px] text-[13px] font-semibold text-white hover:brightness-95">Изменить территории</button>
        <button type="button" onClick={() => setDaysOpen(true)} className="mr-[9px] h-[30px] rounded-[3px] bg-[#4f71dc] px-[15px] text-[13px] font-semibold text-white hover:brightness-95">Изменить сроки</button>
      </WidgetUserCard>

      <div className="mx-[30px]">
      <form onSubmit={apply} className={`${card} mt-[20px] flex h-[77px] items-center gap-[10px] px-[30px] pb-[12px]`}>
        <div className="w-[250px]"><ReportSelectField label="Тип клиента" value={clientType} onChange={setClientType} options={clientTypes.filter((item) => item !== ALL_CLIENT_TYPES && item !== "Все типы клиентов")} /></div>
        <button className="mt-[2px] h-[30px] rounded-[3px] bg-[#4f71dc] px-[15px] text-[13px] font-semibold text-white hover:brightness-95">Применить</button>
      </form>

      <section className={`${card} mt-[10px] grid items-center rounded-t-[10px] lg:h-[178.7px] lg:grid-cols-[289px_1fr_227px]`}>
        <Ring value={akbPercent} label="АКБ %" />
        <div className="grid grid-cols-2 md:grid-cols-5">
          <Metric value={totalOkb} label="ОКБ" /><Metric value={planOkb} label="План ОКБ" /><Metric value={totalVisits} label="В маршруте" /><Metric value={totalAkb} label="АКБ" green /><Metric value={totalNew} label="Новый" />
          <Metric value={unconfirmedCount} label="Не подтвержденные" red /><Metric value={noRouteCount} label="Нет маршрута" red /><Metric value={invalidInnCount} label="Неправильный ИНН" red /><Metric value={noTerritoryCount} label="Нет территории" red /><Metric value={closedCount} label="Закрыто" red />
        </div>
        <Ring value={routePercent} label="В МАРШРУТЕ" />
      </section>

      <CoverageChart rows={visibleRows} />

      <section className={`${card} mt-[30px] overflow-hidden rounded-[10px]`}>
        <table className="w-full table-fixed border-collapse text-[13px] text-[#333]">
          <colgroup>
            {[125.3, 82.1, 201.5, 95.1, 94, 141.6, 255.7, 270.7, 125.3, 48.3].map((width, index) => <col key={index} style={{ width: `${(width / 1440) * 100}%` }} />)}
          </colgroup>
          <thead>
            <tr className="h-[48px] bg-[#f0f4f9] text-left text-[13px] font-semibold text-[#374557]">
              {([["zone", "Зона"], ["okb", "ОКБ"], ["akb", "АКБ"], ["visits", "Визит"], ["refusal", "Отказ"], ["newPoints", "Новые точки"], ["stopped", `${t("Перестали покупать <")} ${inactiveDays || 30} ${t("дней")}`], ["noOrder", "Нет заказа до сегодняшнего дня"]] as [keyof ZoneRow, string][]).map(([key, title]) => (
                <th key={key} onClick={() => sortBy(key)} className={`cursor-pointer select-none px-[17.5px] font-semibold ${key === "zone" ? "" : "border-l border-white"}`}>
                  {key === "stopped" ? title : t(title)}
                  {key !== "zone" && <svg viewBox="0 0 10 14" className="ml-[8px] inline h-[10px] w-[7px] fill-[#8a94a6]" aria-hidden><path d="M5 0l4 5H1zM5 14L1 9h8z" /></svg>}
                </th>
              ))}
              <th className="whitespace-nowrap border-l border-white px-[17.5px] font-semibold">{t("Тендения акб")}</th>
              <th className="border-l border-white text-center">
                <span className="-my-[1px] inline-flex h-12 w-12 items-center justify-center">
                  <button type="button" onClick={download} aria-label={t("Скачать Excel")} className="inline-flex"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#555]"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg></button>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(tableVisible ? visibleRows : visibleRows.slice(0, 8)).map((row) => {
              const percent = row.okb ? (row.akb / row.okb) * 100 : 0
              return (
                <tr key={row.zone} className="h-[46px] border-b border-[#eee]">
                  <td className="border-r border-[#eee] px-[17.5px] py-[8px] leading-[20px]">{row.zone}</td>
                  <td className="border-r border-[#eee] px-[17.5px]"><a href={`/clients?zone=${encodeURIComponent(row.zone)}`} className="text-[#129fdd]">{format(row.okb)}</a></td>
                  <td className={`border-r border-white px-[17.5px] font-semibold text-white ${row.akb ? "bg-[#71ce87]" : "bg-[#e57373]"}`}>
                    <span className="flex justify-between"><span>{percentLabel(percent)} %</span><span>{row.akb}</span></span>
                  </td>
                  <td className="border-r border-[#eee] px-[17.5px]">{row.visits}</td>
                  <td className="border-r border-[#eee] px-[17.5px]">{row.refusal}</td>
                  <td className="border-r border-[#eee] px-[17.5px]">{row.newPoints}</td>
                  <td className="border-r border-[#eee] px-[17.5px]">{row.stopped}</td>
                  <td className="border-r border-[#eee] px-[17.5px]">{format(row.noOrder)}</td>
                  <td className="border-r border-[#eee]" />
                  <td />
                </tr>
              )
            })}
          </tbody>
        </table>
        <button
          type="button"
          onClick={() => setTableVisible(!tableVisible)}
          className="mx-[17.5px] my-[5px] flex h-[30px] w-[calc(100%-35px)] items-center justify-center gap-[6px] rounded-[100px] bg-[#f0f4f8] text-[13px] text-[#5869f0]"
        >
          {tableVisible ? t("Скрыть") : t("Показать еще")}
          <svg viewBox="0 0 24 24" className={`h-4 w-4 fill-[#5869f0] ${tableVisible ? "rotate-180" : ""}`} aria-hidden><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" /></svg>
        </button>
      </section>

      </div>
      {daysOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onMouseDown={(event) => event.target === event.currentTarget && setDaysOpen(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              setDaysOpen(false)
            }}
            className="w-[500px] max-w-full bg-white text-[13px] text-[#333] shadow-[0_10px_30px_rgba(0,0,0,0.3)]"
          >
            <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[28px]">
              <b className="uppercase">Изменить дни</b>
              <button type="button" onClick={() => setDaysOpen(false)} aria-label="Закрыть"><X className="h-6 w-6" /></button>
            </header>
            <div className="px-[30px] pb-[16px] pt-[16px]">
              <label className="relative block h-[67px] border-b border-[#e0e0e0]">
                <span className="absolute left-0 top-[12px] text-[10px] font-bold leading-3">Количество дней для активных клиентов</span>
                <input value={activeDays} onChange={(event) => setActiveDays(event.target.value)} className="absolute inset-x-0 bottom-0 h-[34px] bg-transparent text-[13px] font-semibold outline-none" />
              </label>
              <label className="relative mt-[0px] block h-[67px] border-b border-[#e0e0e0]">
                <span className="absolute left-0 top-[12px] text-[10px] font-bold leading-3">Количество дней для неактивных клиентов</span>
                <input value={inactiveDays} onChange={(event) => setInactiveDays(event.target.value)} className="absolute inset-x-0 bottom-0 h-[34px] bg-transparent text-[13px] font-semibold outline-none" />
              </label>
            </div>
            <footer className="flex h-[57px] items-center justify-end border-t border-[#efefef] pr-[10px]">
              <button type="submit" className="h-9 rounded-[3px] bg-[#71ce87] px-[16px] text-[13px] font-bold uppercase text-white hover:brightness-95">Сохранить</button>
            </footer>
          </form>
        </div>
      )}
      {territoryOpen && <TerritoryDialog zones={zones} selected={selectedZones} onChange={setSelectedZones} onClose={() => setTerritoryOpen(false)} />}
    </ReportPage>
  )
}

// The reference draws the gauge with apexcharts: a 270° track starting at the bottom left, and a round-capped arc that fades
// from blue (where it starts) to green (where it ends).
let ringId = 0
function Ring({ value, label }: { value: number; label: string }) {
  const shown = Math.max(0, Math.min(100, value))
  const [gradientId] = useState(() => `coverage-ring-${++ringId}`)
  const radius = 63.5
  const track = 2 * Math.PI * radius * 0.75
  const arc = (shown / 100) * track
  const point = (degrees: number) => [67 + radius * Math.cos((degrees * Math.PI) / 180), 67 + radius * Math.sin((degrees * Math.PI) / 180)]
  const [startX, startY] = point(135)
  const [endX, endY] = point(135 + shown * 2.7)
  return (
    <div className="relative mx-auto flex h-[134px] w-[134px] items-center justify-center rounded-full border-[7px] border-[#f1f1f1] shadow-[inset_0_0_8px_#bbb,0_0_8px_#bbb]">
      {shown > 0 && (
        <svg viewBox="0 0 134 134" className="pointer-events-none absolute -left-[7px] -top-[7px] h-[134px] w-[134px]" aria-hidden>
          <defs>
            <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={startX} y1={startY} x2={endX} y2={endY}>
              <stop offset="0" stopColor="#0d99ff" />
              <stop offset="1" stopColor="#abe5a1" />
            </linearGradient>
          </defs>
          <circle
            cx="67"
            cy="67"
            r={radius}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${Math.max(arc, 0.01)} ${2 * Math.PI * radius}`}
            transform="rotate(135 67 67)"
          />
        </svg>
      )}
      <div className="relative flex h-[100px] w-[100px] flex-col items-center justify-center rounded-full bg-white text-center">
        <strong className="text-[24px] font-bold leading-[30px] text-[#333]">{percentLabel(value)} %</strong>
        <small className="text-[10px] font-semibold uppercase leading-[12.5px] text-[#675c5c]">{label}</small>
      </div>
    </div>
  )
}
function Metric({ value, label, red, green }: { value: number; label: string; red?: boolean; green?: boolean }) {
  return (
    <div className="flex min-h-[77.3px] flex-col items-center justify-start border-b border-r border-[#efefef] px-[26px] py-[15px] text-center [&:nth-child(5n)]:border-r-0 [&:nth-child(n+6)]:min-h-[95px] [&:nth-last-child(-n+5)]:border-b-0">
      <strong className={`text-[22px] font-semibold leading-[27.5px] ${red ? "text-[#e57373]" : green ? "text-[#71ce87]" : "text-[#129fdd]"}`}>{format(value)}</strong>
      <p className="m-0 text-[15px] font-semibold leading-5 text-[#666]">{label}</p>
    </div>
  )
}
const CHART_COLORS = {
  akb: "#00e096",
  refusal: "#e3236a",
} as const

function CoverageChart({ rows }: { rows: ZoneRow[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  const series = useMemo(() => ({ zones: rows.map((row) => row.zone), akb: rows.map((row) => row.akb), refusal: rows.map((row) => row.refusal) }), [rows])

  useEffect(() => {
    if (!containerRef.current) return
    const chart = echarts.init(containerRef.current)
    chartRef.current = chart
    const resizeObserver = new ResizeObserver(() => chart.resize())
    resizeObserver.observe(containerRef.current)
    return () => {
      resizeObserver.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const { zones, akb, refusal } = series
    const max = Math.max(1, ...akb, ...refusal)
    const box = (color: string) => ({
      type: "scatter" as const,
      symbol: "roundRect",
      symbolSize: [16, 16],
      itemStyle: { color },
      label: { show: true, position: "inside" as const, color: "#fff", fontSize: 11, fontWeight: 600 },
    })
    chart.setOption({
      animation: false,
      grid: { left: 14, right: 36, top: 30, bottom: 120 },
      tooltip: { trigger: "axis", axisPointer: { type: "line" } },
      legend: { bottom: 8, left: "center", icon: "circle", itemWidth: 10, itemHeight: 10, itemGap: 10, textStyle: { color: "#373d3f", fontSize: 12 }, data: ["АКБ", "Отказ"] },
      xAxis: {
        type: "category",
        data: zones,
        axisLabel: { rotate: 45, interval: 0, fontSize: 12, color: "#373d3f" },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: { type: "value", position: "right", min: 0, max, minInterval: 1, splitNumber: 1, axisLabel: { color: "#373d3f", fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: "#e0e0e0" } } },
      series: [
        { name: "АКБ", data: akb, ...box(CHART_COLORS.akb) },
        { name: "Отказ", data: refusal, ...box(CHART_COLORS.refusal) },
      ],
    })
  }, [series])

  return (
    <section className="h-[365px] rounded-[10px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <div ref={containerRef} className="h-full w-full" />
    </section>
  )
}
function TerritoryDialog({ zones, selected, onChange, onClose }: { zones: ZoneRow[]; selected: string[]; onChange: (value: string[]) => void; onClose: () => void }) { return <Modal title="Изменить территории" onClose={onClose}><label className="mb-4 flex gap-3 font-bold"><input type="checkbox" checked={selected.length === zones.length} onChange={(event) => onChange(event.target.checked ? zones.map((row) => row.zone) : [])} />Выбрать все</label><div className="grid max-h-[430px] gap-2 overflow-y-auto sm:grid-cols-2">{zones.map((row) => <label key={row.zone} className="flex gap-3 border-b py-2"><input type="checkbox" checked={selected.includes(row.zone)} onChange={() => onChange(selected.includes(row.zone) ? selected.filter((item) => item !== row.zone) : [...selected, row.zone])} />{row.zone}</label>)}</div><button type="button" onClick={onClose} className="mt-5 w-full rounded bg-[#5470e8] py-3 font-bold text-white">Применить</button></Modal> }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <><button type="button" aria-label="Закрыть" onClick={onClose} className="fixed inset-0 z-[90] bg-black/50" /><section role="dialog" className="fixed left-1/2 top-1/2 z-[100] w-[min(720px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 bg-white p-7 shadow-2xl"><header className="mb-6 flex justify-between text-xl font-bold">{title}<button type="button" onClick={onClose}><X /></button></header>{children}</section></> }
function percentLabel(value: number) { return (Math.round(value * 10) / 10).toString().replace(".", ",") }
function format(value: number) { return value.toLocaleString("ru-RU") }
