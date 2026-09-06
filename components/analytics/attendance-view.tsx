"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FilePenLine,
  Filter,
  MapPin,
  PlusCircle,
  RefreshCw,
  Search,
  Star,
  UserRound,
  X,
} from "lucide-react"

const agents: string[] = []
const branches = ["777", "878", "agent", "Andijon", "AURUM samarqand", "baby still"]
const week = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"]

function sundaysInMonth(year: number, month: number) {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: daysInMonth }, (_, index) => index + 1).filter((day) => new Date(year, month, day).getDay() === 0)
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/55 p-5" onMouseDown={onClose}>
      <section role="dialog" aria-label={title} onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-3xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-9 py-6">
          <h2 className="text-xl font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть"><X className="h-7 w-7 text-slate-600" /></button>
        </header>
        {children}
      </section>
    </div>
  )
}

function WorkingTimeModal({ onClose }: { onClose: () => void }) {
  const [time, setTime] = useState("09:00")
  return (
    <Modal title="РАБОЧЕЕ ВРЕМЯ" onClose={onClose}>
      <div className="min-h-80 px-10 py-12">
        <label className="text-sm font-semibold">Считать опозданием после
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="mt-3 block w-full border-b py-3 text-lg outline-none" />
        </label>
      </div>
      <footer className="border-t px-9 py-5 text-right"><button type="button" onClick={onClose} className="font-bold text-sky-500">СОХРАНИТЬ</button></footer>
    </Modal>
  )
}

function WeekendModal({ onClose, selected, setSelected, year, month }: { onClose: () => void; selected: number[]; setSelected: (days: number[]) => void; year: number; month: number }) {
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const sundays = useMemo(() => sundaysInMonth(year, month), [year, month])
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const customDays = selected.filter((day) => !sundays.includes(day))
      await fetch("/api/attendance-weekend-days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month, days: customDays }),
      })
    } catch {
      // ignore network failures, still close like the rest of the app does
    }
    setSaving(false)
    onClose()
  }

  return (
    <Modal title="ДОБАВИТЬ ВЫХОДНЫЕ ДНИ" onClose={onClose}>
      <div className="px-9 py-7">
        <div className="mb-3 grid grid-cols-7 bg-slate-100 py-3 text-center">{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => <b key={day}>{day}</b>)}</div>
        <div className="grid grid-cols-7 gap-2 text-center">
          {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((day) => {
            const sunday = sundays.includes(day)
            const active = selected.includes(day) || sunday
            return <button key={day} type="button" onClick={() => setSelected(active ? selected.filter((item) => item !== day) : [...selected, day])} className={`h-14 rounded ${active ? "bg-sky-500 text-white" : "hover:bg-slate-100"}`}>{day}</button>
          })}
        </div>
      </div>
      <footer className="border-t px-9 py-4 text-right"><button type="button" disabled={saving} onClick={() => void save()} className="rounded bg-[#6bce87] px-6 py-3 font-bold text-white disabled:opacity-60">{saving ? "СОХРАНЕНИЕ..." : "СОХРАНИТЬ"}</button></footer>
    </Modal>
  )
}

