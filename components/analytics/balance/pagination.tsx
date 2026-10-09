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
    <div className="flex items-center gap-3 text-[#586174]">
      <select
        value={pageSize}
        onChange={(event) => onChange({ page: 1, pageSize: Number(event.target.value) })}
        className="h-9 bg-transparent"
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
        className="rounded-full border border-[#4f70e7] p-1 text-[#4f70e7] disabled:border-[#dbe0e8] disabled:text-[#9aa3b6]"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        type="button"
        disabled={current >= lastPage}
        onClick={() => onChange({ page: current + 1, pageSize })}
        aria-label={t("Вперед")}
        className="rounded-full border border-[#4f70e7] p-1 text-[#4f70e7] disabled:border-[#dbe0e8] disabled:text-[#9aa3b6]"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  )
}
