"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { CalendarDays, XCircle } from "lucide-react"

import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { RI } from "@/components/ref/list-kit"

import { formatDotDate, formatStatementDate } from "@/lib/finance/dates"
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
    <div className="flex flex-wrap items-center">
      <button type="button" onClick={onOpen} className="flex h-[34px] items-center rounded-[5px] bg-[#1E4A9A] pl-[12.8px] pr-[17px] text-[13px] font-semibold text-white hover:brightness-95">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-white" aria-hidden><path d={RI.filter} /></svg>
        <span className="pl-2">{t("Фильтр")}{count ? ` / ${count}` : ""}</span>
      </button>
      {/* Linko: the period and «Во всей организации» open the filter too. */}
      <button type="button" onClick={onOpen} className="ml-[14px] text-left text-[13px] font-semibold text-[#1E4A9A] hover:underline">
        {hidePeriod ? "" : `${formatDotDate(from)} - ${formatDotDate(to)} `}{scope.length ? scope.join(", ") : t("Во всей организации")}
      </button>
      {extra}
    </div>
  )
}

export function BalanceFilterChip({
  count,
  onOpen,
  onClear,
  variant = "link",
}: {
  count: number
  onOpen: () => void
  onClear: () => void
  /** No filter yet: "link" = «Показать фильтр ⌄» (van-sell, branches), "button" = Linko's filled button (employees). */
  variant?: "link" | "button"
}) {
  const { t } = useLanguage()
  if (!count) {
    if (variant === "button") {
      return (
        <button type="button" onClick={onOpen} className="flex h-[30px] items-center rounded-[2px] bg-[#1E4A9A] pl-[12px] pr-[16px] text-[13px] font-semibold text-white">
          <svg viewBox="0 0 24 24" className="mb-[4px] h-[18px] w-[18px] fill-white" aria-hidden>
            <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z" />
          </svg>
          <span className="pl-[8px]">{t("Показать фильтр")}</span>
        </button>
      )
    }
    return (
      <button type="button" onClick={onOpen} className="text-[13px] text-[#1E4A9A]">
        {t("Показать фильтр")} ⌄
      </button>
    )
  }
  // Linko: a grey block from the page edge — «Фильтр: N элемента», the underlined pencil and ⊗ (48 px icon buttons).
  return (
    <span className="-ml-[10px] flex h-[48px] items-center bg-[#efefef] pl-[10px] text-[13px] text-[#666]">
      {t("Фильтр")}: {count} {t("элемента")}
      <button type="button" onClick={onOpen} aria-label={t("Изменить")} className="ml-[9px] flex h-12 w-12 items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#8f8f8f]" aria-hidden>
          <path d="M17.75 7L14 3.25l-10 10V17h3.75l10-10zm2.96-2.96c.39-.39.39-1.02 0-1.41L18.37.29c-.39-.39-1.02-.39-1.41 0L15 2.25 18.75 6l1.96-1.96z" />
          <path fillOpacity=".36" d="M0 20h24v4H0z" />
        </svg>
      </button>
      <button type="button" onClick={onClear} aria-label={t("Очистить")} className="flex h-12 w-12 items-center justify-center">
        <XCircle className="h-6 w-6 text-[#8f8f8f]" strokeWidth={1.5} />
      </button>
    </span>
  )
}

/** True inside the reference's small "Filter" card (van-sell / branch / employee balance, recommended stock). */
export const FilterCardContext = createContext(false)
export const useFilterCard = () => useContext(FilterCardContext)

/** Material "floating label" select used in the card: bold label as the placeholder, small label above a chosen value. */
export function FilterCardSelect({ label, text, onClick, children }: { label: string; text: string; onClick: () => void; children?: ReactNode }) {
  return (
    <div className="relative">
      <button type="button" onClick={onClick} className="relative block h-[40px] w-full border-b border-[#d5dae1] text-left">
        <span className={`absolute left-0 ${text ? "top-0 text-[10px] font-semibold leading-3" : "top-[18px] text-[13px] font-bold leading-4"}`}>{label}</span>
        {text && <span className="absolute inset-x-0 bottom-[6px] truncate pr-8 text-[13px] text-black">{text}</span>}
        <svg viewBox="0 0 10 5" className="absolute bottom-[10px] right-[2px] h-[5px] w-[10px] fill-[#757575]" aria-hidden><path d="M0 0h10L5 5z" /></svg>
      </button>
      {children}
    </div>
  )
}

/** Renders `card` inside the small filter card and `plain` inside the full-width panel. */
/** Filter-card select (label floats up once a value is chosen), like the reference's filter dropdowns. */
export function FilterCardOptionSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (next: string) => void
  disabled?: boolean
}) {
  return (
    <label className={`relative block h-[40px] border-b border-[#d5dae1] ${disabled ? "opacity-60" : ""}`}>
      <span className={`pointer-events-none absolute left-0 ${value ? "top-0 text-[10px] font-semibold leading-3" : "top-[18px] text-[13px] font-bold leading-4"}`}>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="absolute inset-x-0 bottom-0 h-[26px] w-full appearance-none bg-transparent text-[13px] outline-none">
        <option value=""></option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      <svg viewBox="0 0 10 5" className="pointer-events-none absolute bottom-[10px] right-[2px] h-[5px] w-[10px] fill-[#757575]" aria-hidden><path d="M0 0h10L5 5z" /></svg>
    </label>
  )
}

