"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react"

import { Icon } from "@/components/analytics/attendance-cells"
import { readExcelRows } from "@/lib/excel-import"
import { EDITABLE_TYPES, TYPE_LABELS, isClockTime, mondayIndex, monthDays, timeMinutes, type EditableType } from "@/lib/attendance-types"
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
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
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
          <h2 className="text-[13px] font-bold uppercase">{t(title)}</h2>
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

/** ‹ value › stepper (year / month) of the page and the weekend dialog. */
export function Stepper({ label, onPrev, onNext, prevLabel, nextLabel, width = 85, prevDisabled, nextDisabled }: { label: ReactNode; onPrev: () => void; onNext: () => void; prevLabel: string; nextLabel: string; width?: number; prevDisabled?: boolean; nextDisabled?: boolean }) {
  const { t } = useLanguage()
  const arrow = "flex h-[30px] w-[42px] items-center justify-center rounded-[2px] bg-[#eef1f5] text-[#555] hover:bg-[#e2e7ee] disabled:opacity-40"
  return (
    <div className="flex items-center gap-[6px]">
      <button type="button" onClick={onPrev} disabled={prevDisabled} aria-label={t(prevLabel)} className={arrow}>
        <ChevronLeft className="h-5 w-5" />
      </button>
      <b className="text-center text-[14px] font-semibold" style={{ width }}>
        {label}
      </b>
      <button type="button" onClick={onNext} disabled={nextDisabled} aria-label={t(nextLabel)} className={arrow}>
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  )
}

function shiftMonth(year: number, month: number, offset: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + offset
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

const inRange = (year: number) => year >= 2000 && year <= 2100

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
      width={520}
      footer={
        <>
          {error && <span className="mr-auto pl-[18px] text-[12px] text-[#e57373]">{t(error)}</span>}
          <SaveButton onClick={() => void save()} busy={saving} disabled={loading} />
        </>
      }
    >
      <div className="flex flex-wrap items-center justify-center gap-[20px]">
        <Stepper label={period.year} onPrev={() => setPeriod((current) => ({ ...current, year: current.year - 1 }))} onNext={() => setPeriod((current) => ({ ...current, year: current.year + 1 }))} prevLabel="Предыдущий год" nextLabel="Следующий год" width={48} prevDisabled={period.year <= 2000} nextDisabled={period.year >= 2100} />
        <Stepper label={t(MONTH_KEYS[period.month - 1])} onPrev={() => move(-1)} onNext={() => move(1)} prevLabel="Предыдущий месяц" nextLabel="Следующий месяц" />
      </div>
      <div className="mt-[18px] grid grid-cols-7 bg-[#f0f4f9] py-[8px] text-center text-[13px] font-semibold text-[#374557]">
        {WEEKDAY_KEYS.map((day) => (
          <span key={day}>{t(day)}</span>
        ))}
      </div>
      <div className="relative mt-[8px] grid grid-cols-7 gap-[6px] text-center">
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
              className={`h-[40px] rounded-[6px] text-[14px] ${active ? "bg-[#2196f3] font-semibold text-white" : "text-[#333] hover:bg-[#f0f4f9]"}`}
            >
              {Number(day.slice(8, 10))}
            </button>
          )
        })}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70">
            <Loader2 className="h-6 w-6 animate-spin text-[#4f71dc]" />
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
    <AttendanceModal title="Рабочее время" onClose={onClose} width={480} footer={<SaveButton text onClick={() => void save()} busy={saving} disabled={loading} />}>
      <label className="block min-h-[120px] pt-[10px]">
        <span className="text-[13px] font-semibold text-[#333]">
          {t("Считать опозданием после")}
          <span className="text-[#e57373]"> *</span>
        </span>
        <input
          type="time"
          required
          value={value}
          disabled={loading}
          onChange={(event) => {
            setValue(event.target.value)
            setError("")
          }}
          className={`mt-[10px] block h-[36px] w-full border-b bg-transparent text-[15px] outline-none ${error ? "border-[#e57373]" : "border-[#d9d9d9] focus:border-[#4f71dc]"}`}
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
    if (!file) return
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
    <AttendanceModal title="Импорт с excel" onClose={onClose} width={460} footer={<SaveButton onClick={() => void save()} busy={saving} disabled={!file} />}>
      <div className="border border-[#efefef] px-[20px] pb-[22px] pt-[16px]">
        <button type="button" onClick={onTemplate} className="mb-[13px] block w-full text-center text-[13px] font-medium uppercase text-[#333] hover:text-[#4f71dc]">
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

