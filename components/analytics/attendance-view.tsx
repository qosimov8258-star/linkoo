"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { AgentDayDrawer } from "@/components/analytics/agent-day-drawer"
import { DatePickerDialog } from "@/components/analytics/date-picker-dialog"
import { RefTip } from "@/components/ref/ref-tip"
import { RI, RefButton, RefFilterPanel, RefHeader } from "@/components/ref/list-kit"
import { ReportPage } from "@/components/ref/report-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"

type CellType = "on_time" | "late" | "not_come" | "holiday" | "sick_leave" | "vacation"
type Cell = { date: string; type: CellType; comment: string | null; time: string | null; late_minutes: number }
type User = { id: number; first_name: string; second_name: string | null; dates: Cell[]; total_late_minutes: number }
type Data = { holidays: string[]; users: User[] }
type Branch = { id: number; name: string }

const week = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"]
// The reference prints these day headers with the built-in moment "uz" locale (Cyrillic) in the uz interface.
const WEEK_UZ_CYRILLIC: Record<string, string> = { вс: "Як", пн: "Ду", вт: "Се", ср: "Чо", чт: "Па", пт: "Жу", сб: "Ша" }
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

const pad = (n: number) => String(n).padStart(2, "0")
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const longDate = (day: string) => `${day.slice(8, 10)} ${MONTHS_GEN[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`

const P = {
  x: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  cal: "M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z",
  box: "M18 4H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H6V6h12v12z",
  clock: RI.clock,
  check: "M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z",
  sick: "M19 3H5c-1.1 0-1.99.9-1.99 2L3 19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4v4z",
  vacation: "M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z",
  left: "M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z",
  right: "M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
  selectAll: "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z",
  boxEmpty: "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z",
  boxChecked: "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  info: "M11 17h2v-6h-2v6zm1-15C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zM11 9h2V7h-2v2z",
  search: "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  edit: "M17.75 7L14 3.25l-10 10V17h3.75l10-10zm2.96-2.96c.39-.39.39-1.02 0-1.41L18.37.29c-.39-.39-1.02-.39-1.41 0L15 2.25 18.75 6l1.96-1.96z",
  clear: "M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.59-13L12 10.59 8.41 7 7 8.41 10.59 12 7 15.59 8.41 17 12 13.41 15.59 17 17 15.59 13.41 12 17 8.41z",
  file: "M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z",
  person: "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  fire: "M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z",
  pin: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
  reply: "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z",
  caret: "M0 0l5 5 5-5z",
  arrowUp: "M0 5l5-5 5 5z",
  sortUp: "M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z",
  sortDown: "M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z",
}

function Icon({ d, size = 24, fill, className, style }: { d: string; size?: number; fill: string; className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} style={{ fill, display: "block", ...style }} aria-hidden>
      <path d={d} />
    </svg>
  )
}

const OVERLAY_SHADOW = "0 14px 45px rgba(0,0,0,0.25), 0 10px 18px rgba(0,0,0,0.22)"

