"use client"

import { useEffect, useState, type ReactNode } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

export type PickItem = { id: number; name: string }

/** Closes an open list on Escape. */
function useEscape(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, close])
}

/** Underlined text field of the reference's KPI form (floating label). */
export function Line({ label, value, onChange, required, type = "text", children }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string; children?: ReactNode }) {
  return (
    <label className="relative block h-[50px] border-b border-[#e0e0e0] focus-within:border-[#5d6474]">
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder=" " className="peer absolute inset-x-0 bottom-0 h-[34px] bg-transparent pt-[6px] text-[13px] font-semibold text-black outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
      <span className="pointer-events-none absolute left-0 top-[26px] text-[13px] font-semibold leading-[18px] text-black transition-all peer-focus:top-[6px] peer-focus:text-[10px] peer-[:not(:placeholder-shown)]:top-[6px] peer-[:not(:placeholder-shown)]:text-[10px]">
        {label}
        {required && <span className="text-[#e57373]">{" *"}</span>}
      </span>
      {children}
    </label>
  )
}

// Month names of the reference's date fields ("февраля 2026 г.") and its month picker ("февр.").
const MONTHS_GENITIVE = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
const MONTHS_SHORT = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."]

export function MonthField({ label, value, onChange, className = "", padLeft = 0, popupLeft = 0 }: { label: string; value: string | null; onChange: (value: string | null) => void; className?: string; padLeft?: number; popupLeft?: number }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  useEscape(open, () => setOpen(false))
  const now = new Date()
  const [year, setYear] = useState(() => Number(value?.slice(0, 4)) || now.getFullYear())
  // the reference leaves the chosen month in Russian in every language
  const text = value ? `${MONTHS_GENITIVE[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)} г.` : ""
  const current = value ? (Number(value.slice(0, 4)) === year ? Number(value.slice(5, 7)) - 1 : -1) : year === now.getFullYear() ? now.getMonth() : -1
  const choose = (month: number) => {
    onChange(`${year}-${String(month + 1).padStart(2, "0")}`)
    setOpen(false)
  }
  return (
    <div className={`relative ${className}`}>
      <button type="button" onClick={() => setOpen((state) => !state)} className="relative block h-[50px] w-full border-b border-[#e0e0e0] text-left">
        <span className="absolute top-[12px] text-[11px] leading-[13.8px] text-[#333]" style={{ left: padLeft }}>{label}</span>
        <span className={`absolute top-[28.8px] text-[13px] leading-[16.3px] ${text ? "text-black" : "text-[#bdbdbd]"}`} style={{ left: padLeft }}><span data-no-translate>{text || "Выберите месяц"}</span></span>
        <svg viewBox="0 0 24 24" className="absolute right-[0.5px] top-[14px] h-5 w-5 fill-[#ccc]"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z" /></svg>
      </button>
      {open && (
        <>
          <button type="button" aria-label={t("Закрыть")} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute top-[53px] z-50 w-[334px] bg-white p-[7px] text-[#666] shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]" style={{ left: popupLeft }}>
            <div className="flex h-[54.4px] items-center justify-between">
              <button type="button" onClick={() => setYear((state) => state - 1)} className="flex h-[54.4px] w-[54.4px] items-center justify-center text-[19.2px] hover:bg-[#ffecc9]">&lt;</button>
              <span className="text-[13px] text-[#333]">{year}</span>
              <button type="button" onClick={() => setYear((state) => state + 1)} className="flex h-[54.4px] w-[54.4px] items-center justify-center text-[19.2px] hover:bg-[#ffecc9]">&gt;</button>
            </div>
            <div className="grid grid-cols-3">
              {MONTHS_SHORT.map((month, index) => (
                <button key={month} type="button" onClick={() => choose(index)} className={`h-[54.4px] text-[18.4px] ${index === current ? "bg-[#5d6474] text-white" : "hover:bg-[#ffecc9]"}`}>{t(month)}</button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const CARET_DOWN = "M0 0l5 5 5-5z"
const CARET_UP = "M0 5l5-5 5 5z"

/** The reference's underlined select: floating label, "×" to clear, 32px options that wrap, 200px list. */
export function RefSelect({
  label,
  value,
  onChange,
  options,
  className = "",
  clearable,
  boxHeight = 41,
  floatTop = -13,
  required,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
  className?: string
  clearable?: boolean
  boxHeight?: number
  floatTop?: number
  required?: boolean
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  useEscape(open, () => setOpen(false))
  const [hover, setHover] = useState(-1)
  const active = hover >= 0 ? hover : Math.max(0, options.indexOf(value))
  return (
    <div className={`relative ${className}`} style={{ height: boxHeight }}>
      <button type="button" onClick={() => setOpen((state) => !state)} className="absolute inset-x-0 top-0 h-[36px] border-b border-[#e8e8e8] text-left text-[13px]">
        {value ? (
          <>
            <span className="absolute left-0 text-[10px] font-semibold leading-[12.2px] text-black" style={{ top: floatTop }}>{label}</span>
            <span className="absolute left-0 top-[13px] max-w-[88%] truncate font-semibold leading-[18px] text-[#333]">{value}</span>
          </>
        ) : (
          <span className="absolute left-0 top-[12px] font-semibold leading-[16.3px] text-black">
            {label}
            {required && <span className="text-[#e57373]">{" *"}</span>}
          </span>
        )}
      </button>
      {value && clearable && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange("")} className="absolute right-[28.4px] top-[13.8px] text-[18px] leading-[18px] text-[#999]">×</button>
      )}
      <svg viewBox="0 0 10 5" className="pointer-events-none absolute right-[10px] top-[22px] h-[5px] w-[10px] fill-[#888]"><path d={open ? CARET_UP : CARET_DOWN} /></svg>
      {open && (
        <>
          <button type="button" aria-label={t("Закрыть")} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 top-[35px] z-50 max-h-[200px] overflow-y-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]" onMouseLeave={() => setHover(-1)}>
            {options.length === 0 ? (
              <div className="px-[10px] py-[7.5px] text-[13px] font-semibold leading-[17px] text-[#666]">{t("Ничего не найдено")}</div>
            ) : (
              options.map((option, index) => (
                <button
                  key={option}
                  type="button"
                  onMouseEnter={() => setHover(index)}
                  onClick={() => {
                    onChange(option)
                    setOpen(false)
                  }}
                  className={`block min-h-[32px] w-full px-[10px] py-[7.5px] text-left text-[13px] font-semibold leading-[17px] ${index === active ? "bg-[#e6f2ff] text-[#333]" : "text-[#666]"}`}
                >
                  {option}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** Multi-select with blue chips ("По брендам", "Зона", "Филиалы" …) — the list stays open while picking. */
export function MultiSelect({ label, items, selected, onChange, className = "" }: { label: string; items: PickItem[]; selected: PickItem[]; onChange: (next: PickItem[]) => void; className?: string }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  useEscape(open, () => setOpen(false))
  const ids = new Set(selected.map((item) => item.id))
  const toggle = (item: PickItem) => onChange(ids.has(item.id) ? selected.filter((entry) => entry.id !== item.id) : [...selected, item])
  return (
    <div className={`relative ${className}`}>
      <div role="button" tabIndex={0} onClick={() => setOpen((state) => !state)} onKeyDown={(event) => event.key === "Enter" && setOpen((state) => !state)} className={`relative block w-full cursor-pointer border-b border-[#e8e8e8] text-left text-[13px] ${selected.length ? "min-h-[37px] pb-[6px] pt-[13px]" : "h-[37px]"}`}>
        {selected.length ? (
          <>
            <span className="absolute left-0 top-[-7px] text-[10px] font-semibold leading-[12px] text-black">{label}</span>
            <span className="flex flex-wrap gap-[5px] pr-[50px]">
              {selected.map((item) => (
                <span key={item.id} className="inline-flex h-[22px] items-center overflow-hidden rounded-[2px] bg-[#566ae5] text-[12.5px] font-semibold leading-[22px] text-white">
                  <button type="button" aria-label={t("Удалить")} onClick={(event) => { event.stopPropagation(); toggle(item) }} className="h-full border-r border-white/40 px-[6px] text-[11px] hover:bg-black/10">×</button>
                  <span className="px-[6px]">{item.name}</span>
                </span>
              ))}
            </span>
          </>
        ) : (
          <span className="absolute left-0 top-[12px] font-semibold leading-[16.3px] text-black">{label}</span>
        )}
        {selected.length > 0 && (
          <button type="button" aria-label={t("Очистить")} onClick={(event) => { event.stopPropagation(); onChange([]) }} className="absolute right-[28.4px] top-[13px] text-[18px] leading-[18px] text-[#999]">×</button>
        )}
        <svg viewBox="0 0 10 5" className="pointer-events-none absolute right-[10px] top-[16px] h-[5px] w-[10px] fill-[#888]"><path d={open ? CARET_UP : CARET_DOWN} /></svg>
      </div>
      {open && (
        <>
          <button type="button" aria-label={t("Закрыть")} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 top-full z-50 max-h-[200px] overflow-y-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
            {items.length === 0 ? (
              <div className="px-[10px] py-[9px] text-[13px] text-[#999]">{t("Ничего не найдено")}</div>
            ) : (
              items.map((item) => (
                <button key={item.id} type="button" onClick={() => toggle(item)} className={`block h-[36px] w-full truncate px-[10px] text-left text-[13px] font-medium text-[#333] hover:bg-[#f2f5f8] ${ids.has(item.id) ? "bg-[#e6f2ff]" : ""}`}>
                  {item.name}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}

export function Radio({ checked, label, onSelect, indent = 0, labelClass = "text-black" }: { checked: boolean; label: string; onSelect: () => void; indent?: number; labelClass?: string }) {
  return (
    <button type="button" onClick={onSelect} className={`flex h-[34px] w-full items-start gap-[16px] text-left text-[13px] leading-[24px] ${labelClass}`} style={{ paddingLeft: indent }}>
      <span className="flex h-[24px] w-[24px] shrink-0 items-center justify-center">
        <span className={`flex h-[20px] w-[20px] items-center justify-center rounded-full border-2 ${checked ? "border-[#5d6474]" : "border-[#333]"}`}>
          {checked && <span className="h-[10px] w-[10px] rounded-full bg-[#5d6474]" />}
        </span>
      </span>
      {label}
    </button>
  )
}

export function Check({ checked, label, onToggle, className = "mb-[10px]", labelClass = "", indent = 0 }: { checked: boolean; label: string; onToggle: () => void; className?: string; labelClass?: string; indent?: number }) {
  return (
    <button type="button" onClick={onToggle} className={`flex min-h-[20px] w-full items-start gap-[6px] text-left text-[13px] font-semibold leading-[20px] text-black ${className}`} style={{ paddingLeft: indent }}>
      <span className={`m-px mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[2px] border-2 ${checked ? "border-[#666] bg-[#666]" : "border-[#666]"}`}>
        {checked && <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>}
      </span>
      <span className={labelClass}>{label}</span>
    </button>
  )
}
