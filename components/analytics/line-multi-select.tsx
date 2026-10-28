"use client"

import { ChevronDown, ChevronUp, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

/** Underlined multi select (reference "Категории"): chips of the picked options, clear-all cross and a checkable list. */
export function LineMultiSelect({
  label,
  value,
  onChange,
  options,
  required,
  loading,
}: {
  label: string
  value: string[]
  onChange: (value: string[]) => void
  options: string[]
  required?: boolean
  loading?: boolean
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])
  const toggle = (option: string) => onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option])
  const Chevron = open ? ChevronUp : ChevronDown
  return (
    <div ref={rootRef} className="relative">
      <div role="button" tabIndex={0} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (event.key === "Enter") setOpen((current) => !current) }} className="relative block min-h-[56px] w-full cursor-pointer border-b border-[#d5dae1] pr-[46px]">
        <span className={`absolute left-0 ${value.length ? "top-[8px] text-[10px] font-semibold leading-3" : "top-[33px] text-[13px] font-bold leading-4"}`}>
          {label}{required && <span className="text-red-500"> *</span>}
        </span>
        {value.length > 0 && (
          <span className="flex flex-wrap gap-[6px] pb-[7px] pt-[24px]">
            {value.map((item) => (
              <span key={item} className="flex h-[22px] items-center overflow-hidden rounded-[2px] bg-[#5868f0] text-[12px] font-semibold leading-none text-white">
                <button type="button" aria-label={t("Удалить")} onClick={(event) => { event.stopPropagation(); toggle(item) }} className="h-full border-r border-white/30 px-[6px]">×</button>
                <span className="px-[6px]">{item}</span>
              </span>
            ))}
          </span>
        )}
        <span className="absolute bottom-[12px] right-0 flex items-center gap-[10px] text-slate-500">
          {value.length > 0 && <span role="button" aria-label="clear" onClick={(event) => { event.stopPropagation(); onChange([]) }}><X className="h-3.5 w-3.5" /></span>}
          <Chevron className="h-4 w-4" />
        </span>
      </div>
      {open && (
        <ul className="absolute left-0 right-0 z-20 mt-0.5 max-h-60 overflow-y-auto bg-white shadow-[0_2px_10px_rgba(0,0,0,0.2)]">
          {options.length === 0 ? (
            <li className="px-[10px] py-[10px] text-slate-400">{loading ? t("Загрузка...") : "—"}</li>
          ) : (
            options.map((option, index) => (
              <li key={`${option}-${index}`}>
                <button type="button" onClick={() => toggle(option)} className={`block w-full px-[10px] py-[10px] text-left font-semibold text-[#333] ${value.includes(option) ? "bg-[#e6f0ff]" : "hover:bg-slate-50"}`}>{option}</button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
