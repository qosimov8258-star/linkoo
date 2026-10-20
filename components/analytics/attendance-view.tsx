"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { RI, RefButton, RefHeader } from "@/components/ref/list-kit"
import { ReportPage } from "@/components/ref/report-kit"
import { useDirectoryNames } from "@/components/clients/use-directory"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Search,
  UserRound,
  X,
} from "lucide-react"

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
  const { t } = useLanguage()
  // Branches of the factory itself (never another tenant's names).
  const branches = useDirectoryNames("branches")
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
  const [agents, setAgents] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    fetch("/api/employees")
      .then((response) => (response.ok ? (response.json() as Promise<{ name: string }[]>) : Promise.reject()))
      .then((data) => {
        if (!cancelled) setAgents(data.map((employee) => employee.name).filter(Boolean))
      })
      .catch(() => {
        if (!cancelled) setAgents([])
      })
    return () => {
      cancelled = true
    }
  }, [])
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

  const CAL = "M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z"
  const arrowBtn = "flex h-[34px] w-[68px] items-center justify-center bg-[#e8f1fb] hover:bg-[#d9e8f8]"
  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]">
        <RefHeader title={t("Посещаемость")}>
          <RefButton icon={RI.add} green label={t("Добавить выходные дни")} onClick={() => setWeekendOpen(true)} />
          <RefButton icon={RI.clock} label={t("Рабочее время")} onClick={() => setWorkingOpen(true)} />
          <RefButton icon={RI.sync} label={t("Обновить с excel")} onClick={() => flash(t("Данные обновлены"))} />
          <RefButton icon={RI.chart} green label={t("Скачать")} onClick={download} />
        </RefHeader>
      </div>
      <section className="mx-7 overflow-hidden rounded-[10px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="flex h-[52px] items-center justify-end gap-[19px] border-b border-[#ececec] px-[30px]">
          <RefButton icon={RI.edit} label={editMode ? t("Сохранить") : t("Изменить")} onClick={() => setEditMode((current) => !current)} />
          <RefButton icon={RI.sync} label={t("Перерасчет")} onClick={() => flash(t("Перерасчет выполнен"))} />
        </div>
        <div className="relative flex h-[53px] items-center px-[15px]">
          <button type="button" onClick={() => setFilterOpen((current) => !current)} className="flex h-[30px] w-[168px] items-center rounded-[5px] bg-[#4f71dc] pl-3 text-[13px] font-semibold text-white hover:brightness-95">
            <svg viewBox="0 0 24 24" className="mr-3 h-[18px] w-[18px] fill-white" aria-hidden><path d={RI.filter} /></svg>{t("Показать фильтр")}
          </button>
          <label className="relative ml-[102px] block h-[28px] w-[250px] border-b border-[#e0e0e0]">
            {!query && <span className="pointer-events-none absolute left-0 top-[5px] text-[13px] font-semibold text-black">{t("Поиск")}</span>}
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-full w-full bg-transparent pr-8 text-[13px] outline-none" aria-label={t("Поиск")} />
            <Search className="pointer-events-none absolute right-[2px] top-[2px] h-5 w-5 text-[#444]" />
          </label>
          <div className="ml-auto flex items-center gap-[10px] text-[13px]">
            <button onClick={() => setYear(year - 1)} className={arrowBtn} aria-label={t("Предыдущий год")}><ChevronLeft className="h-5 w-5" /></button><b className="w-[48px] text-center text-[14px] font-semibold">{year}</b><button onClick={() => setYear(year + 1)} className={arrowBtn} aria-label={t("Следующий год")}><ChevronRight className="h-5 w-5" /></button>
            <button onClick={() => setMonth((month + 11) % 12)} className={`${arrowBtn} ml-[5px]`} aria-label={t("Предыдущий месяц")}><ChevronLeft className="h-5 w-5" /></button><b className="w-[85px] text-center text-[14px] font-semibold">{t(["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"][month])}</b><button onClick={() => setMonth((month + 1) % 12)} className={arrowBtn} aria-label={t("Следующий месяц")}><ChevronRight className="h-5 w-5" /></button>
          </div>
        </div>
        {filterOpen && <div className="absolute z-50 ml-[15px] mt-[2px] w-[340px] bg-white p-6 text-[13px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]"><div className="flex justify-between text-[14px] font-semibold">{t("Фильтр")}<button onClick={() => setFilterOpen(false)}><X className="h-5 w-5" /></button></div><label className="mt-6 block font-semibold">{t("Филиал")}<select value={branch} onChange={(event) => setBranch(event.target.value)} className="mt-2 block w-full border-b bg-white py-2 font-normal"><option value="">{t("Все филиалы")}</option>{branches.map((item) => <option key={item}>{item}</option>)}</select></label></div>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1250px] table-fixed border-collapse text-[13px]">
            <colgroup><col className="w-[78px]" /><col className="w-[200px]" />{days.map((day) => <col key={day} className="w-[27px]" />)}<col className="w-[190px]" /></colgroup>
            <thead className="bg-[#f2f5f8]"><tr className="h-[55px]"><th className="text-center"><svg viewBox="0 0 24 24" className="mx-auto h-6 w-6 fill-none stroke-[#333] stroke-2" aria-hidden><path d="M4 4h16v16H4z" strokeDasharray="3 2" /></svg></th><th className="px-[6px] text-left font-semibold">{t("Агент")}</th>{days.map((day) => <th key={day} className={`text-center text-[12px] font-bold leading-4 text-[#555]`}>{String(day).padStart(2,"0")}<small className={`block text-[11px] font-semibold ${weekends.includes(day) ? "text-[#f06c6c]" : "text-[#1ea1f2]"}`}>{t(week[new Date(year, month, day).getDay()])}</small></th>)}<th className="whitespace-nowrap text-center font-semibold">{t("Пришел вовремя")} <svg viewBox="0 0 24 24" className="ml-1 inline h-5 w-5 fill-none stroke-[#4f71dc] stroke-2 align-middle" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" strokeLinecap="round" /></svg></th></tr></thead>
            <tbody>{visibleAgents.map((agent) => <tr key={agent} className="h-[52px] border-b border-[#ececec] hover:bg-[#f7f9fb]"><td className="text-center"><input type="checkbox" checked={selectedRows.includes(agent)} onChange={() => setSelectedRows(selectedRows.includes(agent) ? selectedRows.filter((item) => item !== agent) : [...selectedRows, agent])} className="h-[18px] w-[18px] cursor-pointer accent-[#444]" /></td><td className="truncate px-[6px]"><button type="button" onClick={() => setSelectedAgent(agent)} className="text-left hover:text-[#4f71dc]">{agent}</button></td>{days.map((day) => <td key={day} className="text-center">{weekends.includes(day) ? <svg viewBox="0 0 24 24" className="mx-auto h-[14px] w-[14px] fill-[#f06c6c]" aria-hidden><path d={CAL} /></svg> : editMode ? <input type="checkbox" className="h-[13px] w-[13px] cursor-pointer" /> : <span className="mx-auto block h-[11px] w-[11px] rounded-[2px] border border-[#d0d0d0]" />}</td>)}<td className="text-center"><span className="text-[#43a047]">0</span> / <span className="text-[#4f71dc]">0</span> / <span className="text-[#f06c6c]">0</span> / {days.length - weekends.length}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
      {workingOpen && <WorkingTimeModal onClose={() => setWorkingOpen(false)} />}
      {weekendOpen && <WeekendModal onClose={() => setWeekendOpen(false)} selected={weekends} setSelected={setWeekends} year={year} month={month} />}
      {selectedAgent && <AgentDrawer name={selectedAgent} onClose={() => setSelectedAgent(null)} />}
      {notice && <div className="fixed bottom-6 left-1/2 z-[1200] -translate-x-1/2 rounded bg-slate-800 px-6 py-3 text-white shadow-xl">{notice}</div>}
    </ReportPage>
  )
}