export function FilterVariant({ card, plain }: { card: ReactNode; plain: ReactNode }) {
  return <>{useFilterCard() ? card : plain}</>
}

export function BalanceFilterDialog({
  open,
  onClose,
  from,
  to,
  onApply,
  dateLabel = "Диапазон дат",
  title = "Фильтр",
  variant = "panel",
  columns = 1,
  hideDate = false,
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
  /** "card": the reference's small anchored card (310px, dark "Применить") instead of the full-width panel. */
  variant?: "panel" | "card"
  /** Panel only: 4 = the reference's compact card (fields in four columns, labels inside the fields). */
  columns?: 1 | 4
  hideDate?: boolean
  /** Page-specific fields (selects, checkboxes). */
  children?: ReactNode
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState({ from, to })
  const [lastOpen, setLastOpen] = useState(open)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ left: number; top: number }>({ left: 10, top: 110 })
  useEffect(() => {
    if (!open || variant !== "card") return
    const trigger = document.activeElement
    const rect = trigger instanceof HTMLElement && trigger !== document.body ? trigger.getBoundingClientRect() : null
    if (rect && rect.top > 60) setAnchor({ left: Math.max(0, Math.round(rect.left)), top: Math.max(60, Math.round(rect.top - 24)) })
  }, [open, variant])
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
  if (variant === "card") {
    return (
      <div className="fixed inset-0 z-[100]" onClick={onClose}>
        <div
          style={{ left: anchor.left, top: anchor.top }}
          className="absolute max-h-[calc(100vh-80px)] w-[310px] overflow-y-auto bg-white px-[20px] pb-[10px] pt-[20px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex h-[30px] items-center justify-between">
            <h2 className="text-[15px] font-normal text-[#777]">{t(title)}</h2>
            <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#555]">
              <XCircle className="h-6 w-6" strokeWidth={1.5} />
            </button>
          </div>
          <div className="mt-[10px] grid gap-[22px]">
            {!hideDate && (
              <div className="relative">
                <span className="text-[10px] font-semibold text-black">{t(dateLabel)}</span>
                <button type="button" onClick={() => setPickerOpen((value) => !value)} className="flex h-[34px] w-full items-center justify-between border-b border-[#d5dae1] text-left text-[13px] text-black">
                  <span>{rangeLabel(draft.from)} – {rangeLabel(draft.to)}</span>
                  <CalendarDays className="h-4 w-4 text-[#bdbdbd]" />
                </button>
                {pickerOpen && (
                  <DateRangePicker begin={draft.from} end={draft.to} onClose={() => setPickerOpen(false)} onApply={(begin, end) => { setDraft({ from: begin, to: end }); setPickerOpen(false) }} />
                )}
              </div>
            )}
            <FilterCardContext.Provider value>{children}</FilterCardContext.Provider>
          </div>
          <button
            type="button"
            onClick={apply}
            disabled={!draft.from || !draft.to}
            className="mt-[22px] h-9 rounded-[3px] bg-[#5d6474] px-[16px] text-[13px] font-semibold uppercase text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] disabled:opacity-50"
          >
            {t("Применить")}
          </button>
        </div>
      </div>
    )
  }
  // Reference look: a full-width panel dropping from the top (30px side gutters) over a light overlay, ⊗ to close,
  // stacked fields and a full-width green "Применить".
  return (
    <div className="fixed inset-x-0 bottom-0 top-[50px] z-[100] overflow-y-auto bg-black/10" onClick={onClose}>
      <div className={`mx-[30px] ${columns === 4 ? "mt-[80px]" : "mt-[117px]"} bg-white p-[30px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]`} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-[13px] font-semibold text-[#333]">{t(title)}</h2>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#333]">
            <XCircle className="h-6 w-6" />
          </button>
        </div>
        <div className={columns === 4 ? "mt-[10px] grid grid-cols-1 gap-x-[22px] gap-y-[12px] md:grid-cols-4" : "mt-[10px] grid grid-cols-1 gap-[22px]"}>
          <div className="relative flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-black">{t(dateLabel)}</span>
            <button
              type="button"
              onClick={() => setPickerOpen((value) => !value)}
              className={`flex h-9 ${columns === 4 ? "w-full" : "w-[256px]"} items-center justify-between border-b border-[#dbe0e8] text-left text-[13px] text-[#17233b]`}
            >
              <span>
                {rangeLabel(draft.from)} – {rangeLabel(draft.to)}
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
          {columns === 4 ? <FilterCardContext.Provider value>{children}</FilterCardContext.Provider> : children}
        </div>
        <button
          type="button"
          onClick={apply}
          disabled={!draft.from || !draft.to}
          className={`mt-[10px] h-9 w-full rounded-[3px] bg-[#71ce87] text-[13px] font-semibold text-white disabled:opacity-50 ${columns === 4 ? "" : "uppercase"}`}
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
  // moment "ru" "DD MMM YYYY" as the reference prints it ("01 июня 2026", not Intl's "июн.").
  return formatStatementDate(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, "ru", false)
}
