"use client"

import { X } from "lucide-react"
import { useEffect, useState } from "react"

import { ReportCalendar, formatReportDate } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"

import { SelectBox } from "./order-filter-panel"
import type { PromoType } from "./promo-form"

export type PromoFilters = {
  select: Record<string, string[]>
  entered: string
  start: string
  end: string
}

export const EMPTY_PROMO_FILTERS: PromoFilters = { select: {}, entered: "", start: "", end: "" }

const SELECT_FIELDS = [
  { key: "type", label: "Тип акции" },
  { key: "priceList", label: "Прайс-лист" },
  { key: "activity", label: "Для деятельности" },
  { key: "organization", label: "Организация" },
  { key: "branch", label: "Филиалы" },
  { key: "purchaseProduct", label: "Товары для закупа" },
  { key: "giftProduct", label: "Товары в подарок" },
]

const DATE_FIELDS = [
  { key: "entered", label: "Дата ввода" },
  { key: "start", label: "Дата начала" },
  { key: "end", label: "Дата завершения" },
] as const

const REFERENCE_ENDPOINTS: Record<string, string> = {
  priceList: "price-lists",
  organization: "organizations",
  branch: "branches",
  purchaseProduct: "products",
  giftProduct: "products",
}

/** "Тип акции": the promotion types the promotion form offers (components/orders/promo-form.tsx),
 * compared with the translated type of a stored promotion. Every other list comes from this
 * company's own data only (Прайс-листы, Организации, Филиалы, Продукты); an empty directory gives an
 * empty list ("Не найдено"), never another company's sample names. */
const PROMO_TYPES: readonly PromoType[] = ["Скидка", "Бонус", "Надбавка", "Балл", "Кэшбэк"]

/** The fields a stored promotion can be filtered by (marketing-campaigns-view.tsx applies them): it keeps
 * name / start / end / type / active and the form's settings (lib/ref-records-repo.ts promoCreate), but no
 * price list, organization, branch, products, activity or entry date. Those fields stay in the reference's
 * layout, disabled and explained, so they never look applied while they change nothing. */
const APPLIED_SELECT = new Set(["type"])
const APPLIED_DATES = new Set<string>(["start", "end"])

export function countPromoFilters(filters: PromoFilters) {
  const selects = Object.entries(filters.select).filter(([key, values]) => APPLIED_SELECT.has(key) && values.length > 0).length
  return selects + DATE_FIELDS.filter((field) => APPLIED_DATES.has(field.key) && filters[field.key]).length
}

/** A filter the promotions cannot be matched by yet: same place and size, greyed out, not focusable. */
function Unavailable({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage()
  return (
    <div title={t("Акции не хранят это поле, фильтр по нему недоступен")} aria-disabled className="cursor-not-allowed">
      <div inert className="opacity-40">
        {children}
      </div>
    </div>
  )
}

function SingleDate({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { t, language } = useLanguage()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative h-[52px] cursor-pointer border-b border-[#e0e0e0]" onClick={() => setOpen(true)}>
      <span className="absolute left-0 top-0 text-[10px] font-bold leading-3">{t(label)}</span>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-[56px] top-0 h-3.5 w-3.5 fill-[#c4c4c4]" aria-hidden>
        <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z" />
      </svg>
      <span className="absolute inset-x-0 bottom-[6px] text-[14px] leading-5 text-black">{value ? formatReportDate(value, language) : t("Укажите дату")}</span>
      {value && (
        <button type="button" aria-label="clear" onClick={(event) => { event.stopPropagation(); onChange("") }} className="absolute bottom-[6px] right-0 text-[18px] leading-none text-[#999]">×</button>
      )}
      {open && (
        <ReportCalendar
          value={value || new Date().toISOString().slice(0, 10)}
          onCancel={() => setOpen(false)}
          onPick={(picked) => {
            onChange(picked)
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}

export function PromoFilterDrawer({ filters, onChange, onApply, onClose }: { filters: PromoFilters; onChange: (filters: PromoFilters) => void; onApply: () => void; onClose: () => void }) {
  const { t } = useLanguage()
  const [reference, setReference] = useState<Record<string, string[]>>({})

  useEffect(() => {
    let cancelled = false
    Promise.all(
      Array.from(new Set(Object.values(REFERENCE_ENDPOINTS))).map((endpoint) =>
        fetch(`/api/${endpoint}`)
          .then((response) => (response.ok ? response.json() : []))
          .then((items: Array<{ name?: string }>) => [endpoint, Array.isArray(items) ? Array.from(new Set(items.map((item) => item.name ?? "").filter(Boolean))).sort((a, b) => a.localeCompare(b)) : []] as const)
          .catch(() => [endpoint, []] as const),
      ),
    ).then((entries) => {
      if (!cancelled) setReference(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [])

  const optionsFor = (key: string): string[] => {
    if (key === "type") return PROMO_TYPES.map((type) => t(type))
    const endpoint = REFERENCE_ENDPOINTS[key]
    return endpoint ? (reference[endpoint] ?? []) : []
  }

  return (
    <>
      <button type="button" aria-label={t("Закрыть")} className="fixed inset-0 z-30 cursor-default" onClick={onClose} />
      <aside className="fixed bottom-0 left-[30px] top-[56px] z-40 w-[310px] overflow-y-auto bg-white px-[20px] pb-[20px] pt-[10px] shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-normal text-[#757575]">{t("Фильтр")}</h3>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#999] hover:text-[#666]">
            <X className="h-6 w-6 rounded-full border-2 border-current p-[2px]" />
          </button>
        </div>
        <div className="mt-[34px] flex flex-col gap-[20px]">
          {SELECT_FIELDS.map((field) => {
            const box = (
              <SelectBox
                key={field.key}
                label={t(field.label)}
                value={APPLIED_SELECT.has(field.key) ? (filters.select[field.key] ?? []) : []}
                options={optionsFor(field.key)}
                onChange={(value) => onChange({ ...filters, select: { ...filters.select, [field.key]: value } })}
              />
            )
            return APPLIED_SELECT.has(field.key) ? box : <Unavailable key={field.key}>{box}</Unavailable>
          })}
          {DATE_FIELDS.map((field) => {
            const box = <SingleDate key={field.key} label={field.label} value={APPLIED_DATES.has(field.key) ? filters[field.key] : ""} onChange={(value) => onChange({ ...filters, [field.key]: value })} />
            return APPLIED_DATES.has(field.key) ? box : <Unavailable key={field.key}>{box}</Unavailable>
          })}
        </div>
        <div className="mt-[10px] flex gap-3">
          <button type="button" onClick={onApply} className="h-[53px] rounded-[3px] bg-[#5d6474] px-[24px] text-[16px] font-normal uppercase text-white shadow-[0_1px_3px_rgba(0,0,0,0.3)] hover:brightness-110">
            {t("Применить")}
          </button>
          {countPromoFilters(filters) > 0 && (
            <button type="button" onClick={() => onChange(EMPTY_PROMO_FILTERS)} className="h-[53px] rounded-[3px] border border-[#e0e0e0] bg-white px-[16px] text-[13px] font-medium uppercase text-[#5d6474] hover:bg-[#f2f5f8]">
              {t("Сбросить")}
            </button>
          )}
        </div>
      </aside>
    </>
  )
}
