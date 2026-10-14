"use client"

import { useState, type ReactNode } from "react"

import { BalanceFilterDialog } from "@/components/analytics/balance/filter-bar"
import { MultiSelect } from "@/components/analytics/client-balance-filters"
import { withSelected, type StockOptions } from "@/components/analytics/stock-move-filters"
import { isIsoDay, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import type { RecommendedUnit } from "@/lib/stock-recommended"
import { defaultRecommendedPeriod } from "@/lib/stock-recommended-calc"

// URL state and filter dialog of "Рекомендованный запас" (demo c138 module
// 4457 / 4458). Demo URL keys: beginDate endDate stock* division* typeParent*
// typeChild* brand* selectType=measurement|weight|capacity|box search ordering
// page pageSize. Default period: the 1st of the month two months back … the end
// of the current month.

export type ReorderState = {
  from: string
  to: string
  urlFrom: string
  urlTo: string
  warehouses: string[]
  divisions: string[]
  typeParents: string[]
  typeChildren: string[]
  brands: string[]
  unit: RecommendedUnit
  search: string
  ordering: string
  page: number
  pageSize: number
}

export const REORDER_PAGE_SIZES = [10, 25, 50, 100, 200, 500] as const

export const REORDER_UNITS: Array<{ id: RecommendedUnit; label: string }> = [
  { id: "measurement", label: "Количество" },
  { id: "box", label: "Блок" },
  { id: "weight", label: "Вес" },
  { id: "capacity", label: "Объем" },
]

function values(params: URLSearchParams, name: string): string[] {
  return [...new Set(params.getAll(name).map((value) => value.trim()).filter(Boolean))]
}

export function reorderStateFromParams(params: URLSearchParams): ReorderState {
  const urlFrom = isIsoDay(params.get("beginDate")) ? (params.get("beginDate") as string) : ""
  const urlTo = isIsoDay(params.get("endDate")) ? (params.get("endDate") as string) : ""
  const fallback = defaultRecommendedPeriod(todayIso())
  const periodFrom = urlFrom || fallback.from
  const periodTo = urlTo || fallback.to
  const [from, to] = periodFrom <= periodTo ? [periodFrom, periodTo] : [periodTo, periodFrom]
  const unitRaw = params.get("selectType") ?? ""
  const unit = (REORDER_UNITS.some((item) => item.id === unitRaw) ? unitRaw : "measurement") as RecommendedUnit
  const size = Number(params.get("pageSize"))
  const page = Math.floor(Number(params.get("page")))
  return {
    from,
    to,
    urlFrom,
    urlTo,
    warehouses: values(params, "stock"),
    divisions: values(params, "division"),
    typeParents: values(params, "typeParent"),
    typeChildren: values(params, "typeChild"),
    brands: values(params, "brand"),
    unit,
    search: (params.get("search") ?? "").trim(),
    ordering: (params.get("ordering") ?? "").trim() || "-sold",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: (REORDER_PAGE_SIZES as readonly number[]).includes(size) ? size : 25,
  }
}

/** /api/stock/recommended query of the state (+ extra params). */
export function reorderApiQuery(state: ReorderState, extra: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams()
  params.set("from", state.from)
  params.set("to", state.to)
  state.warehouses.forEach((value) => params.append("warehouse", value))
  state.divisions.forEach((value) => params.append("organization", value))
  state.typeParents.forEach((value) => params.append("type", value))
  state.typeChildren.forEach((value) => params.append("subcategory", value))
  state.brands.forEach((value) => params.append("brand", value))
  if (state.search) params.set("search", state.search)
  if (state.unit !== "measurement") params.set("unit", state.unit)
  params.set("ordering", state.ordering)
  for (const [name, value] of Object.entries(extra)) if (value !== undefined && value !== "") params.set(name, String(value))
  return params.toString()
}

export type ReorderDraft = Pick<ReorderState, "warehouses" | "divisions" | "typeParents" | "typeChildren" | "brands">

function Field({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-[#586174]">{t(label)}</span>
      {children}
    </div>
  )
}

export function ReorderFilterDialog({
  open,
  onClose,
  state,
  options,
  optionsError,
  onApply,
}: {
  open: boolean
  onClose: () => void
  state: ReorderState
  options: StockOptions
  optionsError: string
  onApply: (period: { from: string; to: string }, draft: ReorderDraft) => void
}) {
  const { t } = useLanguage()
  const fromState = (): ReorderDraft => ({ warehouses: state.warehouses, divisions: state.divisions, typeParents: state.typeParents, typeChildren: state.typeChildren, brands: state.brands })
  const [draft, setDraft] = useState<ReorderDraft>(fromState)
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) setDraft(fromState())
  }
  const set = <K extends keyof ReorderDraft>(key: K, value: ReorderDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  return (
    <BalanceFilterDialog open={open} onClose={onClose} from={state.from} to={state.to} onApply={(period) => onApply(period, draft)}>
      {optionsError && <p className="text-sm text-[#e57373] md:col-span-2">{t("Не удалось загрузить списки фильтра")}: {t(optionsError)}</p>}
      <Field label="Склад">
        <MultiSelect value={draft.warehouses} options={withSelected(options.warehouses.map((warehouse) => warehouse.name), draft.warehouses)} onChange={(next) => set("warehouses", next)} />
      </Field>
      <Field label="Организация">
        <MultiSelect value={draft.divisions} options={withSelected(options.organizations, draft.divisions)} onChange={(next) => set("divisions", next)} />
      </Field>
      <Field label="Тип продукта">
        <MultiSelect value={draft.typeParents} options={withSelected(options.types, draft.typeParents)} onChange={(next) => set("typeParents", next)} />
      </Field>
      <Field label="Подкатегория">
        <MultiSelect value={draft.typeChildren} options={withSelected(options.subcategories, draft.typeChildren)} onChange={(next) => set("typeChildren", next)} />
      </Field>
      <Field label="По брендам">
        <MultiSelect value={draft.brands} options={withSelected(options.brands, draft.brands)} onChange={(next) => set("brands", next)} />
      </Field>
    </BalanceFilterDialog>
  )
}
