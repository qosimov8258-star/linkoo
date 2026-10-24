"use client"

import { useEffect, useRef, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

export type RefOption = { value: string; label: string }

/**
 * Select field of the reference's filter panels: the field name acts as the placeholder, shrinks to a
 * 10px label once something is picked, the underline carries a caret and the list drops below.
 * `multiple` keeps the list open and toggles values; otherwise a pick replaces the value.
 */
export function RefMultiField({
  label,
  options,
  value,
  onChange,
  multiple = true,
}: {
  label: string
  options: RefOption[]
  value: string[]
  onChange: (next: string[]) => void
  multiple?: boolean
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])
  const text = value.map((item) => options.find((option) => option.value === item)?.label ?? item).join(", ")
  return (
    <div ref={ref} className="relative h-[54px]">
      <button type="button" onClick={() => setOpen((current) => !current)} className="absolute inset-0 border-b border-[#e0e0e0] text-left">
        {value.length > 0 && <span className="absolute left-0 top-[7px] text-[10px] leading-3 text-black">{t(label)}</span>}
        <span className={`absolute inset-x-0 truncate pr-6 text-[13px] leading-[18px] text-black ${value.length > 0 ? "top-[26px]" : "top-[28px] font-semibold"}`}>{value.length > 0 ? text : t(label)}</span>
        <svg viewBox="0 0 24 24" className="pointer-events-none absolute bottom-[6px] right-0 h-6 w-6 fill-[#999]" aria-hidden>
          <path d={open ? "M7 14l5-5 5 5z" : "M7 10l5 5 5-5z"} />
        </svg>
      </button>
      {open && options.length > 0 && (
        <ul className="absolute left-0 right-0 top-[54px] z-30 m-0 max-h-[200px] list-none overflow-y-auto bg-white py-[4px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
          {options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                onClick={() => {
                  if (multiple) onChange(value.includes(option.value) ? value.filter((item) => item !== option.value) : [...value, option.value])
                  else {
                    onChange(value.includes(option.value) ? [] : [option.value])
                    setOpen(false)
                  }
                }}
                className={`block h-9 w-full px-[10px] text-left text-[13px] font-semibold leading-9 text-[#333] hover:bg-[#f2f5f8] ${value.includes(option.value) ? "bg-[#e6f2ff]" : ""}`}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
