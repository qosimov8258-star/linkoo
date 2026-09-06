"use client"

import { useEffect, useRef, useState } from "react"
import { X, ChevronDown } from "lucide-react"

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
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <label className="text-sm font-semibold text-slate-600">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-2 flex w-full items-center justify-between border-b border-slate-300 pb-2 text-left outline-none focus:border-brand-blue"
      >
        <span className={value ? "text-base text-slate-700" : "text-base text-slate-400"}>{t(value) || t(placeholder)}</span>
        <span className="flex items-center gap-1 text-slate-400">
          {value && (
            <span
              role="button"
              tabIndex={0}
              aria-label={t("Очистить")}
              onClick={(e) => {
                e.stopPropagation()
                onChange("")
              }}
              className="rounded p-0.5 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </span>
          )}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {options.map((option) => (
            <li key={option}>
              <button
                type="button"
                onClick={() => {
                  onChange(option)
                  setOpen(false)
                }}
                className={`w-full px-4 py-2 text-left text-sm transition-colors hover:bg-slate-50 ${
                  option === value ? "bg-slate-100 font-semibold text-slate-800" : "text-slate-700"
                }`}
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
