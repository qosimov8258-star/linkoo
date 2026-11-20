"use client"

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"

import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { todayIso } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

// The filter fields of the reference's «Фотоотчеты» card and «Perfect store» filter row: its react-select multi
// selects (the field name is the placeholder until something is picked, then a 10px label over blue "× name" chips;
// typing searches the list, × clears every choice, ▾ opens the list) and its «Дата создания» range field (the
// period, × to clear it, the calendar glyph; a click opens the range picker with Сегодня / Вчера / … presets).

export type KitOption = { value: string; label: string }

/** At most this many matching options are drawn at once (the store list has thousands; typing narrows it). */
const MAX_SHOWN = 300

// The reference's select search finds a name in either alphabet ("Pepsi" also finds "Пепси маркет"): both sides are
// compared in Latin letters as well.
const CYRILLIC: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "", э: "e", ю: "yu", я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h",
}
const latin = (text: string) => [...text.toLocaleLowerCase()].map((char) => CYRILLIC[char] ?? char).join("")

/** True when `label` contains the typed text, in its own letters or in Latin ones. */
export function kitMatches(label: string, needle: string): boolean {
  if (!needle) return true
  const lower = label.toLocaleLowerCase()
  return lower.includes(needle) || latin(lower).includes(latin(needle))
}

const CARET = <path d="M7 10l5 5 5-5z" />

