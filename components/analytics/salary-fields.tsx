"use client"

import { useEffect, useRef, useState } from "react"

import { RI } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"

export const SALARY_MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]

/** The reference's "Месяц" select: small bold caption, value, a clear cross and the caret. `value` is 0-based, null = cleared. */
export function SalaryMonthSelect({ value, onChange, className = "", bare }: { value: number | null; onChange: (value: number | null) => void; className?: string; /** No underline (the list toolbar of the reference). */ bare?: boolean }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])
  return (
    <div ref={rootRef} className={`relative h-[50px] ${className}`}>
      <span className="pointer-events-none absolute left-0 top-[5px] text-[10px] font-bold leading-[12px] text-black">{t("Месяц")}</span>
      <button type="button" onClick={() => setOpen((current) => !current)} className="absolute left-0 top-[27px] h-[26px] w-full pr-[40px] text-left text-[13px] leading-[26px] text-black outline-none">
        {value == null ? "" : t(SALARY_MONTHS[value])}
      </button>
      {!bare && <span className="pointer-events-none absolute inset-x-0 top-[53px] h-px bg-[#e8e8e8]" />}
      {value != null && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange(null)} className="absolute right-[24px] top-[29px] h-5 w-5">
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-black/30"><path d={RI.close} /></svg>
        </button>
      )}
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-[3px] top-[27px] h-6 w-6 fill-black/30"><path d="M7 10l5 5 5-5z" /></svg>
      {open && (
        <div className="absolute inset-x-0 top-[54px] z-50 max-h-[205px] overflow-y-auto bg-white py-1 shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
          {SALARY_MONTHS.map((name, index) => (
            <button
              key={name}
              type="button"
              onClick={() => {
                onChange(index)
                setOpen(false)
              }}
              className={`block h-9 w-full px-[10px] text-left text-[13px] hover:bg-[#f2f5f8] ${index === value ? "font-semibold text-[#4f71dc]" : "text-[#333]"}`}
            >
              {t(name)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The reference's "Год" field: a plain text input with a small bold caption. */
export function SalaryYearField({ value, onChange, className = "", bare }: { value: number; onChange: (value: number) => void; className?: string; bare?: boolean }) {
  const { t } = useLanguage()
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <div className={`relative h-[50px] ${className}`}>
      <span className="pointer-events-none absolute left-0 top-[11px] text-[10px] font-bold leading-[12px] text-black">{t("Год")}</span>
      <input
        value={text}
        inputMode="numeric"
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "").slice(0, 4)
          setText(digits)
          if (digits.length === 4) onChange(Number(digits))
        }}
        onBlur={() => setText(String(value))}
        className={`absolute left-0 top-[29px] h-[26px] w-full border-b ${bare ? "border-transparent" : "border-[#e8e8e8]"} bg-transparent text-[13px] font-semibold text-black outline-none focus:border-[#5d6474]`}
      />
    </div>
  )
}
