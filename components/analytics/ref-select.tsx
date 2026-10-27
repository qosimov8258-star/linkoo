"use client"

import { useEffect, useRef, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

export type RefSelectOption = { key: string | number; label: string }

/**
 * The reference's react-select field (floating "label", chips with a cross in the multi mode, a clear cross, the caret and a list that opens
 * under the 36px control). `multi` keeps the chips and the list open after a pick; the single mode closes the list and focuses the first
 * option (light blue) with grey options below it.
 */
export function RefSelect({
  label,
  options,
  value,
  onChange,
  multi,
  className = "",
}: {
  label: string
  options: RefSelectOption[]
  value: Array<string | number>
  onChange: (value: Array<string | number>) => void
  multi?: boolean
  className?: string
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [focus, setFocus] = useState(-1)
  const [focused, setFocused] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const chosen = value.map((key) => options.find((item) => item.key === key)).filter((item): item is RefSelectOption => Boolean(item))
  const shown = options.filter((item) => item.label.toLowerCase().includes(text.trim().toLowerCase()))
  const floated = chosen.length > 0 || text !== ""
  const current = multi ? focus : focus < 0 ? 0 : focus

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setFocused(false)
        setText("")
      }
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])

  function pick(item: RefSelectOption) {
    if (multi) onChange(value.includes(item.key) ? value : [...value, item.key])
    else {
      onChange([item.key])
      setOpen(false)
    }
    setText("")
  }

  return (
    <div ref={rootRef} className={`relative mt-[5px] h-[54px] text-[13px] text-[#333] ${className}`}>
      {floated && <div className="pointer-events-none absolute left-0 top-[5px] origin-top-left scale-75 text-[13px] font-semibold leading-[16.25px] text-black">{label}</div>}
      <div
        onClick={() => { setOpen(true); inputRef.current?.focus() }}
        className={`absolute inset-x-0 top-[18px] flex min-h-[36px] cursor-default items-start border-b ${open ? "border-[#d9d9d9] shadow-[0_1px_0_rgba(0,0,0,0.06)]" : "border-[#e8e8e8]"}`}
      >
        <div className="relative flex min-w-0 flex-1 flex-wrap items-start">
          {!floated && <div className="pointer-events-none absolute left-0 top-[12px] text-[13px] font-semibold leading-[16.25px] text-black">{label}</div>}
          {!multi && chosen.length > 0 && text === "" && <div className="pointer-events-none absolute left-0 top-[13px] text-[13px] font-semibold leading-[18px] text-[#333]">{chosen[0].label}</div>}
          {multi &&
            chosen.map((item) => (
              <div key={item.key} className="mr-[5px] mt-[5px] flex h-[22.4px] items-stretch rounded-[2px] border border-[#5868f0] bg-[#5868f0] text-[11.7px] font-semibold leading-[16.25px] text-white">
                <button
                  type="button"
                  aria-label={t("Удалить")}
                  onClick={(event) => { event.stopPropagation(); onChange(value.filter((key) => key !== item.key)) }}
                  className="cursor-pointer rounded-l-[2px] border-r border-[#efefef] px-[5px] py-[2px] leading-[16.25px] hover:bg-[#2d3037]/[0.08]"
                >
                  ×
                </button>
                <span className="px-[5px] py-[2px]">{item.label}</span>
              </div>
            ))}
          <input
            ref={inputRef}
            value={text}
            onFocus={() => { setFocused(true); setOpen(true) }}
            onBlur={() => setFocused(false)}
            onChange={(event) => { setText(event.target.value); setFocus(-1); setOpen(true) }}
            onKeyDown={(event) => {
              if (event.key === "Backspace" && !text && value.length) onChange(multi ? value.slice(0, -1) : [])
              else if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setFocus(Math.min(shown.length - 1, current + (open ? 1 : 0))) }
              else if (event.key === "ArrowUp") { event.preventDefault(); setFocus(Math.max(0, current - 1)) }
              else if (event.key === "Enter" && open && shown[current]) { event.preventDefault(); pick(shown[current]) }
              else if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); setText("") }
            }}
            style={{ width: Math.max(5, text.length * 8 + 5) }}
            className="block h-[34px] bg-transparent text-[13px] font-semibold text-black outline-none"
          />
        </div>
        {chosen.length > 0 && (
          <button
            type="button"
            aria-label={t("Очистить")}
            onClick={(event) => { event.stopPropagation(); onChange([]); setText("") }}
            className={`h-[35px] w-[17px] shrink-0 ${open ? "pt-[10px]" : "pt-[9px]"} text-center text-[18px] leading-[18px] text-[#999] hover:text-[#d0021b]`}
          >
            ×
          </button>
        )}
        {focused && !open && <span className="pointer-events-none absolute inset-x-0 -bottom-px h-[2px] bg-[#5d6474]" />}
        <span className="relative h-[35px] w-[25px] shrink-0 cursor-pointer pr-[5px] pt-[12px]" onMouseDown={(event) => { event.preventDefault(); setOpen((now) => !now) }}>
          <span className={`absolute left-[5px] top-[21.4px] block h-0 w-0 border-x-[5px] border-x-transparent ${open ? "border-b-[5px] border-b-[#999]" : "border-t-[5px] border-t-[#999] border-b-[2px] border-b-transparent"}`} />
        </span>
      </div>
      {open && (
        <div className="absolute inset-x-0 top-[53px] z-[9999] max-h-[200px] overflow-y-auto rounded-b-[4px] bg-white text-[13px] font-semibold text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
          {shown.length === 0 ? (
            <div className="cursor-default px-[10px] py-2 text-[13px] font-semibold leading-[16.25px] text-[#999]">{t("Не найдено")}</div>
          ) : multi ? (
            shown.map((item, index) => (
              <div
                key={item.key}
                onMouseDown={(event) => { event.preventDefault(); pick(item); setFocus(index) }}
                className={`cursor-pointer p-[10px] leading-[16.25px] hover:bg-[#e6f0ff] ${index === focus ? "bg-[#e6f0ff]" : "bg-white"}`}
              >
                {item.label}
              </div>
            ))
          ) : (
            shown.map((item, index) => (
              <div
                key={item.key}
                onMouseDown={(event) => { event.preventDefault(); pick(item) }}
                className={`cursor-pointer px-[10px] py-2 leading-[16.25px] ${index === current ? "bg-[#e6f2ff] text-[#333]" : "bg-white text-[#666]"}`}
              >
                {item.label}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
