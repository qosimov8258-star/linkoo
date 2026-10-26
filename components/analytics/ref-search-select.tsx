"use client"

import { useEffect, useRef, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

export type RefSelectItem = { value: string; label: string }

/**
 * Material-style select of the reference's filter panels and dialogs (62 px pitch): the bold label
 * is the placeholder, a chosen value moves it above; single or multiple choice, typing filters
 * (or calls `onQuery` for server-side search) and the list says "Загрузка..." / "Ничего не найдено".
 */
export function RefSearchSelect({
  label,
  items,
  selected,
  onChange,
  onQuery,
  loading,
  multi,
  className = "",
  required,
  error,
  searchable = true,
  rowHeight = 36,
  labelShift = 0,
  dense,
}: {
  label: string
  items: RefSelectItem[]
  selected: RefSelectItem[]
  onChange: (next: RefSelectItem[]) => void
  /** Server-side search: when given, `items` are not filtered locally. */
  onQuery?: (query: string) => void
  loading?: boolean
  multi?: boolean
  className?: string
  /** Red asterisk after the label (dialog fields). */
  required?: boolean
  /** Red underline plus the message under the field. */
  error?: string
  /** false = no search box in the list (the reference's dialog selects). */
  searchable?: boolean
  /** List row height in px (36 in the filter panels, 32 in dialogs). */
  rowHeight?: number
  /** Moves the label and the chosen value down by this many px. */
  labelShift?: number
  /** Dialog variant: the clear mark and arrow sit closer to the right edge. */
  dense?: boolean
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])
  const chosen = new Set(selected.map((item) => item.value))
  const needle = query.trim().toLowerCase()
  const shown = onQuery ? items : items.filter((item) => !needle || item.label.toLowerCase().includes(needle))
  const pick = (item: RefSelectItem) => {
    if (multi) onChange(chosen.has(item.value) ? selected.filter((entry) => entry.value !== item.value) : [...selected, item])
    else {
      onChange(chosen.has(item.value) ? [] : [item])
      setOpen(false)
    }
  }
  return (
    <div ref={root} className={`relative h-[62px] ${className}`}>
      <button type="button" onClick={() => setOpen((current) => !current)} className={`absolute inset-x-0 top-[18px] h-[36px] border-b text-left text-[13px] font-semibold text-black ${error ? "border-[#f44336]" : "border-[#e8e8e8]"}`}>
        {selected.length ? (
          <>
            <span className="absolute left-0 text-[10px] font-bold leading-3" style={{ top: dense ? -11 : -8 }}>
              {label}
              {required && <span className="text-[#e57373]"> *</span>}
            </span>
            <span className="absolute inset-x-0 truncate pr-12" style={{ top: 10 + labelShift + (dense ? 5 : 0) }}>{selected.map((item) => item.label).join(", ")}</span>
          </>
        ) : (
          <span className="absolute left-0 leading-4" style={{ top: 13 + labelShift }}>
            {label}
            {required && <span className="text-[#e57373]"> *</span>}
          </span>
        )}
      </button>
      {selected.length > 0 && (
        <button type="button" aria-label={t("Очистить")} title="Clear value" data-native-tip="" onClick={() => onChange([])} className={`absolute text-[18px] leading-[18px] text-[#999] ${dense ? "right-[29px] top-[31px]" : "right-[26px] top-[28px]"}`}>
          ×
        </button>
      )}
      <svg viewBox="0 0 10 7" className={`pointer-events-none absolute h-[7px] w-[10px] fill-[#888] ${dense ? "right-[10px] top-[39px]" : "right-[14px] top-[36px]"} ${open ? "rotate-180" : ""}`}>
        <path d="M0 0l5 5.5L10 0z" />
      </svg>
      {error && <div className="absolute left-0 top-[56px] text-[12px] leading-4 text-[#f44336]">{error}</div>}
      {open && (
        <div className={`absolute inset-x-0 top-[54px] z-50 overflow-y-auto bg-white py-1 ${dense ? "max-h-[200px]" : "max-h-[240px]"} shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]`}>
          {searchable && <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              onQuery?.(event.target.value)
            }}
            placeholder={t("Поиск")}
            className="mb-1 h-9 w-full border-b border-[#efefef] bg-transparent px-[10px] text-[13px] outline-none placeholder:text-black/30"
          />}
          {loading ? (
            <div className="h-9 px-[10px] text-[13px] font-semibold leading-9 text-[#999]">{t("Загрузка...")}</div>
          ) : shown.length === 0 ? (
            <div className="h-9 px-[10px] text-[13px] leading-9 text-[#999]">{t("Не найдено")}</div>
          ) : (
            shown.map((item, index) => (
              <button
                key={`${item.value}:${index}`}
                type="button"
                onClick={() => pick(item)}
                style={{ height: rowHeight }} className={`block w-full truncate px-[10px] text-left text-[13px] font-semibold hover:bg-[#e6f2ff] ${dense ? "text-[#666] hover:text-[#333]" : ""} ${chosen.has(item.value) ? "bg-[#e6f2ff] text-[#4f71dc]" : index === 0 && !needle ? `bg-[#e6f2ff] ${dense ? "!text-[#333]" : ""}` : ""}`}
              >
                {item.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
