"use client"

import { X } from "lucide-react"
import { createPortal } from "react-dom"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { Modal, SaveButton } from "@/components/analytics/catalog-ui"
import { FilterToggle } from "@/components/analytics/internal-transfers-filter"
import { ROW_ICONS } from "@/components/analytics/settings-list-kit"
import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { RI, RefButton, RefCard, RefFilterPanel, RefHeader, RefImportDialog, RefPage, RefTabs, RefToolbar } from "@/components/ref/list-kit"
import { formatReportDate } from "@/components/ref/report-kit"
import { Check, MultiSelectField, type Option } from "@/components/staff/staff-kit"
import { readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

type Person = { id: number; firstName: string; secondName: string }
type Plan = { id: number; comment: string; date: string; status: string; response: string; imageUrl: string }
type Task = {
  id: number
  title: string
  status: "new" | "in_progress" | "done" | "finished"
  createdDate: string
  endDate: string | null
  responsibleUser: Person | null
  createdBy: Person | null
  market: { id: number; name: string } | null
  todayPlans: Plan[]
}

const TABS = [
  { label: "В процессе", status: "in_progress" },
  { label: "Выполнено", status: "done" },
  { label: "Завершенный", status: "finished" },
  { label: "Все", status: "" },
]

const ICON_PATHS = {
  clock: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
  done: "M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z",
  all: "M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z",
  fresh: "M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zM8.5 15H7.3l-2.55-3.5V15H3.5V9h1.25l2.5 3.5V9H8.5v6zm5-4.74H11v1.12h2.5v1.26H11v1.11h2.5V15h-4V9h4v1.26zm7 3.74c0 .55-.45 1-1 1h-4c-.55 0-1-.45-1-1V9h1.25v4.51h1.13V9.99h1.25v3.51h1.12V9h1.25v5z",
  undone: "M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z",
}

function statusIcon(status: string): { label: string; color: string; path: string } | null {
  switch (status) {
    case "in_progress":
    case "pending":
      return { label: "В процессе", color: "#ff9800", path: ICON_PATHS.clock }
    case "done":
      return { label: "Выполнено", color: "#4caf50", path: ICON_PATHS.done }
    case "finished":
      return { label: "Завершено", color: "rgb(79, 113, 220)", path: ICON_PATHS.all }
    case "undone":
      return { label: "Не выполнено", color: "#e57373", path: ICON_PATHS.undone }
    case "new":
      return { label: "Новый", color: "#2196f3", path: ICON_PATHS.fresh }
    default:
      return null
  }
}

const MONTHS_SHORT = ["янв.", "февр.", "март", "апр.", "май", "июнь", "июль", "авг.", "сент.", "окт.", "нояб.", "дек."]
function shortDate(iso: string | null, withTime = false) {
  if (!iso) return ""
  let [date, time] = iso.replace("T", " ").split(" ")
  if (withTime && time) {
    // the server stores UTC; show the viewer's local time
    const local = new Date(`${date}T${time.slice(0, 8)}Z`)
    if (!Number.isNaN(local.getTime())) {
      date = isoDay(local)
      time = `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`
    }
  }
  const [y, m, d] = date.split("-").map(Number)
  if (!y || !m || !d) return ""
  const base = `${String(d).padStart(2, "0")} ${MONTHS_SHORT[m - 1]} ${y}`
  return withTime && time ? `${base}, ${time.slice(0, 5)}` : base
}
const fullName = (person: Person | null) => (person ? `${person.firstName} ${person.secondName}`.trim() : "")
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

function monthRange() {
  const now = new Date()
  return [isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), isoDay(new Date(now.getFullYear(), now.getMonth() + 1, 0))] as const
}

type Filters = { users: string[]; creators: string[]; markets: string[]; createdFrom: string; createdTo: string; taskFrom: string; taskTo: string }
const EMPTY_FILTERS: Filters = { users: [], creators: [], markets: [], createdFrom: "", createdTo: "", taskFrom: "", taskTo: "" }
function filterCount(f: Filters) {
  return [f.users.length, f.creators.length, f.markets.length, f.createdFrom, f.taskFrom].filter(Boolean).length
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store" })
    return response.ok ? ((await response.json()) as T) : null
  } catch {
    return null
  }
}

/** Every page of an options list (the endpoint caps a page at 200 rows). */
async function loadAllOptions<T>(kind: "users" | "markets"): Promise<T[]> {
  const all: T[] = []
  for (let page = 1; page <= 200; page += 1) {
    const data = await getJson<{ count: number; results: T[] }>(`/api/task-items/options?kind=${kind}&page_size=200&page=${page}`)
    if (!data?.results.length) break
    all.push(...data.results)
    if (all.length >= data.count) break
  }
  return all
}

