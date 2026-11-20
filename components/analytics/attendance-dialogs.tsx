"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Loader2, X } from "lucide-react"

import { Icon } from "@/components/analytics/attendance-cells"
import { TaskMultiSelect } from "@/components/analytics/tasks-filter"
import { FilterSelect, RefFilterPanel } from "@/components/ref/list-kit"
import { readExcelRows } from "@/lib/excel-import"
import { EDITABLE_TYPES, TYPE_LABELS, isClockTime, mondayIndex, monthDays, type EditableType } from "@/lib/attendance-types"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

// Dialogs of Посещаемость: Добавить выходные дни, Рабочее время, Импорт с excel, Изменить.
// Every dialog closes on Escape / the X / a click outside; server refusals are shown translated.

export const MONTH_KEYS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]
export const WEEKDAY_KEYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; field?: string; errors?: ImportIssue[] }
export type ImportIssue = { row: number; column?: number; error: string; value?: string }

/** fetch → JSON with the server's Russian error key (never throws). */
export async function callApi<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } })
    const body = (await response.json().catch(() => null)) as (T & { error?: string; field?: string; errors?: ImportIssue[] }) | null
    if (response.ok) return { ok: true, data: body as T }
    const error = response.status === 403 && !body?.error ? "Недостаточно прав" : body?.error || "Не удалось выполнить запрос"
    return { ok: false, status: response.status, error, field: body?.field, errors: body?.errors }
  } catch {
    return { ok: false, status: 0, error: "Сервер недоступен, попробуйте ещё раз" }
  }
}

export function AttendanceModal({
  title,
  onClose,
  children,
  footer,
  width = 560,
  titleSize = 13,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
  /** Title font size in px (Linko: 15 in «Добавить выходные дни», 13 elsewhere). */
  titleSize?: number
}) {
  const { t } = useLanguage()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:items-center" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-label={t(title)} className="w-full bg-white text-[13px] text-[#333] shadow-[0_10px_30px_rgba(0,0,0,0.3)]" style={{ maxWidth: width }}>
        <header className="flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[24px]">
          <h2 className="font-bold uppercase" style={{ fontSize: titleSize }}>{t(title)}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#555] hover:text-black">
            <X className="h-6 w-6" />
          </button>
        </header>
        <div className="px-[30px] py-[24px]">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-3 border-t border-[#efefef] px-[12px] py-[10px]">{footer}</footer>}
      </section>
    </div>
  )
}

function SaveButton({ onClick, disabled, busy, label = "Сохранить", text }: { onClick: () => void; disabled?: boolean; busy?: boolean; label?: string; text?: boolean }) {
  const { t } = useLanguage()
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={
        text
          ? "inline-flex h-[35px] items-center gap-2 px-[16px] text-[13px] font-bold uppercase text-[#2196f3] hover:bg-[#f2f7fe] disabled:opacity-50"
          : "inline-flex h-[35px] items-center gap-2 rounded-[3px] bg-[#71ce87] px-[16px] text-[13px] font-bold uppercase text-white hover:brightness-95 disabled:opacity-60"
      }
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {t(label)}
    </button>
  )
}

const CHEVRON_LEFT = "M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"
const CHEVRON_RIGHT = "M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"

/** ‹ value › stepper (year / month) of the page and the weekend dialog, as Linko's: three equal cells of
 * `cell` px, the arrows in light-blue 7px-inset switchers, the value 16px semi-bold. */
export function Stepper({ label, onPrev, onNext, prevLabel, nextLabel, cell = 250 / 3, prevDisabled, nextDisabled }: { label: ReactNode; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string; cell?: number; prevDisabled?: boolean; nextDisabled?: boolean }) {
  const { t } = useLanguage()
  const arrow = "m-[7px] flex items-center justify-center rounded-[5px] bg-[rgba(13,153,255,0.1)] p-[5px] text-[#333] disabled:opacity-40"
  return (
    <div className="grid shrink-0 grid-cols-3" style={{ width: cell * 3 }}>
      <button type="button" onClick={onPrev} disabled={prevDisabled} aria-label={t(prevLabel)} className={arrow}>
        <Icon path={CHEVRON_LEFT} color="currentColor" size={24} />
      </button>
      <span className="flex h-[48px] select-none items-center justify-center text-[16px] font-semibold text-[#333]">{label}</span>
      <button type="button" onClick={onNext} disabled={nextDisabled} aria-label={t(nextLabel)} className={arrow}>
        <Icon path={CHEVRON_RIGHT} color="currentColor" size={24} />
      </button>
    </div>
  )
}

