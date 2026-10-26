"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

// Building blocks of the reference's full-screen product form (material-ui text fields with a
// floating label, react-select dropdowns, toggles, hints, "+" links), sized to its pixels.

const ERROR = "#f44336"

const I_PATH = "M11 17h2v-6h-2v6zm1-15C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zM11 9h2V7h-2v2z"
const PLUS_CIRCLE = "M13 7h-2v4H7v2h4v4h2v-4h4v-2h-4V7zm-1-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"
const MINUS_CIRCLE = "M7 11v2h10v-2H7zm5-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"
const ADD_CIRCLE = "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"
const DASH = "M19 13H5v-2h14v2z"
const CHECK_BOX_BLANK = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const CHECK_BOX = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
const CLOSE = "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"

/** Dark tooltip of the reference (react-tooltip): next to the anchor, as wide as the screen allows. */
function useTip() {
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null)
  const show = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    setTip({ left: rect.right + 10, top: rect.top - 5 })
  }
  return { tip, show, hide: () => setTip(null) }
}

function TipBox({ tip, children }: { tip: { left: number; top: number }; children: ReactNode }) {
  return (
    <div
      style={{ left: tip.left, top: tip.top, maxWidth: `calc(100vw - ${tip.left}px)` }}
      className="pointer-events-none fixed z-[1700] rounded-[2px] bg-[#2d3037] px-[21px] py-[8px] text-[13px] font-bold leading-[17px] text-white opacity-90"
    >
      {children}
    </div>
  )
}

/** Blue "i" icon with the hint tooltip. */
export function InfoHint({ text }: { text: string }) {
  const { t } = useLanguage()
  const { tip, show, hide } = useTip()
  return (
    <span className="inline-flex h-6 w-6 shrink-0 cursor-pointer" onMouseEnter={(event) => show(event.currentTarget)} onMouseLeave={hide}>
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#4f71dc]">
        <path d={I_PATH} />
      </svg>
      {tip && <TipBox tip={tip}>{t(text)}</TipBox>}
    </span>
  )
}

/** Green "+" that opens the page where the dictionary item is created (a new tab, like the reference). */
export function CreateLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label={label} className="inline-flex h-6 w-6 shrink-0">
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#92ce95]">
        <path d={PLUS_CIRCLE} />
      </svg>
    </a>
  )
}

/** 40px round-icon button (barcode "+" / "−") with a tooltip. */
export function CircleButton({ minus, label, onClick }: { minus?: boolean; label: string; onClick: () => void }) {
  const { tip, show, hide } = useTip()
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onMouseEnter={(event) => show(event.currentTarget)}
      onMouseLeave={hide}
      className="flex h-10 w-10 shrink-0 items-start justify-center"
    >
      <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-[#666]">
        <path d={minus ? MINUS_CIRCLE : PLUS_CIRCLE} />
      </svg>
      {tip && <TipBox tip={tip}>{label}</TipBox>}
    </button>
  )
}

export function FormShell({ title, onClose, footer, children }: { title: string; onClose: () => void; footer: ReactNode; children: ReactNode }) {
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [])
  return (
    <div data-form-scroll className="fixed inset-0 z-[1500] overflow-y-auto bg-white font-sans text-[13px] text-[#333]">
      <div className="relative h-[60px] border-b border-[#e0e0e0]">
        <span className="absolute left-[30px] top-[20px] text-[15px] font-bold uppercase leading-[18.75px]">{title}</span>
        <button type="button" onClick={onClose} aria-label="×" className="absolute right-[30px] top-[6px] flex h-12 w-12 items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]">
            <path d={CLOSE} />
          </svg>
        </button>
      </div>
      <div className="grid grid-cols-3 max-lg:grid-cols-1">{children}</div>
      <div className="sticky bottom-0 flex h-[57px] items-center justify-end border-t border-[#e0e0e0] bg-white px-[10px]">{footer}</div>
    </div>
  )
}

export function FormColumn({ children, last, className = "" }: { children: ReactNode; last?: boolean; className?: string }) {
  return <div className={`min-h-[1258px] min-w-0 px-[30px] ${last ? "" : "border-r border-[#e0e0e0]"} ${className}`}>{children}</div>
}

function ErrorLine({ text }: { text: string }) {
  return <span className="absolute left-0 top-[calc(100%+2px)] whitespace-nowrap text-[13px] leading-4" style={{ color: ERROR }}>{text}</span>
}