/** The reference's Material-UI dialog: white paper with a 60px title bar, a body and an optional 57px footer. */
function Modal({ title, titleSize = 13, width, height, top, onClose, footer, children }: { title: string; titleSize?: number; width: number; height?: number; top?: number; onClose: () => void; footer?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[150] bg-black/[0.54] font-sans text-[13px] text-[#333]" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-label={title}
        className="absolute left-1/2 flex flex-col rounded-[2px] bg-white"
        style={{ width, height, top: top ?? "50%", transform: top === undefined ? "translate(-50%,-50%)" : "translateX(-50%)", boxShadow: OVERLAY_SHADOW }}
      >
        <div className="relative h-[60px] shrink-0 border-b border-[#efefef]">
          <span className="absolute left-[30px] font-bold uppercase" style={{ fontSize: titleSize, top: titleSize === 15 ? 20.6 : 21.4, lineHeight: titleSize === 15 ? "18.8px" : "16.3px" }}>{title}</span>
          <button type="button" aria-label="Закрыть" onClick={onClose} className="absolute right-[10px] top-[18px] h-6 w-6">
            <Icon d={P.x} fill="#666" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        {footer && <div className="flex h-[57px] shrink-0 items-center justify-end border-t border-[#efefef] p-[10px]">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

const footerBlue = "h-9 px-4 text-[13px] font-semibold uppercase text-[#129fdd]"
const footerGreen = "h-9 w-[110.8px] rounded-[5px] bg-[#71ce87] text-[13px] font-semibold uppercase text-white"

/** react-select look of the reference (single or multi with chips). */
function SelectField({ label, options, value, onChange, multi, menuMax, autoOpen }: { label: string; options: Array<{ value: string; label: string }>; value: string[]; onChange: (next: string[]) => void; multi?: boolean; menuMax?: number; autoOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(autoOpen))
  const [focus, setFocus] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (event: MouseEvent) => !ref.current?.contains(event.target as Node) && setOpen(false)
    document.addEventListener("mousedown", down)
    return () => document.removeEventListener("mousedown", down)
  }, [open])
  const chosen = value.map((v) => options.find((o) => o.value === v)).filter(Boolean) as Array<{ value: string; label: string }>
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((c) => !c)} className="relative flex min-h-[36px] cursor-pointer items-center border-b bg-transparent" style={{ borderColor: open ? "#d9d9d9" : "#e8e8e8", boxShadow: open ? "0 1px 0 rgba(0,0,0,.06)" : undefined }}>
        {chosen.length === 0 ? (
          <span className={`text-[13px] font-semibold text-black ${multi ? "" : "mt-[3px]"}`}>{label}</span>
        ) : multi ? (
          <div className="flex flex-wrap items-center gap-[5px] py-[3px] pr-[44px]">
            {chosen.map((c) => (
              <span key={c.value} className="flex items-center rounded-[2px] bg-[#4f71dc] text-[11.7px] text-white">
                <span
                  role="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onChange(value.filter((v) => v !== c.value))
                  }}
                  className="border-r border-white/30 px-[4px] leading-[19px]"
                >
                  ×
                </span>
                <span className="px-[5px] leading-[19px]">{c.label}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[13px] font-semibold text-black">{chosen[0].label}</span>
        )}
        {chosen.length > 0 && !multi && (
          <span className="absolute left-0 top-[-12px] text-[10px] font-semibold text-black">{label}</span>
        )}
        {chosen.length > 0 && multi && <span className="absolute left-0 top-[-12px] text-[10px] font-semibold text-black">{label}</span>}
        {chosen.length > 0 && (
          <span
            role="button"
            aria-label="Очистить"
            onClick={(event) => {
              event.stopPropagation()
              onChange([])
            }}
            className="absolute right-[22px] top-1/2 -translate-y-1/2 text-[18px] leading-none text-[#999]"
          >
            ×
          </span>
        )}
        <svg viewBox="0 0 10 5" className="absolute right-[10px] top-[50%] h-[5px] w-[10px] -translate-y-1/2" style={{ fill: "#999" }} aria-hidden>
          <path d={open ? P.arrowUp : P.caret} />
        </svg>
      </div>
      {open && (
        <div className="absolute inset-x-0 top-full z-50 overflow-y-auto rounded-b-[4px] bg-white" style={{ maxHeight: menuMax ?? 200, boxShadow: "0 3px 10px rgba(0,0,0,.16), 0 3px 10px rgba(0,0,0,.23)" }}>
          {options.map((o, oi) => {
            const on = value.includes(o.value)
            const hot = multi ? on : on || (value.length === 0 && oi === focus) || oi === focus
            return (
              <div
                key={o.value}
                onClick={() => {
                  if (multi) onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])
                  else {
                    onChange([o.value])
                    setOpen(false)
                  }
                }}
                onMouseEnter={() => setFocus(oi)}
                className={`cursor-pointer text-[13px] font-semibold leading-[16.3px] ${hot ? "bg-[#e6f2ff]" : "bg-white"}`}
                style={{ padding: multi ? 10 : "8px 10px", color: hot || multi ? "#333" : "#666" }}
              >
                {o.label}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StepButtons({ label, onPrev, onNext, width, gap = 7 }: { label: string; onPrev: () => void; onNext: () => void; width: number; gap?: number }) {
  const btn = "flex h-[34px] items-center justify-center rounded-[5px] bg-[#0d99ff]/10 p-[5px]"
  return (
    <div className="flex items-center" style={{ gap }}>
      <button type="button" aria-label="Назад" onClick={onPrev} className={btn} style={{ width }}>
        <Icon d={P.left} fill="#333" />
      </button>
      <div className="flex h-12 items-center justify-center text-[16px] font-semibold text-[#333]" style={{ width: width === 69.3 ? 83.3 : 101.1 }}>{label}</div>
      <button type="button" aria-label="Вперед" onClick={onNext} className={btn} style={{ width }}>
        <Icon d={P.right} fill="#333" />
      </button>
    </div>
  )
}

function WeekendModal({ year: y0, month: m0, onClose, onSaved }: { year: number; month: number; onClose: () => void; onSaved: () => void }) {
  const [year, setYear] = useState(y0)
  const [month, setMonth] = useState(m0)
  const [custom, setCustom] = useState<number[]>([])
  const [loaded, setLoaded] = useState(false)
  const [picked, setPicked] = useState<number[]>([])
  const dim = new Date(year, month + 1, 0).getDate()
  const sundays = useMemo(() => Array.from({ length: dim }, (_, i) => i + 1).filter((d) => new Date(year, month, d).getDay() === 0), [year, month, dim])
  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    fetch(`/api/attendance-weekend-days?year=${year}&month=${month}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((days: number[]) => {
        if (cancelled) return
        setCustom(days)
        setPicked([])
        setLoaded(true)
      })
      .catch(() => !cancelled && setLoaded(true))
    return () => {
      cancelled = true
    }
  }, [year, month])
  const selected = (d: number) => (custom.length ? custom.includes(d) : sundays.includes(d)) !== picked.includes(d)
  const first = (new Date(year, month, 1).getDay() + 6) % 7
  const cells = [...Array.from({ length: first }, () => 0), ...Array.from({ length: dim }, (_, i) => i + 1)]
  async function save() {
    const all = Array.from({ length: dim }, (_, i) => i + 1).filter((d) => selected(d))
    const chosen = all.length === sundays.length && all.every((d) => sundays.includes(d)) ? [] : all
    await fetch("/api/attendance-weekend-days", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year, month, days: chosen }) }).catch(() => {})
    onSaved()
    onClose()
  }
  const stepMonth = (s: number) => {
    const d = new Date(year, month + s, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }
  return (
    <Modal title="Добавить выходние дни" titleSize={15} width={768} height={542.5} onClose={onClose} footer={<button type="button" onClick={() => void save()} className={footerGreen}>Сохранить</button>}>
      <div className="px-[30px] pt-[20px]">
        <div className="flex justify-between px-[7px]">
          <StepButtons label={String(year)} width={87.1} gap={7} onPrev={() => setYear(year - 1)} onNext={() => setYear(year + 1)} />
          <StepButtons label={MONTHS[month]} width={87.1} gap={7} onPrev={() => stepMonth(-1)} onNext={() => stepMonth(1)} />
        </div>
        <div className="grid grid-cols-7">
          {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
            <div key={d} className="bg-[#f0f4f9] py-[10px] text-center text-[13px] leading-[16.3px]">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7" style={{ opacity: loaded ? 1 : 0.999 }}>
          {cells.map((d, i) =>
            d === 0 ? (
              <div key={`b${i}`} />
            ) : (
              <div key={d} className="p-[3px]">
                <div
                  onClick={() => setPicked((c) => (c.includes(d) ? c.filter((x) => x !== d) : [...c, d]))}
                  className="cursor-pointer rounded-[5px] py-[15px] text-center text-[13px] leading-[16.3px]"
                  style={{ background: selected(d) ? "#0d99ff" : "transparent", color: selected(d) ? "#fff" : new Date(year, month, d).getDay() === 0 ? "#ff5e5e" : "#333" }}
                >
                  {d}
                </div>
              </div>
            ),
          )}
        </div>
      </div>
    </Modal>
  )
}

function WorkingTimeModal({ onClose }: { onClose: () => void }) {
  const [time, setTime] = useState("")
  return (
    <Modal title="Рабочее время" width={550} height={417} top={50} onClose={onClose} footer={<button type="button" onClick={onClose} className={footerBlue}>Сохранить</button>}>
      <div className="px-[30px] pt-[34px]">
        <label className="relative block h-[50px] border-b border-[#e0e0e0]">
          <span className="absolute left-0 top-[4.5px] text-[10px] font-semibold text-black">Считать опозданием после</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="absolute inset-x-0 bottom-0 h-[32px] bg-transparent pt-[6px] text-[13px] text-black outline-none" />
        </label>
      </div>
    </Modal>
  )
}

function ExcelImportModal({ days, onClose, onDone }: { days: number[]; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  return (
    <Modal title="Импорт с Excel" width={400} height={440} onClose={onClose} footer={<button type="button" onClick={() => { if (file) onDone(); onClose() }} className={footerGreen}>Сохранить</button>}>
      <div className="px-[30px] pt-[30px]">
        <div className="h-[273px] border border-[#efefef] py-[5px]">
          <button type="button" onClick={() => downloadExcelTable("shablon_posesheniy", [["Агент", ...days.map(String)]])} className="mx-auto block w-full px-4 pt-[13px] text-center text-[13px] uppercase leading-[18px] text-black">
            1. Скачать шаблон
          </button>
          <label className="ml-[20px] mr-[17px] mt-[11px] flex h-[200px] cursor-pointer flex-col items-center justify-center border-2 border-dashed border-[#efefef] px-[2px] text-center text-[13px] text-[#333]">
            <Icon d={P.file} fill="#333" />
            <p className="mt-[5px] whitespace-nowrap">{file ? file.name : "Добавьте файл Excel или нажмите для выбора"}</p>
            <input type="file" accept=".xls,.xlsx,.csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </div>
      </div>
    </Modal>
  )
}

const TYPE_OPTIONS = [
  { value: "on_time", label: "Пришел вовремя" },
  { value: "late", label: "Опоздал" },
  { value: "sick_leave", label: "Больничный" },
  { value: "vacation", label: "Отпуск" },
  { value: "not_come", label: "Не пришел" },
]

function EditModal({ ids, onClose, onSaved }: { ids: number[]; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<string[]>([])
  const [date, setDate] = useState("")
  const [pick, setPick] = useState(false)
  const [comment, setComment] = useState("")
  const [error, setError] = useState(false)
  async function save() {
    if (!type[0] || !date) return setError(true)
    await fetch("/api/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set", employeeIds: ids, date, type: type[0], comment }) }).catch(() => {})
    onSaved()
    onClose()
  }
  return (
    <>
      <Modal title="Изменить" width={550} height={472} top={150} onClose={onClose} footer={<button type="button" onClick={() => void save()} className={footerBlue}>Сохранить</button>}>
        <div className="px-[30px] pt-[23px]">
          <SelectField label="Тип посещении" options={TYPE_OPTIONS} value={type} onChange={setType} />
          <div onClick={() => setPick(true)} className="relative mt-[10px] h-[37px] cursor-pointer border-b border-[#e0e0e0]">
            <span className={`absolute left-0 text-[13px] text-black ${date ? "top-[-6px] text-[10px] font-semibold" : "top-[13px]"}`}>Дата</span>
            {date && <span className="absolute left-0 top-[14px] text-[13px] text-black">{longDate(date)}</span>}
            <Icon d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z" size={20} fill="#ccc" className="absolute right-0 top-[15px]" />
          </div>
          <label className="relative mt-[26px] block h-[36px] border-b border-[#e0e0e0]">
            {!comment && <span className="pointer-events-none absolute left-0 top-[13px] text-[13px] font-semibold text-black">Комментарий...</span>}
            <input value={comment} onChange={(e) => setComment(e.target.value)} className="absolute inset-x-0 bottom-0 h-[30px] bg-transparent text-[13px] outline-none" />
          </label>
          {error && <p className="mt-3 text-[12px] text-[#ff5e5e]">Заполните тип и дату</p>}
        </div>
      </Modal>
      {pick && <DatePickerDialog value={date || iso(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())} onCancel={() => setPick(false)} onPick={(v) => { setDate(v); setPick(false) }} />}
    </>
  )
}

export function AttendanceView() {
  const { language } = useLanguage()
  const today = useMemo(() => new Date(), [])
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [query, setQuery] = useState("")
  const [data, setData] = useState<Data>({ holidays: [], users: [] })
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchDraft, setBranchDraft] = useState<string[]>([])
  const [branchApplied, setBranchApplied] = useState<string[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [workOpen, setWorkOpen] = useState(false)
  const [excelOpen, setExcelOpen] = useState(false)
  const [weekendOpen, setWeekendOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [drawer, setDrawer] = useState<{ user: User; date: string } | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [notice, setNotice] = useState("")
  const [recalcBusy, setRecalcBusy] = useState(false)
  // The reference sorts by first_name: asc, then desc, then the saved order again.
  const [sort, setSort] = useState<"" | "asc" | "desc">("")

  const load = useCallback(() => {
    const branch = branchApplied.length ? `&branch=${branchApplied.join(",")}` : ""
    fetch(`/api/attendance?year=${year}&month=${month + 1}${branch}`)
      .then((r) => (r.ok ? (r.json() as Promise<Data>) : { holidays: [], users: [] }))
      .then(setData)
      .catch(() => setData({ holidays: [], users: [] }))
  }, [year, month, branchApplied])
  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    if (!filterOpen || branches.length) return
    fetch("/api/branches")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Array<{ id: number; name: string }>) => setBranches(list.map((b) => ({ id: b.id, name: b.name })).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), "en"))))
      .catch(() => {})
  }, [filterOpen, branches.length])

  const dim = new Date(year, month + 1, 0).getDate()
  const days = useMemo(() => Array.from({ length: dim }, (_, i) => i + 1), [dim])
  const holidaySet = useMemo(() => new Set(data.holidays), [data.holidays])
  const found = data.users.filter((u) => `${u.first_name} ${u.second_name ?? ""}`.toLowerCase().includes(query.toLowerCase()))
  const users = sort ? [...found].sort((a, b) => (sort === "asc" ? 1 : -1) * (a.first_name ?? "").localeCompare(b.first_name ?? "", "ru", { sensitivity: "base" })) : found
  const total = dim - data.holidays.length
  const userName = (u: User) => `${u.first_name} ${u.second_name}`.trim()

  function cellOf(u: User, d: number) {
    return u.dates.find((c) => c.date === iso(year, month, d))
  }
  function flash(text: string) {
    setNotice(text)
    window.setTimeout(() => setNotice(""), 1800)
  }
  async function recalc() {
    if (recalcBusy) return
    setRecalcBusy(true)
    const r = await fetch("/api/attendance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "recalc", branch: branchApplied.map(Number), search: query, year, month: month + 1 }) }).catch(() => null)
    setRecalcBusy(false)
    if (r?.ok) {
      load()
      flash("Перерасчет выполнен")
    }
  }
  function download() {
    downloadExcelTable("attendance", [["Агент", ...days.map(String)], ...users.map((u) => [userName(u), ...days.map((d) => cellOf(u, d)?.type ?? "")])])
  }
  const allChecked = users.length > 0 && users.every((u) => selected.includes(u.id))
  const noneTip = selected.length ? "" : "Хотя бы выберете одного агента !"
  const stepYear = (s: number) => setYear((y) => y + s)
  const stepMonth = (s: number) => {
    const d = new Date(year, month + s, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth())
  }
  const showTip = (event: React.MouseEvent) => {
    const td = (event.target as HTMLElement).closest("td[data-tip]") as HTMLElement | null
    if (!td) return setTip(null)
    const r = td.getBoundingClientRect()
    setTip({ x: r.x + r.width / 2, y: r.y + r.height / 2 + 8.5, text: td.dataset.tip ?? "" })
  }
  const filtered = branchApplied.length > 0

  return (
    <ReportPage>
      <div className="-mt-px px-[28px]">
        <RefHeader title="Посещаемость">
          <RefButton exact icon={RI.add} green label="Добавить выходные дни" onClick={() => setWeekendOpen(true)} />
          <RefButton exact icon={RI.clock} label="Рабочее время" onClick={() => setWorkOpen(true)} />
          <span className="ml-[8px] flex"><RefButton exact icon={RI.sync} label="Обновить с excel" onClick={() => setExcelOpen(true)} /></span>
          <span className="ml-[10px] flex"><RefButton exact icon={RI.chart} green label="Скачать" onClick={download} /></span>
        </RefHeader>
      </div>
      <section className="mx-7 overflow-hidden rounded-[10px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        <div className="flex h-[53px] items-center justify-end gap-[18px] border-b border-[#efefef] px-[18px]">
          <RefTip text={noneTip} side="left" gap={12}>
            <RefButton exact icon={RI.edit} label="Изменить" onClick={() => selected.length && setEditOpen(true)} />
          </RefTip>
          <RefButton exact icon={RI.sync} label={recalcBusy ? "Загрузка ..." : "Перерасчет"} onClick={() => void recalc()} />
        </div>
        <div className="relative flex h-[52px] items-center">
          {filtered ? (
            <div className="flex h-[53px] w-[260px] items-center bg-[#efefef] pl-[30px] text-[13px] text-[#666]">
              <span className="w-[134px]">Фильтр: {branchApplied.length} элемента</span>
              <button type="button" aria-label="Изменить фильтр" onClick={() => { setBranchDraft(branchApplied); setFilterOpen((c) => !c) }} className="flex h-12 w-12 items-center justify-center">
                <svg viewBox="0 0 24 24" width={24} height={24} aria-hidden><path d={P.edit} fill="#8f8f8f" transform="translate(2 0)" /><path d="M2 20h20v3H2z" fill="#8f8f8f" fillOpacity=".36" /></svg>
              </button>
              <button type="button" aria-label="Сбросить фильтр" onClick={() => { setBranchApplied([]); setBranchDraft([]) }} className="flex h-12 w-12 items-center justify-center">
                <Icon d={P.clear} fill="#8f8f8f" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => { setBranchDraft(branchApplied); setFilterOpen((c) => !c) }} className="ml-[15px] flex h-[30px] w-[163px] items-center rounded-[5px] bg-[#4f71dc] pl-3 text-[13px] font-semibold text-white hover:brightness-95">
              <svg viewBox="0 0 24 24" className="mr-2 h-[18px] w-[18px] fill-white" aria-hidden><path d={RI.filter} /></svg>Показать фильтр
            </button>
          )}
          <label className="relative block h-[45px] self-start" style={{ marginLeft: filtered ? 25 : 102, width: 250, marginTop: 7 }}>
            {!query && <span className="pointer-events-none absolute left-[5px] top-[14px] text-[13px] font-semibold text-black">Поиск</span>}
            <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск" className="h-full w-full bg-transparent pr-8 text-[13px] font-semibold text-black outline-none" />
            <hr className="absolute inset-x-0 top-[36px] border-0 border-b border-[#e0e0e0]" />
            <Icon d={P.search} size={22} fill="#5d6474" className="absolute right-[9px] top-[13px]" />
          </label>
          <div className="ml-auto flex items-center pr-[7px]" style={{ gap: 14 }}>
            <StepButtons label={String(year)} width={69.3} onPrev={() => stepYear(-1)} onNext={() => stepYear(1)} />
            <StepButtons label={MONTHS[month]} width={69.3} onPrev={() => stepMonth(-1)} onNext={() => stepMonth(1)} />
          </div>
          {filterOpen && (
            <div className="absolute left-[15px] top-[11px] z-50">
              <RefFilterPanel
                narrow
                onClose={() => setFilterOpen(false)}
                onApply={() => {
                  setBranchApplied(branchDraft)
                  setFilterOpen(false)
                  setSelected([])
                }}
                applyClassName="mt-[23px]"
              >
                <div className="mt-[18px]">
                  <SelectField label="Филиал" multi options={branches.map((b) => ({ value: String(b.id), label: b.name }))} value={branchDraft} onChange={setBranchDraft} menuMax={200} />
                </div>
              </RefFilterPanel>
            </div>
          )}
        </div>
        <div className="overflow-x-auto" onMouseMove={showTip} onMouseLeave={() => setTip(null)}>
          <table className="w-full border-collapse text-[13px] text-[#333]" style={{ minWidth: 1100 }}>
            <thead>
              <tr className="bg-[#f0f4f9] align-bottom text-[13px] font-semibold text-[#374557]" style={{ height: 54.6 }}>
                <th className="px-[17.5px] py-[7.8px] text-left" style={{ verticalAlign: "bottom" }}>
                  <button type="button" aria-label="Выбрать всех" onClick={() => setSelected(allChecked ? [] : users.map((u) => u.id))} className="block h-6 w-[40px]">
                    <Icon d={P.selectAll} fill="#333" />
                  </button>
                </th>
                <th onClick={() => setSort(sort === "" ? "asc" : sort === "asc" ? "desc" : "")} className="cursor-pointer px-[17.5px] py-[7.8px] text-left leading-[19.5px]" style={{ verticalAlign: "middle" }}>
                  <span className="flex items-center gap-[5px]">
                    Агент
                    {sort && <Icon d={sort === "desc" ? P.sortUp : P.sortDown} size={24} fill="#374557" style={{ height: 15 }} />}
                  </span>
                </th>
                {days.map((d) => {
                  const date = iso(year, month, d)
                  const dow = week[new Date(year, month, d).getDay()]
                  return (
                    <th key={d} className="px-[5px] py-[7.8px] text-left leading-[19.5px]" style={{ verticalAlign: "bottom" }}>
                      <div className="flex flex-col items-center">
                        <div>{pad(d)}</div>
                        <div data-no-translate={language === "uz" ? "" : undefined} style={{ color: holidaySet.has(date) ? "rgba(255,94,94,0.7)" : "#0d99ff" }}>
                          {language === "uz" ? WEEK_UZ_CYRILLIC[dow] : dow}
                        </div>
                      </div>
                    </th>
                  )
                })}
                <th className="px-[17.5px] py-[7.8px] text-left leading-[19.5px]" style={{ verticalAlign: "bottom" }}>
                  <span className="inline-flex items-center whitespace-nowrap">
                    Пришел вовремя
                    <RefTip text="Пришел вовремя / Опоздал (время опоздания) / Не пришел / Всего" side="left" gap={12.5}>
                      <Icon d={P.info} fill="#4f71dc" />
                    </RefTip>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const counts = { on: 0, late: 0, absent: 0 }
                for (const c of u.dates) {
                  if (c.type === "on_time" || c.type === "sick_leave" || c.type === "vacation") counts.on += 1
                  else if (c.type === "late") counts.late += 1
                  else if (c.type === "not_come") counts.absent += 1
                }
                const checked = selected.includes(u.id)
                return (
                  <tr key={u.id} className="border-b border-[#efefef]" style={{ height: users[0] === u ? 51.2 : 51.7 }}>
                    <td className="border-b border-[#efefef] px-[17.5px] py-[7.8px]">
                      <button type="button" aria-label="Выбрать" onClick={() => setSelected(checked ? selected.filter((i) => i !== u.id) : [...selected, u.id])} className="block h-6 w-[40px]">
                        <Icon d={checked ? P.boxChecked : P.boxEmpty} fill={checked ? "#5d6474" : "#333"} />
                      </button>
                    </td>
                    <td className="cursor-pointer break-words border-b border-[#efefef] px-[17.5px] py-[7.8px] leading-[19.5px] hover:text-[#0d99ff]">{userName(u)}</td>
                    {days.map((d) => {
                      const date = iso(year, month, d)
                      const c = cellOf(u, d)
                      const type: CellType | "empty" = c?.type ?? (holidaySet.has(date) ? "holiday" : "empty")
                      const [path, fill] =
                        type === "not_come" ? [P.x, "#ff5e5e"] : type === "holiday" ? [P.cal, "#ff5e5e"] : type === "late" ? [P.clock, "#4f71dc"] : type === "on_time" ? [P.check, "#81c784"] : type === "sick_leave" ? [P.sick, "#E57373"] : type === "vacation" ? [P.vacation, "#4DB6AC"] : [P.box, "#d9d9d9"]
                      return (
                        <td
                          key={d}
                          onClick={() => setDrawer({ user: u, date })}
                          data-tip={type === "late" ? longDate(date) : undefined}
                          className="cursor-pointer border-b border-[#efefef] px-[5px] py-[7.8px]"
                        >
                          <div className="flex flex-col items-center">
                            <Icon d={path} size={17} fill={fill} />
                          </div>
                        </td>
                      )
                    })}
                    <td className="border-b border-[#efefef] py-[7.8px] pl-[25px] pr-[7px]">
                      <div className="flex whitespace-nowrap">
                      <span style={{ color: "#71ce87", fontWeight: 600 }}>{counts.on}</span>&nbsp;/&nbsp;<span style={{ color: "#4f71dc" }}>{counts.late} </span>&nbsp;/&nbsp;<span style={{ color: "#ff5e5e" }}>{counts.absent}</span>&nbsp;/&nbsp;<span>{total}</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
      {tip && createPortal(<span role="tooltip" className="pointer-events-none fixed z-[1000] -translate-x-1/2 whitespace-nowrap rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-[13px] leading-[17px] text-white opacity-90" style={{ left: tip.x, top: tip.y + 10 }}>{tip.text}</span>, document.body)}
      {excelOpen && <ExcelImportModal days={days} onClose={() => setExcelOpen(false)} onDone={() => flash("Данные обновлены")} />}
      {workOpen && <WorkingTimeModal onClose={() => setWorkOpen(false)} />}
      {weekendOpen && <WeekendModal year={year} month={month} onClose={() => setWeekendOpen(false)} onSaved={load} />}
      {editOpen && <EditModal ids={selected} onClose={() => setEditOpen(false)} onSaved={load} />}
      {drawer && <AgentDayDrawer variant="attendance" width={800} userId={drawer.user.id} name={userName(drawer.user)} date={drawer.date} onClose={() => setDrawer(null)} />}
      {notice && <div className="fixed bottom-6 left-1/2 z-[1600] -translate-x-1/2 rounded bg-slate-800 px-6 py-3 text-white shadow-xl">{notice}</div>}
    </ReportPage>
  )
}
