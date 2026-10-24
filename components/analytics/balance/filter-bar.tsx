"use client"

import { useState, type ReactNode } from "react"
import { CalendarDays, Pencil, X, XCircle } from "lucide-react"

import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { RI } from "@/components/ref/list-kit"

import { formatDotDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// Filter header pieces of the balance pages:
// - BalanceFilterButton: blue "Фильтр / N" + "DD.MM.YYYY - DD.MM.YYYY" + scope
//   ("Во всей организации" or the selected organizations/branches) — cash,
//   client, account, supplier, management pages;
// - BalanceFilterChip: "Показать фильтр" / "Фильтр: N элемента" with edit and
//   clear icons — van-sell, branch, employee pages;
// - BalanceFilterDialog: popup with "Диапазон дат" + page-specific fields + "Применить".

/** Demo counter: active filter keys except the ones listed (fromDate, search…). */
export function countActiveFilters(values: Record<string, unknown>, exclude: string[] = []): number {
  return Object.entries(values).filter(([name, value]) => {
    if (exclude.includes(name)) return false
    if (Array.isArray(value)) return value.length > 0
    return value !== undefined && value !== null && value !== "" && value !== false
  }).length
}

export function BalanceFilterButton({
  count,
  from,
  to,
  scope = [],
  onOpen,
  extra,
  hidePeriod = false,
}: {
  count: number
  from: string
  to: string
  /** Selected organization / branch names; empty = "Во всей организации". */
  scope?: string[]
  onOpen: () => void
  /** Extra inline badge after the scope (e.g. green "Реализовано"). */
  extra?: ReactNode
  /** Reports without a date filter (expenses by category / staff) show only the scope. */
  hidePeriod?: boolean
}) {
  const { t } = useLanguage()
  return (
    <div className="flex flex-wrap items-center gap-[10px]">
      <button type="button" onClick={onOpen} className="flex h-[34px] items-center gap-2 rounded-[3px] bg-[#4f71dc] pl-3 pr-4 text-[13px] font-semibold text-white">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-white" aria-hidden><path d={RI.filter} /></svg> {t("Фильтр")}{count ? ` / ${count}` : ""}
      </button>
      <span className="text-[13px] font-semibold text-[#4f71dc]">
        {hidePeriod ? "" : `${formatDotDate(from)} - ${formatDotDate(to)} `}{scope.length ? scope.join(", ") : t("Во всей организации")}
      </span>
      {extra}
    </div>
  )
}

export function BalanceFilterChip({ count, onOpen, onClear }: { count: number; onOpen: () => void; onClear: () => void }) {
  const { t } = useLanguage()
  if (!count) {
    return (
      <button type="button" onClick={onOpen} className="text-[13px] text-[#4f71dc]">
        {t("Показать фильтр")} ⌄
      </button>
    )
  }
  return (
    <span className="flex h-[30px] items-center gap-3 rounded-[3px] border border-[#4f71dc] px-3 text-[13px] font-semibold text-[#4f71dc]">
      {t("Фильтр")}: {count} {t("элемента")}
      <button type="button" onClick={onOpen} aria-label={t("Изменить")}>
        <Pencil className="h-4 w-4" />
      </button>
      <button type="button" onClick={onClear} aria-label={t("Очистить")}>
        <X className="h-4 w-4" />
      </button>
    </span>
  )
}

export function BalanceFilterDialog({
  open,
  onClose,
  from,
  to,
  onApply,
  dateLabel = "Диапазон дат",
  title = "Фильтр",
  children,
}: {
  open: boolean
  onClose: () => void
  /** Applied period (the dialog edits a draft copy). */
  from: string
  to: string
  /** Called with the drafted period; apply the page's own field drafts here too. */
  onApply: (period: { from: string; to: string }) => void
  /** "Диапазон дат" / "Период создания" / "Период реализации" … */
  dateLabel?: string
  title?: string
  /** Page-specific fields (selects, checkboxes). */
  children?: ReactNode
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState({ from, to })
  const [lastOpen, setLastOpen] = useState(open)
  const [pickerOpen, setPickerOpen] = useState(false)
  if (open !== lastOpen) {
    // Re-seed the draft each time the dialog opens.
    setLastOpen(open)
    if (open) setDraft({ from, to })
  }
  if (!open) return null
  const apply = () => {
    const period = draft.from <= draft.to ? draft : { from: draft.to, to: draft.from }
    onApply(period)
    onClose()
  }
  // Reference look: a full-width panel dropping from the top (30px side gutters) over a light overlay, ⊗ to close,
  // stacked fields and a full-width green "Применить".
  return (
    <div className="fixed inset-x-0 bottom-0 top-[50px] z-[100] overflow-y-auto bg-black/10" onClick={onClose}>
      <div className="mx-[30px] mt-[117px] bg-white p-[30px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-[13px] font-semibold text-[#333]">{t(title)}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#333]">
            <XCircle className="h-6 w-6" />
          </button>
        </div>
        <div className="mt-[10px] grid grid-cols-1 gap-[22px]">
          <div className="relative flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-black">{t(dateLabel)}</span>
            <button
              type="button"
              onClick={() => setPickerOpen((value) => !value)}
              className="flex h-9 w-[256px] items-center justify-between border-b border-[#dbe0e8] text-left text-[13px] text-[#17233b]"
            >
              <span>
                {rangeLabel(draft.from)} - {rangeLabel(draft.to)}
              </span>
              <CalendarDays className="h-4 w-4 text-[#9aa3b6]" />
            </button>
            {pickerOpen && (
              <DateRangePicker
                begin={draft.from}
                end={draft.to}
                onClose={() => setPickerOpen(false)}
                onApply={(begin, end) => {
                  setDraft({ from: begin, to: end })
                  setPickerOpen(false)
                }}
              />
            )}
          </div>
          {children}
        </div>
        <button
          type="button"
          onClick={apply}
          disabled={!draft.from || !draft.to}
          className="mt-[10px] h-9 w-full rounded-[3px] bg-[#71ce87] text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {t("Применить")}
        </button>
      </div>
    </div>
  )
}

/** "01 окт. 2026": the reference spelling of a day in the date-range field. */
function rangeLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number)
  if (!year || !month || !day) return iso
  return new Date(year, month - 1, day).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).replace(/\s?г\.$/, "")
}
