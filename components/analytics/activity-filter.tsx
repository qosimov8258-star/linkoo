"use client"

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { ChevronDown, X } from "lucide-react"

import { SearchSelect } from "@/components/analytics/cash-management-shared"
import {
  ACTIVITY_MAX_RANGE_DAYS,
  daysBetween,
  isActivityDay,
  monthEnd,
  monthStart,
  shiftDay,
  weekdayOf,
  type ActivityState,
} from "@/lib/activity-types"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

// "Показать фильтр" panel of the Активность page (demo #/activity): a floating panel under the
// button with Дата (range picker with presets), Тип клиента (multi select with chips),
// Подкатегория (only after a type is chosen), Магазин с оборудованием (Да / Нет) and ПРИМЕНИТЬ.
// Escape closes the open picker first, then the panel.

export type ClientTypeOption = { id: number; name: string }

type Draft = Pick<ActivityState, "from" | "to" | "clientTypes" | "withGear">

const MONTH_KEYS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]
const WEEKDAY_KEYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
const PRESETS = ["Сегодня", "Вчера", "Последние 7 дней", "Текущий месяц", "Пред. месяц"] as const
type Preset = (typeof PRESETS)[number]

function presetRange(preset: Preset, today: string): [string, string] {
  switch (preset) {
    case "Сегодня":
      return [today, today]
    case "Вчера":
      return [shiftDay(today, -1), shiftDay(today, -1)]
    case "Последние 7 дней":
      return [shiftDay(today, -6), today]
    case "Текущий месяц":
      return [monthStart(today), monthEnd(today)]
    default:
      return [monthStart(today, -1), monthEnd(today, -1)]
  }
}

/** "01 окт. 2026 - 31 окт. 2026" in the UI language. */
export function periodText(from: string, to: string, language: Parameters<typeof formatDateText>[1]): string {
  return `${formatDateText(from, language, { withTime: false })} - ${formatDateText(to, language, { withTime: false })}`
}

