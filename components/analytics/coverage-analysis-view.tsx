"use client"

import { FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Download, X } from "lucide-react"
import * as echarts from "echarts"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportPage, ReportSelectField, WidgetHeader, WidgetUserCard } from "@/components/ref/report-kit"

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
type OrderRecord = { client: string; created: string; status: string }

const tabs = ["ВИДЖЕТЫ", "KPI", "БАЛАНС", "ОХВАТ", "ФИЛИАЛ", "P&L", "ДОЛГ КЛИЕНТОВ", "ПРОДАЖА", "ГИБКИЙ ДАШБОРД"]
const tabHref: Partial<Record<string, string>> = {
  "ВИДЖЕТЫ": "/",
  "P&L": "/analytics/pnl",
  "ДОЛГ КЛИЕНТОВ": "/analytics/client-debts",
  "ГИБКИЙ ДАШБОРД": "/analytics/flexible-dashboard",
  "ФИЛИАЛ": "/analytics/branch-tab",
  "ПРОДАЖА": "/analytics/sales-tab",
  "KPI": "/analytics/kpi-performance",
  "БАЛАНС": "/analytics/balance-tab",
}
const ALL_CLIENT_TYPES = ""

function iso(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function CoverageAnalysisView() {
  const router = useRouter()
  const now = useMemo(() => new Date(), [])
  const [period, setPeriod] = useState("СВОЯ")
  const [from, setFrom] = useState(() => iso(now))
  const [to, setTo] = useState(() => iso(now))
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
  const [tableVisible, setTableVisible] = useState(true)

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
      const match = order.created.match(/^(\d{4}-\d{2}-\d{2})/)
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
      const zoneName = client.zone || "Без зоны"
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
          if (daysSince >= 30) row.stopped += 1
        }
      }
      byZone.set(zoneName, row)
    }
    return Array.from(byZone.values()).sort((a, b) => a.zone.localeCompare(b.zone, "ru"))
  }, [clients, activeClientType, clientOrderStats, from, to, now])

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
      return zoneSet.has(client.zone || "Без зоны")
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
    if (value === "МЕСЯЦ") start.setDate(1)
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
  const ghost = "h-[30px] px-4 text-[13px] font-medium uppercase transition-colors"
  return (
    <ReportPage>
      <WidgetHeader active="ОХВАТ" />

      <WidgetUserCard
        range={`${formatDate(from)}${from === to ? "" : ` - ${formatDate(to)}`}`}
        period={period}
        onPeriod={(item) => (item === "СВОЯ" ? setPeriod("СВОЯ") : changePeriod(item))}
      >
        <button type="button" onClick={() => router.push("/clients/territory?openInfo=true")} className="mr-[18px] h-[30px] rounded-[3px] bg-[#71ce87] px-[15px] text-[13px] font-semibold text-white hover:brightness-95">Изменить территории</button>
        <button type="button" onClick={() => setDaysOpen(true)} className="h-[30px] rounded-[3px] bg-[#4f71dc] px-[15px] text-[13px] font-semibold text-white hover:brightness-95">Изменить сроки</button>
      </WidgetUserCard>

      <div className="mx-[30px]">
      <form onSubmit={apply} className={`${card} mt-[20px] flex h-[77px] items-center gap-[10px] px-[30px]`}>
        <div className="w-[250px]"><ReportSelectField label="Тип клиента" value={clientType} onChange={setClientType} options={clientTypes.filter((item) => item !== ALL_CLIENT_TYPES && item !== "Все типы клиентов")} /></div>
        <button className="mt-[2px] h-[30px] rounded-[3px] bg-[#4f71dc] px-[15px] text-[13px] font-semibold text-white hover:brightness-95">Применить</button>
      </form>

      <section className={`${card} mt-[10px] grid items-center gap-y-[20px] rounded-[12px] px-[30px] py-[20px] lg:grid-cols-[230px_1fr_167px] lg:gap-x-[30px]`}>
        <Ring value={akbPercent} label="АКБ %" />
        <div className="grid grid-cols-2 md:grid-cols-5">
          <Metric value={totalOkb} label="ОКБ" /><Metric value={planOkb} label="План ОКБ" /><Metric value={totalVisits} label="В маршруте" /><Metric value={totalAkb} label="АКБ" green /><Metric value={totalNew} label="Новый" />
          <Metric value={unconfirmedCount} label="Не подтвержденные" red /><Metric value={noRouteCount} label="Нет маршрута" red /><Metric value={invalidInnCount} label="Неправильный ИНН" red /><Metric value={noTerritoryCount} label="Нет территории" red /><Metric value={closedCount} label="Закрыто" red />
        </div>
        <Ring value={routePercent} label="В МАРШРУТЕ" />
      </section>

      <CoverageChart rows={visibleRows.slice(0, 28)} />

      <section className="mt-8 overflow-hidden rounded-xl bg-white shadow">
        {tableVisible && <table className="w-full table-fixed border-collapse text-xs md:text-sm"><thead className="bg-slate-100"><tr>{[["zone", "Зона"], ["okb", "ОКБ"], ["akb", "АКБ"], ["visits", "Визит"], ["refusal", "Отказ"], ["newPoints", "Новые точки"], ["stopped", "Перестали покупать < 30 дней"], ["noOrder", "Нет заказа до сегодняшнего дня"]].map(([key, title]) => <th key={key} onClick={() => sortBy(key as keyof ZoneRow)} className="cursor-pointer border-b px-2 py-4 text-left">{title} ↕</th>)}</tr></thead><tbody>{visibleRows.map((row) => <tr key={row.zone}><td className="border px-2 py-3">{row.zone}</td><td className="border px-2 py-3 text-sky-500">{format(row.okb)}</td><td className={`border px-2 py-3 font-bold text-white ${row.akb ? "bg-emerald-400" : "bg-[#e57373]"}`}>{row.okb ? `${((row.akb / row.okb) * 100).toFixed(1)} %` : "0 %"} <span className="float-right">{row.akb}</span></td><td className="border px-2 py-3">{row.visits}</td><td className="border px-2 py-3">{row.refusal}</td><td className="border px-2 py-3">{row.newPoints}</td><td className="border px-2 py-3">{row.stopped}</td><td className="border px-2 py-3">{row.noOrder}</td></tr>)}</tbody></table>}
        <div className="flex justify-center gap-4 bg-slate-100 py-2"><button type="button" onClick={() => setTableVisible(!tableVisible)} className="text-[#5470e8]">{tableVisible ? "Скрыть ▲" : "Показать ▼"}</button><button type="button" onClick={download} aria-label="Скачать таблицу"><Download className="h-5 w-5" /></button></div>
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
      {dateOpen && <DateDialog from={from} to={to} setFrom={setFrom} setTo={setTo} onClose={() => { setPeriod("СВОЯ"); setDateOpen(false) }} />}
    </ReportPage>
  )
}

