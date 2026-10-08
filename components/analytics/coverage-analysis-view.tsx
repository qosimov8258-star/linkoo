"use client"

import { FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Download, X } from "lucide-react"
import * as echarts from "echarts"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

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

type ClientRecord = { name: string; zone: string; type: string; inn?: string; zoneAgent: string; tab: string; balance?: number }
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
const ALL_CLIENT_TYPES = "Все типы клиентов"

function iso(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function CoverageAnalysisView() {
  const router = useRouter()
  const now = useMemo(() => new Date(), [])
  const [period, setPeriod] = useState("СВОЯ")
  const [from, setFrom] = useState(() => iso(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [to, setTo] = useState(() => iso(now))
  const [clients, setClients] = useState<ClientRecord[]>([])
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [clientType, setClientType] = useState(ALL_CLIENT_TYPES)
  const [activeClientType, setActiveClientType] = useState(ALL_CLIENT_TYPES)
  const [territoryOpen, setTerritoryOpen] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
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
      if (client.zoneAgent && client.zoneAgent !== "Не указано") row.visits += 1

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
  const totalVisits = visibleRows.reduce((sum, row) => sum + row.visits, 0)
  const totalNew = visibleRows.reduce((sum, row) => sum + row.newPoints, 0)
  const akbPercent = totalOkb ? (totalAkb / totalOkb) * 100 : 0
  const routePercent = totalOkb ? (totalVisits / totalOkb) * 100 : 0

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
  const noTerritoryCount = visibleClients.filter((client) => !client.zone).length
  const invalidInnCount = visibleClients.filter((client) => !isValidInn(client.inn)).length
  const noRouteCount = totalOkb - totalVisits

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

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 pb-8 sm:px-9">
      <header className="flex flex-wrap items-center gap-3 py-4 text-xl font-bold sm:text-2xl">
        <FavoritesButton className="flex items-center gap-2 text-[#5470e8]" />
        <span className="text-slate-500">|</span><h1 className="text-slate-600">Виджеты</h1>
        <nav className="ml-auto flex flex-wrap overflow-hidden rounded shadow">{tabs.map((tab) => <button key={tab} type="button" onClick={() => { const href = tabHref[tab]; if (href) router.push(href) }} className={`border px-5 py-2 text-sm font-medium ${tab === "ОХВАТ" ? "bg-green-500 text-white" : "bg-white"}`}>{tab}</button>)}</nav>
      </header>

      <section className="flex flex-wrap items-center gap-5 rounded bg-white px-9 py-6 shadow">
        <div className="flex items-center gap-3 text-lg font-semibold"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-500 text-white">A</span>Admin Ritm <small className="text-slate-400">Сервер: (https://time3.linko.uz)</small></div>
        <strong className="ml-auto text-[#5470e8]">{formatDate(from)} - {formatDate(to)}</strong>
        <div className="flex flex-wrap overflow-hidden rounded shadow">{["СЕГОДНЯ", "ВЧЕРА", "ПОСЛ. 7", "МЕСЯЦ", "СВОЯ"].map((item) => <button key={item} type="button" onClick={() => item === "СВОЯ" ? setDateOpen(true) : changePeriod(item)} className={`border px-5 py-2 ${period === item ? "bg-[#5470e8] text-white" : "bg-white"}`}>{item}</button>)}</div>
        <button type="button" onClick={() => setTerritoryOpen(true)} className="rounded bg-[#6ccd8b] px-5 py-2 font-bold text-white">Изменить территории</button>
        <button type="button" onClick={() => setDateOpen(true)} className="rounded bg-[#5470e8] px-5 py-2 font-bold text-white">Изменить сроки</button>
      </section>

      <form onSubmit={apply} className="mt-6 flex items-end gap-3 rounded bg-white px-9 py-6 shadow">
        <label className="w-full max-w-xs font-semibold">Тип клиента<select value={clientType} onChange={(event) => setClientType(event.target.value)} className="mt-1 block w-full border-b bg-white py-2 font-normal">{clientTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
        <button className="rounded bg-[#5470e8] px-5 py-2 font-bold text-white">Применить</button>
      </form>

      <section className="mt-3 grid items-center gap-5 rounded-xl bg-white px-7 py-4 shadow lg:grid-cols-[240px_1fr_240px]">
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

      {territoryOpen && <TerritoryDialog zones={zones} selected={selectedZones} onChange={setSelectedZones} onClose={() => setTerritoryOpen(false)} />}
      {dateOpen && <DateDialog from={from} to={to} setFrom={setFrom} setTo={setTo} onClose={() => { setPeriod("СВОЯ"); setDateOpen(false) }} />}
    </main>
  )
}

function Ring({ value, label }: { value: number; label: string }) { const shown = Math.min(100, value); return <div className="mx-auto flex h-40 w-40 flex-col items-center justify-center rounded-full border-[10px] border-slate-100 text-center shadow-[inset_0_0_12px_#aaa,0_0_12px_#aaa]" style={{ background: `conic-gradient(#18c8a0 ${shown}%, transparent ${shown}%)` }}><div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-white"><strong className="text-3xl">{value.toFixed(1).replace(".", ",")} %</strong><small>{label}</small></div></div> }
function Metric({ value, label, red, green }: { value: number; label: string; red?: boolean; green?: boolean }) { return <div className="border-b border-r px-3 py-5 text-center"><strong className={`text-2xl ${red ? "text-[#ef7373]" : green ? "text-[#6ccd8b]" : "text-sky-500"}`}>{format(value)}</strong><p className="mt-1 text-slate-600">{label}</p></div> }
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
function formatDate(value: string) { const [year, month, day] = value.split("-"); const months = ["", "Января", "Февраля", "Марта", "Апреля", "Мая", "Июня", "Июля", "Августа", "Сентября", "Октября", "Ноября", "Декабря"]; return `${day} ${months[Number(month)]} ${year}` }
