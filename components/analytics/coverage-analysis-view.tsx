"use client"

import { FormEvent, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Download, Star, X } from "lucide-react"

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

const zones: ZoneRow[] = [
  ["Не указано", 1952, 0, 30, 0, 0, 150, 1802],
  ["Фрунзе", 79, 0, 0, 0, 0, 0, 79],
  ["Залиния", 73, 0, 0, 0, 0, 1, 72],
  ["Ургут", 54, 0, 0, 0, 0, 0, 54],
  ["Геофизика", 51, 0, 0, 0, 0, 1, 50],
  ["Равонак", 50, 0, 0, 0, 0, 1, 49],
  ["Гагарина", 48, 0, 0, 0, 0, 1, 47],
  ["Ургут шахар 2", 48, 0, 0, 0, 0, 0, 48],
  ["Жума шахар бозор", 47, 0, 0, 0, 0, 0, 47],
  ["Дальний лагерь 1", 43, 0, 0, 0, 0, 2, 41],
  ["Дальний лагерь", 43, 0, 0, 0, 0, 1, 42],
  ["spark", 41, 2, 41, 0, 0, 32, 7],
  ["Дагбитская", 41, 0, 0, 0, 0, 0, 41],
  ["Мотрид сити", 41, 0, 0, 0, 0, 0, 41],
  ["Самкоч-Фрунзе", 41, 0, 0, 0, 0, 0, 41],
  ["Челляк", 40, 0, 0, 0, 0, 2, 38],
  ["Иштихон", 40, 0, 0, 0, 0, 0, 40],
  ["Тош. ост-ка", 40, 0, 0, 0, 0, 3, 37],
  ["Окмачит", 40, 0, 0, 0, 0, 0, 40],
  ["Карасув - Племсавхоз", 39, 0, 0, 0, 0, 0, 39],
  ["Пайшанба", 39, 0, 0, 0, 0, 1, 38],
  ["Согдиана", 38, 0, 0, 0, 0, 0, 38],
  ["Каттакурган шахар", 38, 0, 0, 0, 0, 0, 38],
  ["Гор Больница", 38, 0, 0, 0, 0, 0, 38],
  ["Вокзал", 37, 0, 0, 0, 0, 0, 37],
  ["Октябрьская - Титова", 37, 0, 0, 0, 0, 0, 37],
  ["Мотрид", 37, 0, 0, 0, 0, 0, 37],
  ["Лоиш", 36, 0, 0, 0, 0, 1, 35],
  ["Грибной", 36, 0, 0, 0, 0, 2, 34],
  ["Бульвар-сафеди", 35, 0, 0, 0, 0, 2, 33],
  ["Chinobod zona", 5, 0, 5, 0, 0, 5, 0],
  ["Каттакурган", 4, 0, 0, 0, 0, 0, 4],
  ["Yunusobod", 2, 0, 5, 0, 0, 2, 0],
  ["Arslan", 2, 0, 15, 0, 0, 2, 0],
  ["chilonzor", 2, 0, 0, 0, 0, 2, 0],
  ["Andijon shaharchasi", 1, 0, 15, 0, 0, 1, 0],
].map(([zone, okb, akb, visits, refusal, newPoints, stopped, noOrder]) => ({ zone, okb, akb, visits, refusal, newPoints, stopped, noOrder })) as ZoneRow[]

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
const clientTypes = ["Все типы клиентов", "horeca", "market", "market100", "market101"]