function Underline({ error }: { error?: boolean }) {
  return (
    <>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[#e0e0e0]" />
      <span
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] origin-center scale-x-0 transition-transform duration-[450ms] ease-[cubic-bezier(0.23,1,0.32,1)] group-focus-within:scale-x-100"
        style={{ background: error ? ERROR : "#5d6474", transform: error ? "scaleX(1)" : undefined }}
      />
    </>
  )
}

function Caption({ label, required, floated }: { label: ReactNode; required?: boolean; floated: boolean }) {
  return (
    <span
      className={`pointer-events-none absolute left-0 z-[1] whitespace-nowrap font-semibold text-black transition-all duration-[450ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${floated ? "top-[9px] text-[10px] leading-4" : "top-[27px] text-[13px] leading-[22px]"}`}
    >
      {label}
      {required && <span className="text-[#e57373]">{"\u00a0*"}</span>}
    </span>
  )
}

/** Material text field: floating label, 1px grey underline that turns dark on focus (red on error). */
export function TextField({
  label,
  value,
  onChange,
  required,
  error,
  type = "text",
  numeric,
  multiline,
  className = "",
  min,
  errorShift = true,
}: {
  label: ReactNode
  value: string
  onChange: (value: string) => void
  required?: boolean
  error?: string
  type?: "text" | "number"
  /** Text input that only takes digits, separators and a minus (the reference's amounts). */
  numeric?: boolean
  multiline?: boolean
  className?: string
  min?: number
  /** An error line pushes the next field down by 15px (not for the first field of the form). */
  errorShift?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const floated = focused || value !== ""
  return (
    <div className={`group relative ${multiline ? "min-h-[52px]" : "h-[52px]"} ${error && errorShift ? "mb-[15px]" : ""} ${className}`}>
      <Caption label={label} required={required} floated={floated} />
      {multiline ? (
        <textarea
          value={value}
          rows={1}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="absolute inset-x-0 bottom-[1px] min-h-6 w-full resize-none bg-transparent text-[13px] font-semibold leading-6 text-black outline-none"
        />
      ) : (
        <input
          type={type}
          min={min}
          inputMode={numeric ? "decimal" : undefined}
          value={value}
          onChange={(event) => onChange(numeric ? event.target.value.replace(/[^\d.,\s-]/g, "") : event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="absolute inset-x-0 bottom-[1px] h-6 w-full bg-transparent text-[13px] font-semibold leading-6 text-black outline-none [appearance:textfield]"
        />
      )}
      <Underline error={Boolean(error)} />
      {error && <ErrorLine text={error} />}
    </div>
  )
}

/** react-select look: searchable, clearable, menu of 32px rows (first row highlighted). */
export function SelectField({
  label,
  value,
  options,
  onChange,
  required,
  error,
  className = "",
  loading,
}: {
  label: ReactNode
  value: string
  options: string[]
  onChange: (value: string) => void
  required?: boolean
  error?: string
  className?: string
  loading?: boolean
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const shown = options.filter((option) => option.toLowerCase().includes(query.trim().toLowerCase()))
  const floated = value !== "" || (open && query !== "")

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  const pick = (next: string) => {
    onChange(next)
    setOpen(false)
    setQuery("")
  }
  const openMenu = () => {
    setOpen(true)
    setActive(Math.max(0, options.indexOf(value)))
    input.current?.focus()
  }

  return (
    <div ref={root} className={`group relative h-9 ${error ? "mb-[7px]" : ""} ${className}`}>
      <span
        className={`pointer-events-none absolute left-0 z-[1] whitespace-nowrap font-semibold text-black transition-all duration-[450ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${floated ? "top-[-14px] text-[10px] leading-4" : "top-[12px] text-[13px] leading-[17px]"}`}
      >
        {label}
        {required && <span className="text-[#e57373]">{"\u00a0*"}</span>}
      </span>
      <div
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="relative h-9 cursor-pointer"
        style={{ borderBottom: `${error ? 2 : 1}px solid ${error ? ERROR : "#e8e8e8"}` }}
      >
        {value !== "" && !open && <span className="absolute inset-x-0 top-[12px] truncate pr-[44px] text-[13px] font-semibold leading-[17px] text-black">{value}</span>}
        <input
          ref={input}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault()
              setOpen(true)
              setActive((current) => Math.min(shown.length - 1, current + 1))
            } else if (event.key === "ArrowUp") {
              event.preventDefault()
              setActive((current) => Math.max(0, current - 1))
            } else if (event.key === "Enter" && open && shown[active] !== undefined) {
              event.preventDefault()
              pick(shown[active])
            } else if (event.key === "Escape" && open) {
              event.stopPropagation()
              setOpen(false)
              setQuery("")
            }
          }}
          className="absolute inset-x-0 top-[6px] h-[26px] bg-transparent pr-[44px] text-[13px] font-semibold text-black opacity-100 outline-none"
          style={{ caretColor: open ? undefined : "transparent", color: open ? undefined : "transparent" }}
          aria-label={typeof label === "string" ? label : undefined}
        />
        {value !== "" && (
          <button
            type="button"
            aria-label="×"
            onClick={(event) => {
              event.stopPropagation()
              pick("")
            }}
            className="absolute right-[24px] top-[10px] flex h-4 w-4 items-center justify-center text-[16px] leading-none text-[#999] hover:text-[#d0021b]"
          >
            ×
          </button>
        )}
        <span
          className={`pointer-events-none absolute right-[10px] border-x-[5px] border-x-transparent ${open ? "top-[19px] border-b-[5px] border-b-[#999]" : "top-[21px] border-t-[5px] border-t-[#999]"}`}
        />
      </div>
      {error && <ErrorLine text={error} />}
      {open && (
        <div className="absolute inset-x-0 top-[calc(100%-1px)] z-[60] max-h-[200px] overflow-y-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
          {shown.length ? (
            shown.map((option, index) => (
              <button
                key={`${option}-${index}`}
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(option)}
                className={`block h-8 w-full truncate px-[10px] text-left text-[13px] font-semibold leading-8 text-[#666] ${index === active ? "bg-[#e6f2ff]" : ""} ${option === value ? "text-black" : ""}`}
              >
                {option}
              </button>
            ))
          ) : (
            <div className="h-8 px-[10px] text-[13px] leading-8 text-[#999]">{loading ? t("Загрузка...") : t("Не найдено")}</div>
          )}
        </div>
      )}
    </div>
  )
}