function Ring({ value, label }: { value: number; label: string }) {
  const shown = Math.min(100, value)
  return (
    <div className="mx-auto flex h-[134px] w-[134px] items-center justify-center rounded-full border-[7px] border-[#f1f1f1] shadow-[inset_0_0_8px_#bbb,0_0_8px_#bbb]" style={{ background: `conic-gradient(#18c8a0 ${shown}%, transparent ${shown}%)` }}>
      <div className="flex h-[100px] w-[100px] flex-col items-center justify-center rounded-full bg-white text-center">
        <strong className="text-[22px] font-bold leading-6">{value.toFixed(1).replace(".", ",")} %</strong>
        <small className="text-[8px] font-semibold uppercase leading-3">{label}</small>
      </div>
    </div>
  )
}
function Metric({ value, label, red, green }: { value: number; label: string; red?: boolean; green?: boolean }) {
  return (
    <div className="flex min-h-[76px] flex-col items-center justify-center border-b border-r border-[#efefef] px-2 py-[12px] text-center [&:nth-child(5n)]:border-r-0 [&:nth-last-child(-n+5)]:border-b-0">
      <strong className={`text-[22px] font-semibold leading-6 ${red ? "text-[#ef7373]" : green ? "text-[#71ce87]" : "text-[#1ea1f2]"}`}>{format(value)}</strong>
      <p className="mt-[2px] text-[16px] leading-[19px] text-[#555]">{label}</p>
    </div>
  )
}
const CHART_COLORS = {
  factSotuv: "#4d7cfe", // Fakt sotuv (=ОКБ) — ko'k
  akb: "#3ecf8e", // АКБ — yashil
  radEtilish: "#f2557d", // Отказ — pushti
} as const