function shiftMonth(year: number, month: number, offset: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + offset
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

const inRange = (year: number) => year >= 2000 && year <= 2100

/** Column of the weekend dialog's grid: Linko's 708px body in 7 columns. */
const WEEK_CELL = 708 / 7

// --- Добавить выходные дни ---------------------------------------------------------------

export function WeekendDialog({ initialYear, initialMonth, onClose, onSaved }: { initialYear: number; initialMonth: number; onClose: () => void; onSaved: (year: number, month: number) => void }) {
  const { t } = useLanguage()
  const [period, setPeriod] = useState({ year: initialYear, month: initialMonth })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError("")
    void callApi<{ dates: string[] }>(`/api/work-attendance/holidays?year=${period.year}&month=${period.month}`).then((result) => {
      if (cancelled) return
      setLoading(false)
      if (result.ok) setSelected(new Set(result.data.dates))
      else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [period])
  const days = useMemo(() => monthDays(period.year, period.month), [period])
  const blanks = mondayIndex(days[0])
  const move = (offset: number) => {
    const next = shiftMonth(period.year, period.month, offset)
    if (inRange(next.year)) setPeriod(next)
  }
  const toggle = (day: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return next
    })
  async function save() {
    setSaving(true)
    setError("")
    const result = await callApi("/api/work-attendance/holidays", { method: "POST", body: JSON.stringify({ ...period, dates: [...selected].sort() }) })
    setSaving(false)
    if (!result.ok) return setError(result.error)
    onSaved(period.year, period.month)
  }
  return (
    <AttendanceModal
      title="Добавить выходные дни"
      onClose={onClose}
      width={768}
      titleSize={15}
      footer={
        <>
          {error && <span className="mr-auto pl-[18px] text-[12px] text-[#e57373]">{t(error)}</span>}
          <SaveButton onClick={() => void save()} busy={saving} disabled={loading} />
        </>
      }
    >
      {/* Linko's 7-column grid: the year over Пн–Ср, the month over Пт–Вс. */}
      <div className="flex">
        <Stepper cell={WEEK_CELL} label={period.year} onPrev={() => setPeriod((current) => ({ ...current, year: current.year - 1 }))} onNext={() => setPeriod((current) => ({ ...current, year: current.year + 1 }))} prevLabel="Предыдущий год" nextLabel="Следующий год" prevDisabled={period.year <= 2000} nextDisabled={period.year >= 2100} />
        <span className="shrink-0" style={{ width: WEEK_CELL }} />
        <Stepper cell={WEEK_CELL} label={t(MONTH_KEYS[period.month - 1])} onPrev={() => move(-1)} onNext={() => move(1)} prevLabel="Предыдущий месяц" nextLabel="Следующий месяц" />
      </div>
      <div className="grid grid-cols-7 bg-[rgb(240,244,249)] text-center text-[13px] text-[#333]">
        {WEEKDAY_KEYS.map((day) => (
          <span key={day} className="py-[10px] leading-4">
            {t(day)}
          </span>
        ))}
      </div>
      <div className="relative grid min-h-[312px] grid-cols-7 content-start text-center text-[13px]">
        {Array.from({ length: blanks }, (_, index) => (
          <span key={`blank-${index}`} />
        ))}
        {days.map((day) => {
          const active = selected.has(day)
          return (
            <button
              key={day}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(day)}
              className={`m-[3px] h-[46px] rounded-[5px] leading-4 ${active ? "bg-[rgb(13,153,255)] text-white" : "text-[#333] hover:bg-[rgb(240,244,249)]"}`}
            >
              {Number(day.slice(8, 10))}
            </button>
          )
        })}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70">
            <Loader2 className="h-6 w-6 animate-spin text-[#1E4A9A]" />
          </div>
        )}
      </div>
    </AttendanceModal>
  )
}

// --- Рабочее время ------------------------------------------------------------------------

