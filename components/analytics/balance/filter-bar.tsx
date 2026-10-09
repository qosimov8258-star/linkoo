"use client"

import { useState, type ReactNode } from "react"
import { Filter, Pencil, X } from "lucide-react"

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
}: {
  count: number
  from: string
  to: string
  /** Selected organization / branch names; empty = "Во всей организации". */
  scope?: string[]
  onOpen: () => void
  /** Extra inline badge after the scope (e.g. green "Реализовано"). */
  extra?: ReactNode
}) {
  const { t } = useLanguage()
  return (
    <div className="flex flex-wrap items-center gap-4">
      <button type="button" onClick={onOpen} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-5 font-semibold text-white">
        <Filter className="h-4 w-4" /> {t("Фильтр")} / {count}
      </button>
      <span className="font-semibold text-[#4f70e7]">
        {formatDotDate(from)} - {formatDotDate(to)}
      </span>
      <span className="font-semibold text-[#4f70e7]">{scope.length ? scope.join(", ") : t("Во всей организации")}</span>
      {extra}
    </div>
  )
}

export function BalanceFilterChip({ count, onOpen, onClear }: { count: number; onOpen: () => void; onClear: () => void }) {
  const { t } = useLanguage()
  if (!count) {
    return (
      <button type="button" onClick={onOpen} className="flex h-10 items-center gap-2 rounded-md border border-[#4f70e7] px-4 font-semibold text-[#4f70e7]">
        <Filter className="h-4 w-4" /> {t("Показать фильтр")}
      </button>
    )
  }
  return (
    <span className="flex h-10 items-center gap-3 rounded-md border border-[#4f70e7] px-4 font-semibold text-[#4f70e7]">
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
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/30 py-10" onClick={onClose}>
      <div className="w-full max-w-[760px] rounded-lg bg-white shadow-xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#e1e5eb] px-6 py-4">
          <h2 className="text-lg font-bold text-[#17233b]">{t(title)}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#586174]">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 px-6 py-5 md:grid-cols-2">
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-sm text-[#586174]">{t(dateLabel)}</span>
            <span className="flex items-center gap-2">
              <input type="date" value={draft.from} onChange={(event) => setDraft((value) => ({ ...value, from: event.target.value }))} className="h-10 flex-1 rounded-md border border-[#dbe0e8] px-3" />
              <span className="text-[#586174]">—</span>
              <input type="date" value={draft.to} onChange={(event) => setDraft((value) => ({ ...value, to: event.target.value }))} className="h-10 flex-1 rounded-md border border-[#dbe0e8] px-3" />
            </span>
          </label>
          {children}
        </div>
        <div className="flex justify-end border-t border-[#e1e5eb] px-6 py-4">
          <button type="button" onClick={apply} disabled={!draft.from || !draft.to} className="h-10 rounded-md bg-[#4f70e7] px-6 font-semibold text-white disabled:opacity-50">
            {t("Применить")}
          </button>
        </div>
      </div>
    </div>
  )
}