function formatThousands(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")
}

function CoverageChart({ rows }: { rows: ZoneRow[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  // Legend/tooltip use the reference app's own labels ("Fakt sotuv", "AKB",
  // "Rad etilish"); the underlying data is the same ОКБ/АКБ/Отказ this page
  // already shows elsewhere (client count per zone, active clients in the
  // period, cancelled orders in the period) — there is no separate sales-
  // amount field to source "Fakt sotuv" from.
  const series = useMemo(() => {
    const zones = rows.map((row) => row.zone)
    const factSotuv = rows.map((row) => row.okb)
    const akb = rows.map((row) => row.akb)
    const radEtilish = rows.map((row) => row.refusal)
    return { zones, factSotuv, akb, radEtilish }
  }, [rows])

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

    const { zones, factSotuv, akb, radEtilish } = series
    const leftMax = Math.max(32000, ...factSotuv)
    const rightMax = Math.max(2, ...akb)

    chart.setOption({
      color: [CHART_COLORS.factSotuv, CHART_COLORS.akb, CHART_COLORS.radEtilish],
      grid: { left: 56, right: 48, top: 24, bottom: 96 },
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "line",
          lineStyle: { type: "dashed", color: "#b8bcc4" },
          label: { backgroundColor: "#6a7985" },
        },
        backgroundColor: "rgba(255,255,255,0.98)",
        borderWidth: 0,
        extraCssText: "box-shadow:0 6px 24px rgba(0,0,0,.15); border-radius:8px;",
        textStyle: { color: "#1f2430" },
      },
      legend: {
        bottom: 4,
        icon: "circle",
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: "#5b6270", fontSize: 12 },
        data: ["Fakt sotuv", "AKB", "Rad etilish"],
      },
      xAxis: {
        type: "category",
        data: zones,
        axisLabel: { rotate: 55, fontSize: 10, color: "#8a90a0", interval: 0 },
        axisLine: { lineStyle: { color: "#e3e5ea" } },
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: "value",
          min: 0,
          max: leftMax,
          splitNumber: 4,
          axisLabel: { formatter: formatThousands, color: "#8a90a0" },
          splitLine: { lineStyle: { color: "#eef0f3" } },
        },
        {
          type: "value",
          min: 0,
          max: rightMax,
          interval: 1,
          axisLabel: { color: "#8a90a0" },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: "Fakt sotuv",
          type: "line",
          yAxisIndex: 0,
          data: factSotuv,
          symbol: "circle",
          symbolSize: 6,
          smooth: true,
          lineStyle: { width: 2, color: CHART_COLORS.factSotuv },
          areaStyle: { color: CHART_COLORS.factSotuv, opacity: 0.15 },
          label: {
            show: true,
            position: "top",
            formatter: (p: { value: number }) => (p.value ? formatThousands(p.value) : ""),
            color: "#fff",
            backgroundColor: CHART_COLORS.factSotuv,
            borderRadius: 8,
            padding: [2, 6],
            fontSize: 11,
          },
        },
        {
          name: "AKB",
          type: "line",
          yAxisIndex: 1,
          data: akb,
          symbol: "circle",
          symbolSize: 6,
          smooth: true,
          lineStyle: { width: 2, color: CHART_COLORS.akb },
          areaStyle: { color: CHART_COLORS.akb, opacity: 0.2 },
          label: {
            show: true,
            position: "top",
            formatter: (p: { value: number }) => (p.value ? String(p.value) : ""),
            color: "#fff",
            backgroundColor: CHART_COLORS.akb,
            borderRadius: 8,
            padding: [2, 6],
            fontSize: 11,
          },
        },
        {
          name: "Rad etilish",
          type: "line",
          yAxisIndex: 0,
          data: radEtilish,
          symbol: "circle",
          symbolSize: 4,
          lineStyle: { width: 2, color: CHART_COLORS.radEtilish },
          label: {
            show: true,
            position: "bottom",
            formatter: (p: { value: number }) => String(p.value),
            color: "#fff",
            backgroundColor: CHART_COLORS.radEtilish,
            borderRadius: 8,
            padding: [1, 5],
            fontSize: 10,
          },
        },
      ],
    })
  }, [series])

  return (
    <section className="mt-1 rounded-xl bg-white p-5 shadow">
      <div ref={containerRef} style={{ width: "100%", height: 420 }} />
    </section>
  )
}
function TerritoryDialog({ zones, selected, onChange, onClose }: { zones: ZoneRow[]; selected: string[]; onChange: (value: string[]) => void; onClose: () => void }) { return <Modal title="Изменить территории" onClose={onClose}><label className="mb-4 flex gap-3 font-bold"><input type="checkbox" checked={selected.length === zones.length} onChange={(event) => onChange(event.target.checked ? zones.map((row) => row.zone) : [])} />Выбрать все</label><div className="grid max-h-[430px] gap-2 overflow-y-auto sm:grid-cols-2">{zones.map((row) => <label key={row.zone} className="flex gap-3 border-b py-2"><input type="checkbox" checked={selected.includes(row.zone)} onChange={() => onChange(selected.includes(row.zone) ? selected.filter((item) => item !== row.zone) : [...selected, row.zone])} />{row.zone}</label>)}</div><button type="button" onClick={onClose} className="mt-5 w-full rounded bg-[#5470e8] py-3 font-bold text-white">Применить</button></Modal> }
function DateDialog({ from, to, setFrom, setTo, onClose }: { from: string; to: string; setFrom: (value: string) => void; setTo: (value: string) => void; onClose: () => void }) { return <Modal title="Изменить сроки" onClose={onClose}><div className="grid gap-5 sm:grid-cols-2"><label>Дата от<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-2 block w-full border-b py-2" /></label><label>Дата до<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="mt-2 block w-full border-b py-2" /></label></div><button type="button" onClick={onClose} className="mt-8 w-full rounded bg-[#5470e8] py-3 font-bold text-white">Применить</button></Modal> }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <><button type="button" aria-label="Закрыть" onClick={onClose} className="fixed inset-0 z-[90] bg-black/50" /><section role="dialog" className="fixed left-1/2 top-1/2 z-[100] w-[min(720px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 bg-white p-7 shadow-2xl"><header className="mb-6 flex justify-between text-xl font-bold">{title}<button type="button" onClick={onClose}><X /></button></header>{children}</section></> }
function isValidInn(inn: string | undefined) { return !!inn && /^\d{9}$/.test(inn.trim()) }
function format(value: number) { return value.toLocaleString("ru-RU") }
function formatDate(value: string) { const [year, month, day] = value.split("-"); const months = ["", "Янв.", "Февр.", "Март", "Апр.", "Май", "Июнь", "Июль", "Авг.", "Сент.", "Окт.", "Нояб.", "Дек."]; return `${Number(day)} ${months[Number(month)]} ${year}` }
