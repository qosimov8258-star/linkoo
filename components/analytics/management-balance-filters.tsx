"use client"

import { Check, ChevronDown } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

import type { ManagementBranchOption } from "@/lib/finance-management-balance-types"
import { useLanguage } from "@/lib/i18n/language-context"

// Filter bar of "Управленческий баланс по филиалам" (demo: Организация
// (division, multi-select of the legacy Баланс tab) | Филиалы | date range |
// Применить). Values are drafts until "Применить"; the parent remounts the bar
// (key) whenever the URL state changes, which resets the drafts.

export type ManagementFilters = { from: string; to: string; organizations: string[]; branch: string }

const fieldLabel = "block text-sm font-medium text-slate-600"
const fieldControl = "mt-1 flex h-9 w-56 items-center border-b border-slate-300 bg-white text-left text-[15px] text-slate-700 outline-none focus:border-[#4f70e7]"

function OrganizationSelect({ options, value, onChange }: { options: string[]; value: string[]; onChange: (next: string[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", escape)
    return () => {
      document.removeEventListener("mousedown", close)
      document.removeEventListener("keydown", escape)
    }
  }, [open])

  const toggle = (name: string) => onChange(value.includes(name) ? value.filter((item) => item !== name) : [...value, name])
  const summary = value.length ? value.join(", ") : t("Все организации")

  return (
    <div ref={ref} className="relative">
      <span className={fieldLabel}>{t("Организация")}</span>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} className={`${fieldControl} justify-between gap-2`}>
        <span className="truncate" title={summary}>
          {summary}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true" className="absolute left-0 z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded border border-slate-200 bg-white py-1 shadow-lg">
          <OptionRow selected={!value.length} label={t("Все организации")} onClick={() => onChange([])} />
          {options.map((name) => (
            <OptionRow key={name} selected={value.includes(name)} label={name} onClick={() => toggle(name)} />
          ))}
          {!options.length && <p className="px-3 py-2 text-sm text-slate-400">{t("Нет данных")}</p>}
        </div>
      )}
    </div>
  )
}

function OptionRow({ selected, label, onClick }: { selected: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="option" aria-selected={selected} onClick={onClick} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-[#f2f5f8]">
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${selected ? "border-[#4f70e7] bg-[#4f70e7] text-white" : "border-slate-300"}`}>
        {selected && <Check className="h-3 w-3" />}
      </span>
      <span className="truncate">{label}</span>
    </button>
  )
}

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
  const set = (changes: Partial<ManagementFilters>) => setDraft((current) => ({ ...current, ...changes }))

  const apply = () => {
    const [from, to] = draft.from <= draft.to ? [draft.from, draft.to] : [draft.to, draft.from]
    onApply({ ...draft, from: from || initial.from, to: to || initial.to })
  }

  return (
    <section className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-4 rounded bg-white p-5 shadow">
      <OrganizationSelect options={organizations} value={draft.organizations} onChange={(next) => set({ organizations: next })} />
      <label className={fieldLabel}>
        {t("Филиалы")}
        <select value={draft.branch} onChange={(event) => set({ branch: event.target.value })} className={`${fieldControl} py-1.5`}>
          <option value="">{t("Все филиалы")}</option>
          {branches.map((branch) => (
            <option key={branch.value} value={branch.value}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2">
        <input
          type="date"
          aria-label={t("Дата начала")}
          value={draft.from}
          max={draft.to || undefined}
          onChange={(event) => set({ from: event.target.value })}
          className="h-9 border-b border-slate-300 py-1.5 text-sm text-slate-700 outline-none focus:border-[#4f70e7]"
        />
        <span className="text-slate-400">—</span>
        <input
          type="date"
          aria-label={t("Дата окончания")}
          value={draft.to}
          min={draft.from || undefined}
          onChange={(event) => set({ to: event.target.value })}
          className="h-9 border-b border-slate-300 py-1.5 text-sm text-slate-700 outline-none focus:border-[#4f70e7]"
        />
      </div>
      <button type="button" onClick={apply} className="rounded bg-[#4f70e7] px-6 py-2.5 font-semibold text-white hover:brightness-95">
        {t("Применить")}
      </button>
      {extra && <div className="ml-auto">{extra}</div>}
    </section>
  )
}
