"use client"

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react"

import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { todayIso } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

// The fields of Linko's filter drawers built on react-select (its MultiSearchField / SearchField / DateToDateField),
// in Linko's 62 px block: the control 18 px down, 36 px tall, the caret 10 px from the right. The same fields as the
// Возвраты filter (components/orders/returns-filter.tsx keeps its own copy), exported for the other drawers
// (Интеграция).

export type LinkoOption = { value: string; label: string }

const CHIP_CLOSE = "flex h-full w-[17.7px] items-center justify-center border-r border-white/40"

function Caret({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 10 5" className="pointer-events-none absolute right-[10px] top-[39.3px] h-[5px] w-[10px] fill-[#999]" aria-hidden>
      <path d={open ? "M0 5l5-5 5 5z" : "M0 0l5 5 5-5z"} />
    </svg>
  )
}

/** The search fields' list closes (and forgets the typed text) on a click outside the field. */
function useCloseOutside(rootRef: RefObject<HTMLDivElement | null>, open: boolean, setOpen: (open: boolean) => void, setQuery: (query: string) => void) {
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [rootRef, open, setOpen, setQuery])
}

function MenuList({ options, chosen, onPick, emptyText, top = "top-[54px]", limit = 100 }: { options: LinkoOption[]; chosen: (value: string) => boolean; onPick: (value: string) => void; emptyText: string; top?: string; limit?: number }) {
  const { t } = useLanguage()
  return (
    <div className={`absolute inset-x-0 ${top} z-50 max-h-[205px] overflow-y-auto bg-white py-1 shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]`}>
      {options.length === 0 ? (
        <div className="h-9 px-[10px] text-[13px] leading-9 text-[#999]">{t(emptyText)}</div>
      ) : (
        options.slice(0, limit).map((option) => (
          <button
            key={option.value}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(option.value)}
            className={`block h-9 w-full truncate px-[10px] text-left text-[13px] font-semibold hover:bg-[#f2f5f8] ${chosen(option.value) ? "text-[#1E4A9A]" : "text-[#333]"}`}
          >
            {option.label}
          </button>
        ))
      )}
    </div>
  )
}

/** Linko's multi-search field: the name until something is picked, then a small label over «× name» chips; × clears
 * them all. A pick keeps the list open (a second click drops the entry), typing filters the list. Chips that wrap make
 * the field taller and push the fields below it down, as in Linko. */
export function LinkoMultiField({ label, options, value, onChange, limit }: { label: string; options: LinkoOption[] | null; value: string[]; onChange: (next: string[]) => void; /** Entries the list shows (Linko's page size of the field's request; 100 by default). */ limit?: number }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  useCloseOutside(rootRef, open, setOpen, setQuery)
  const close = () => (setOpen(false), setQuery(""))
  const inputRef = useRef<HTMLInputElement>(null)
  const byValue = useMemo(() => new Map((options ?? []).map((option) => [option.value, option.label])), [options])
  const needle = query.trim().toLocaleLowerCase("ru")
  const shown = (options ?? []).filter((option) => !needle || option.label.toLocaleLowerCase("ru").includes(needle))
  const toggle = (picked: string) => onChange(value.includes(picked) ? value.filter((item) => item !== picked) : [...value, picked])
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation()
      close()
    } else if (event.key === "Backspace" && !query && value.length) onChange(value.slice(0, -1))
    else if (event.key === "Enter") {
      event.preventDefault()
      if (shown[0]) toggle(shown[0].value)
    }
  }
  const filled = value.length > 0
  return (
    <div ref={rootRef} className="relative min-h-[62px]">
      <div
        role="button"
        tabIndex={-1}
        onClick={() => {
          setOpen(true)
          window.setTimeout(() => inputRef.current?.focus(), 0)
        }}
        className="relative top-[18px] mb-[26px] min-h-[36px] cursor-text border-b border-[#e8e8e8] text-[13px] font-semibold text-black"
      >
        {filled && <span className="absolute left-0 top-[-13px] text-[10px] font-bold leading-3">{t(label)}</span>}
        <span className="flex min-h-[36px] flex-wrap content-start items-start gap-x-[5px] gap-y-[3px] pb-[8.6px] pr-[45px] pt-[5px]">
          {value.map((item) => (
            <span key={item} className="flex h-[22.4px] items-center bg-[#1E4A9A] text-[11.7px] font-semibold text-white">
              <button type="button" aria-label={t("Удалить")} onClick={(event) => (event.stopPropagation(), onChange(value.filter((entry) => entry !== item)))} className={CHIP_CLOSE}>
                ×
              </button>
              <span className="whitespace-nowrap px-[5px]">{byValue.get(item) ?? item}</span>
            </span>
          ))}
          {open || filled ? (
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => (setQuery(event.target.value), setOpen(true))}
              onKeyDown={onKeyDown}
              aria-label={t(label)}
              className={`h-[22px] min-w-[5px] flex-1 bg-transparent text-[13px] font-normal outline-none ${filled ? "" : "absolute left-0 top-[8px]"}`}
            />
          ) : null}
        </span>
        {!filled && !query && <span className="pointer-events-none absolute left-0 top-[12px] leading-4">{t(label)}</span>}
        {filled && (
          <button type="button" aria-label={t("Очистить")} onClick={(event) => (event.stopPropagation(), onChange([]))} className="absolute right-[28.4px] top-[13.8px] text-[18px] font-normal leading-[18px] text-[#999] hover:text-[#d0021b]">
            ×
          </button>
        )}
        <svg viewBox="0 0 10 5" className="pointer-events-none absolute right-[10px] top-[21.3px] h-[5px] w-[10px] fill-[#999]" aria-hidden>
          <path d={open ? "M0 5l5-5 5 5z" : "M0 0l5 5 5-5z"} />
        </svg>
        {open && <MenuList top="top-full" limit={limit} options={options === null ? [] : shown} chosen={(item) => value.includes(item)} onPick={toggle} emptyText={options === null ? "Загрузка..." : "Ничего не найдено"} />}
      </div>
    </div>
  )
}

