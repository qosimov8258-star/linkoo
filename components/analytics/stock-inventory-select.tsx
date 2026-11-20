"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

// Linko's react-select fields of the inventory edit form («Склад», the add row's «Наименование» / «Серия», each line's
// «Серия»): a 36px control on a #e8e8e8 bottom line, typing searches (the server, through `load`), × clears, the menu
// (32px rows, 200px high) hangs under the control. Labels: "float" = the bold 13px label is the placeholder and moves
// up to 10px once a value is chosen; "fixed" = always the 10px label above the control (with a red * when required);
// none = a bare control (the lines' «Серия»). `disabled` = Linko's grey filled box with no value.

export type InventoryOption<T = unknown> = { id: string | number; text: string; data?: T }

export function InventorySelect<T>({
  label,
  fixedLabel,
  required,
  value,
  load,
  onChange,
  disabled,
  error,
  ariaLabel,
  className = "",
  renderOption,
}: {
  label?: string
  /** The label stays above the control (Linko's «Склад»). */
  fixedLabel?: boolean
  required?: boolean
  value: InventoryOption<T> | null
  /** Options for the typed text ("" = the first page). A new function reloads an open list. */
  load: (search: string) => Promise<InventoryOption<T>[]>
  onChange: (value: InventoryOption<T> | null) => void
  disabled?: boolean
  error?: string
  ariaLabel?: string
  className?: string
  /** Several-line options (the write-off form's «name / Доступно / Браковано»); default: the one-line text. */
  renderOption?: (option: InventoryOption<T>) => ReactNode
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [options, setOptions] = useState<InventoryOption<T>[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const valueId = value?.id

  useEffect(() => {
    if (!open) return
    let alive = true
    // «Загрузка...» until the first options come; later loads keep the shown ones (a spinner in place of ×).
    const timer = window.setTimeout(
      () => {
        setLoading(true)
        void load(search)
          .catch(() => [] as InventoryOption<T>[])
          .then((rows) => {
            if (!alive) return
            setOptions(rows)
            setLoading(false)
            const at = rows.findIndex((row) => row.id === valueId)
            setActive(at >= 0 ? at : 0)
          })
      },
      search ? 300 : 0,
    )
    return () => {
      alive = false
      window.clearTimeout(timer)
      setLoading(false)
    }
  }, [open, search, load, valueId])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const show = () => {
    if (disabled || open) return
    setOptions(null)
    setSearch("")
    setOpen(true)
  }
  const choose = (option: InventoryOption<T>) => {
    onChange(option)
    setOpen(false)
  }
  const hasLabel = Boolean(label)
  const floating = hasLabel && (fixedLabel || Boolean(value))
  const typing = open && Boolean(search || options === null)
  return (
    <div ref={ref} className={`relative ${hasLabel ? "h-[54px]" : "h-[36px]"} ${className}`}>
      {label && !(open && search && !value && !fixedLabel) && (
        <span
          className={`pointer-events-none absolute left-0 z-[1] font-semibold text-black ${floating ? "top-[5px] text-[10px] leading-[12px]" : "top-[30px] text-[13px] leading-[16px]"}`}
        >
          {label}
          {required && <span className="text-[#e57373]"> *</span>}
        </span>
      )}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label={ariaLabel ?? label}
        onClick={show}
        onKeyDown={(event) => (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") && event.target === event.currentTarget && show()}
        className={`absolute inset-x-0 bottom-0 h-[36px] border-b ${error ? "border-[#f44336]" : "border-[#e8e8e8]"} ${disabled ? "cursor-default bg-[#f9f9f9]" : "cursor-pointer"}`}
      >
        <div className="absolute left-0 right-[42px] top-[13px] flex h-[18px] items-center overflow-hidden">
          {value && !typing && <span className="truncate text-[13px] font-semibold leading-[18px] text-[#333]">{value.text}</span>}
          {open && (
            <input
              autoFocus
              value={search}
              aria-label={ariaLabel ?? label ?? t("Поиск")}
              autoComplete="off"
              onChange={(event) => setSearch(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                const count = options?.length ?? 0
                if (event.key === "ArrowDown" && count) {
                  event.preventDefault()
                  setActive((index) => (index + 1) % count)
                } else if (event.key === "ArrowUp" && count) {
                  event.preventDefault()
                  setActive((index) => (index - 1 + count) % count)
                } else if (event.key === "Enter") {
                  event.preventDefault()
                  if (options?.[active]) choose(options[active])
                } else if (event.key === "Escape") {
                  // Closes the list only, never the form.
                  event.stopPropagation()
                  setOpen(false)
                }
              }}
              className="h-[18px] min-w-[5px] flex-1 bg-transparent p-0 text-[13px] text-black outline-none"
            />
          )}
        </div>
        {open && loading ? (
          <svg viewBox="0 0 16 16" className="pointer-events-none absolute right-[26px] top-[14px] h-[16px] w-[16px] animate-spin" aria-hidden>
            <path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          value &&
          !disabled && (
            <button
              type="button"
              aria-label={t("Очистить")}
              onClick={(event) => {
                event.stopPropagation()
                onChange(null)
                setOpen(false)
              }}
              className="absolute right-[25px] top-[13px] h-[18px] w-[17px] text-center text-[18px] leading-[18px] text-[#999] hover:text-[#d0021b]"
            >
              ×
            </button>
          )
        )}
        <svg viewBox="0 0 10 5" className={`pointer-events-none absolute right-[8px] top-[21px] h-[5px] w-[10px] ${disabled ? "fill-[#ccc]" : "fill-[#999]"} ${open ? "rotate-180" : ""}`} aria-hidden>
          <path d="M0 0l5 5 5-5z" />
        </svg>
      </div>
      {error && <div className="absolute left-0 top-[calc(100%+3px)] whitespace-nowrap text-[12px] leading-[12px] text-[#f44336]">{error}</div>}
      {open && (options !== null || loading) && (
        <div className="absolute inset-x-0 top-[calc(100%-1px)] z-[1700] max-h-[200px] overflow-y-auto bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
          {options === null ? (
            <div className="px-[10px] py-[8px] text-[13px] font-semibold leading-[16px] text-[#999]">{t("Загрузка...")}</div>
          ) : options.length === 0 ? (
            <div className="px-[10px] py-[8px] text-[13px] font-semibold leading-[16px] text-[#999]">{t("Не найдено")}</div>
          ) : (
            options.map((option, index) => (
              <button
                key={`${option.id}-${index}`}
                type="button"
                onClick={() => choose(option)}
                onMouseEnter={() => setActive(index)}
                className={`block w-full px-[10px] text-left text-[13px] ${renderOption ? "py-[8px] leading-4" : "h-[32px] truncate font-semibold leading-[32px]"} ${index === active ? "bg-[#e6f2ff] text-[#333]" : "bg-white text-[#666]"}`}
              >
                {renderOption ? renderOption(option) : option.text}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