function AgentDrawer({ name, onClose }: { name: string; onClose: () => void }) {
  const router = useRouter()
  const [visitDate, setVisitDate] = useState(() => new Date())
  const visitDateLabel = useMemo(() => {
    const months = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
    return `${visitDate.getDate()} ${months[visitDate.getMonth()]} ${visitDate.getFullYear()}`
  }, [visitDate])
  function shiftVisitDate(offset: number) {
    setVisitDate((current) => {
      const next = new Date(current)
      next.setDate(next.getDate() + offset)
      return next
    })
  }
  return (
    <aside className="fixed bottom-0 right-0 top-16 z-[900] flex w-[52vw] min-w-[720px] flex-col bg-slate-50 shadow-2xl">
      <header className="flex items-center gap-4 border-b bg-white px-6 py-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-500 text-white"><UserRound /></span>
        <strong>{name}</strong>
        <button type="button" onClick={() => router.push("/tracking")} className="ml-auto text-sky-500">Посмотреть на карте</button>
        <button type="button" onClick={onClose}><X /></button>
      </header>
      <div className="grid grid-cols-2 border-b bg-white px-7 py-4">
        <div className="flex items-center gap-3"><Clock3 className="h-8 w-8 text-slate-400" /><div><b className="text-2xl">0 <small>SUM</small></b><p>сделки</p></div></div>
        <div className="flex items-center justify-self-end gap-3"><MapPin className="h-8 w-8 text-slate-400" /><div><b className="text-2xl">0 / 0</b><p>посещено</p></div></div>
      </div>
      <div className="grid grid-cols-3 gap-4 p-6 text-center font-bold text-white">
        <div className="rounded bg-[#39ca79] py-3"><b className="text-2xl">0</b> Заказ оформлен</div>
        <div className="rounded bg-[#ff5d63] py-3"><b className="text-2xl">0</b> Отказы</div>
        <div className="rounded bg-[#13a0f4] py-3"><b className="text-2xl">0</b> Надо посетить</div>
      </div>
      <div className="mx-7 flex items-center gap-3 rounded bg-[#20abc8] px-4 py-2 font-bold text-white">
        <button type="button" onClick={() => shiftVisitDate(-1)} aria-label="Предыдущий день"><ChevronLeft /></button>
        {visitDateLabel}
        <button type="button" onClick={() => shiftVisitDate(1)} aria-label="Следующий день"><ChevronRight /></button>
      </div>
      <div className="m-7 flex flex-1 flex-col items-center justify-center border bg-white">
        <div className="text-7xl">🤖</div><p className="mt-5 text-slate-500">Для выбранного агента в эту дату не найдено планов</p>
      </div>
    </aside>
  )
}

