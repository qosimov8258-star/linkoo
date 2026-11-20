"use client"

import { useEffect, useMemo, useState } from "react"

import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { RefFilterPanel } from "@/components/ref/list-kit"
import { todayIso } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"

import { KitMultiSelect, KitSingleSelect, type KitOption } from "./field-filter-kit"

// «Маркетинговые акции» → «Показать фильтр» (Linko's PricesFilterForm, 310px over the toolbar): Тип акции, Прайс-лист,
// Действует для, Организация, Филиалы, Товары для закупа, Товары в подарок, Дата создания, Дата начала, Дата
// завершения, «Применить». The values live in the URL with Linko's names (type, priceList, promotionType, division,
// branch, conditionProducts, bonusProducts: ids joined with "-"; fromDate/toDate, fromDate1/toDate1,
// fromDate2/toDate2: days). marketing-campaigns-view.tsx applies them to the copied promotion documents.

export type PromoFilters = {
  type: string[]
  priceList: string
  promotionType: string[]
  division: string[]
  branch: string[]
  conditionProducts: string[]
  bonusProducts: string[]
  fromDate: string
  toDate: string
  fromDate1: string
  toDate1: string
  fromDate2: string
  toDate2: string
}

const LIST_KEYS = ["type", "promotionType", "division", "branch", "conditionProducts", "bonusProducts"] as const
const TEXT_KEYS = ["priceList", "fromDate", "toDate", "fromDate1", "toDate1", "fromDate2", "toDate2"] as const
export const PROMO_FILTER_PARAMS: readonly string[] = [...LIST_KEYS, ...TEXT_KEYS]

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The filter of a URL query (unknown values dropped). */
export function readPromoFilters(query: Record<string, string>): PromoFilters {
  const list = (key: string) => (query[key] ?? "").split("-").filter((item) => /^[a-z_]+$|^\d+$/.test(item))
  const day = (key: string) => (DAY.test(query[key] ?? "") ? query[key] : "")
  return {
    type: list("type"),
    priceList: /^\d+$/.test(query.priceList ?? "") ? query.priceList : "",
    promotionType: list("promotionType"),
    division: list("division"),
    branch: list("branch"),
    conditionProducts: list("conditionProducts"),
    bonusProducts: list("bonusProducts"),
    fromDate: day("fromDate"),
    toDate: day("toDate"),
    fromDate1: day("fromDate1"),
    toDate1: day("toDate1"),
    fromDate2: day("fromDate2"),
    toDate2: day("toDate2"),
  }
}

/** The URL query of a filter (empty values drop their parameter). */
export function promoFilterQuery(filters: PromoFilters): Record<string, string | null> {
  const query: Record<string, string | null> = {}
  for (const key of LIST_KEYS) query[key] = filters[key].length ? filters[key].join("-") : null
  for (const key of TEXT_KEYS) query[key] = filters[key] || null
  return query
}

/** Linko's «Фильтр: N элемента»: the fields in use, a period counted once. */
export function countPromoFilters(filters: PromoFilters): number {
  return (
    LIST_KEYS.filter((key) => filters[key].length > 0).length +
    (filters.priceList ? 1 : 0) +
    (filters.fromDate || filters.toDate ? 1 : 0) +
    (filters.fromDate1 || filters.toDate1 ? 1 : 0) +
    (filters.fromDate2 || filters.toDate2 ? 1 : 0)
  )
}

/** Linko's «Тип акции» items (its filter names the discount and bonus types «Скидочная» / «Бонусная»). */
export const PROMO_TYPE_ITEMS: readonly { id: string; name: string }[] = [
  { id: "discount", name: "Скидочная" },
  { id: "bonus", name: "Бонусная" },
  { id: "addup", name: "Надбавка" },
  { id: "ball", name: "Балл" },
  { id: "cash_back", name: "Кэшбек" },
]

/** Linko's «Действует для» items (promotion_type). */
export const PROMO_AUDIENCE_ITEMS: readonly { id: string; name: string }[] = [
  { id: "promotion_all", name: "Для всех" },
  { id: "promotion_one", name: "Выбранным клиентам" },
  { id: "promotion_agents", name: "Выбранным агентам" },
  { id: "promotion_branches", name: "Выбранным филиалам" },
  { id: "promotion_market_types", name: "Выбранным типам клиентов" },
  { id: "promotion_borders", name: "Выбранным зонам" },
]

type Named = { id?: number | string; name?: string }

const named = (rows: unknown): KitOption[] =>
  (Array.isArray(rows) ? (rows as Named[]) : [])
    .filter((row) => row.id !== undefined && row.id !== null && row.name)
    .map((row) => ({ value: String(row.id), label: String(row.name) }))

/** This company's directories the filter offers (Прайс-листы, Организации, Филиалы, Продукты). */
export function usePromoFilterOptions(enabled: boolean) {
  const [lists, setLists] = useState<{ priceLists: KitOption[]; divisions: KitOption[]; branches: KitOption[]; products: KitOption[] } | null>(null)
  useEffect(() => {
    if (!enabled || lists) return
    let cancelled = false
    const load = (url: string) =>
      fetch(url, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : []))
        .catch(() => [])
    void Promise.all([load("/api/price-lists"), load("/api/organizations"), load("/api/branches"), load("/api/products")]).then(([priceLists, divisions, branches, products]) => {
      if (!cancelled) setLists({ priceLists: named(priceLists), divisions: named(divisions), branches: named(branches), products: named(products) })
    })
    return () => {
      cancelled = true
    }
  }, [enabled, lists])
  return lists
}