/** Linko's single search field: the picked entry in place of the name (a small label over it), × empties it. */
export function LinkoSingleField({ label, options, value, onChange, limit }: { label: string; options: LinkoOption[] | null; value: string; onChange: (next: string) => void; /** Entries the list shows (100 by default). */ limit?: number }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  useCloseOutside(rootRef, open, setOpen, setQuery)
  const close = () => (setOpen(false), setQuery(""))
  const inputRef = useRef<HTMLInputElement>(null)
  const picked = (options ?? []).find((option) => option.value === value)
  const needle = query.trim().toLocaleLowerCase("ru")
  const shown = (options ?? []).filter((option) => !needle || option.label.toLocaleLowerCase("ru").includes(needle))
  const pick = (next: string) => {
    onChange(next)
    close()
  }
  return (
    <div ref={rootRef} className="relative h-[62px]">
      <div
        role="button"
        tabIndex={-1}
        onClick={() => {
          setOpen(true)
          window.setTimeout(() => inputRef.current?.focus(), 0)
        }}
        className="absolute inset-x-0 top-[18px] h-[36px] cursor-text border-b border-[#e8e8e8] text-[13px] font-semibold text-black"
      >
        {value && <span className="absolute left-0 top-[-13px] text-[10px] font-bold leading-3">{t(label)}</span>}
        {open && (
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation()
                close()
              } else if (event.key === "Enter") {
                event.preventDefault()
                if (shown[0]) pick(shown[0].value)
              }
            }}
            aria-label={t(label)}
            className="absolute left-0 right-[45px] top-[11px] h-[18px] bg-transparent text-[13px] font-normal outline-none"
          />
        )}
        {!query && (
          <span className={`pointer-events-none absolute left-0 right-[45px] truncate leading-[18px] ${value ? "top-[13px] font-normal text-[#333]" : "top-[12px]"}`}>
            {value ? (picked?.label ?? value) : t(label)}
          </span>
        )}
        {value && (
          <button type="button" aria-label={t("Очистить")} onClick={(event) => (event.stopPropagation(), onChange(""))} className="absolute right-[28.4px] top-[13.8px] text-[18px] font-normal leading-[18px] text-[#999] hover:text-[#d0021b]">
            ×
          </button>
        )}
      </div>
      <Caret open={open} />
      {open && <MenuList limit={limit} options={options === null ? [] : shown} chosen={(item) => item === value} onPick={pick} emptyText={options === null ? "Загрузка..." : "Ничего не найдено"} />}
    </div>
  )
}

const DATE_RANGE = "M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"
const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"

/** Linko's period field (DateToDateField): the small label above, «Укажите дату» or «01 янв. 2026 – 31 янв. 2026», a ×
 * once set and the 18 px calendar at the right end. */
export function LinkoPeriodField({ label, begin, end, onChange }: { label: string; begin: string; end: string; onChange: (begin: string, end: string) => void }) {
  const { t, language } = useLanguage()
  const [open, setOpen] = useState(false)
  const day = (iso: string) => formatDateText(iso, language, { withTime: false })
  const today = todayIso()
  return (
    <div className="relative h-[62px]">
      <button type="button" onClick={() => setOpen((current) => !current)} className="absolute inset-x-0 top-0 h-[54px] w-full cursor-pointer text-left">
        <span className="absolute left-0 top-[5px] text-[10px] font-semibold leading-3 text-black">{t(label)}</span>
        <span className="absolute left-0 right-[44px] top-[32px] truncate text-[13px] leading-4 text-black">{begin || end ? `${day(begin || end)} – ${day(end || begin)}` : t("Укажите дату")}</span>
        <svg viewBox="0 0 24 24" className="absolute right-0 top-[31px] h-[18px] w-[18px] fill-[#8a90a0]" aria-hidden>
          <path d={DATE_RANGE} />
        </svg>
        <span className="absolute inset-x-0 top-[53px] h-px bg-[#e0e0e0]" />
      </button>
      {(begin || end) && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange("", "")} className="absolute right-[24px] top-[33px] flex h-[14px] w-[14px] items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] fill-[#8a90a0]" aria-hidden>
            <path d={CLOSE} />
          </svg>
        </button>
      )}
      {open && (
        <DateRangePicker
          begin={begin || end || today}
          end={end || begin || today}
          positionClassName="left-0 top-[62px]"
          onClose={() => setOpen(false)}
          onApply={(from, to) => {
            onChange(from, to)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
