"use client"

import { useLayoutEffect, useRef, useState, type ReactNode } from "react"

const ERROR = "#f44336"
/** Line height of the reference's multi-line fields (24px per row). */
const ROW = 24

/**
 * The reference's material-ui TextField in the «Рассылка» and «Страницы телеграм бота» dialogs: the label sits in the
 * field and floats up (to 3/4 size) on focus or once there is text, a 1px grey underline turns dark on focus (red on an
 * error), and a hint shows in an empty focused field.
 * - single line (no `rows`): 45px tall with 7px above it (the article-link and title fields);
 * - `rows`: a textarea of that many 24px rows, growing with the text (`grow`, «Сообщение» of a mailing) or scrolling
 *   inside them («Содержание», rows 7 / rowsMax 7).
 */
export function MaterialField({
  label,
  value,
  onChange,
  hint,
  rows,
  grow,
  error,
  name,
  bold,
  className = "",
}: {
  label: ReactNode
  value: string
  onChange: (value: string) => void
  hint?: string
  rows?: number
  grow?: boolean
  error?: string
  name?: string
  /** Semi-bold text (the mailing message; «Содержание» is regular). */
  bold?: boolean
  className?: string
}) {
  const [focused, setFocused] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const floated = focused || value !== ""

  useLayoutEffect(() => {
    const area = areaRef.current
    if (!area || !rows || !grow) return
    area.style.height = "auto"
    area.style.height = `${Math.max(area.scrollHeight, rows * ROW)}px`
  }, [value, rows, grow])

  const underline = (
    <>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[#e0e0e0]" />
      <span
        className={`pointer-events-none absolute inset-x-0 bottom-0 h-[2px] origin-center transition-[scale] duration-[450ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${error ? "" : "scale-x-0 group-focus-within:scale-x-100"}`}
        style={{ background: error ? ERROR : "#5d6474" }}
      />
    </>
  )
  const hintText = hint && focused && !value ? <span className="pointer-events-none absolute left-0 text-[13px] text-black/30" style={{ top: rows ? 36 : 12, lineHeight: `${ROW}px` }}>{hint}</span> : null
  const errorLine = error ? <span className="absolute left-0 top-[calc(100%+4px)] whitespace-nowrap text-[12px] leading-[12px]" style={{ color: ERROR }}>{error}</span> : null

  if (rows) {
    return (
      <div className={`group relative pt-[36px] ${error ? "mb-[16px]" : ""} ${className}`}>
        <span className={`pointer-events-none absolute left-0 z-[1] whitespace-nowrap font-semibold text-black transition-all duration-[450ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${floated ? "top-[17px] text-[10px] leading-[16px]" : "top-[40px] text-[13px] leading-[18px]"}`}>
          {label}
        </span>
        {hintText}
        <textarea
          ref={areaRef}
          name={name}
          value={value}
          rows={rows}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={grow ? undefined : { height: rows * ROW }}
          className={`relative mb-[3px] block w-full resize-none bg-transparent text-[13px] leading-6 text-[#333] outline-none ${grow ? "overflow-hidden" : "overflow-y-auto"} ${bold ? "font-semibold" : ""}`}
        />
        {underline}
        {errorLine}
      </div>
    )
  }

  return (
    <div className={`group relative mt-[7px] h-[45px] ${className}`}>
      <span className={`pointer-events-none absolute left-0 z-[1] whitespace-nowrap font-semibold text-black transition-all duration-[450ms] ease-[cubic-bezier(0.23,1,0.32,1)] ${floated ? "-top-[7px] text-[10px] leading-[14px]" : "top-[13px] text-[13px] leading-[18px]"}`}>
        {label}
      </span>
      {hintText}
      <input
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="absolute inset-x-0 top-[12px] h-6 w-full bg-transparent text-[13px] font-semibold leading-6 text-black outline-none"
      />
      <span className="pointer-events-none absolute inset-x-0 top-0 h-[37px]">{underline}</span>
      {errorLine}
    </div>
  )
}