export function PromoFilterDrawer({ initial, onApply, onClose }: { initial: PromoFilters; onApply: (filters: PromoFilters) => void; onClose: () => void }) {
  const { t } = useLanguage()
  const [filters, setFilters] = useState<PromoFilters>(initial)
  const lists = usePromoFilterOptions(true)
  const typeOptions = useMemo(() => PROMO_TYPE_ITEMS.map((item) => ({ value: item.id, label: t(item.name) })), [t])
  const audienceOptions = useMemo(() => PROMO_AUDIENCE_ITEMS.map((item) => ({ value: item.id, label: t(item.name) })), [t])
  const set = (patch: Partial<PromoFilters>) => setFilters((current) => ({ ...current, ...patch }))

  return (
    <RefFilterPanel narrow applyClassName="mt-[3px]" onClose={onClose} onApply={() => onApply(filters)}>
      <div className="flow-root h-[62px]">
        <KitMultiSelect label="Тип акции" options={typeOptions} value={filters.type} onChange={(type) => set({ type })} />
      </div>
      <div className="flow-root h-[62px]">
        <KitSingleSelect label="Прайс-лист" options={lists?.priceLists ?? []} value={filters.priceList} onChange={(priceList) => set({ priceList })} />
      </div>
      <div className="flow-root h-[62px]">
        <KitMultiSelect label="Действует для" options={audienceOptions} value={filters.promotionType} onChange={(promotionType) => set({ promotionType })} />
      </div>
      <div className="flow-root h-[62px]">
        <KitMultiSelect label="Организация" options={lists?.divisions ?? []} value={filters.division} onChange={(division) => set({ division })} />
      </div>
      <div className="flow-root h-[62px]">
        <KitMultiSelect label="Филиалы" options={lists?.branches ?? []} value={filters.branch} onChange={(branch) => set({ branch })} />
      </div>
      <div className="flow-root h-[62px]">
        <KitMultiSelect label="Товары для закупа" options={lists?.products ?? []} value={filters.conditionProducts} onChange={(conditionProducts) => set({ conditionProducts })} />
      </div>
      <div className="flow-root h-[62px]">
        <KitMultiSelect label="Товары в подарок" options={lists?.products ?? []} value={filters.bonusProducts} onChange={(bonusProducts) => set({ bonusProducts })} />
      </div>
      <PeriodField label="Дата создания" begin={filters.fromDate} end={filters.toDate} onChange={(fromDate, toDate) => set({ fromDate, toDate })} />
      <PeriodField label="Дата начала" begin={filters.fromDate1} end={filters.toDate1} onChange={(fromDate1, toDate1) => set({ fromDate1, toDate1 })} />
      <PeriodField label="Дата завершения" begin={filters.fromDate2} end={filters.toDate2} onChange={(fromDate2, toDate2) => set({ fromDate2, toDate2 })} />
    </RefFilterPanel>
  )
}

/** Linko's period field of this filter (67px): the small bold label, "Укажите дату" or the period 30px below it with the
 * calendar on the right, the hairline; a click opens the range picker, × clears it. */
function PeriodField({ label, begin, end, onChange }: { label: string; begin: string; end: string; onChange: (begin: string, end: string) => void }) {
  const { t, language } = useLanguage()
  const [open, setOpen] = useState(false)
  const today = todayIso()
  const text = !begin ? t("Укажите дату") : !end || end === begin ? formatDateText(begin, language) : `${formatDateText(begin, language)} - ${formatDateText(end, language)}`
  return (
    <div className="relative h-[67px]">
      <button type="button" aria-label={t(label)} onClick={() => setOpen((state) => !state)} className="absolute inset-0 text-left">
        <span className="absolute left-0 top-[12px] text-[10px] font-bold leading-3 text-black">{t(label)}</span>
        <span className="absolute left-0 right-[48px] top-[40px] truncate text-[13px] leading-5 text-black">{text}</span>
        <svg viewBox="0 0 24 24" className="absolute right-[1px] top-[41px] h-[18px] w-[18px] fill-[#999]" aria-hidden>
          <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z" />
        </svg>
        <span className="absolute inset-x-0 top-[62px] h-px bg-[#e0e0e0]" />
      </button>
      {begin && (
        <button type="button" aria-label={t("Очистить")} onClick={() => onChange("", "")} className="absolute right-[24px] top-[40px] flex h-5 w-5 items-center justify-center text-[17px] leading-none text-[#999] hover:text-[#333]">
          ×
        </button>
      )}
      {open && (
        <DateRangePicker
          begin={begin || today}
          end={end || begin || today}
          positionClassName="left-0 top-[calc(100%+6px)]"
          onClose={() => setOpen(false)}
          onApply={(from, to) => {
            onChange(from, to)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