export function AttendanceView() {
  const today = useMemo(() => new Date(), [])
  const [query, setQuery] = useState("")
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [filterOpen, setFilterOpen] = useState(false)
  const [branch, setBranch] = useState("")
  const [workingOpen, setWorkingOpen] = useState(false)
  const [weekendOpen, setWeekendOpen] = useState(false)
  const [weekends, setWeekends] = useState<number[]>(() => sundaysInMonth(today.getFullYear(), today.getMonth()))

  useEffect(() => {
    let cancelled = false
    setWeekends(sundaysInMonth(year, month))
    fetch(`/api/attendance-weekend-days?year=${year}&month=${month}`)
      .then((response) => (response.ok ? (response.json() as Promise<number[]>) : []))
      .then((customDays) => {
        if (cancelled || !customDays.length) return
        setWeekends((current) => Array.from(new Set([...current, ...customDays])).sort((a, b) => a - b))
      })
      .catch(() => {
        // keep the auto-computed Sundays if the request fails
      })
    return () => {
      cancelled = true
    }
  }, [year, month])
  const [selectedRows, setSelectedRows] = useState<string[]>([])
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [notice, setNotice] = useState("")
  const days = useMemo(() => Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, index) => index + 1), [year, month])
  const visibleAgents = agents.filter((agent) => agent.toLowerCase().includes(query.toLowerCase()))

  function download() {
    const csv = ["Агент;" + days.join(";"), ...visibleAgents.map((agent) => `${agent};${days.map(() => "0").join(";")}`)].join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a"); link.href = url; link.download = "attendance.csv"; link.click(); URL.revokeObjectURL(url)
  }

  function flash(text: string) { setNotice(text); window.setTimeout(() => setNotice(""), 1800) }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100">
      <header className="flex flex-wrap items-center gap-3 px-9 py-5">
        <FavoritesButton className="flex items-center gap-2 text-2xl font-bold text-[#526fe0]" /><span className="text-2xl text-slate-400">|</span><h1 className="text-2xl font-bold text-slate-600">Посещаемость</h1>
        <div className="ml-auto flex gap-3">
          <button type="button" onClick={() => setWeekendOpen(true)} className="flex items-center gap-2 rounded bg-[#6bce87] px-5 py-3 font-bold text-white"><PlusCircle />Добавить выходные дни</button>
          <button type="button" onClick={() => setWorkingOpen(true)} className="flex items-center gap-2 rounded bg-[#526fe0] px-5 py-3 font-bold text-white"><Clock3 />Рабочее время</button>
          <button type="button" onClick={() => flash("Данные обновлены")} className="flex items-center gap-2 rounded bg-[#526fe0] px-5 py-3 font-bold text-white"><RefreshCw />Обновить с excel</button>
          <button type="button" onClick={download} className="flex items-center gap-2 rounded bg-[#6bce87] px-5 py-3 font-bold text-white"><Download />Скачать</button>
        </div>
      </header>
      <section className="mx-9 overflow-hidden rounded-xl bg-white shadow">
        <div className="flex justify-end gap-5 border-b px-5 py-4">
          <button type="button" onClick={() => setEditMode((current) => !current)} className={`flex items-center gap-2 rounded px-6 py-2 font-bold text-white ${editMode ? "bg-green-500" : "bg-[#526fe0]"}`}><FilePenLine />{editMode ? "Сохранить" : "Изменить"}</button>
          <button type="button" onClick={() => flash("Перерасчет выполнен")} className="flex items-center gap-2 rounded bg-[#526fe0] px-6 py-2 font-bold text-white"><RefreshCw />Перерасчет</button>
        </div>
        <div className="flex items-center gap-10 border-b px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((current) => !current)} className="flex items-center gap-3 rounded bg-[#526fe0] px-5 py-3 font-bold text-white"><Filter />Показать фильтр</button>
          <label className="flex w-80 items-center border-b py-2"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="w-full outline-none" /><Search className="text-slate-500" /></label>
          <div className="ml-auto flex items-center gap-4">
            <button onClick={() => setYear(year - 1)} className="rounded bg-sky-50 p-3"><ChevronLeft /></button><b className="px-5 text-xl">{year}</b><button onClick={() => setYear(year + 1)} className="rounded bg-sky-50 p-3"><ChevronRight /></button>
            <button onClick={() => setMonth((month + 11) % 12)} className="rounded bg-sky-50 p-3"><ChevronLeft /></button><b className="w-24 text-center text-xl">{["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"][month]}</b><button onClick={() => setMonth((month + 1) % 12)} className="rounded bg-sky-50 p-3"><ChevronRight /></button>
          </div>
        </div>
        {filterOpen && <div className="absolute z-50 ml-5 mt-2 w-96 bg-white p-6 shadow-xl"><div className="flex justify-between text-lg text-slate-600">Фильтр<button onClick={() => setFilterOpen(false)}><X /></button></div><label className="mt-8 block font-bold">Филиал<select value={branch} onChange={(event) => setBranch(event.target.value)} className="mt-2 block w-full border-b bg-white py-3 font-normal"><option value="">Все филиалы</option>{branches.map((item) => <option key={item}>{item}</option>)}</select></label></div>}
        <div className="overflow-x-auto">
          <table className="min-w-[1850px] w-full border-collapse">
            <thead className="bg-slate-100"><tr><th className="w-14 p-4"><Filter /></th><th className="sticky left-0 z-10 min-w-72 bg-slate-100 p-4 text-left">Агент</th>{days.map((day) => <th key={day} className={`w-10 py-3 text-center ${weekends.includes(day) ? "text-red-400" : ""}`}>{String(day).padStart(2,"0")}<small className="block text-sky-500">{week[new Date(year, month, day).getDay()]}</small></th>)}<th className="min-w-48">Пришел вовремя</th></tr></thead>
            <tbody>{visibleAgents.map((agent) => <tr key={agent} className="border-t hover:bg-slate-50"><td className="p-5 text-center"><input type="checkbox" checked={selectedRows.includes(agent)} onChange={() => setSelectedRows(selectedRows.includes(agent) ? selectedRows.filter((item) => item !== agent) : [...selectedRows, agent])} className="h-6 w-6" /></td><td className="sticky left-0 bg-white p-4"><button type="button" onClick={() => setSelectedAgent(agent)} className="text-left text-slate-700 hover:text-sky-500">{agent}</button></td>{days.map((day) => <td key={day} className="text-center">{weekends.includes(day) ? <CalendarDays className="mx-auto h-5 w-5 text-red-400" /> : editMode ? <input type="checkbox" className="h-4 w-4" /> : <span className="text-red-400">×</span>}</td>)}<td className="text-center"><span className="text-green-500">0</span> / <span className="text-blue-500">0</span> / <span className="text-red-500">0</span> / {days.length - weekends.length}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      {workingOpen && <WorkingTimeModal onClose={() => setWorkingOpen(false)} />}
      {weekendOpen && <WeekendModal onClose={() => setWeekendOpen(false)} selected={weekends} setSelected={setWeekends} year={year} month={month} />}
      {selectedAgent && <AgentDrawer name={selectedAgent} onClose={() => setSelectedAgent(null)} />}
      {notice && <div className="fixed bottom-6 left-1/2 z-[1200] -translate-x-1/2 rounded bg-slate-800 px-6 py-3 text-white shadow-xl">{notice}</div>}
    </main>
  )
}
