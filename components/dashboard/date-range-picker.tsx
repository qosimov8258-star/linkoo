"use client"

import { useMemo, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]
const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
const PRESETS = ["Сегодня", "Вчера", "Последние 7 дней", "Текущий месяц", "Пред. месяц"] as const

const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
const fromIso = (value: string) => {
  const [y, m, d] = value.split("-").map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
const sameDay = (a: Date, b: Date) => iso(a) === iso(b)

function presetRange(preset: (typeof PRESETS)[number]): [Date, Date] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  switch (preset) {
    case "Сегодня":
      return [today, today]
    case "Вчера": {
      const y = new Date(today)
      y.setDate(y.getDate() - 1)
      return [y, y]
    }
    case "Последние 7 дней": {
      const s = new Date(today)
      s.setDate(s.getDate() - 6)
      return [s, today]
    }
    case "Текущий месяц":
      return [new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getFullYear(), today.getMonth() + 1, 0)]
    default:
      return [new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)]
  }
}

function Month({
  year,
  month,
  start,
  end,
  hover,
  onPick,
  onHover,
  onPrev,
  onNext,
}: {
  year: number
  month: number
  start: Date | null
  end: Date | null
  hover: Date | null
  onPick: (date: Date) => void
  onHover: (date: Date | null) => void
  onPrev?: () => void
  onNext?: () => void
}) {
  const { t } = useLanguage()
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  const cells = Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - offset + i))
  const rangeEnd = end ?? hover
  const lo = start && rangeEnd ? (start <= rangeEnd ? start : rangeEnd) : start
  const hi = start && rangeEnd ? (start <= rangeEnd ? rangeEnd : start) : start

  return (
    <div className="w-[280px]">
      <div className="flex h-[26px] items-center justify-between bg-[#5d6474] px-[10px] text-[13px] font-semibold text-white">
        <button type="button" onClick={onPrev} className={`flex h-[18px] w-[18px] items-center justify-center rounded-[3px] bg-white/90 ${onPrev ? "" : "invisible"}`} aria-label={t("Назад")}>
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#333]"><path d="M15 6v12l-8-6z" /></svg>
        </button>
        <span>{MONTHS[month]} - {year}</span>
        <button type="button" onClick={onNext} className={`flex h-[18px] w-[18px] items-center justify-center rounded-[3px] bg-white/90 ${onNext ? "" : "invisible"}`} aria-label={t("Вперед")}>
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#333]"><path d="M9 6v12l8-6z" /></svg>
        </button>
      </div>
      <div className="mt-2 grid grid-cols-7 text-center text-[13px] font-semibold text-[#5d6474]">
        {WEEKDAYS.map((day) => (
          <span key={day} className="h-8 leading-8">{day}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 text-center text-[13px]">
        {cells.map((date) => {
          const inMonth = date.getMonth() === month
          const selected = (start && sameDay(date, start)) || (end && sameDay(date, end))
          const inRange = lo && hi && date >= lo && date <= hi
          return (
            <button
              key={iso(date)}
              type="button"
              onClick={() => onPick(date)}
              onMouseEnter={() => onHover(date)}
              onMouseLeave={() => onHover(null)}
              className={`h-10 ${selected ? "bg-[#5d6474] font-semibold text-white" : inRange ? "bg-[#e3e6ec]" : ""} ${inMonth ? "" : "text-[#bbb]"}`}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function DateRangePicker({
  begin,
  end,
  onApply,
  onClose,
  placement = "below",
}: {
  begin: string
  end: string
  onApply: (begin: string, end: string) => void
  onClose: () => void
  placement?: "below" | "above"
}) {
  const { t } = useLanguage()
  const initial = fromIso(begin)
  const [view, setView] = useState({ year: initial.getFullYear(), month: initial.getMonth() - 1 })
  const [start, setStart] = useState<Date | null>(fromIso(begin))
  const [stop, setStop] = useState<Date | null>(fromIso(end))
  const [hover, setHover] = useState<Date | null>(null)
  const [preset, setPreset] = useState<string>("")

  const normalized = useMemo(() => {
    const base = new Date(view.year, view.month, 1)
    const next = new Date(view.year, view.month + 1, 1)
    return [base, next]
  }, [view])

  const shift = (delta: number) => setView((current) => {
    const d = new Date(current.year, current.month + delta, 1)
    return { year: d.getFullYear(), month: d.getMonth() }
  })

  function pick(date: Date) {
    setPreset("")
    if (!start || (start && stop)) {
      setStart(date)
      setStop(null)
    } else if (date < start) {
      setStop(start)
      setStart(date)
    } else {
      setStop(date)
    }
  }

  return (
    <>
      <button type="button" aria-label={t("Закрыть")} onClick={onClose} className="fixed inset-0 z-30 cursor-default" />
      <div className={`absolute left-0 ${placement === "above" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]"} z-40 flex w-[750px] gap-[10px] rounded-[10px] bg-white p-[10px] font-sans text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]`}>
        <div className="flex w-[140px] shrink-0 flex-col gap-[6px] pt-[2px]">
          {PRESETS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                const [s, e] = presetRange(item)
                setPreset(item)
                setStart(s)
                setStop(e)
                setView({ year: s.getFullYear(), month: s.getMonth() })
              }}
              className={`h-[35px] whitespace-nowrap px-[14px] text-left text-[13px] ${preset === item ? "bg-[#9aa0b4] text-white" : "bg-[#eceff1]"}`}
            >
              {t(item)}
            </button>
          ))}
          <div className="mt-auto flex gap-[10px] pb-1 pt-14">
            <button type="button" onClick={onClose} aria-label={t("Отмена")} className="flex h-[26px] w-[60px] items-center justify-center rounded-[3px] bg-[#5d6474]">
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
            </button>
            <button
              type="button"
              disabled={!start}
              onClick={() => start && onApply(iso(start), iso(stop ?? start))}
              aria-label={t("Применить")}
              className="flex h-[26px] w-[60px] items-center justify-center rounded-[3px] bg-[#5d6474] disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
            </button>
          </div>
        </div>
        <Month year={normalized[0].getFullYear()} month={normalized[0].getMonth()} start={start} end={stop} hover={hover} onPick={pick} onHover={setHover} onPrev={() => shift(-1)} />
        <Month year={normalized[1].getFullYear()} month={normalized[1].getMonth()} start={start} end={stop} hover={hover} onPick={pick} onHover={setHover} onNext={() => shift(1)} />
      </div>
    </>
  )
}