export function KitMultiSelect({
  label,
  options,
  value,
  onChange,
  disabled = false,
  className = "",
}: {
  label: string
  options: KitOption[]
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  className?: string
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const labelOf = useMemo(() => new Map(options.map((option) => [option.value, option.label])), [options])
  // The reference's multi select leaves the chosen options out of its list.
  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const rest = options.filter((option) => !value.includes(option.value) && kitMatches(option.label, needle))
    return rest.slice(0, MAX_SHOWN)
  }, [options, value, query])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) close()
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  function close() {
    setOpen(false)
    setQuery("")
    setActive(0)
  }
  function openList() {
    if (disabled) return
    setOpen(true)
    window.setTimeout(() => input.current?.focus(), 0)
  }
  function pick(option: KitOption) {
    onChange([...value, option.value])
    setQuery("")
    setActive(0)
    input.current?.focus()
  }
  function onKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      // Only the list closes: the dialog around it stays.
      event.nativeEvent.stopImmediatePropagation()
      close()
    } else if (event.key === "ArrowDown") {
      event.preventDefault()
      if (!open) setOpen(true)
      setActive((current) => Math.min(current + 1, Math.max(0, items.length - 1)))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((current) => Math.max(current - 1, 0))
    } else if (event.key === "Enter") {
      // Enter picks the highlighted option and never submits the form around the field.
      event.preventDefault()
      const option = items[active]
      if (open && option) pick(option)
    } else if (event.key === "Backspace" && !query && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  const chosen = value.length > 0
  const floating = chosen || (open && query !== "")
  return (
    <div ref={box} className={`relative min-h-[52px] ${disabled ? "opacity-50" : ""} ${className}`}>
      <div
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-disabled={disabled || undefined}
        aria-label={t(label)}
        onMouseDown={(event) => {
          if (event.target === input.current) return
          event.preventDefault()
          if (open) close()
          else openList()
        }}
        className={`relative mt-[7px] flex min-h-[45px] items-end border-b pb-[4px] pr-[46px] ${open ? "border-[#555]" : "border-[#e0e0e0]"} ${disabled ? "cursor-default" : "cursor-pointer"}`}
      >
        {floating && <span className="pointer-events-none absolute left-0 top-[3px] text-[10px] font-semibold leading-[13px] text-black">{t(label)}</span>}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-[4px] pt-[18px]">
          {value.map((item) => (
            <span key={item} className="inline-flex h-[20px] max-w-full items-stretch overflow-hidden rounded-[2px] bg-[#1E4A9A] text-[12px] font-semibold leading-[20px] text-white">
              <button
                type="button"
                aria-label={t("Удалить")}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => onChange(value.filter((entry) => entry !== item))}
                className="border-r border-white/40 px-[5px] hover:bg-black/15"
              >
                ×
              </button>
              <span className="truncate px-[5px]">{labelOf.get(item) ?? item}</span>
            </span>
          ))}
          {open ? (
            <input
              ref={input}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActive(0)
              }}
              onKeyDown={onKey}
              aria-label={t(label)}
              placeholder={chosen ? "" : t(label)}
              className="h-[20px] min-w-[30px] flex-1 bg-transparent text-[13px] text-black outline-none placeholder:font-semibold placeholder:text-black"
            />
          ) : (
            !chosen && <span className="pointer-events-none h-[20px] truncate text-[13px] font-semibold leading-[20px] text-black">{t(label)}</span>
          )}
        </div>
      </div>
      {chosen && !disabled && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange([])} className="absolute bottom-[5px] right-[22px] flex h-5 w-5 items-center justify-center text-[17px] leading-none text-[#999] hover:text-[#333]">
          ×
        </button>
      )}
      <svg viewBox="0 0 24 24" className={`pointer-events-none absolute bottom-[3px] right-0 h-6 w-6 fill-[#999] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
        {CARET}
      </svg>
      {open && (
        <div id={listId} role="listbox" aria-multiselectable="true" className="visits-scrollbar absolute inset-x-0 top-full z-[60] max-h-[200px] overflow-y-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
          {items.length === 0 ? (
            <div className="h-9 px-[10px] text-[13px] leading-9 text-[#999]">{t("Не найдено")}</div>
          ) : (
            items.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={false}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(option)}
                className={`block h-9 w-full truncate px-[10px] text-left text-[13px] font-semibold text-[#333] ${index === active ? "bg-[#e6f0ff]" : "bg-white"}`}
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

/** The reference's single-choice static select (Магазин с оборудованием: Да / Нет) in the same field shape. */
export function KitSingleSelect({ label, options, value, onChange }: { label: string; options: KitOption[]; value: string; onChange: (next: string) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])
  const current = options.find((option) => option.value === value)
  return (
    <div ref={box} className="relative min-h-[52px]">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t(label)}
        onClick={() => setOpen((state) => !state)}
        className={`relative mt-[7px] flex h-[45px] w-full items-end border-b pb-[4px] pr-[46px] text-left ${open ? "border-[#555]" : "border-[#e0e0e0]"}`}
      >
        {current && <span className="pointer-events-none absolute left-0 top-[3px] text-[10px] font-semibold leading-[13px] text-black">{t(label)}</span>}
        <span className={`h-[20px] truncate text-[13px] leading-[20px] text-black ${current ? "" : "font-semibold"}`}>{current ? current.label : t(label)}</span>
      </button>
      {current && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange("")} className="absolute bottom-[5px] right-[22px] flex h-5 w-5 items-center justify-center text-[17px] leading-none text-[#999] hover:text-[#333]">
          ×
        </button>
      )}
      <svg viewBox="0 0 24 24" className={`pointer-events-none absolute bottom-[3px] right-0 h-6 w-6 fill-[#999] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
        {CARET}
      </svg>
      {open && (
        <div role="listbox" className="absolute inset-x-0 top-full z-[60] max-h-[200px] overflow-y-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value)
                setOpen(false)
              }}
              className={`block h-9 w-full truncate px-[10px] text-left text-[13px] font-semibold text-[#333] hover:bg-[#e6f0ff] ${option.value === value ? "bg-[#e6f0ff]" : "bg-white"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** «Дата создания»: the period ("01 нояб. 2026 – 30 нояб. 2026", one day once, "Укажите дату" without one), × and the
 * calendar. */
export function KitRangeField({
  label,
  begin,
  end,
  onChange,
  clearable = true,
}: {
  label: string
  begin: string
  end: string
  onChange: (begin: string, end: string) => void
  clearable?: boolean
}) {
  const { t, language } = useLanguage()
  const [open, setOpen] = useState(false)
  const today = todayIso()
  // One day prints once ("19 нояб. 2026"), a period as "01 нояб. 2026 – 30 нояб. 2026".
  const text = !begin ? t("Укажите дату") : !end || end === begin ? formatDateText(begin, language) : `${formatDateText(begin, language)} – ${formatDateText(end, language)}`
  return (
    <div className="relative min-h-[52px]">
      <span className="pointer-events-none absolute left-0 top-[10px] text-[10px] font-semibold leading-[13px] text-black">{t(label)}</span>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t(label)}
        onClick={() => setOpen((state) => !state)}
        className={`relative mt-[7px] flex h-[45px] w-full items-end border-b pb-[4px] pr-[50px] text-left text-[13px] leading-[20px] text-black ${open ? "border-[#1E4A9A]" : "border-[#e0e0e0]"}`}
      >
        <span className="truncate">{text}</span>
      </button>
      {clearable && begin && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange("", "")} className="absolute bottom-[5px] right-[22px] flex h-5 w-5 items-center justify-center text-[17px] leading-none text-[#999] hover:text-[#333]">
          ×
        </button>
      )}
      <svg viewBox="0 0 24 24" className={`pointer-events-none absolute bottom-[6px] right-[2px] h-[18px] w-[18px] ${open ? "fill-[#1E4A9A]" : "fill-[#999]"}`} aria-hidden>
        <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z" />
      </svg>
      {open && (
        <DateRangePicker
          begin={begin || today}
          end={end || begin || today}
          positionClassName="left-0 top-[calc(100%+6px)]"
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

/** The reference's searchable single select of a form (Организация, Опросник): the label floats over the chosen name,
 * typing searches the list, × clears it, ▾ opens it. `required` adds the red "*", `error` prints under the field. */
export function KitSearchSelect({
  label,
  options,
  value,
  onChange,
  required = false,
  error,
}: {
  label: string
  options: KitOption[]
  value: string
  onChange: (next: string) => void
  required?: boolean
  error?: string
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const current = options.find((option) => option.value === value)
  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return options.filter((option) => kitMatches(option.label, needle)).slice(0, MAX_SHOWN)
  }, [options, query])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (box.current?.contains(event.target as Node)) return
      setOpen(false)
      setQuery("")
      setActive(0)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  function close() {
    setOpen(false)
    setQuery("")
    setActive(0)
  }
  function pick(option: KitOption) {
    onChange(option.value)
    close()
  }
  function onKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault()
      event.nativeEvent.stopImmediatePropagation()
      close()
    } else if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, Math.max(0, items.length - 1)))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      const option = items[active]
      if (option) pick(option)
    }
  }
  const caption = (
    <>
      {t(label)}
      {required && <span className="text-[#f44336]"> *</span>}
    </>
  )
  const floating = Boolean(current) || (open && query !== "")
  return (
    <div ref={box} className="relative min-h-[52px]">
      <div
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={t(label)}
        onMouseDown={(event) => {
          if (event.target === input.current) return
          event.preventDefault()
          if (open) close()
          else {
            setOpen(true)
            window.setTimeout(() => input.current?.focus(), 0)
          }
        }}
        className={`relative mt-[7px] flex h-[45px] cursor-pointer items-end border-b pb-[4px] pr-[46px] ${error ? "border-[#f44336]" : open ? "border-[#555]" : "border-[#e0e0e0]"}`}
      >
        {floating && <span className="pointer-events-none absolute left-0 top-[3px] text-[10px] font-semibold leading-[13px] text-black">{caption}</span>}
        {open ? (
          <input
            ref={input}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={onKey}
            aria-label={t(label)}
            placeholder={current ? current.label : t(label)}
            className={`h-[20px] w-full bg-transparent text-[13px] text-black outline-none placeholder:text-black ${current ? "" : "placeholder:font-semibold"}`}
          />
        ) : (
          <span className={`pointer-events-none h-[20px] truncate text-[13px] leading-[20px] text-black ${current ? "" : "font-semibold"}`}>{current ? current.label : caption}</span>
        )}
      </div>
      {current && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange("")} className="absolute bottom-[5px] right-[22px] flex h-5 w-5 items-center justify-center text-[17px] leading-none text-[#999] hover:text-[#333]">
          ×
        </button>
      )}
      <svg viewBox="0 0 24 24" className={`pointer-events-none absolute bottom-[3px] right-0 h-6 w-6 fill-[#999] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
        {CARET}
      </svg>
      {error && <div className="mt-[3px] text-[12px] leading-[14px] text-[#f44336]">{t(error)}</div>}
      {open && (
        <div id={listId} role="listbox" className="visits-scrollbar absolute inset-x-0 top-[52px] z-[60] max-h-[200px] overflow-y-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
          {items.length === 0 ? (
            <div className="h-9 px-[10px] text-[13px] leading-9 text-[#999]">{t("Не найдено")}</div>
          ) : (
            items.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(option)}
                className={`block h-9 w-full truncate px-[10px] text-left text-[13px] font-semibold text-[#333] ${index === active ? "bg-[#e6f0ff]" : "bg-white"}`}
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
