"use client"

import { useEffect, useRef, useState } from "react"

import { useLanguage } from "@/lib/i18n/language-context"

export const REF_PAGE_SIZES = [10, 25, 50, 100, 200, 500, 1000, 2000] as const

const ARROW_PREV = "M22,12A10,10 0 0,0 12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12M20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12M14,7L9,12L14,17V7Z"
const ARROW_NEXT = "M2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2A10,10 0 0,0 2,12M4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12M10,17L15,12L10,7V17Z"

/**
 * The reference app's paging cluster: "25 ▾" size menu, "1 - 25 из N" and the two round arrows.
 * Renders a fragment, so drop it inside a flex row (`items-center`, text-[#5d6474]).
 */
export function RefPager({
  pageSize,
  onPageSize,
  from,
  to,
  total,
  page,
  pageCount,
  onPage,
  sizes = REF_PAGE_SIZES,
}: {
  pageSize: number
  onPageSize: (size: number) => void
  from: number
  to: number
  total: number
  page: number
  pageCount: number
  onPage: (page: number) => void
  sizes?: readonly number[]
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])

  return (
    <>
      <div ref={rootRef} className="relative mr-[27px] h-12 w-[40px] shrink-0">
        <button type="button" onClick={() => setOpen((current) => !current)} aria-label={t("Количество строк")} className="flex h-12 w-full items-center text-[13px] text-[#333]">
          {pageSize}
        </button>
        <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-[16px] top-3 h-6 w-6 fill-[#e0e0e0]"><path d="M7 10l5 5 5-5z" /></svg>
        {open && (
          <ul className="absolute -left-1 -top-1 z-30 m-0 w-[88px] list-none rounded-[2px] bg-white py-[5px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
            {sizes.map((size) => (
              <li key={size}>
                <button
                  type="button"
                  onClick={() => {
                    onPageSize(size)
                    setOpen(false)
                  }}
                  className={`block h-8 w-full px-6 text-left text-[13px] leading-8 hover:bg-[#f2f5f8] ${size === pageSize ? "text-[#5d6474]" : "text-[#333]"}`}
                >
                  {size}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <span className="shrink-0 whitespace-nowrap text-[13px] leading-[16.25px]">
        {total === 0 ? 1 : from} - {to} {t("из")} {total}
      </span>
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t("Назад")} className="flex h-7 w-[39px] shrink-0 items-center pl-[10px]">
        <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page <= 1 ? "fill-black/30" : "fill-black/55"}`}><path d={ARROW_PREV} /></svg>
      </button>
      <button type="button" disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label={t("Вперед")} className="flex h-7 w-6 shrink-0 items-center">
        <svg viewBox="0 0 24 24" className={`h-6 w-6 ${page >= pageCount ? "fill-black/30" : "fill-black/55"}`}><path d={ARROW_NEXT} /></svg>
      </button>
    </>
  )
}
