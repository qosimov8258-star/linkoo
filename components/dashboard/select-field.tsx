"use client"

import { useEffect, useRef, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

interface SelectFieldProps {
  label: string
  options: string[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function SelectField({ label, options, value, onChange, placeholder = "Выберите" }: SelectFieldProps) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <label className="block text-[10px] font-bold leading-3 text-black">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-[10px] flex h-[26px] w-full items-center justify-between border-b border-[#e0e0e0] text-left outline-none focus:border-[#5d6474]"
      >
        <span className={`text-[13px] font-semibold ${value ? "text-[#333]" : "text-black/30"}`}>{t(value) || t(placeholder)}</span>
        <span className="flex items-center">
          {value && (
            <span
              role="button"
              tabIndex={0}
              aria-label={t("Очистить")}
              onClick={(e) => {
                e.stopPropagation()
                onChange("")
              }}
              className="text-[16px] leading-none text-[#999] hover:text-[#666]"
            >
              ×
            </span>
          )}
          <svg viewBox="0 0 24 24" className={`h-6 w-6 fill-black/30 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </span>
      </button>

      {open && (
        <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-[2px] bg-white py-1 shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          {options.map((option) => (
            <li key={option}>
              <button
                type="button"
                onClick={() => {
                  onChange(option)
                  setOpen(false)
                }}
                className={`w-full px-4 py-2 text-left text-[13px] hover:bg-[#f2f5f8] ${option === value ? "bg-[#f2f5f8] font-semibold" : ""}`}
              >
                {t(option)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
