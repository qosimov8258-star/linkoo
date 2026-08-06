"use client"

import { useState } from "react"
import { User } from "lucide-react"

const MONTHS = [
  "Января",
  "Февраля",
  "Марта",
  "Апреля",
  "Мая",
  "Июня",
  "Июля",
  "Августа",
  "Сентября",
  "Октября",
  "Ноября",
  "Декабря",
]

function fmt(date: Date) {
  return `${String(date.getDate()).padStart(2, "0")} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

// Fixed reference date to match the mockup (July 2026)
const REFERENCE = new Date(2026, 6, 31)

function computeRange(key: string): string {
  const end = new Date(REFERENCE)
  switch (key) {
    case "СЕГОДНЯ": {
      return fmt(end)
    }
    case "ВЧЕРА": {
      const y = new Date(end)
      y.setDate(y.getDate() - 1)
      return fmt(y)
    }
    case "ПОСЛ. 7": {
      const start = new Date(end)
      start.setDate(start.getDate() - 6)
      return `${fmt(start)} - ${fmt(end)}`
    }
    case "МЕСЯЦ":
    default: {
      const start = new Date(end.getFullYear(), end.getMonth(), 1)
      const last = new Date(end.getFullYear(), end.getMonth() + 1, 0)
      return `${fmt(start)} - ${fmt(last)}`
    }
  }
}

const rangeButtons = ["СЕГОДНЯ", "ВЧЕРА", "ПОСЛ. 7", "МЕСЯЦ"]

export function DateRangeBar() {
  const [active, setActive] = useState("МЕСЯЦ")

  return (
    <div className="mx-6 mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-white px-6 py-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-slate-100">
          <User className="h-7 w-7 text-slate-400" />
        </span>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-slate-700">Admin Ritm</span>
          <span className="text-sm text-slate-400">Сервер: (https://time3.linko.uz)</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <span className="text-base font-bold text-link">{computeRange(active)}</span>
        <div className="flex items-center gap-1 rounded-md">
          {rangeButtons.map((label) => (
            <button
              key={label}
              onClick={() => setActive(label)}
              className={`rounded-md px-4 py-2.5 text-sm font-bold transition-colors ${
                label === active
                  ? "bg-brand-blue text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
