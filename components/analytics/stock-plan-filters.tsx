"use client"

import { useState } from "react"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import { RefSearchSelect, type RefSelectItem } from "@/components/analytics/ref-search-select"
import { withSelected, type StockOptions } from "@/components/analytics/stock-move-filters"
import type { PlanState } from "@/components/analytics/stock-plan-state"
import { FilterDate, RefFilterPanel } from "@/components/ref/list-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  PLAN_MOVE_DIRECTIONS,
  PLAN_MOVE_FILTER_TYPES,
  PLAN_TAB_TYPES,
  PLAN_TYPE_LABELS,
  isHistoryTab,
  isReceiveTab,
  type PlanOptionsResult,
  type PlanTaskTab,
} from "@/lib/stock-plan-types"

// Filter panels of "План приемок и передач" (the left-hand "Фильтр" panel of the reference):
// - task tabs (demo StockReceivesReceiveFilterForm / …TransferFilterForm):
//   Склад, Тип, Принял / Передал (history only), Дата приемки / Дата передачи;
// - "Движение товаров" (demo StockReceivesProductMoveFilterForm): Тип продукта, Тип,
//   Товар, Склад, Статус (Приход / Расход), Период.
// The date range is pre-filled with the current month and sent with "Применить",
// like the reference (without it the list shows everything).

export type PlanFilterChanges = Record<string, string | string[] | null>

const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

function currentMonth() {
  const now = new Date()
  return { from: day(new Date(now.getFullYear(), now.getMonth(), 1)), to: day(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
}

const ordered = (from: string, to: string) => (from && to && from > to ? { from: to, to: from } : { from, to })

const items = (values: string[]): RefSelectItem[] => values.map((value) => ({ value, label: value }))
const picked = (values: string[]): RefSelectItem[] => values.map((value) => ({ value, label: value }))

function MultiField({ label, options, value, onChange }: { label: string; options: string[]; value: string[]; onChange: (next: string[]) => void }) {
  const { t } = useLanguage()
  return (
    <RefSearchSelect
      multi
      searchable={false}
      rowHeight={32}
      label={t(label)}
      items={items(withSelected(options, value).map((option) => option.value))}
      selected={picked(value)}
      onChange={(next) => onChange(next.map((item) => item.value))}
    />
  )
}

/** Mounted only while open: the draft is seeded from the applied state. */
export function PlanTaskFilterDialog({
  tab,
  state,
  options,
  doneByOptions,
  onClose,
  onApply,
}: {
  tab: PlanTaskTab
  state: PlanState
  options: StockOptions
  doneByOptions: string[]
  onClose: () => void
  onApply: (changes: PlanFilterChanges) => void
}) {
  const { t } = useLanguage()
  const [warehouses, setWarehouses] = useState(state.warehouses)
  const [type, setType] = useState(state.type)
  const [doneBy, setDoneBy] = useState(state.doneBy)
  const month = currentMonth()
  const [period, setPeriod] = useState({ from: state.from || month.from, to: state.to || month.to })
  const receive = isReceiveTab(tab)
  const apply = () => {
    const dates = ordered(period.from, period.to)
    onApply({ stock: warehouses, type: type || null, acceptedBy: isHistoryTab(tab) ? doneBy : null, fromDate: dates.from || null, toDate: dates.to || null })
  }
  const typeItems = PLAN_TAB_TYPES[tab].map((value) => ({ value, label: t(PLAN_TYPE_LABELS[value]) }))
  return (
    <RefFilterPanel narrow onClose={onClose} onApply={apply} applyClassName="mt-[15px]">
      <MultiField label="Склад" options={options.warehouses.map((warehouse) => warehouse.name)} value={warehouses} onChange={setWarehouses} />
      <RefSearchSelect
        label={t("Тип")}
        searchable={false}
        rowHeight={32}
        items={typeItems}
        selected={typeItems.filter((item) => item.value === type)}
        onChange={(next) => setType(next[0]?.value ?? "")}
      />
      {isHistoryTab(tab) && <MultiField label={receive ? "Принял" : "Передал"} options={doneByOptions} value={doneBy} onChange={setDoneBy} />}
      <FilterDate words className="-mt-[9px]" label={t(receive ? "Дата приемки" : "Дата передачи")} begin={period.from} end={period.to} onChange={(from, to) => setPeriod({ from, to })} />
    </RefFilterPanel>
  )
}

export function PlanMoveFilterDialog({ state, options, onClose, onApply }: { state: PlanState; options: StockOptions; onClose: () => void; onApply: (changes: PlanFilterChanges) => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState({
    typeParents: state.typeParents,
    types: state.moveTypes,
    products: state.products,
    warehouses: state.warehouses,
    direction: state.direction,
  })
  const month = currentMonth()
  const [period, setPeriod] = useState({ from: state.from || month.from, to: state.to || month.to })
  const productList = useCashJson<PlanOptionsResult>("/api/stock/plan/options").data?.products ?? []
  const known = new Set(productList.map((item) => item.key))
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const apply = () => {
    const dates = ordered(period.from, period.to)
    onApply({
      typeParent: draft.typeParents,
      type: draft.types,
      product: draft.products,
      stock: draft.warehouses,
      direction: draft.direction || null,
      fromDate: dates.from || null,
      toDate: dates.to || null,
    })
  }
  const typeItems = PLAN_MOVE_FILTER_TYPES.map((type) => ({ value: type.id, label: t(type.label) }))
  const productItems: RefSelectItem[] = [
    ...draft.products.filter((key) => !known.has(key)).map((key) => ({ value: key, label: key.replace(/^name:/, "") })),
    ...productList.map((item) => ({ value: item.key, label: item.name })),
  ]
  const directionItems = PLAN_MOVE_DIRECTIONS.map((direction) => ({ value: direction.id, label: t(direction.label) }))
  return (
    <RefFilterPanel narrow onClose={onClose} onApply={apply} applyClassName="mt-[15px]">
      <MultiField label="Тип продукта" options={options.types} value={draft.typeParents} onChange={(next) => set("typeParents", next)} />
      <RefSearchSelect
        multi
        searchable={false}
        rowHeight={32}
        label={t("Тип")}
        items={typeItems}
        selected={typeItems.filter((item) => draft.types.includes(item.value))}
        onChange={(next) => set("types", next.map((item) => item.value))}
      />
      <RefSearchSelect
        multi
        label={t("Товар")}
        rowHeight={32}
        items={productItems}
        selected={productItems.filter((item) => draft.products.includes(item.value))}
        onChange={(next) => set("products", next.map((item) => item.value))}
      />
      <MultiField label="Склад" options={options.warehouses.map((warehouse) => warehouse.name)} value={draft.warehouses} onChange={(next) => set("warehouses", next)} />
      <RefSearchSelect
        searchable={false}
        rowHeight={32}
        label={t("Статус")}
        items={directionItems}
        selected={directionItems.filter((item) => item.value === draft.direction)}
        onChange={(next) => set("direction", next[0]?.value ?? "")}
      />
      <FilterDate words className="-mt-[9px]" label={t("Период")} begin={period.from} end={period.to} onChange={(from, to) => setPeriod({ from, to })} />
    </RefFilterPanel>
  )
}
