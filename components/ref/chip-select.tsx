"use client"

import { useEffect, useRef, useState } from "react"
import { Search, X } from "lucide-react"

import { useLanguage } from "@/lib/i18n/language-context"

export type ChipOption = { id: number; name: string }

/** Linko's multi-select (the report «Пользователи» dialog, the shop's «Изменение агентов» price lists): the chosen
 * entries as chips, × clears them, ▾ opens the list with a search. */
export function ChipSelect({ label, options, value, onChange }: { label: string; options: ChipOption[]; value: number[]; onChange: (next: number[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])
  const names = new Map(options.map((option) => [option.id, option.name]))
  const needle = query.trim().toLocaleLowerCase("ru")
  const shown = options.filter((option) => !needle || option.name.toLocaleLowerCase("ru").includes(needle)).slice(0, 300)
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id])
  return (
    <div ref={ref} onKeyDown={(event) => {
      // Escape closes the open list only: the dialog around it stays.
      // (React listens on the document itself: only stopImmediatePropagation keeps the later document listeners of the
      // dialogs and drawers around it from closing them.)
      if (event.key === "Escape" && open) {
        event.preventDefault()
        event.nativeEvent.stopImmediatePropagation()
        setOpen(false)
      }
    }} className="relative">
      <span className="block text-[11px] font-semibold text-black">{label}</span>
      <div className="flex min-h-[34px] items-center gap-[6px] border-b border-[#e0e0e0] py-[4px]">
        <div role="button" tabIndex={0} aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setOpen(!open) }} className="flex min-h-[24px] flex-1 cursor-pointer flex-wrap items-center gap-[4px]">
          {value.map((id) => (
            <span key={id} className="inline-flex h-[22px] items-center rounded-[2px] bg-[#1E4A9A] text-[12px] font-semibold text-white">
              <button type="button" aria-label={t("Удалить")} onClick={(event) => { event.stopPropagation(); toggle(id) }} className="h-full border-r border-white/40 px-[5px] hover:bg-black/15">×</button>
              <span className="px-[6px]">{names.get(id) ?? `№${id}`}</span>
            </span>
          ))}
        </div>
        {value.length > 0 && <button type="button" aria-label={t("Очистить")} onClick={() => onChange([])} className="text-[#999] hover:text-black"><X className="h-[14px] w-[14px]" /></button>}
        <button type="button" aria-label={label} onClick={() => setOpen(!open)} className="text-[#999] hover:text-black"><svg viewBox="0 0 10 6" className="h-[6px] w-[10px] fill-current" aria-hidden><path d="M0 0h10L5 6z" /></svg></button>
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-[10] mt-[2px] rounded-[2px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
          <div className="flex items-center gap-[8px] border-b border-[#eee] px-[12px]">
            <Search className="h-[15px] w-[15px] shrink-0 text-[#999]" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="h-[36px] w-full text-[13px] outline-none" />
          </div>
          <ul role="listbox" aria-multiselectable="true" className="max-h-[180px] overflow-y-auto py-[4px]">
            {shown.map((option) => (
              <li key={option.id} role="option" aria-selected={value.includes(option.id)}>
                <button type="button" onClick={() => toggle(option.id)} className={`flex w-full items-center px-[14px] py-[7px] text-left text-[13px] hover:bg-[#f2f5f8] ${value.includes(option.id) ? "font-semibold text-[#1E4A9A]" : "text-black"}`}>{option.name}</button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-[14px] py-[10px] text-[13px] text-[#999]">{t("Ничего не найдено")}</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
