"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { todayIso } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

// The fields of Linko's «Отказы» filter (its RejectFilterForm, a 300px card): «Период» (DateToDateField) and the two
// multi-search fields «Агент» / «Тип отказа». Geometry measured on Linko at 1600×1000: every field is a 62px block,
// the value line sits 39-43px below its top and the underline 58px below it (53px for the period).

const DATE_RANGE = "M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"
const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"

/**
 * Linko's «Период»: the small label, the range as "01 нояб. 2026 – 30 нояб. 2026" (or «Укажите дату»), a × that
 * empties it and the calendar icon at the right end; a click opens the range picker under the field.
 */
export function RefusalPeriodField({ label, begin, end, onChange }: { label: string; begin: string; end: string; onChange: (begin: string, end: string) => void }) {
  const { t, language } = useLanguage()
  const [open, setOpen] = useState(false)
  const day = (iso: string) => formatDateText(iso, language, { withTime: false })
  const today = todayIso()
  return (
    <div className="relative h-[62px]">
      <button type="button" onClick={() => setOpen((current) => !current)} className="absolute inset-x-0 top-0 h-[54px] w-full cursor-pointer text-left">
        <span className="absolute left-0 top-[4px] text-[10px] font-semibold leading-3 text-black">{t(label)}</span>
        <span className="absolute left-0 right-[44px] top-[31px] truncate text-[13px] leading-[18px] text-black">
          {begin ? `${day(begin)} – ${day(end || begin)}` : t("Укажите дату")}
        </span>
        <svg viewBox="0 0 24 24" className="absolute right-0 top-[31px] h-[18px] w-[18px] fill-[#8a90a0]" aria-hidden>
          <path d={DATE_RANGE} />
        </svg>
        <span className="absolute inset-x-0 top-[53px] h-px bg-[#e0e0e0]" />
      </button>
      {begin && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange("", "")} className="absolute right-[24px] top-[33px] flex h-[14px] w-[14px] items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] fill-[#8a90a0]" aria-hidden>
            <path d={CLOSE} />
          </svg>
        </button>
      )}
      {open && (
        <DateRangePicker
          begin={begin || today}
          end={end || begin || today}
          positionClassName="left-0 top-[70px]"
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

export type MultiOption = { value: string; label: string }

/**
 * Linko's multi-search select (UsersMultiSearchField / the «Тип отказа» select): the name is the placeholder until a
 * value is picked or typed, then a small label above blue «× name» chips that wrap; typing filters the list, a pick
 * keeps the list open (picked entries stay listed, highlighted; a second click drops them), × clears every chip,
 * Backspace in the empty search drops the last one, Escape or a click outside closes the list.
 */
export function RefusalMultiField({ label, options, value, onChange }: { label: string; options: MultiOption[]; value: string[]; onChange: (next: string[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [query, setQuery] = useState("")
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const labels = useMemo(() => new Map(options.map((option) => [option.value, option.label])), [options])
  const needle = query.trim().toLocaleLowerCase("ru")
  const shown = needle ? options.filter((option) => option.label.toLocaleLowerCase("ru").includes(needle)) : options

  useEffect(() => {
    if (!open && !focused) return
    const onDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      setOpen(false)
      setFocused(false)
      setQuery("")
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open, focused])

  const toggle = (item: string) => {
    onChange(value.includes(item) ? value.filter((entry) => entry !== item) : [...value, item])
    setQuery("")
    inputRef.current?.focus()
  }
  const raised = value.length > 0 || query !== ""
  return (
    <div
      ref={rootRef}
      className="relative pb-[4px]"
      onKeyDown={(event) => {
        // Escape closes the list only (the filter card stays), like Linko's select.
        if (event.key === "Escape" && open) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
          setQuery("")
        }
      }}
    >
      <div
        onMouseDown={(event) => {
          if (event.target === inputRef.current) {
            setOpen(true)
            return
          }
          event.preventDefault()
          inputRef.current?.focus()
          setOpen((current) => !current)
        }}
        className={`relative min-h-[58px] cursor-pointer border-b pb-[7px] pr-[48px] pt-[29px] ${focused ? "border-b-2 border-[#5d6474] pb-[6px]" : "border-[#e0e0e0]"}`}
      >
        <span className={`pointer-events-none absolute left-0 font-semibold text-black ${raised ? "top-[10px] text-[10px] leading-3" : "top-[35px] text-[13px] leading-[16.25px]"}`}>{t(label)}</span>
        <div className="flex min-h-[20.4px] flex-wrap items-center gap-x-[4px] gap-y-[7px]">
          {value.map((item) => (
            <span key={item} className="flex h-[20.4px] items-stretch overflow-hidden rounded-[2px] bg-[#1E4A9A] text-[11.7px] font-semibold leading-[20.4px] text-white">
              <button
                type="button"
                aria-label={t("Удалить")}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => onChange(value.filter((entry) => entry !== item))}
                className="w-[17.7px] border-r border-white/40 text-center"
              >
                ×
              </button>
              <span className="px-[5px]">{labels.get(item) ?? item}</span>
            </span>
          ))}
          <input
            ref={inputRef}
            value={query}
            aria-label={t(label)}
            onFocus={() => setFocused(true)}
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !query && value.length) onChange(value.slice(0, -1))
              else if (event.key === "Enter") {
                event.preventDefault()
                if (open && shown[0]) toggle(shown[0].value)
              } else if (event.key === "ArrowDown" && !open) setOpen(true)
            }}
            style={{ width: `${Math.max(1, query.length) + 1}ch` }}
            className="h-[20px] min-w-[5px] bg-transparent text-[13px] leading-[20px] text-black outline-none"
          />
        </div>
        {value.length > 0 && (
          <button
            type="button"
            aria-label={t("Очистить")}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => onChange([])}
            className="absolute right-[24px] top-[calc(50%+8px)] flex h-[18px] w-[14px] items-center justify-center text-[18px] leading-[18px] text-[#999]"
          >
            ×
          </button>
        )}
        <svg viewBox="0 0 10 5" className={`pointer-events-none absolute right-[10px] top-[calc(50%+15px)] h-[5px] w-[10px] fill-[#999] ${open ? "rotate-180" : ""}`} aria-hidden>
          <path d="M0 0l5 5 5-5z" />
        </svg>
      </div>
      {open && (
        <div role="listbox" className="absolute inset-x-0 top-[calc(100%-4px)] z-40 max-h-[200px] overflow-y-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
          {shown.length === 0 ? (
            <div className="px-[10px] py-[10px] text-[13px] font-semibold leading-[16.25px] text-[#999]">{t("Не найдено")}</div>
          ) : (
            shown.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={value.includes(option.value)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => toggle(option.value)}
                className={`block w-full truncate px-[10px] py-[10px] text-left text-[13px] font-semibold leading-[16.25px] text-[#333] hover:bg-[#e6f0ff] ${value.includes(option.value) ? "bg-[#e6f0ff]" : "bg-white"}`}
              >
                {option.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
