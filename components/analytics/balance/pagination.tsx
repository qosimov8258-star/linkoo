"use client"

import { useLanguage } from "@/lib/i18n/language-context"

// Demo paginator: page-size select (10 … 2000), "1 - 25 из N", ‹ ›.

export const BALANCE_PAGE_SIZES = [10, 25, 50, 100, 200, 500, 1000, 2000] as const

export function BalancePagination({
  page,
  pageSize,
  count,
  onChange,
  sizes = BALANCE_PAGE_SIZES,
}: {
  /** 1-based. */
  page: number
  pageSize: number
  count: number
  onChange: (next: { page: number; pageSize: number }) => void
  sizes?: readonly number[]
}) {
  const { t } = useLanguage()
  const lastPage = Math.max(1, Math.ceil(count / pageSize))
  const current = Math.min(page, lastPage)
  const start = count ? (current - 1) * pageSize + 1 : 0
  const end = Math.min(current * pageSize, count)
  return (
    <div className="flex items-center text-[13px] text-[#5d6474]">
      <label className="relative flex h-[56px] w-[56px] items-center justify-center text-[#333]">
        <select
          value={pageSize}
          onChange={(event) => onChange({ page: 1, pageSize: Number(event.target.value) })}
          className="h-full w-full appearance-none bg-transparent text-[13px] outline-none"
          aria-label={t("Количество строк")}
        >
          {sizes.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <svg viewBox="0 0 10 5" className="pointer-events-none absolute left-[23px] top-[26px] h-[5px] w-[10px] fill-[#999]" aria-hidden><path d="M0 0h10L5 5z" /></svg>
      </label>
      <span className="ml-[11px] whitespace-nowrap">
        {start} - {end} {t("из")} {count}
      </span>
      <button type="button" disabled={current <= 1} onClick={() => onChange({ page: current - 1, pageSize })} aria-label={t("Назад")} className="pl-[10px] pr-[5px] disabled:opacity-30">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-black/60" aria-hidden><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-5l-3-3 3-3v6z" /></svg>
      </button>
      <button type="button" disabled={current >= lastPage} onClick={() => onChange({ page: current + 1, pageSize })} aria-label={t("Вперед")} className="disabled:opacity-30">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-black/60" aria-hidden><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-11l3 3-3 3V9z" /></svg>
      </button>
    </div>
  )
}