export function EditDialog({ employeeIds, lateAfter, maxDate, onClose, onSaved }: { employeeIds: number[]; lateAfter: string; maxDate: string; onClose: () => void; onSaved: (updated: number) => void }) {
  const { t } = useLanguage()
  const [type, setType] = useState<EditableType | "">("")
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [comment, setComment] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const withTime = type === "on_time" || type === "late"
  const clear = useCallback((field: string) => setErrors((current) => (current[field] || current.form ? { ...current, [field]: "", form: "" } : current)), [])
  function validate(): Record<string, string> {
    const next: Record<string, string> = {}
    if (!type) next.type = "Выберите тип посещения"
    if (!date) next.date = "Укажите дату"
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < "2000-01-01") next.date = "Неверная дата"
    else if (date > maxDate) next.date = "Дата не может быть позже сегодняшнего дня"
    if (withTime && time) {
      const arrived = timeMinutes(time)
      const limit = timeMinutes(lateAfter) ?? 540
      if (arrived === null) next.time = "Укажите время в формате ЧЧ:ММ"
      else if (type === "late" && arrived <= limit) next.time = "Время прихода должно быть позже начала рабочего дня"
      else if (type === "on_time" && arrived > limit) next.time = "Время прихода позже начала рабочего дня — выберите «Опоздал»"
    }
    return next
  }
  async function save() {
    const found = validate()
    if (Object.values(found).some(Boolean)) return setErrors(found)
    setSaving(true)
    const result = await callApi<{ updated: number }>("/api/work-attendance/days", {
      method: "POST",
      body: JSON.stringify({ employeeIds, date, type, time: withTime && time ? time : null, comment }),
    })
    setSaving(false)
    if (!result.ok) return setErrors({ [result.field && ["type", "date", "time", "comment"].includes(result.field) ? result.field : "form"]: result.error })
    onSaved(result.data.updated)
  }
  const field = "mt-[6px] block h-[36px] w-full border-b bg-transparent text-[14px] outline-none"
  const border = (name: string) => (errors[name] ? "border-[#e57373]" : "border-[#d9d9d9] focus:border-[#4f71dc]")
  return (
    <AttendanceModal
      title="Изменить"
      onClose={onClose}
      width={520}
      footer={
        <>
          {errors.form && <span className="mr-auto pl-[18px] text-[12px] text-[#e57373]">{t(errors.form)}</span>}
          <SaveButton onClick={() => void save()} busy={saving} />
        </>
      }
    >
      <p className="mb-[14px] text-[12px] text-[#777]">
        {t("Выбрано сотрудников")}: {employeeIds.length}
      </p>
      <label className="block">
        <span className="text-[13px] font-semibold">
          {t("Тип посещении")}
          <span className="text-[#e57373]"> *</span>
        </span>
        <select
          value={type}
          onChange={(event) => {
            setType(event.target.value as EditableType | "")
            clear("type")
            clear("time")
          }}
          className={`${field} ${border("type")}`}
        >
          <option value="">{t("Выберите")}</option>
          {EDITABLE_TYPES.map((item) => (
            <option key={item} value={item}>
              {t(TYPE_LABELS[item])}
            </option>
          ))}
        </select>
        {errors.type && <span className="mt-[4px] block text-[12px] text-[#e57373]">{t(errors.type)}</span>}
      </label>
      <label className="mt-[16px] block">
        <span className="text-[13px] font-semibold">
          {t("Дата")}
          <span className="text-[#e57373]"> *</span>
        </span>
        <input
          type="date"
          value={date}
          min="2000-01-01"
          max={maxDate}
          onChange={(event) => {
            setDate(event.target.value)
            clear("date")
          }}
          className={`${field} ${border("date")}`}
        />
        {errors.date && <span className="mt-[4px] block text-[12px] text-[#e57373]">{t(errors.date)}</span>}
      </label>
      {withTime && (
        <label className="mt-[16px] block">
          <span className="text-[13px] font-semibold">{t("Время прихода")}</span>
          <input
            type="time"
            value={time}
            onChange={(event) => {
              setTime(event.target.value)
              clear("time")
            }}
            className={`${field} ${border("time")}`}
          />
          {errors.time && <span className="mt-[4px] block text-[12px] text-[#e57373]">{t(errors.time)}</span>}
        </label>
      )}
      <label className="mt-[16px] block">
        <textarea
          value={comment}
          maxLength={500}
          rows={3}
          placeholder={t("Комментарий...")}
          aria-label={t("Комментарий")}
          onChange={(event) => {
            setComment(event.target.value)
            clear("comment")
          }}
          className={`block w-full resize-none border-b bg-transparent py-[6px] text-[14px] outline-none ${border("comment")}`}
        />
        {errors.comment && <span className="mt-[4px] block text-[12px] text-[#e57373]">{t(errors.comment)}</span>}
      </label>
    </AttendanceModal>
  )
}

