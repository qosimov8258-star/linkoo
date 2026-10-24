"use client"

import { useState, type ReactNode } from "react"

import { RefSearchSelect, type RefSelectItem } from "@/components/analytics/ref-search-select"
import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { formatRangeLabel, parseISODate } from "@/lib/dashboard-date-range"
import type { ManagementBranchOption } from "@/lib/finance-management-balance-types"
import { useLanguage } from "@/lib/i18n/language-context"

// Filter bar of "Управленческий баланс по филиалам" (demo: Организация (division, multi-select) | Филиалы | date range |
// Применить). Values are drafts until "Применить"; the parent remounts the bar (key) whenever the URL state changes,
// which resets the drafts. Same Material look as "Движения денежных средств".

export type ManagementFilters = { from: string; to: string; organizations: string[]; branch: string }

export function ManagementFilterBar({
  initial,
  organizations,
  branches,
  onApply,
  extra,
}: {
  initial: ManagementFilters
  organizations: string[]
  branches: ManagementBranchOption[]
  onApply: (filters: ManagementFilters) => void
  extra?: ReactNode
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState(initial)
  const [pickerOpen, setPickerOpen] = useState(false)
  const set = (changes: Partial<ManagementFilters>) => setDraft((current) => ({ ...current, ...changes }))
  const organizationItems: RefSelectItem[] = organizations.map((name) => ({ value: name, label: name }))
  const branchItems: RefSelectItem[] = branches.map((branch) => ({ value: branch.value, label: branch.name }))

  const apply = () => {
    const [from, to] = draft.from <= draft.to ? [draft.from, draft.to] : [draft.to, draft.from]
    onApply({ ...draft, from: from || initial.from, to: to || initial.to })
  }

  return (
    <section className="relative mb-[15px] h-[78px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <div className="absolute left-[30px] top-[4px] w-[350px]">
        <RefSearchSelect label={t("Организация")} items={organizationItems} selected={draft.organizations.map((name) => ({ value: name, label: name }))} onChange={(next) => set({ organizations: next.map((item) => item.value) })} multi />
      </div>
      <div className="absolute left-[395px] top-[4px] w-[300px]">
        <RefSearchSelect label={t("Филиалы")} items={branchItems} selected={branchItems.filter((item) => item.value === draft.branch)} onChange={(next) => set({ branch: next[0]?.value ?? "" })} />
      </div>
      <div className="absolute left-[710px] top-[26px] h-[36px] w-[350px] border-b border-[#e8e8e8]">
        <button type="button" onClick={() => setPickerOpen((open) => !open)} className="absolute left-0 top-[9px] text-[13px] text-black">
          {formatRangeLabel(parseISODate(draft.from), parseISODate(draft.to)).toLowerCase()}
        </button>
        {pickerOpen && (
          <DateRangePicker
            positionClassName="left-0 top-[36px]"
            begin={draft.from}
            end={draft.to}
            onClose={() => setPickerOpen(false)}
            onApply={(from, to) => {
              set({ from, to })
              setPickerOpen(false)
            }}
          />
        )}
      </div>
      <button type="button" onClick={apply} className="absolute left-[1075px] top-[26px] h-[30px] rounded-[4px] bg-[#4f71dc] px-[16px] text-[13px] font-bold text-white uppercase">
        {t("Применить")}
      </button>
      {extra && <div className="absolute right-[30px] top-[17px]">{extra}</div>}
    </section>
  )
}