/** material-ui Toggle: 34×14 track, 20px thumb; the label takes the rest, a hint icon follows it. */
export function Toggle({
  checked,
  onChange,
  title,
  subTitle,
  hint,
  className = "",
}: {
  checked: boolean
  onChange: (value: boolean) => void
  title: ReactNode
  subTitle?: ReactNode
  hint?: string
  className?: string
}) {
  return (
    <div className={`flex min-h-6 items-center ${className}`}>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="relative mr-2 h-6 w-9 shrink-0 cursor-pointer py-[4px] pl-[2px] pr-0">
        <span className={`block h-[14px] w-[34px] rounded-[30px] transition-colors duration-[450ms] ${checked ? "bg-[#a7b8ee]" : "bg-[#bdbdbd]"}`} />
        <span
          className={`absolute left-0 top-[1px] h-5 w-5 rounded-full shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] transition-all duration-[450ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${checked ? "translate-x-4 bg-[#4f71dc]" : "bg-[#f2f5f8]"}`}
        />
      </button>
      <div className="min-w-0 text-[13px] leading-[16.25px] text-[#333]">
        <div className="font-semibold">{title}</div>
        {subTitle && <div>{subTitle}</div>}
      </div>
      {hint && (
        <span className="ml-[5px] flex">
          <InfoHint text={hint} />
        </span>
      )}
    </div>
  )
}

export function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} aria-pressed={checked} className="flex h-5 items-center text-left text-[13px] font-semibold leading-5 text-black">
      <svg viewBox="0 0 24 24" className={`mr-[6px] h-5 w-5 shrink-0 ${checked ? "fill-[#5d6474]" : "fill-[#666]"}`}>
        <path d={checked ? CHECK_BOX : CHECK_BOX_BLANK} />
      </svg>
      {label}
    </button>
  )
}

/** Blue 30px button: a 30px icon area, then the label (the width follows the text, like the reference). */
export function BlueButton({ children, minus, onClick, disabled }: { children: ReactNode; minus?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex h-[30px] items-center rounded-[2px] bg-[#4f71dc] text-[13px] font-semibold leading-[30px] text-white disabled:opacity-50">
      <span className="flex w-[30px] items-center pl-3">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-white">
          <path d={minus ? DASH : ADD_CIRCLE} />
        </svg>
      </span>
      <span className="whitespace-nowrap pl-2 pr-4">{children}</span>
    </button>
  )
}

/** Green sticky "СОХРАНИТЬ ИЗМЕНЕНИЕ". */
export function SaveButton({ children, onClick, busy }: { children: ReactNode; onClick: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="h-9 w-[196px] whitespace-nowrap rounded-[2px] bg-[#71ce87] px-[14px] text-center text-[13px] font-semibold uppercase leading-9 text-white hover:brightness-95 disabled:opacity-60"
    >
      {children}
    </button>
  )
}
