"use client"

import type { ReactNode } from "react"

/**
 * Form primitives of the reference's order dialogs (Material-UI "floating label" fields). Every field is a fixed
 * 54px block: the label floats at the top once a value exists (9.75px, i.e. 13px scaled by .75), the value sits 26px
 * below the top and the underline closes the block.
 */

const LABEL = "absolute left-0 origin-left whitespace-nowrap font-semibold text-black"
const UNDERLINE = "absolute inset-x-0 bottom-0 h-px bg-[#e0e0e0]"

function Label({ label, required, floating, plain }: { label: string; required?: boolean; floating: boolean; plain?: boolean }) {
  return (
    <span className={`${LABEL} ${floating ? "top-0 text-[9.75px] leading-[12.2px]" : "top-[25px] text-[13px] leading-[16.3px]"} ${!floating && plain ? "!font-normal" : ""}`}>
      {label}
      {required && <span className="text-[#e57373]"> *</span>}
    </span>
  )
}

export function RefSelect({
  label,
  value,
  display,
  options,
  onChange,
  onClear,
  required,
  alwaysFloat,
  className = "",
}: {
  label: string
  value: string
  /** Keep the label floated even while empty (the reference's group-payment "Ответственный персонал"). */
  alwaysFloat?: boolean
  /** Shown instead of `value` (e.g. a translated option label). */
  display?: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  onClear?: () => void
  required?: boolean
  className?: string
}) {
  const shown = value ? (display ?? options.find((option) => option.value === value)?.label ?? value) : ""
  return (
    <div className={`relative h-[54px] ${className}`}>
      <Label label={label} required={required} floating={Boolean(shown) || Boolean(alwaysFloat)} />
      {shown && <span className="absolute left-0 right-[40px] top-[26px] truncate text-[13px] font-semibold leading-[18px] text-[#333]">{shown}</span>}
      {shown && onClear && (
        <span role="button" aria-label="clear" onClick={onClear} className="absolute right-[28px] top-[26.8px] cursor-pointer text-[18px] leading-[18px] text-[#999]">
          ×
        </span>
      )}
      <svg viewBox="0 0 10 7" className="pointer-events-none absolute right-[10px] top-[34.3px] h-[7px] w-[10px]" aria-hidden>
        <path d="M0 0h10L5 7z" fill="#999" fillOpacity={0.7} />
      </svg>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
        <option value="" />
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className={UNDERLINE} />
    </div>
  )
}

const CALENDAR =
  "M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"

export function RefDate({
  label,
  value,
  display,
  onChange,
  required,
  height = 61,
  compact,
  className = "",
}: {
  label: string
  /** Value 15px below the label (the confirmation strips) instead of 26px. */
  compact?: boolean
  /** YYYY-MM-DD */
  value: string
  display: string
  onChange: (value: string) => void
  required?: boolean
  height?: number
  className?: string
}) {
  return (
    <div style={{ height }} className={`relative ${className}`}>
      <Label label={label} required={required} floating={Boolean(display) || Boolean(compact)} plain />
      <span className={`absolute left-0 right-[30px] truncate text-[13px] font-semibold leading-[18px] text-[#333] ${compact ? "top-[15px]" : "top-[26px]"}`}>{display}</span>
      <svg viewBox="0 0 24 24" className={`pointer-events-none absolute right-[2.5px] h-5 w-5 ${compact ? "top-[14.6px]" : "top-[27px]"}`} aria-hidden>
        <path d={CALENDAR} fill="#ccc" />
      </svg>
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
      <span className={`absolute inset-x-0 h-px bg-[#e0e0e0] ${compact ? "top-[41px]" : "bottom-0"}`} />
    </div>
  )
}

export function RefText({
  label,
  value,
  onChange,
  className = "",
}: {
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <div className={`relative h-[49px] ${className}`}>
      <Label label={label} floating={Boolean(value)} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-x-0 top-[22px] h-[26px] bg-transparent text-[13px] font-semibold leading-[18px] text-[#333] outline-none"
      />
      <span className={UNDERLINE} />
    </div>
  )
}

const BOX_EMPTY = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const BOX_CHECKED = "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"

/** Material checkbox: a 20px box (15px glyph) and a 600-weight label, 20px high. */
export function RefCheck({
  checked,
  onChange,
  children,
  className = "",
}: {
  checked: boolean
  onChange: (value: boolean) => void
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`flex h-5 cursor-pointer items-center text-[13px] font-semibold text-black ${className}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" aria-hidden>
        <path d={checked ? BOX_CHECKED : BOX_EMPTY} fill={checked ? "#129fdd" : "#666"} />
      </svg>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
      <span className="pl-[6px]">{children}</span>
    </label>
  )
}