function MonthGrid({
  month,
  start,
  end,
  hover,
  onPick,
  onHover,
  onPrev,
  onNext,
}: {
  /** First day of the shown month. */
  month: string
  start: string | null
  end: string | null
  hover: string | null
  onPick: (day: string) => void
  onHover: (day: string | null) => void
  onPrev?: () => void
  onNext?: () => void
}) {
  const { t } = useLanguage()
  const year = Number(month.slice(0, 4))
  const monthIndex = Number(month.slice(5, 7)) - 1
  const first = shiftDay(month, 1 - weekdayOf(month))
  const cells = Array.from({ length: 42 }, (_, index) => shiftDay(first, index))
  const other = end ?? hover
  const lo = start && other ? (start <= other ? start : other) : start
  const hi = start && other ? (start <= other ? other : start) : start
  return (
    <div className="w-[252px] shrink-0">
      <div className="flex h-[26px] items-center justify-between bg-[#5d6474] px-[10px] text-[13px] font-semibold text-white">
        <button type="button" onClick={onPrev} aria-label={t("Назад")} className={`flex h-[18px] w-[18px] items-center justify-center rounded-[3px] bg-white/90 ${onPrev ? "" : "invisible"}`}>
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#333]">
            <path d="M15 6v12l-8-6z" />
          </svg>
        </button>
        <span>
          {t(MONTH_KEYS[monthIndex])} - {year}
        </span>
        <button type="button" onClick={onNext} aria-label={t("Вперед")} className={`flex h-[18px] w-[18px] items-center justify-center rounded-[3px] bg-white/90 ${onNext ? "" : "invisible"}`}>
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#333]">
            <path d="M9 6v12l8-6z" />
          </svg>
        </button>
      </div>
      <div className="mt-2 grid grid-cols-7 text-center text-[13px] font-semibold text-[#5d6474]">
        {WEEKDAY_KEYS.map((day) => (
          <span key={day} className="h-8 leading-8">
            {t(day)}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 text-center text-[13px]">
        {cells.map((day) => {
          const inMonth = day.slice(0, 7) === month.slice(0, 7)
          const allowed = isActivityDay(day)
          const edge = day === start || day === end
          const inRange = lo !== null && hi !== null && day >= lo && day <= hi
          return (
            <button
              key={day}
              type="button"
              disabled={!allowed}
              onClick={() => onPick(day)}
              onMouseEnter={() => onHover(day)}
              onMouseLeave={() => onHover(null)}
              className={`h-9 disabled:cursor-not-allowed disabled:opacity-30 ${edge ? "bg-[#5d6474] font-semibold text-white" : inRange ? "bg-[#e3e6ec]" : "hover:bg-[#f2f5f8]"} ${inMonth || edge ? "" : "text-[#bbb]"}`}
            >
              {Number(day.slice(8, 10))}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Range picker popover: presets, two months (previous + current), ✕ / ✓. */
export function ActivityRangePicker({
  from,
  to,
  today,
  onApply,
  onClose,
}: {
  from: string
  to: string
  today: string
  onApply: (from: string, to: string) => void
  onClose: () => void
}) {
  const { t } = useLanguage()
  // The right calendar shows the month of the range end (the demo: previous + current month).
  const [view, setView] = useState(() => monthStart(to, -1))
  const [start, setStart] = useState<string | null>(from)
  const [stop, setStop] = useState<string | null>(to)
  const [hover, setHover] = useState<string | null>(null)
  const [preset, setPreset] = useState<Preset | null>(null)
  const [error, setError] = useState("")

  function pick(day: string) {
    setPreset(null)
    setError("")
    if (!start || stop) {
      setStart(day)
      setStop(null)
    } else if (day < start) {
      setStop(start)
      setStart(day)
    } else {
      setStop(day)
    }
  }

  function apply() {
    if (!start) return
    const end = stop ?? start
    if (daysBetween(start, end) > ACTIVITY_MAX_RANGE_DAYS) {
      setError("Период не может быть больше 366 дней")
      return
    }
    onApply(start, end)
  }

  const shift = (months: number) => setView((current) => monthStart(current, months))

  return (
    <div className="absolute right-0 top-[calc(100%+6px)] z-[60] flex max-w-[calc(100vw-32px)] flex-wrap gap-[10px] overflow-auto rounded-[10px] bg-white p-[10px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)] sm:w-[680px] sm:flex-nowrap">
      <div className="flex w-[140px] shrink-0 flex-col gap-[6px] pt-[2px]">
        {PRESETS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => {
              const [s, e] = presetRange(item, today)
              setPreset(item)
              setError("")
              setStart(s)
              setStop(e)
              setView(monthStart(e, -1))
            }}
            className={`h-[35px] whitespace-nowrap px-[14px] text-left text-[13px] ${preset === item ? "bg-[#9aa0b4] text-white" : "bg-[#eceff1] hover:bg-[#e1e5ea]"}`}
          >
            {t(item)}
          </button>
        ))}
        {error && <p className="text-[12px] leading-4 text-[#e57373]">{t(error)}</p>}
        <div className="mt-auto flex gap-[10px] pb-1 pt-6">
          <button type="button" onClick={onClose} aria-label={t("Отмена")} title={t("Отмена")} className="flex h-[26px] w-[60px] items-center justify-center rounded-[3px] bg-[#5d6474]">
            <X className="h-4 w-4 text-white" />
          </button>
          <button type="button" disabled={!start} onClick={apply} aria-label={t("Применить")} title={t("Применить")} className="flex h-[26px] w-[60px] items-center justify-center rounded-[3px] bg-[#5d6474] disabled:opacity-50">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
            </svg>
          </button>
        </div>
      </div>
      <MonthGrid month={view} start={start} end={stop} hover={stop ? null : hover} onPick={pick} onHover={setHover} onPrev={() => shift(-1)} />
      <MonthGrid month={monthStart(view, 1)} start={start} end={stop} hover={stop ? null : hover} onPick={pick} onHover={setHover} onNext={() => shift(1)} />
    </div>
  )
}

/** Searchable multi select with removable chips; stays open after a pick (demo react-select). */
function ChipMultiSelect({ options, value, onChange }: { options: ClientTypeOption[]; value: number[]; onChange: (next: number[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  const names = useMemo(() => new Map(options.map((option) => [option.id, option.name])), [options])
  const needle = query.trim().toLowerCase()
  const visible = options.filter((option) => !value.includes(option.id) && (!needle || option.name.toLowerCase().includes(needle))).slice(0, 200)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const onKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && open) {
      event.stopPropagation()
      setOpen(false)
    } else if (event.key === "Backspace" && !query && value.length) {
      onChange(value.slice(0, -1))
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (visible[0]) {
        onChange([...value, visible[0].id])
        setQuery("")
      }
    }
  }

  return (
    <div ref={ref} className="relative">
      <div className="flex min-h-[36px] cursor-text flex-wrap items-center gap-1 border-b border-[#ccc] py-1 pr-12" onClick={() => setOpen(true)}>
        {value.map((id) => (
          <span key={id} className="flex max-w-full items-center gap-1 rounded-[2px] bg-[#e6e6e6] py-[2px] pl-1 pr-[6px] text-[12px] text-[#333]">
            <button
              type="button"
              aria-label={t("Удалить")}
              onClick={(event) => {
                event.stopPropagation()
                onChange(value.filter((item) => item !== id))
              }}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] hover:bg-[#ffbdad] hover:text-[#de350b]"
            >
              <X className="h-3 w-3" />
            </button>
            <span className="truncate">{names.get(id) ?? `#${id}`}</span>
          </span>
        ))}
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={value.length ? "" : t("Выберите")}
          aria-label={t("Тип клиента")}
          className="min-w-[60px] flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#999]"
        />
      </div>
      {value.length > 0 && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange([])} className="absolute right-6 top-[10px] text-[#999] hover:text-[#333]">
          <X className="h-4 w-4" />
        </button>
      )}
      <ChevronDown className="pointer-events-none absolute right-0 top-[10px] h-4 w-4 text-[#999]" />
      {open && (
        <div className="absolute left-0 right-0 top-full z-[60] mt-1 max-h-60 overflow-y-auto rounded-[4px] bg-white py-1 shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_4px_11px_rgba(0,0,0,0.1)]">
          {!visible.length && <p className="px-3 py-2 text-center text-[13px] text-[#999]">{t("Не найдено")}</p>}
          {visible.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                onChange([...value, option.id])
                setQuery("")
              }}
              className="block w-full truncate px-3 py-2 text-left text-[13px] hover:bg-[#deebff]"
            >
              {option.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ActivityFilterPanel({
  state,
  today,
  clientTypes,
  onApply,
  onClose,
}: {
  state: ActivityState
  today: string
  clientTypes: ClientTypeOption[]
  onApply: (draft: Draft) => void
  onClose: () => void
}) {
  const { t, language } = useLanguage()
  const [draft, setDraft] = useState<Draft>({ from: state.from, to: state.to, clientTypes: state.clientTypes, withGear: state.withGear })
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (pickerOpen) setPickerOpen(false)
      else onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, pickerOpen])

  const gearOptions = [
    { value: "yes", label: t("Да") },
    { value: "no", label: t("Нет") },
  ]
  const known = new Set(clientTypes.map((type) => type.id))
  // A type removed meanwhile (stale URL) stays removable as a chip but is not sent on apply.
  const chosen = draft.clientTypes

  return (
    <section
      role="dialog"
      aria-label={t("Фильтр")}
      className="absolute right-0 top-[calc(100%+8px)] z-50 w-[300px] max-w-[calc(100vw-32px)] rounded-[2px] bg-white p-5 text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
    >
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">{t("Фильтр")}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-6 w-6 items-center justify-center rounded-full border border-[#999] text-[#666] hover:bg-[#f2f5f8]">
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <div className="space-y-5">
        <div className="relative">
          <span className="mb-1 block text-[12px] font-semibold text-[#333]">{t("Дата")}</span>
          <button type="button" onClick={() => setPickerOpen((open) => !open)} className="flex h-9 w-full items-center justify-between border-b border-[#ccc] text-left text-[13px]">
            <span>{periodText(draft.from, draft.to, language)}</span>
            <ChevronDown className="h-4 w-4 text-[#999]" />
          </button>
          {pickerOpen && (
            <ActivityRangePicker
              from={draft.from}
              to={draft.to}
              today={today}
              onClose={() => setPickerOpen(false)}
              onApply={(from, to) => {
                setDraft((current) => ({ ...current, from, to }))
                setPickerOpen(false)
              }}
            />
          )}
        </div>
        <div>
          <span className="mb-1 block text-[12px] font-semibold text-[#333]">{t("Тип клиента")}</span>
          <ChipMultiSelect options={clientTypes} value={chosen} onChange={(next) => setDraft((current) => ({ ...current, clientTypes: next }))} />
        </div>
        {chosen.length > 0 && (
          <div>
            <span className="mb-1 block text-[12px] font-semibold text-[#333]">{t("Подкатегория")}</span>
            {/* Our client types have no sub-types (no parent), so there is nothing to choose. */}
            <div className="flex h-9 items-center justify-between border-b border-[#ccc] text-[13px] text-[#999]">
              <span>{t("Не найдено")}</span>
              <ChevronDown className="h-4 w-4" />
            </div>
          </div>
        )}
        <div>
          <span className="mb-1 block text-[12px] font-semibold text-[#333]">{t("Магазин с оборудованием")}</span>
          <SearchSelect
            value={draft.withGear === null ? "" : draft.withGear ? "yes" : "no"}
            options={gearOptions}
            placeholder={t("Выберите")}
            onChange={(value) => setDraft((current) => ({ ...current, withGear: value === "yes" ? true : value === "no" ? false : null }))}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onApply({ ...draft, clientTypes: draft.clientTypes.filter((id) => known.has(id)) })}
            className="h-9 rounded-[2px] bg-[#5d6474] px-6 text-[13px] font-semibold uppercase text-white hover:brightness-95"
          >
            {t("Применить")}
          </button>
          <button
            type="button"
            onClick={() => setDraft({ from: today, to: today, clientTypes: [], withGear: null })}
            className="text-[13px] text-[#4f71dc] hover:underline"
          >
            {t("Сбросить")}
          </button>
        </div>
      </div>
    </section>
  )
}