// --- Фильтр -------------------------------------------------------------------------------

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
  const { t } = useLanguage()
  const [draft, setDraft] = useState<number[]>(value)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])
  const needle = query.trim().toLowerCase()
  const options = branches.filter((branch) => !draft.includes(branch.id) && (!needle || branch.name.toLowerCase().includes(needle)))
  return (
    <div className="absolute left-[15px] top-[48px] z-50 w-[340px] max-w-[calc(100vw-30px)] bg-white p-[20px] text-[13px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div className="flex items-center justify-between text-[14px] font-semibold">
        {t("Фильтр")}
        <button type="button" onClick={onClose} aria-label={t("Закрыть")}>
          <Icon path="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" color="#555" size={24} />
        </button>
      </div>
      <div className="relative mt-[16px]">
        <span className="text-[12px] text-[#777]">{t("Филиал")}</span>
        <div className="mt-[4px] flex min-h-[34px] flex-wrap items-center gap-[5px] border-b border-[#d9d9d9] pb-[4px]">
          {draft.map((id) => (
            <span key={id} className="flex h-5 items-stretch overflow-hidden text-[12px] font-semibold text-white">
              <button type="button" aria-label={t("Удалить")} onClick={() => setDraft((current) => current.filter((item) => item !== id))} className="border-r border-white/30 bg-[#5c6df3] px-[5px]">
                ×
              </button>
              <span className="max-w-[200px] truncate bg-[#5c6df3] px-[5px]">{branches.find((branch) => branch.id === id)?.name ?? `#${id}`}</span>
            </span>
          ))}
          <input
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
            }}
            placeholder={draft.length ? "" : t("Поиск")}
            aria-label={t("Филиал")}
            className="min-w-[80px] flex-1 bg-transparent text-[13px] outline-none"
          />
        </div>
        {open && (
          <div className="absolute inset-x-0 top-full z-10 max-h-[205px] overflow-y-auto bg-white py-1 shadow-[0_1px_6px_rgba(0,0,0,0.2)]">
            {options.length === 0 ? (
              <div className="h-9 px-[10px] leading-9 text-[#999]">{t("Ничего не найдено")}</div>
            ) : (
              options.map((branch) => (
                <button
                  key={branch.id}
                  type="button"
                  onClick={() => {
                    setDraft((current) => [...current, branch.id])
                    setQuery("")
                    setOpen(false)
                  }}
                  className="block h-9 w-full truncate px-[10px] text-left font-semibold hover:bg-[#f2f5f8]"
                >
                  {branch.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <button type="button" onClick={() => onApply(draft)} className="mt-[18px] block h-9 w-full rounded-[5px] bg-[#71ce87] text-[13px] font-semibold uppercase text-white hover:brightness-95">
        {t("Применить")}
      </button>
    </div>
  )
}
