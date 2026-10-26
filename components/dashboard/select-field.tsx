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
    <div ref={ref} className="relative h-[54px]">
      <label className="absolute left-0 top-[5px] block text-[9.75px] font-semibold leading-[12.2px] text-black">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="absolute left-0 right-0 top-[18px] h-[36px] border-b border-[#e8e8e8] text-left outline-none focus:border-[#5d6474]"
      >
        <span className={`absolute left-0 top-[13px] text-[13px] font-semibold leading-[18px] ${value ? "text-[#333]" : "text-black/30"}`}>
          {t(value) || t(placeholder)}
        </span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            aria-label={t("Очистить")}
            title="Clear value"
            data-native-tip=""
            onClick={(e) => {
              e.stopPropagation()
              onChange("")
            }}
            className="absolute right-[25px] top-0 h-[35px] w-[17px] pt-[14px] text-center text-[18px] font-normal leading-[18px] text-[#999] hover:text-[#666]"
          >
            ×
          </span>
        )}
        <span
          aria-hidden
          className={`absolute right-[10px] top-[21.4px] h-[7px] w-[10px] border-x-[5px] border-b-[2px] border-t-[5px] border-x-transparent border-b-transparent border-t-[#999] ${open ? "origin-[50%_35%] rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul className="absolute left-0 right-0 top-[53px] z-30 max-h-[200px] overflow-y-auto rounded-b-[4px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
          {options.map((option) => (
            <li key={option}>
              <button
                type="button"
                onClick={() => {
                  onChange(option)
                  setOpen(false)
                }}
                className={`block w-full px-[10px] py-[8px] text-left text-[13px] font-semibold leading-[16.25px] hover:bg-[#e6f2ff] hover:text-[#333] ${option === value ? "bg-[#e6f2ff] text-[#333]" : "text-[#666]"}`}
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