export function WorkTimeDialog({ initial, onClose, onSaved }: { initial: string | null; onClose: () => void; onSaved: (late: string) => void }) {
  const { t } = useLanguage()
  const [value, setValue] = useState(initial ?? "")
  const [loading, setLoading] = useState(initial === null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  useEffect(() => {
    if (initial !== null) return
    let cancelled = false
    void callApi<{ late: string }>("/api/work-attendance/work-time").then((result) => {
      if (cancelled) return
      setLoading(false)
      if (result.ok) setValue(result.data.late)
      else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [initial])
  async function save() {
    if (!isClockTime(value)) return setError("Укажите время в формате ЧЧ:ММ")
    setSaving(true)
    const result = await callApi<{ late: string }>("/api/work-attendance/work-time", { method: "PUT", body: JSON.stringify({ late: value }) })
    setSaving(false)
    if (!result.ok) return setError(result.error)
    onSaved(result.data.late)
  }
  return (
    <AttendanceModal title="Рабочее время" onClose={onClose} width={550} footer={<SaveButton text onClick={() => void save()} busy={saving} disabled={loading} />}>
      <label className="block min-h-[252px] pt-[10px]">
        <span className="text-[13px] font-semibold text-black">{t("Считать опозданием после")}</span>
        <input
          type="time"
          required
          value={value}
          disabled={loading}
          onChange={(event) => {
            setValue(event.target.value)
            setError("")
          }}
          className={`mt-[10px] block h-[36px] w-full border-b bg-transparent text-[15px] outline-none ${error ? "border-[#e57373]" : "border-[#d9d9d9] focus:border-[#1E4A9A]"}`}
        />
        {error && <span className="mt-[6px] block text-[12px] text-[#e57373]">{t(error)}</span>}
      </label>
    </AttendanceModal>
  )
}

// --- Импорт с excel -----------------------------------------------------------------------

export function ImportDialog({ year, month, onTemplate, onClose, onImported }: { year: number; month: number; onTemplate: () => void; onClose: () => void; onImported: (result: { updated: number; unchanged: number }) => void }) {
  const { t } = useLanguage()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [issues, setIssues] = useState<ImportIssue[]>([])
  const pick = (next: File | null) => {
    setError("")
    setIssues([])
    if (next && !/\.(xlsx|xls|csv)$/i.test(next.name)) {
      setFile(null)
      setError("Выберите файл Excel (.xlsx, .xls) или CSV")
      return
    }
    setFile(next)
  }
  async function save() {
    if (!file) return setError("Выберите файл Excel (.xlsx, .xls) или CSV")
    setSaving(true)
    setError("")
    setIssues([])
    const rows = await readExcelRows(file)
    if (!rows.length) {
      setSaving(false)
      return setError("Файл пустой или не читается")
    }
    const result = await callApi<{ updated: number; unchanged: number }>("/api/work-attendance/import", { method: "POST", body: JSON.stringify({ year, month, rows }) })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      setIssues(result.errors ?? [])
      return
    }
    onImported(result.data)
  }
  return (
    <AttendanceModal title="Импорт с excel" onClose={onClose} width={400} footer={<SaveButton onClick={() => void save()} busy={saving} />}>
      <div className="border border-[#efefef] px-[20px] pb-[22px] pt-[16px]">
        <button type="button" onClick={onTemplate} className="mb-[13px] block w-full text-center text-[13px] font-medium uppercase text-[#333] hover:text-[#1E4A9A]">
          {t("1. Скачать шаблон")}
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            pick(event.dataTransfer.files?.[0] ?? null)
          }}
          className="flex h-[180px] w-full cursor-pointer flex-col items-center justify-center gap-[8px] border border-dashed border-[#ddd] px-3 text-center text-[13px] text-[#333]"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]" aria-hidden>
            <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" />
          </svg>
          <span className="break-all">{file ? file.name : t("Добавьте файл Excel или нажмите для выбора")}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(event) => {
            pick(event.target.files?.[0] ?? null)
            event.target.value = ""
          }}
        />
      </div>
      {error && <p className="mt-[12px] text-[12px] font-semibold text-[#e57373]">{t(error)}</p>}
      {issues.length > 0 && (
        <ul className="mt-[6px] max-h-[180px] overflow-y-auto text-[12px] text-[#e57373]">
          {issues.map((issue, index) => (
            <li key={index}>
              {t("Строка")} {issue.row}
              {issue.column ? `, ${t("колонка")} ${issue.column}` : ""}: {t(issue.error)}
              {issue.value ? ` (${issue.value})` : ""}
            </li>
          ))}
        </ul>
      )}
    </AttendanceModal>
  )
}

// --- Изменить -----------------------------------------------------------------------------