function usePersonOptions() {
  const [users, setUsers] = useState<Option[]>([])
  const [markets, setMarkets] = useState<Option[]>([])
  useEffect(() => {
    void loadAllOptions<Person>("users").then((list) => setUsers(list.map((p) => ({ value: String(p.id), label: fullName(p) }))))
    void loadAllOptions<{ id: number; name: string }>("markets").then((list) => setMarkets(list.map((m) => ({ value: String(m.id), label: m.name }))))
  }, [])
  return { users, markets }
}

/** The reference's react-select field of the dialog: bold label inside, semibold value, × and caret, list under the line. */
function PickField({ label, value, required, loadOptions, onChange, loading }: { label: string; value: Option | null; required?: boolean; loadOptions: (search: string) => Promise<Option[]>; onChange: (value: Option | null) => void; loading?: boolean }) {
  const [open, setOpen] = useState(false)
  const [lit, setLit] = useState(false)
  const [text, setText] = useState("")
  const [options, setOptions] = useState<Option[]>([])
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!lit) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setLit(false)
        setText("")
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [lit])
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const timer = setTimeout(() => void loadOptions(text).then((list) => !cancelled && setOptions(list)), text ? 250 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, text, loadOptions])
  return (
    <div ref={rootRef} className="relative">
      <div onClick={() => { setOpen((current) => !current); setLit(true) }} className={`relative h-[43px] w-full cursor-pointer border-b text-left ${lit ? "border-b-2 !border-[#5d6474]" : "border-[#e8e8e8]"}`}>
        <span className={`pointer-events-none absolute left-0 font-semibold ${value || text ? "-top-[6px] text-[10px] leading-3" : "top-[19px] text-[13px] leading-4"}`}>
          {label}{required && <span className="text-[#e57373]"> *</span>}
        </span>
        {value && !text && <span className="pointer-events-none absolute inset-x-0 bottom-[5px] truncate pr-14 text-[13px] font-semibold leading-4 text-[#333]">{value.label}</span>}
        {open && <input autoFocus value={text} onChange={(event) => setText(event.target.value)} className="absolute inset-x-0 bottom-[5px] h-[18px] bg-transparent pr-14 text-[13px] font-semibold text-[#333] outline-none" />}
        <span className="absolute bottom-[6px] right-[10px] flex items-center gap-[7px] text-[#999]">
          {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#4f71dc] border-t-transparent" />}
          {value && <span role="button" aria-label="clear" onClick={(event) => { event.stopPropagation(); onChange(null); setLit(true) }}><X className="h-3.5 w-3.5" /></span>}
          <svg viewBox="0 0 10 5" className={`h-[5px] w-[10px] fill-[#999] ${open ? "rotate-180" : ""}`}><path d="M0 0l5 5 5-5z" /></svg>
        </span>
      </div>
      {open && (
        <ul className="absolute left-0 right-0 top-[43px] z-30 max-h-[200px] overflow-y-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          {options.map((option, index) => (
            <li key={option.value}>
              <button type="button" onClick={() => { onChange(option); setOpen(false); setText("") }} className={`block h-[32px] w-full truncate px-[10px] text-left text-[13px] font-semibold ${option.value === value?.value || (!value && index === 0) ? "bg-[#e6f2ff] text-[#333]" : "text-[#666] hover:bg-[#f2f5f8]"}`}>{option.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FloatInput({ label, value, onChange, required, multiline, type = "text" }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; multiline?: boolean; type?: string }) {
  const [focused, setFocused] = useState(false)
  const floating = focused || value !== ""
  return (
    <div className={`relative h-[42px] border-b ${focused ? "border-b-2 !border-[#5d6474]" : "border-[#e0e0e0]"}`}>
      <span className={`pointer-events-none absolute left-0 font-semibold ${floating ? "-top-[6px] text-[10px] leading-3" : "top-[19px] text-[13px] leading-4"}`}>
        {label}{required && <span className="text-[#e57373]"> *</span>}
      </span>
      {multiline ? (
        <textarea rows={1} value={value} onChange={(event) => onChange(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} className="absolute inset-x-0 bottom-[4px] h-[24px] resize-none bg-transparent text-[13px] leading-[24px] outline-none" />
      ) : (
        <input type={type} value={value} onChange={(event) => onChange(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} className="absolute inset-x-0 bottom-[4px] h-[24px] bg-transparent text-[13px] outline-none" />
      )}
    </div>
  )
}

function DatePickField({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative h-[42px] cursor-pointer border-b border-[#e0e0e0]" onClick={() => setOpen(true)}>
      <span className={`pointer-events-none absolute left-0 font-semibold ${value ? "top-0 text-[10px] leading-3" : "top-[19px] text-[13px] leading-4"}`}>
        {label}{required && <span className="text-[#e57373]"> *</span>}
      </span>
      {value && <span className="absolute inset-x-0 bottom-[1px] text-[13px]">{formatReportDate(value)}</span>}
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-[3px] right-0 h-[20px] w-[20px] fill-[#c4c4c4]" aria-hidden>
        <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z" />
      </svg>
      {open && <RefDateDialog value={value || isoDay(new Date())} onCancel={() => setOpen(false)} onPick={(picked) => { onChange(picked); setOpen(false) }} />}
    </div>
  )
}

const WEEK_RU = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
const WEEK_FULL_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"]
const MONTH_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
const MONTH_ABBR = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."]

/** The reference's Material date dialog: blue header with the chosen day, month grid, ОТМЕНА / OK, centred over a dimmed page. */
function RefDateDialog({ value, onCancel, onPick, inline }: { value: string; onCancel: () => void; onPick: (value: string) => void; inline?: boolean }) {
  const { t } = useLanguage()
  const [selected, setSelected] = useState(value)
  const [sy, sm, sd] = selected.split("-").map(Number)
  const [view, setView] = useState({ year: sy, month: sm - 1 })
  const first = (new Date(view.year, view.month, 1).getDay() + 6) % 7
  const days = new Date(view.year, view.month + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  const weekday = new Date(sy, sm - 1, sd).getDay()
  const shift = (delta: number) => setView((v) => { const d = new Date(v.year, v.month + delta, 1); return { year: d.getFullYear(), month: d.getMonth() } })
  const box = (
      <div className={`${inline ? "absolute bottom-[-7px] left-0 z-[130] rounded-[6px] overflow-hidden" : "absolute"} h-[434px] w-[310px] bg-white font-sans text-black ${inline ? "shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]" : "shadow-[0_11px_15px_-7px_rgba(0,0,0,0.2),0_24px_38px_3px_rgba(0,0,0,0.14),0_9px_46px_8px_rgba(0,0,0,0.12)]"}`} style={inline ? undefined : { left: "calc(50% - 155px)", top: "calc(50% - 217px)" }}>
        <div className="h-[104px] bg-[#4f71dc] px-[20px] pt-[19px] text-white">
          <div className="text-[16px] leading-[20px] opacity-70">{sy}</div>
          <div className="mt-[7px] text-[34px] leading-[40px]">{WEEK_FULL_SHORT[weekday]}, {sd} {MONTH_ABBR[sm - 1]}</div>
        </div>
        <div className="relative h-[40px]">
          <button type="button" onClick={() => shift(-1)} aria-label="prev" className="absolute left-[8px] top-[9px] flex h-8 w-8 items-center justify-center"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-black"><path d="M15.41 16.09l-4.58-4.59 4.58-4.59L14 5.5l-6 6 6 6z" /></svg></button>
          <span className="absolute inset-x-0 top-[12px] text-center text-[14px]">{MONTH_GEN[view.month]} {view.year} г.</span>
          <button type="button" onClick={() => shift(1)} aria-label="next" className="absolute right-[8px] top-[9px] flex h-8 w-8 items-center justify-center"><svg viewBox="0 0 24 24" className="h-6 w-6 fill-black"><path d="M8.59 16.34l4.58-4.59-4.58-4.59L10 5.75l6 6-6 6z" /></svg></button>
        </div>
        <div className="grid grid-cols-7 px-[3px] text-center text-[12px] leading-[16px] text-[#9e9e9e]">
          {WEEK_RU.map((name) => <span key={name} className="h-[27px] pt-[5px]">{name}</span>)}
        </div>
        <div className="grid grid-cols-7 content-start px-[3px] text-center text-[14px]">
          {cells.map((day, index) => {
            if (day === null) return <span key={`b-${index}`} className="h-9" />
            const iso = `${view.year}-${String(view.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
            return (
              <span key={iso} className="flex h-9 items-center justify-center">
                <button type="button" onClick={() => setSelected(iso)} className={`h-[34px] w-[34px] rounded-full leading-[34px] ${iso === selected ? "bg-[#4f71dc] text-white" : "hover:bg-black/5"}`}>{day}</button>
              </span>
            )
          })}
        </div>
        <div className="absolute bottom-[7px] right-[12px] flex">
          <button type="button" onClick={onCancel} className="h-9 px-[16px] text-[13px] uppercase">{t("Отмена")}</button>
          <button type="button" onClick={() => onPick(selected)} className="h-9 px-[16px] text-[13px] uppercase">OK</button>
        </div>
      </div>
  )
  if (inline) return <><button type="button" aria-label="close" onClick={onCancel} className="fixed inset-0 z-[125] cursor-default" />{box}</>
  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/[0.54]" onClick={(event) => event.stopPropagation()}>
      {box}
    </div>,
    document.body,
  )
}

function PlanDateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative h-[50px] cursor-pointer border-b border-[#e0e0e0]" onClick={() => setOpen(true)}>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-[1px] h-[20px] w-[20px] fill-[#c4c4c4]"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z" /></svg>
      <span className="pointer-events-none absolute left-0 top-[27px] text-[13px] leading-4">{value ? formatReportDate(value) : label}</span>
      {open && <div onClick={(event) => event.stopPropagation()}><RefDateDialog inline value={value || isoDay(new Date())} onCancel={() => setOpen(false)} onPick={(picked) => { onChange(picked); setOpen(false) }} /></div>}
    </div>
  )
}

function InfoHint({ text, shift = "" }: { text: string; shift?: string }) {
  return (
    <span title={text} data-tip-side="left" className={`flex h-6 w-6 items-center justify-center ${shift}`}>
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#4f71dc]"><path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" /></svg>
    </span>
  )
}

const FREQUENCIES = [
  { value: "7", label: "Раз в неделю" },
  { value: "14", label: "Раз в 2 недели" },
]

function TaskDialog({ task, onClose, onSaved }: { task: Task | null; onClose: () => void; onSaved: (task: Task) => void }) {
  const { t } = useLanguage()
  const [title, setTitle] = useState(task?.title ?? "")
  const [market, setMarket] = useState<Option | null>(task?.market ? { value: String(task.market.id), label: task.market.name } : null)
  const [user, setUser] = useState<Option | null>(task?.responsibleUser ? { value: String(task.responsibleUser.id), label: fullName(task.responsibleUser) } : null)
  const [userLoading, setUserLoading] = useState(false)
  const [endDate, setEndDate] = useState(task?.endDate ?? "")
  const [repeat, setRepeat] = useState(false)
  const [frequency, setFrequency] = useState<string>("")
  const [count, setCount] = useState("")
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const loadMarkets = useCallback(async (search: string) => ((await getJson<{ results: { id: number; name: string }[] }>(`/api/task-items/options?kind=markets&page_size=100&search=${encodeURIComponent(search)}`))?.results ?? []).map((m) => ({ value: String(m.id), label: m.name })), [])
  const loadUsers = useCallback(async (search: string) => ((await getJson<{ results: Person[] }>(`/api/task-items/options?kind=users&page_size=50&search=${encodeURIComponent(search)}`))?.results ?? []).map((p) => ({ value: String(p.id), label: fullName(p) })), [])

  async function pickMarket(next: Option | null) {
    setMarket(next)
    if (!next) return
    setUserLoading(true)
    const list = await getJson<Person[]>(`/api/task-items/options?kind=market-users&market=${next.value}`)
    setUserLoading(false)
    if (list?.[0]) setUser({ value: String(list[0].id), label: fullName(list[0]) })
  }

  const planDates = useMemo(() => {
    const n = Number(count)
    if (!repeat || !endDate || !frequency || !Number.isFinite(n) || n < 1) return []
    return Array.from({ length: Math.min(n, 100) }, (_, i) => {
      const d = new Date(`${endDate}T00:00:00`)
      d.setDate(d.getDate() + i * Number(frequency))
      return shortDate(isoDay(d))
    })
  }, [repeat, endDate, frequency, count])

  async function save() {
    if (saving) return
    const next: Record<string, string> = {}
    // The reference has no client-side check: the API answers 400 and the form shows its messages.
    if (!title.trim()) next.title = "Обязательное поле."
    if (!market) next.market = "Обязательное поле."
    if (!user) next.user = "Обязательное поле."
    if (!endDate) next.endDate = "Это поле не может быть пустым."
    setErrors(next)
    if (Object.keys(next).length) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = { title: title.trim(), market: Number(market!.value), responsibleUser: Number(user!.value), endDate }
      if (!task && repeat) Object.assign(body, { hasPlanRepetition: true, planFrequency: Number(frequency) || undefined, planRepetition: Number(count) || undefined })
      const response = await fetch(task ? `/api/task-items/${task.id}` : "/api/task-items", { method: task ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (!response.ok) {
        notify(t("Не удалось сохранить задачу"))
        return
      }
      onSaved((await response.json()) as Task)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  const err = (key: string) => (errors[key] ? <span className="absolute -bottom-[16px] left-0 text-[12px] leading-[12px] text-[#e57373]">{t(errors[key])}</span> : null)
  return (
    <Modal title={task ? t("Изменить задачу") : t("Добавить задачу")} width={400} bodyClassName={`px-[30px] pt-[42px] [clip-path:inset(-300px_-300px_0_-300px)] ${task ? "pb-[28px]" : "pb-[29px]"}`} onClose={onClose} footer={<SaveButton disabled={saving} onClick={() => void save()}>{t("Сохранить")}</SaveButton>}>
      <div className="relative"><FloatInput label={t("Описание")} required multiline value={title} onChange={setTitle} />{err("title")}</div>
      <div className="relative mt-[24px]"><PickField label={t("Магазин")} required value={market} loadOptions={loadMarkets} onChange={(v) => void pickMarket(v)} />{err("market")}</div>
      <div className="relative mt-[19px]"><PickField label={t("Ответственный пользователь")} required value={user} loading={userLoading} loadOptions={loadUsers} onChange={setUser} />{err("user")}</div>
      <div className="relative mt-[15px]"><DatePickField label={t("Дата задачи")} required value={endDate} onChange={setEndDate} />{err("endDate")}</div>
      {!task && (
        <>
          <div className="mt-[18px]"><Check checked={repeat} onChange={setRepeat} label={t("Повторять план")} /></div>
          {repeat && (
            <div className="mt-[26px]">
              <div className="flex items-center gap-[10px]">
                <div className="flex-1"><PickField label={t("Недельный период")} value={FREQUENCIES.find((f) => f.value === frequency) ? { value: frequency, label: t(FREQUENCIES.find((f) => f.value === frequency)!.label) } : null} loadOptions={async () => FREQUENCIES.map((f) => ({ value: f.value, label: t(f.label) }))} onChange={(v) => setFrequency(v?.value ?? "")} /></div>
                <InfoHint shift="-translate-y-[3px]" text={t("С какой периодичностью ставить в план данную задачу")} />
              </div>
              <div className="mt-[10px] flex items-center gap-[10px]">
                <div className="flex-1"><FloatInput label={t("Количество планов")} type="number" value={count} onChange={setCount} /></div>
                <InfoHint shift="translate-y-[3px]" text={t("Сколько раз поставить в план сотруднику выполнение этой этой задачи")} />
              </div>
              {planDates.length > 0 && (
                <div className="mt-3 text-[14px] font-medium text-[#666]">
                  <div>{t("Планы установятся на даты")}:</div>
                  <div className="mt-[6px] whitespace-pre-line">{planDates.map((d, i) => <div key={`${d}-${i}`}>{d}{i !== planDates.length - 1 ? "," : ""}</div>)}</div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

function DetailRow({ label, children, long }: { label: string; children: ReactNode; long?: boolean }) {
  return (
    <div className={`flex justify-between border-b border-[#efefef] py-2 leading-[16.25px] ${long ? "flex-col gap-[5px]" : ""}`}>
      <span className="font-semibold">{label}:</span>
      <span>{children}</span>
    </div>
  )
}

function TaskDrawer({ id, onClose, onEdit, onChanged }: { id: number; onClose: () => void; onEdit: (task: Task) => void; onChanged: () => void }) {
  const { t } = useLanguage()
  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [planDate, setPlanDate] = useState("")
  const [planComment, setPlanComment] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setTask(await getJson<Task>(`/api/task-items/${id}`))
    setLoading(false)
  }, [id])
  useEffect(() => { void load() }, [load])

  async function accept() {
    if (!task || busy) return
    setBusy(true)
    await fetch("/api/task-items/change-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: task.id, status: "finished" }) })
    setBusy(false)
    onChanged()
    onClose()
  }

  async function createPlan() {
    if (!task || busy) return
    setBusy(true)
    const response = await fetch(`/api/task-items/${task.id}/add-plan`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: planDate || null, comment: planComment }) })
    setBusy(false)
    if (response.ok) {
      setTask((await response.json()) as Task)
      setAddOpen(false)
      setPlanDate("")
      setPlanComment("")
    } else notify(t("Не удалось сохранить задачу"))
  }

  const status = task?.status
  const statusText = status === "new" ? "Новый" : status === "in_progress" ? "В процессе" : status === "done" ? "Выполнено" : "Завершено"
  const title = task?.title ?? ""
  return (
    <aside className="fixed right-0 top-0 z-[60] h-full w-[580px] max-w-full overflow-y-auto bg-white px-[20px] pt-[10px] font-sans text-[13px] text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      {loading && <div className="absolute inset-0 z-[70] flex items-center justify-center bg-white/80"><span className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#4f71dc] border-t-transparent" /></div>}
      <div className="flex items-center justify-between rounded-[10px] bg-[#f5f5f5] py-[5px] pl-[20px] pr-[10px] shadow-[0_2px_6px_rgba(0,0,0,0.1)]">
        <span className="text-[18px] font-semibold uppercase text-[#333]">{t("Задача")} № {task?.id ?? ""}</span>
        <div className="flex items-center">
          {status === "done" && <button type="button" onClick={() => void accept()} className="mr-[25px] h-[34px] rounded-[5px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white">{t("Принять")}</button>}
          <button type="button" onClick={() => task && onEdit(task)} aria-label={t("Изменить")} className="flex h-12 w-12 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]"><path d={ROW_ICONS.pencil} /></svg>
          </button>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-12 w-12 items-center justify-center">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#666]"><path d={RI.close} /></svg>
          </button>
        </div>
      </div>
      <div className="mt-[18px]">
        <p className="mb-[8px] text-[16px] font-semibold">{t("Детали")}</p>
        <div className="flex flex-col gap-[15px]">
          <DetailRow label={t("Ответственный")}>{task?.responsibleUser ? fullName(task.responsibleUser) : t("Не указано")}</DetailRow>
          <DetailRow label={t("Создал")}>{task?.createdBy ? fullName(task.createdBy) : t("Не указано")}</DetailRow>
          <DetailRow label={t("Клиент")}>{task?.market?.name ?? ""}</DetailRow>
          <DetailRow label={t("Статус")}>{t(statusText)}</DetailRow>
          <DetailRow label={t("Дата создания")}>{task?.createdDate ? shortDate(task.createdDate, true) : t("Не указано")}</DetailRow>
          <DetailRow label={t("Дата задачи")}>{task?.endDate ? shortDate(task.endDate) : t("Не указано")}</DetailRow>
          <DetailRow label={t("Описание")} long={title.length > 30}>{title}</DetailRow>
        </div>
      </div>
      <div className="mt-[18px]">
        <div className="flex items-center justify-between">
          <p className="mb-[10px] text-[16px] font-semibold">{t("Планы")}</p>
          <div className="mr-[8px]"><RefButton label={addOpen ? t("Закрыть") : t("Добавить план")} onClick={() => setAddOpen((v) => !v)} /></div>
        </div>
        {addOpen && (
          <form onSubmit={(event) => { event.preventDefault(); void createPlan() }} className="mt-[10px] rounded-[10px] px-[20px] pb-[19px] pt-[14px] shadow-[0_1px_4px_rgba(0,0,0,0.16)]">
            <PlanDateField label={t("Дата выполнения задачи")} value={planDate} onChange={setPlanDate} />
            <div className="relative mt-[-1px] h-[52px] border-b border-[#e0e0e0]">
              <span className={`pointer-events-none absolute left-0 font-semibold ${planComment ? "top-[4px] text-[10px] leading-3" : "top-[29px] text-[13px] leading-4"}`}>{t("Комментарий")}...</span>
              <textarea rows={1} value={planComment} onChange={(event) => setPlanComment(event.target.value)} className="absolute inset-x-0 bottom-[3px] h-[24px] resize-none bg-transparent text-[13px] leading-[24px] outline-none" />
            </div>
            <button type="submit" disabled={busy} className="mt-[28px] h-[34px] w-full rounded-[3px] bg-[#4f71dc] text-[13px] font-semibold text-white">{t("Создать")}</button>
          </form>
        )}
        {(task?.todayPlans ?? []).map((plan, index) => {
          const icon = statusIcon(plan.status)
          return (
            <div key={plan.id} className="flex items-end justify-between border-b border-[#efefef] py-[10px]">
              <div className="flex items-center gap-[10px]">
                <span className="text-[15px] font-semibold text-[#1a1a1a]">{index + 1}</span>
                <div className="flex flex-col items-start border-l border-[#efefef] pl-[10px] leading-[1.5]">
                  <span>{plan.comment}</span>
                  <span>{shortDate(plan.date)}</span>
                </div>
              </div>
              <div className="flex flex-col items-end text-right">
                {icon && (
                  <span title={t(icon.label)} data-tip-side="left" className="flex h-[25px] w-[30px] items-center justify-center">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" style={{ fill: icon.color }}><path d={icon.path} /></svg>
                  </span>
                )}
                {plan.response && <span className="text-[#888]">{plan.response}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

const COLS = "8.3333% 16.6667% 8.3333% 16.6667% 41.6667% 8.3333%"

export function TasksView() {
  const { t } = useLanguage()
  const [tab, setTab] = useState("Все")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [filters, setFilters] = useState<Filters>(() => {
    const [from, to] = monthRange()
    return { ...EMPTY_FILTERS, taskFrom: from, taskTo: to }
  })
  const [draft, setDraft] = useState<Filters>(filters)
  const [panelOpen, setPanelOpen] = useState(false)
  const [rangeOpen, setRangeOpen] = useState<"created" | "task" | null>(null)
  const [data, setData] = useState<{ count: number; results: Task[] } | null>(null)
  const [reload, setReload] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [dialog, setDialog] = useState<{ task: Task | null } | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const { users, markets } = usePersonOptions()

  useEffect(() => {
    const status = TABS.find((item) => item.label === tab)?.status ?? ""
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
    if (status) params.set("status", status)
    if (query.trim()) params.set("search", query.trim())
    if (filters.users.length) params.set("responsible_user", filters.users.join(","))
    if (filters.creators.length) params.set("created_by", filters.creators.join(","))
    if (filters.markets.length) params.set("market", filters.markets.join(","))
    if (filters.createdFrom) { params.set("begin_date", filters.createdFrom); params.set("end_date", filters.createdTo || filters.createdFrom) }
    if (filters.taskFrom) { params.set("begin_task_date", filters.taskFrom); params.set("end_task_date", filters.taskTo || filters.taskFrom) }
    let cancelled = false
    const timer = setTimeout(() => void getJson<{ count: number; results: Task[] }>(`/api/task-items?${params}`).then((d) => !cancelled && setData(d ?? { count: 0, results: [] })), query ? 250 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [tab, query, page, pageSize, filters, reload])

  const total = data?.count ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const count = filterCount(filters)

  async function runImport() {
    if (!importFile || importing) return
    setImporting(true)
    try {
      const rows = await readExcelRows(importFile)
      if (!rows.length) return notify(t("Не удалось найти задачи для импорта в выбранном файле"))
      // Same columns as the reference's template: Агент (ID) | Агент | Магазин (ID) | Магазин | Дата | Задача.
      const map = new Map<number, string>()
      rows[0].forEach((cell, index) => {
        const raw = String(cell ?? "").toLowerCase()
        const withId = /\(\s*id\s*\)/.test(raw)
        const name = raw.replace(/\([^)]*\)/g, "").trim()
        if (name === "агент") map.set(index, withId ? "userId" : "user")
        else if (name === "магазин") map.set(index, withId ? "marketId" : "market")
        else if (name === "дата") map.set(index, "date")
        else if (name === "задача") map.set(index, "title")
      })
      const body = rows.slice(1).map((row) => {
        const rec: Record<string, string> = {}
        row.forEach((cell, index) => { const key = map.get(index); if (key) rec[key] = String(cell ?? "").trim() })
        return rec
      }).filter((rec) => rec.title && (rec.marketId || rec.market) && (rec.userId || rec.user) && rec.date)
      const toIso = (raw: string) => {
        const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
        if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
        const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(raw)
        return dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : ""
      }
      let created = 0
      for (const rec of body) {
        const [m, u] = await Promise.all([
          Number(rec.marketId) > 0 ? Promise.resolve({ results: [{ id: Number(rec.marketId), name: rec.market }] }) : getJson<{ results: { id: number; name: string }[] }>(`/api/task-items/options?kind=markets&page_size=1&search=${encodeURIComponent(rec.market)}`),
          Number(rec.userId) > 0 ? Promise.resolve({ results: [{ id: Number(rec.userId) }] }) : getJson<{ results: Person[] }>(`/api/task-items/options?kind=users&page_size=1&search=${encodeURIComponent(rec.user)}`),
        ])
        const date = toIso(rec.date)
        if (!m?.results[0] || !u?.results[0] || !date) continue
        const response = await fetch("/api/task-items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: rec.title, market: m.results[0].id, responsibleUser: u.results[0].id, endDate: date }) })
        if (response.ok) created += 1
      }
      if (!created) return notify(t("Не удалось найти задачи для импорта в выбранном файле"))
      setReload((v) => v + 1)
      setImportOpen(false)
      setImportFile(null)
    } finally {
      setImporting(false)
    }
  }

  // The reference's "Скачать шаблон" downloads TaskTemplateExcel.xlsx (headers only), served here as a static copy.
  function downloadTemplate() {
    const link = document.createElement("a")
    link.href = "/templates/TaskTemplateExcel.xlsx"
    link.download = "TaskTemplateExcel.xlsx"
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  const periodLabel = (from: string, to: string) => (from ? `${shortDate(from)} - ${shortDate(to || from)}` : t("Укажите дату"))

  const filterPanel = (
    <RefFilterPanel narrow className="!w-[300px]" applyClassName="mt-[21px]" onClose={() => setPanelOpen(false)} onApply={() => { setFilters(draft); setPage(1); setPanelOpen(false) }}>
      <div className="-mt-[3px] mb-[7px]"><MultiSelectField flush label={t("Ответственный пользователь")} options={users} value={draft.users} onChange={(value) => setDraft((d) => ({ ...d, users: value }))} /></div>
      <div className="mb-[7px]"><MultiSelectField flush label={t("Создал")} options={users} value={draft.creators} onChange={(value) => setDraft((d) => ({ ...d, creators: value }))} /></div>
      <div className="mb-[7px]"><MultiSelectField flush label={t("Магазин")} options={markets} value={draft.markets} onChange={(value) => setDraft((d) => ({ ...d, markets: value }))} /></div>
      {([["created", "Период создания", draft.createdFrom, draft.createdTo], ["task", "Период задачи", draft.taskFrom, draft.taskTo]] as const).map(([key, label, from, to]) => (
        <div key={key} className={`relative ${key === "created" ? "mt-[22px]" : "mt-[23px]"}`}>
          <button type="button" onClick={() => setRangeOpen(key)} className={`relative block h-[45px] w-full border-b text-left ${rangeOpen === key ? "border-b-2 !border-[#5d6474]" : "border-[#e0e0e0]"}`}>
            <span className="absolute left-0 top-0 text-[10px] font-semibold leading-3">{t(label)}</span>
            <span className="absolute inset-x-0 bottom-[4.5px] text-[13px]">{periodLabel(from, to)}</span>
            <svg viewBox="0 0 24 24" className="absolute right-[65px] -top-px h-[14px] w-[14px] fill-[#c4c4c4]"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z" /></svg>
          </button>
          {rangeOpen === key && (
            <DateRangePicker
              begin={from || isoDay(new Date())}
              end={to || from || isoDay(new Date())}
              positionClassName="left-0 top-[60px]"
              onClose={() => setRangeOpen(null)}
              onApply={(b, e) => { setDraft((d) => (key === "created" ? { ...d, createdFrom: b, createdTo: e } : { ...d, taskFrom: b, taskTo: e })); setRangeOpen(null) }}
            />
          )}
        </div>
      ))}
    </RefFilterPanel>
  )

  return (
    <RefPage>
      <RefHeader title={t("Задачи")} titleTop={0.8}>
        <div className="mr-[8px] flex items-center gap-[18px]">
          <RefButton exact icon={RI.chart} label={t("Импортировать")} onClick={() => setImportOpen(true)} />
          <RefButton exact icon={RI.add} green label={t("Добавить")} onClick={() => setDialog({ task: null })} />
        </div>
      </RefHeader>
      <RefTabs stacked labels={TABS.map((item) => item.label)} value={tab} onChange={(label) => { setTab(label); setPage(1) }} />
      <RefCard className="bg-white">
        <RefToolbar
          leftSlot={
            panelOpen ? <div /> :
            <div>
            <FilterToggle
              barWidth={331.5}
              count={count}
              open={panelOpen}
              onOpen={() => { setDraft(filters); setPanelOpen(true) }}
              onClose={() => setPanelOpen(false)}
              onClear={() => { setFilters(EMPTY_FILTERS); setDraft(EMPTY_FILTERS); setPage(1) }}
            />
            </div>
          }
          filterWidth={339.5}
          linkFilter="flush"
          searchWidth={300}
          filterOpen={panelOpen}
          filterPanel={filterPanel}
          query={query}
          onQuery={(value) => { setQuery(value); setPage(1) }}
          pageSize={pageSize}
          pageSizeMenu
          onPageSize={(value) => { setPageSize(value); setPage(1) }}
          from={total ? (page - 1) * pageSize + 1 : 0}
          to={Math.min(page * pageSize, total)}
          total={total}
          page={page}
          pageCount={pageCount}
          onPage={setPage}
        />
        <div className="grid h-[50px] items-center bg-[#5d6474] px-[30px] font-semibold text-white" style={{ gridTemplateColumns: "8.3333% 16.6667% 8.3333% 16.6667% 50%" }}>
          <span>№</span>
          <span className="pl-2">{t("Ответственный")}</span>
          <span className="pl-2">{t("Дата задачи")}</span>
          <span className="pl-2">{t("Магазин")}</span>
          <span className="pl-2">{t("Описание")}</span>
        </div>
        {data && data.results.length === 0 ? (
          <div className="flex h-[276px] flex-col items-center pt-[58px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/robot-empty.png" alt="" className="h-[160px] w-[160px] object-contain" />
            <p className="mt-[11px] text-[13px] text-[#666]">{t("По вашему запросу ничего не найдено")}</p>
          </div>
        ) : (
          (data?.results ?? []).map((task) => {
            const icon = statusIcon(task.status)
            return (
              <div
                key={task.id}
                onClick={() => setSelected(task.id)}
                className="group relative grid min-h-[50px] cursor-pointer items-center px-[30px] leading-[16.25px] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[linear-gradient(to_right,#d9e0e5_2px,transparent_2px)] after:bg-[length:8px_2px] after:content-[''] last:after:hidden hover:bg-[#f2f5f8]"
                style={{ gridTemplateColumns: COLS }}
              >
                <span>{task.id}</span>
                <span className="pl-2 pr-2">{task.responsibleUser ? fullName(task.responsibleUser) : ""}</span>
                <span className="pl-2">{task.endDate ? shortDate(task.endDate) : t("Не указано")}</span>
                <span className="pl-2 pr-2">{task.market?.name ?? ""}</span>
                <span className="pl-2 pr-2">{task.title}</span>
                <span className="flex justify-end">
                  {icon && (
                    <span title={t(icon.label)} data-tip-side="left" className="flex h-[30px] w-[30px] items-center justify-center">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" style={{ fill: icon.color }}><path d={icon.path} /></svg>
                    </span>
                  )}
                </span>
              </div>
            )
          })
        )}
      </RefCard>

      {selected != null && (
        <TaskDrawer key={`${selected}-${reload}`} id={selected} onClose={() => setSelected(null)} onEdit={(task) => setDialog({ task })} onChanged={() => setReload((v) => v + 1)} />
      )}
      {dialog && (
        <TaskDialog
          key={dialog.task?.id ?? "new"}
          task={dialog.task}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); setReload((v) => v + 1) }}
        />
      )}
      {importOpen && (
        <RefImportDialog file={importFile} onFile={setImportFile} onTemplate={downloadTemplate} onSave={() => void runImport()} onClose={() => { setImportOpen(false); setImportFile(null) }} saving={importing} />
      )}
    </RefPage>
  )
}
