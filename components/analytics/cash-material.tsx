"use client"

import { useRef, type ReactNode } from "react"
import { X } from "lucide-react"

/** Material radio row of the reference's full-screen dialogs: 34 px row, 24 px mark, 13 px label. */
export function MaterialRadio({
  checked,
  disabled,
  label,
  onChange,
  hint,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: () => void
  hint?: string
}) {
  return (
    <label className={`flex h-[34px] items-center text-[13px] text-black ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <input type="radio" checked={checked} disabled={disabled} onChange={onChange} className="sr-only" />
      <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill={checked ? "#5d6474" : "#333"} aria-hidden>
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
        {checked && <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5z" />}
      </svg>
      <span className="ml-4 flex-1">{label}</span>
      {hint && (
        <span title={hint} className="flex h-6 w-6 shrink-0 items-center justify-center text-[#4f71dc]">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden>
            <path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
          </svg>
        </span>
      )}
    </label>
  )
}

/**
 * Material date field: the label is the placeholder (13 px), a chosen date moves it above and
 * the calendar mark sits on the right; the native picker is the transparent input over the line.
 */
export function MaterialDate({
  label,
  required,
  value,
  onChange,
  min,
  max,
  error,
  className = "",
  compact,
  display,
}: {
  label: string
  required?: boolean
  value: string
  onChange: (value: string) => void
  /** Earliest day the picker offers ("YYYY-MM-DD"). */
  min?: string
  max?: string
  error?: string
  className?: string
  /** Filled geometry of the order dialogs: label 35 px and value 8 px above the line. */
  compact?: boolean
  /** Text shown for the chosen date (defaults to dd.mm.yyyy). */
  display?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className={`relative h-[38px] border-b ${error ? "border-[#f44336]" : "border-[#e0e0e0]"} ${className}`}>
      {value ? (
        <>
          <span className="absolute left-0 text-[10px] font-bold leading-3 text-black" style={{ top: compact ? -3 : -12 }}>
            {label}
            {required && <span className="text-[#e57373]"> *</span>}
          </span>
          <span className="absolute left-0 text-[13px] leading-4 text-black" style={{ top: compact ? 21 : 16 }}>
            {display ?? value.split("-").reverse().join(".")}
          </span>
        </>
      ) : (
        <span className="absolute left-0 top-[16px] text-[13px] leading-4 text-black">
          {label}
          {required && <span className="text-[#e57373]"> *</span>}
        </span>
      )}
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-0 top-[14px] h-6 w-6 fill-[#bdbdbd]" aria-hidden>
        <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z" opacity=".6" />
      </svg>
      <input
        ref={input}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        onClick={() => input.current?.showPicker?.()}
        aria-label={label}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
      {error && <div className="absolute left-0 top-[40px] text-[12px] leading-4 text-[#f44336]">{error}</div>}
    </div>
  )
}

/** The reference's alert box (400 × 300): blue "!" mark, bold message, full-width OK button. Above every
 * full-screen form (they go up to z 1500), so a notice raised from one is never hidden behind it. */
export function MaterialAlert({ message, onClose }: { message: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[1700] flex items-center justify-center bg-black/45" onMouseDown={onClose}>
      <div
        className="flex h-[300px] w-[400px] flex-col bg-white px-[15px] pb-[20px] pt-[25px] shadow-[0_10px_30px_rgba(0,0,0,0.19),0_6px_10px_rgba(0,0,0,0.23)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <svg viewBox="0 0 24 24" className="mx-auto h-[46px] w-[46px] shrink-0 fill-[#4f71dc]" aria-hidden>
          <path d="M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" />
        </svg>
        <div className="mt-[16px] flex-1 overflow-auto whitespace-pre-line text-center text-[15px] font-semibold leading-5 text-[#333]">{message}</div>
        <button type="button" autoFocus onClick={onClose} className="h-10 w-full rounded-[2px] bg-[#4f71dc] text-[14px] font-bold uppercase text-white hover:brightness-95">
          OK
        </button>
      </div>
    </div>
  )
}

/**
 * Reference dialog shell (Material): 60 px header with the bold title and a 24 px close mark,
 * the body and a 57 px footer with the blue text action. Centered vertically, or hung 64 px
 * from the top (`align="top"`, the bulk-edit dialog).
 */
export function MaterialDialog({
  title,
  onClose,
  width = 400,
  top,
  zIndex = 300,
  footer,
  onSubmit,
  children,
  maxHeight,
  closeInset = 10,
}: {
  title: ReactNode
  onClose: () => void
  width?: number
  /** Distance from the window top in px; the dialog is centered when omitted. */
  top?: number
  zIndex?: number
  /** With a footer the header and body scroll (max height = window − 128 px) and the footer stays. */
  footer?: ReactNode
  /** Fixed max height in px instead of window − 128 (the reference's "Добавить склад" is 540 px with a scrolling body). */
  maxHeight?: number
  /** Right padding of the title row in px (the reference's "Добавить склад" close button sits 15 px in, most dialogs 10). */
  closeInset?: number
  /** Renders the box as a form (the footer submit button then submits it). */
  onSubmit?: () => void
  children: ReactNode
}) {
  const Box = onSubmit ? "form" : "div"
  const header = (
    <div className="flex h-[60px] shrink-0 items-center border-b border-[#efefef] pl-[30px]" style={{ paddingRight: closeInset }}>
      <h2 className="min-w-0 flex-1 text-[13px] font-bold uppercase text-[#333]">{title}</h2>
      <button type="button" onClick={onClose} aria-label="Close" className="flex h-12 w-12 items-center justify-center text-[#333]">
        <X className="h-6 w-6" strokeWidth={1.6} />
      </button>
    </div>
  )
  return (
    <div
      className={`fixed inset-0 flex justify-center overflow-y-auto bg-black/45 font-sans text-[13px] text-black ${top === undefined ? "items-center" : "items-start"}`}
      style={{ zIndex, paddingTop: top }}
      onMouseDown={onClose}
    >
      <Box
        role="dialog"
        aria-modal="true"
        className={`max-w-full bg-white shadow-[0_10px_30px_rgba(0,0,0,0.19),0_6px_10px_rgba(0,0,0,0.23)] ${footer ? `flex flex-col ${maxHeight ? "" : "max-h-[calc(100vh-128px)]"}` : ""}`}
        style={{ width, ...(maxHeight ? { maxHeight } : {}) }}
        onMouseDown={(event: React.MouseEvent) => event.stopPropagation()}
        onSubmit={
          onSubmit
            ? (event: React.FormEvent) => {
                event.preventDefault()
                onSubmit()
              }
            : undefined
        }
      >
        {footer ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {header}
              {children}
            </div>
            {footer}
          </>
        ) : (
          <>
            {header}
            {children}
          </>
        )}
      </Box>
    </div>
  )
}

/** Dialog body: 30 px side padding, optional minimum height (the reference's 210 px bodies). */
export function MaterialBody({ minHeight, className = "", children }: { minHeight?: number; className?: string; children: ReactNode }) {
  return (
    <div className={`px-[30px] ${className}`} style={minHeight ? { minHeight } : undefined}>
      {children}
    </div>
  )
}

/** Dialog footer: the blue uppercase text action on the right (СОХРАНИТЬ / УДАЛИТЬ / ДА). */
export function MaterialFooter({
  label,
  busy,
  disabled,
  onClick,
  type = "submit",
  error,
}: {
  label: ReactNode
  busy?: boolean
  disabled?: boolean
  onClick?: () => void
  type?: "submit" | "button"
  error?: ReactNode
}) {
  return (
    <div className="flex h-[57px] shrink-0 items-center justify-end gap-4 border-t border-[#efefef] pr-[26px]">
      {error && <span className="mr-auto pl-[30px] text-[12px] text-[#f44336]">{error}</span>}
      <button
        type={type}
        disabled={busy || disabled}
        onClick={onClick}
        className={`h-9 text-[13px] font-semibold uppercase text-[#129fdd] hover:underline disabled:no-underline ${busy ? "opacity-60" : ""}`}
      >
        {label}
      </button>
    </div>
  )
}

/** Material checkbox row: 24 px mark and a 13 px bold label. */
export function MaterialCheckbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={`-ml-[1px] flex h-6 items-center text-[13px] font-semibold text-black ${disabled ? "cursor-default opacity-60" : "cursor-pointer"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
      <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill={checked ? "#5d6474" : "#333"} aria-hidden>
        {checked ? (
          <path d="M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
        ) : (
          <path d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
        )}
      </svg>
      <span className="ml-0.5">{label}</span>
    </label>
  )
}

/**
 * Material text field: a 10 px bold label above a 13 px value on an underline (42 px block);
 * with `placeholderLabel` the bold label is the placeholder (36 px block).
 */
export function MaterialInput({
  label,
  value,
  onChange,
  placeholderLabel,
  inputMode,
  className = "",
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholderLabel?: boolean
  inputMode?: "decimal" | "text"
  className?: string
}) {
  return placeholderLabel ? (
    <div className={`relative h-[36px] border-b border-[#e8e8e8] ${className}`}>
      <input
        value={value}
        inputMode={inputMode}
        placeholder={label}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-x-0 bottom-0 h-[26px] bg-transparent text-[13px] outline-none placeholder:font-semibold placeholder:text-black"
      />
    </div>
  ) : (
    <div className={`relative h-[42px] border-b border-[#e8e8e8] ${className}`}>
      <span className="absolute left-0 top-0 text-[10px] font-bold leading-3 text-black">{label}</span>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        className="absolute inset-x-0 bottom-0 h-[26px] bg-transparent text-[13px] outline-none"
      />
    </div>
  )
}