export function EditDialog({ employeeIds, maxDate, onClose, onSaved }: { employeeIds: number[]; maxDate: string; onClose: () => void; onSaved: (updated: number) => void }) {
  const { t, language } = useLanguage()
  const [type, setType] = useState<EditableType | "">("")
  const [date, setDate] = useState("")
  const [comment, setComment] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const clear = useCallback((field: string) => setErrors((current) => (current[field] || current.form ? { ...current, [field]: "", form: "" } : current)), [])
  const typeLabels = EDITABLE_TYPES.map((item) => t(TYPE_LABELS[item]))
  function validate(): Record<string, string> {
    const next: Record<string, string> = {}
    if (!type) next.type = "Выберите тип посещения"
    if (!date) next.date = "Укажите дату"
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < "2000-01-01") next.date = "Неверная дата"
    else if (date > maxDate) next.date = "Дата не может быть позже сегодняшнего дня"
    return next
  }
  async function save() {
    const found = validate()
    if (Object.values(found).some(Boolean)) return setErrors(found)
    setSaving(true)
    const result = await callApi<{ updated: number }>("/api/work-attendance/days", {
      method: "POST",
      body: JSON.stringify({ employeeIds, date, type, time: null, comment }),
    })
    setSaving(false)
    if (!result.ok) return setErrors({ [result.field && ["type", "date", "comment"].includes(result.field) ? result.field : "form"]: result.error })
    onSaved(result.data.updated)
  }
  const fieldError = (name: string) => (errors[name] ? <span className="mt-[2px] block text-[12px] text-[#e57373]">{t(errors[name])}</span> : null)
  // Linko's AttendanceForm: Тип посещении, Дата, Комментарий... (no required marks, a text «Сохранить»).
  return (
    <AttendanceModal
      title="Изменить"
      onClose={onClose}
      width={550}
      footer={
        <>
          {errors.form && <span className="mr-auto pl-[18px] text-[12px] text-[#e57373]">{t(errors.form)}</span>}
          <SaveButton text onClick={() => void save()} busy={saving} />
        </>
      }
    >
      <div className="-mt-[16px] min-h-[318px]">
        <FilterSelect
          label="Тип посещении"
          compact
          value={type ? t(TYPE_LABELS[type]) : ""}
          options={typeLabels}
          onChange={(label) => {
            const index = typeLabels.indexOf(label)
            setType(index >= 0 ? EDITABLE_TYPES[index] : "")
            clear("type")
          }}
        />
        {fieldError("type")}
        <label className={`relative mt-[6px] block h-[48px] cursor-pointer border-b ${errors.date ? "border-[#e57373]" : "border-[#e0e0e0]"}`}>
          <span className={`pointer-events-none absolute left-0 text-black ${date ? "top-0 text-[10px] font-semibold leading-3" : "top-[18px] text-[13px] leading-4"}`}>{t("Дата")}</span>
          {date && <span className="pointer-events-none absolute left-0 top-[20px] text-[13px] font-semibold leading-4">{formatDateText(date, language, { withTime: false })}</span>}
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-[2px] top-[14px] h-6 w-6 fill-[#ccc]" aria-hidden>
            <path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11z" />
          </svg>
          <input
            type="date"
            value={date}
            min="2000-01-01"
            max={maxDate}
            aria-label={t("Дата")}
            onClick={(event) => {
              try {
                event.currentTarget.showPicker?.()
              } catch {
                // The picker opens on its own where showPicker is not allowed.
              }
            }}
            onChange={(event) => {
              setDate(event.target.value)
              clear("date")
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        {fieldError("date")}
        <label className={`relative mt-[14px] block min-h-[48px] border-b pt-[22px] ${errors.comment ? "border-[#e57373]" : "border-[#e0e0e0]"}`}>
          <span className={`pointer-events-none absolute left-0 font-semibold text-black ${comment ? "top-0 text-[10px] leading-3" : "top-[24px] text-[13px] leading-4"}`}>{t("Комментарий...")}</span>
          <textarea
            value={comment}
            maxLength={500}
            rows={1}
            aria-label={t("Комментарий")}
            onChange={(event) => {
              setComment(event.target.value)
              clear("comment")
              // One line that grows up to three, as Linko's multi-line field.
              event.target.style.height = "auto"
              event.target.style.height = `${Math.min(event.target.scrollHeight, 60)}px`
            }}
            className="block h-[22px] w-full resize-none bg-transparent text-[13px] font-semibold leading-5 outline-none"
          />
        </label>
        {fieldError("comment")}
      </div>
    </AttendanceModal>
  )
}

// --- Фильтр -------------------------------------------------------------------------------

/** Linko's attendance filter card (its API 147 shows only «Филиал»): laid over the «Показать фильтр»
 * button, 310px, the multi-select of branches and «Применить». */
export function FilterPanel({
  branches,
  value,
  onApply,
  onClose,
}: {
  branches: { id: number; name: string }[]
  value: number[]
  onApply: (ids: number[]) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<string[]>(() => value.map(String))
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])
  const options = useMemo(() => branches.map((branch) => ({ id: branch.id, name: branch.name })), [branches])
  return (
    <div className="absolute left-0 top-0 z-50 max-w-[calc(100vw-30px)]">
      <RefFilterPanel narrow onClose={onClose} onApply={() => onApply(draft.map(Number))} applyClassName="mt-[15px]">
        <TaskMultiSelect label="Филиал" options={options} value={draft} onChange={setDraft} />
      </RefFilterPanel>
    </div>
  )
}