function iso(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function CoverageAnalysisView() {
  const router = useRouter()
  const now = useMemo(() => new Date(), [])
  const [favorite, setFavorite] = useState(true)
  const [period, setPeriod] = useState("СВОЯ")
  const [from, setFrom] = useState(() => iso(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [to, setTo] = useState(() => iso(now))
  const [clientType, setClientType] = useState(clientTypes[0])
  const [activeClientType, setActiveClientType] = useState(clientTypes[0])
  const [territoryOpen, setTerritoryOpen] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const [selectedZones, setSelectedZones] = useState<string[]>(zones.map((row) => row.zone))
  const [sort, setSort] = useState<{ key: keyof ZoneRow; asc: boolean }>({ key: "okb", asc: false })
  const [tableVisible, setTableVisible] = useState(true)
  const [hovered, setHovered] = useState<string | null>(null)

  const visibleRows = useMemo(() => {
    const factor = activeClientType === clientTypes[0] ? 1 : 0.65
    return zones
      .filter((row) => selectedZones.includes(row.zone))
      .map((row) => ({ ...row, okb: Math.round(row.okb * factor), noOrder: Math.round(row.noOrder * factor) }))
      .sort((a, b) => {
        const av = a[sort.key]
        const bv = b[sort.key]
        const compared = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv, "ru") : Number(av) - Number(bv)
        return sort.asc ? compared : -compared
      })
  }, [activeClientType, selectedZones, sort])

  const totalOkb = visibleRows.reduce((sum, row) => sum + row.okb, 0)
  const totalAkb = visibleRows.reduce((sum, row) => sum + row.akb, 0)
  const totalVisits = visibleRows.reduce((sum, row) => sum + row.visits, 0)
  const akbPercent = totalOkb ? (totalAkb / totalOkb) * 100 : 0
  const routePercent = totalOkb ? (totalVisits / totalOkb) * 100 : 0

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
        <button type="button" onClick={() => setFavorite(!favorite)} className="flex items-center gap-2 text-[#5470e8]"><Star className={`h-6 w-6 ${favorite ? "fill-[#5470e8]" : "fill-slate-500 text-slate-500"}`} />Избранные</button>
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
          <Metric value={totalOkb} label="ОКБ" /><Metric value={3231} label="План ОКБ" /><Metric value={totalVisits} label="В маршруте" /><Metric value={totalAkb} label="АКБ" green /><Metric value={0} label="Новый" />
          <Metric value={1052} label="Не подтвержденные" red /><Metric value={2913} label="Нет маршрута" red /><Metric value={3231} label="Неправильный ИНН" red /><Metric value={895} label="Нет территории" red /><Metric value={11} label="Закрыто" red />
        </div>
        <Ring value={routePercent} label="В МАРШРУТЕ" />
      </section>

      <CoverageChart rows={visibleRows.slice(0, 28)} hovered={hovered} setHovered={setHovered} />

      <section className="mt-8 overflow-hidden rounded-xl bg-white shadow">
        {tableVisible && <table className="w-full table-fixed border-collapse text-xs md:text-sm"><thead className="bg-slate-100"><tr>{[["zone", "Зона"], ["okb", "ОКБ"], ["akb", "АКБ"], ["visits", "Визит"], ["refusal", "Отказ"], ["newPoints", "Новые точки"], ["stopped", "Перестали покупать < 30 дней"], ["noOrder", "Нет заказа до сегодняшнего дня"]].map(([key, title]) => <th key={key} onClick={() => sortBy(key as keyof ZoneRow)} className="cursor-pointer border-b px-2 py-4 text-left">{title} ↕</th>)}</tr></thead><tbody>{visibleRows.map((row) => <tr key={row.zone}><td className="border px-2 py-3">{row.zone}</td><td className="border px-2 py-3 text-sky-500">{format(row.okb)}</td><td className={`border px-2 py-3 font-bold text-white ${row.akb ? "bg-emerald-400" : "bg-[#e57373]"}`}>{row.okb ? `${((row.akb / row.okb) * 100).toFixed(1)} %` : "0 %"} <span className="float-right">{row.akb}</span></td><td className="border px-2 py-3">{row.visits}</td><td className="border px-2 py-3">{row.refusal}</td><td className="border px-2 py-3">{row.newPoints}</td><td className="border px-2 py-3">{row.stopped}</td><td className="border px-2 py-3">{row.noOrder}</td></tr>)}</tbody></table>}
        <div className="flex justify-center gap-4 bg-slate-100 py-2"><button type="button" onClick={() => setTableVisible(!tableVisible)} className="text-[#5470e8]">{tableVisible ? "Скрыть ▲" : "Показать ▼"}</button><button type="button" onClick={download} aria-label="Скачать таблицу"><Download className="h-5 w-5" /></button></div>
      </section>

      {territoryOpen && <TerritoryDialog selected={selectedZones} onChange={setSelectedZones} onClose={() => setTerritoryOpen(false)} />}
      {dateOpen && <DateDialog from={from} to={to} setFrom={setFrom} setTo={setTo} onClose={() => { setPeriod("СВОЯ"); setDateOpen(false) }} />}
    </main>
  )
}

function Ring({ value, label }: { value: number; label: string }) { const shown = Math.min(100, value); return <div className="mx-auto flex h-40 w-40 flex-col items-center justify-center rounded-full border-[10px] border-slate-100 text-center shadow-[inset_0_0_12px_#aaa,0_0_12px_#aaa]" style={{ background: `conic-gradient(#18c8a0 ${shown}%, transparent ${shown}%)` }}><div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-white"><strong className="text-3xl">{value.toFixed(1).replace(".", ",")} %</strong><small>{label}</small></div></div> }
function Metric({ value, label, red, green }: { value: number; label: string; red?: boolean; green?: boolean }) { return <div className="border-b border-r px-3 py-5 text-center"><strong className={`text-2xl ${red ? "text-[#ef7373]" : green ? "text-[#6ccd8b]" : "text-sky-500"}`}>{format(value)}</strong><p className="mt-1 text-slate-600">{label}</p></div> }
function CoverageChart({ rows, hovered, setHovered }: { rows: ZoneRow[]; hovered: string | null; setHovered: (value: string | null) => void }) { const max = Math.max(...rows.map((row) => row.okb), 1); return <section className="mt-1 rounded-xl bg-white p-5 shadow"><div className="flex h-72 items-end gap-1 border-b border-l px-2">{rows.map((row) => <div key={row.zone} onMouseEnter={() => setHovered(row.zone)} onMouseLeave={() => setHovered(null)} className="relative flex min-w-0 flex-1 items-end justify-center"><span className="w-2/3 bg-sky-400" style={{ height: `${Math.max(2, (row.okb / max) * 230)}px` }} /><span className="absolute bottom-0 w-1/3 bg-emerald-400" style={{ height: `${Math.max(1, row.akb * 40)}px` }} />{hovered === row.zone && <span className="absolute bottom-16 z-10 w-44 rounded bg-white p-3 text-xs shadow-xl"><b>{row.zone}</b><br />ОКБ: {row.okb}<br />АКБ: {row.akb}<br />Визит: {row.visits}</span>}</div>)}</div><div className="mt-3 flex justify-center gap-5 text-sm"><span className="text-sky-500">● ОКБ</span><span className="text-emerald-500">● АКБ</span><span className="text-pink-500">● Отказ</span></div></section> }
function TerritoryDialog({ selected, onChange, onClose }: { selected: string[]; onChange: (value: string[]) => void; onClose: () => void }) { return <Modal title="Изменить территории" onClose={onClose}><label className="mb-4 flex gap-3 font-bold"><input type="checkbox" checked={selected.length === zones.length} onChange={(event) => onChange(event.target.checked ? zones.map((row) => row.zone) : [])} />Выбрать все</label><div className="grid max-h-[430px] gap-2 overflow-y-auto sm:grid-cols-2">{zones.map((row) => <label key={row.zone} className="flex gap-3 border-b py-2"><input type="checkbox" checked={selected.includes(row.zone)} onChange={() => onChange(selected.includes(row.zone) ? selected.filter((item) => item !== row.zone) : [...selected, row.zone])} />{row.zone}</label>)}</div><button type="button" onClick={onClose} className="mt-5 w-full rounded bg-[#5470e8] py-3 font-bold text-white">Применить</button></Modal> }
function DateDialog({ from, to, setFrom, setTo, onClose }: { from: string; to: string; setFrom: (value: string) => void; setTo: (value: string) => void; onClose: () => void }) { return <Modal title="Изменить сроки" onClose={onClose}><div className="grid gap-5 sm:grid-cols-2"><label>Дата от<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-2 block w-full border-b py-2" /></label><label>Дата до<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="mt-2 block w-full border-b py-2" /></label></div><button type="button" onClick={onClose} className="mt-8 w-full rounded bg-[#5470e8] py-3 font-bold text-white">Применить</button></Modal> }
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <><button type="button" aria-label="Закрыть" onClick={onClose} className="fixed inset-0 z-[90] bg-black/50" /><section role="dialog" className="fixed left-1/2 top-1/2 z-[100] w-[min(720px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 bg-white p-7 shadow-2xl"><header className="mb-6 flex justify-between text-xl font-bold">{title}<button type="button" onClick={onClose}><X /></button></header>{children}</section></> }
function format(value: number) { return value.toLocaleString("ru-RU") }
function formatDate(value: string) { const [year, month, day] = value.split("-"); const months = ["", "Января", "Февраля", "Марта", "Апреля", "Мая", "Июня", "Июля", "Августа", "Сентября", "Октября", "Ноября", "Декабря"]; return `${day} ${months[Number(month)]} ${year}` }
