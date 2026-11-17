"use client"

import type { ReactNode } from "react"
import { useLanguage } from "@/lib/i18n/language-context"

// Linko's dialog form fields: an underlined line whose name sits on it in bold until it has a value (then it moves up
// small), a select with Linko's ▾, and a date shown as "17 ноября 2026 г." with a calendar icon (the browser's own date
// picker opens on a click). Used by the forms copied from Linko (employee fines and corrections, client income and
// expense).

export const LINE_INPUT =
  "absolute bottom-0 left-0 h-[30px] w-full border-b border-[#e0e0e0] bg-transparent text-[13px] text-[#333] outline-none focus:border-[#1E4A9A]"

export function LineField({ label, filled, children }: { label: string; filled: boolean; children: ReactNode }) {
  return (
    <label className="relative block h-[50px]">
      {children}
      <span className={`pointer-events-none absolute left-0 font-semibold transition-all ${filled ? "top-0 text-[11px] text-[#555]" : "top-[24px] text-[13px] text-black"}`}>{label}</span>
    </label>
  )
}

function Caret() {
  return (
    <svg viewBox="0 0 10 5" aria-hidden className="pointer-events-none absolute bottom-[12px] right-[8px] h-[5px] w-[10px] fill-[#757575]">
      <path d="M0 0h10L5 5z" />
    </svg>
  )
}

export function LineSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <LineField label={label} filled={!!value}>
      <select value={value} aria-label={label} onChange={(event) => onChange(event.target.value)} className={`${LINE_INPUT} appearance-none pr-[22px]`}>
        <option value="" />
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Caret />
    </LineField>
  )
}

/** "17 ноября 2026 г." in the page's language. */
export function longDate(iso: string, language: string): string {
  const locale = ({ ru: "ru-RU", uz: "uz-Latn-UZ", tk: "tk-TM", en: "en-GB" } as Record<string, string>)[language] ?? "ru-RU"
  try {
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`))
  } catch {
    return iso
  }
}

/** Linko's date field: the name over the line, the chosen day, a calendar icon; the native picker sits on top. */
export function LineDate({ label, value, onChange, small = false }: { label: string; value: string; onChange: (value: string) => void; small?: boolean }) {
  const { language } = useLanguage()
  return (
    <div>
      {small && <span className="block text-[10px] font-semibold text-[#333]">{label}</span>}
      <div className={`relative flex h-[30px] items-center justify-between border-b border-[#e0e0e0] text-[13px] text-[#333] ${small ? "mt-[4px]" : ""}`}>
        <span className={value ? "" : "font-semibold text-black"}>{value ? longDate(value, language) : small ? "" : label}</span>
        <svg viewBox="0 0 24 24" aria-hidden className="h-[18px] w-[18px] fill-[#bdbdbd]">
          <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z" />
        </svg>
        <input type="date" value={value} aria-label={label} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </div>
    </div>
  )
}
