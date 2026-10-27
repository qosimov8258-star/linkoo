"use client"

import { useState } from "react"
import { createPortal } from "react-dom"

import { useLanguage } from "@/lib/i18n/language-context"

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]

const pad = (value: number) => String(value).padStart(2, "0")
const iso = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`

function parse(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (match) return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) }
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth(), day: now.getDate() }
}

/** Calendar dialog of the reference's date fields (blue header with the chosen date, ОТМЕНА / OK). Values are "YYYY-MM-DD". */
export function DatePickerDialog({ value, onCancel, onPick, anchor }: { value: string; onCancel: () => void; onPick: (value: string) => void; /** Opens as a popover at this point (the form date fields) instead of a dimmed centered dialog. */ anchor?: { left: number; top: number } }) {
  const { t } = useLanguage()
  const initial = parse(value)
  const [selected, setSelected] = useState(iso(initial.year, initial.month, initial.day))
  const [view, setView] = useState({ year: initial.year, month: initial.month })

  const first = (new Date(view.year, view.month, 1).getDay() + 6) % 7
  const days = new Date(view.year, view.month + 1, 0).getDate()
  const cells = [...Array.from({ length: first }, () => 0), ...Array.from({ length: days }, (_, i) => i + 1)]
  const chosen = parse(selected)
  const heading = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "short" }).format(new Date(chosen.year, chosen.month, chosen.day))

  function shift(step: number) {
    const next = new Date(view.year, view.month + step, 1)
    setView({ year: next.getFullYear(), month: next.getMonth() })
  }

  return createPortal(
    <div className={anchor ? "fixed inset-0 z-[1400]" : "fixed inset-0 z-[200] flex items-center justify-center bg-black/50"} onMouseDown={anchor ? onCancel : undefined}>
      <div
        onMouseDown={(event) => event.stopPropagation()}
        style={anchor ? { position: "absolute", left: Math.max(8, Math.min(anchor.left, window.innerWidth - 318)), top: Math.max(8, Math.min(anchor.top, window.innerHeight - 442)) } : undefined}
        className={`flex h-[434px] w-[310px] flex-col bg-white text-[#333] ${anchor ? "rounded-[2px] [box-shadow:0_2px_10px_rgba(0,0,0,0.2)]" : "shadow-xl"}`}
      >
        <div data-no-translate className="h-[104px] bg-[#4f71dc] px-[20px] pt-[17px] text-white">
          <div className="text-[16px] opacity-80">{chosen.year}</div>
          <div className="mt-[2px] text-[36px] leading-[44px]">{heading}</div>
        </div>
        <div className="flex h-[44px] items-center justify-between px-[16px]">
          <button type="button" onClick={() => shift(-1)} aria-label={t("Назад")} className="flex h-[24px] w-[24px] items-center justify-center text-[#555]">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></svg>
          </button>
          <span data-no-translate className="text-[14px]">{MONTHS[view.month]} {view.year} г.</span>
          <button type="button" onClick={() => shift(1)} aria-label={t("Вперед")} className="flex h-[24px] w-[24px] items-center justify-center text-[#555]">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
          </button>
        </div>
        <div data-no-translate className="-mt-[2px] grid grid-cols-7 px-[7px] text-center text-[12px] text-[#9e9e9e]">
          {WEEKDAYS.map((day) => <span key={day} className="h-[26px] leading-[26px]">{day}</span>)}
        </div>
        <div className="grid grid-cols-7 px-[7px] text-center text-[13px]">
          {cells.map((day, index) =>
            day === 0 ? (
              <span key={`blank-${index}`} className="h-[36px]" />
            ) : (
              <button
                key={day}
                type="button"
                onClick={() => setSelected(iso(view.year, view.month, day))}
                className={`mx-auto my-0 h-[36px] w-[36px] rounded-full ${selected === iso(view.year, view.month, day) ? "bg-[#4f71dc] text-white" : "hover:bg-black/5"}`}
              >
                {day}
              </button>
            ),
          )}
        </div>
        <div className="mt-auto flex justify-end gap-[8px] pb-[6px] pr-[8px] text-[14px] uppercase">
          <button type="button" onClick={onCancel} className="h-[36px] px-[16px] uppercase hover:bg-black/5">{t("Отмена")}</button>
          <button type="button" onClick={() => onPick(selected)} className="h-[36px] min-w-[64px] px-[16px] uppercase hover:bg-black/5">OK</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

