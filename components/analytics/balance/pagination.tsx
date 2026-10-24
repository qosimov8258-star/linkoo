"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"

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
    <div className="flex items-center gap-3 text-[13px] text-[#5d6474]">
      <select
        value={pageSize}
        onChange={(event) => onChange({ page: 1, pageSize: Number(event.target.value) })}
        className="h-8 bg-transparent"
        aria-label={t("Количество строк")}
      >
        {sizes.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
      <span className="whitespace-nowrap">
        {start} - {end} {t("из")} {count}
      </span>
      <button
        type="button"
        disabled={current <= 1}
        onClick={() => onChange({ page: current - 1, pageSize })}
        aria-label={t("Назад")}
        className="rounded-full border border-[#5d6474] p-[2px] text-[#5d6474] disabled:border-[#cfd4de] disabled:text-[#cfd4de]"
      >
        <ChevronLeft className="h-[18px] w-[18px]" />
      </button>
      <button
        type="button"
        disabled={current >= lastPage}
        onClick={() => onChange({ page: current + 1, pageSize })}
        aria-label={t("Вперед")}
        className="rounded-full border border-[#5d6474] p-[2px] text-[#5d6474] disabled:border-[#cfd4de] disabled:text-[#cfd4de]"
      >
        <ChevronRight className="h-[18px] w-[18px]" />
      </button>
    </div>
  )
}
