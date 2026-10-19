"use client"

import { useState, type ReactNode } from "react"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import { CashModal, PrimaryButton, inputClass } from "@/components/analytics/cash-management-shared"
import { MultiSelect } from "@/components/analytics/client-balance-filters"
import { withSelected, type StockOptions } from "@/components/analytics/stock-move-filters"
import type { PlanState } from "@/components/analytics/stock-plan-state"
import { useLanguage } from "@/lib/i18n/language-context"
import { PLAN_MOVE_TYPES, PLAN_TAB_TYPES, PLAN_TYPE_LABELS, isHistoryTab, isReceiveTab, type PlanOptionsResult, type PlanTaskTab } from "@/lib/stock-plan-types"

// Filter popups of "План приемок и передач":
// - task tabs (demo StockReceivesReceiveFilterForm / …TransferFilterForm):
//   Склад, Тип, Принял / Передал (history only), Дата приемки / Дата передачи;
// - "Движение товаров" (demo StockReceivesProductMoveFilterForm): Тип продукта,
//   Подкатегория, Тип, Товар, Склад, Период.
// The period is optional (the demo lists everything until one is chosen).

export type PlanFilterChanges = Record<string, string | string[] | null>

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  const { t } = useLanguage()
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${wide ? "md:col-span-2" : ""}`}>
      <span className="text-sm text-[#586174]">{t(label)}</span>
      {children}
    </div>
  )
}

function PeriodField({ label, from, to, onChange }: { label: string; from: string; to: string; onChange: (next: { from: string; to: string }) => void }) {
  return (
    <Field label={label} wide>
      <span className="flex items-center gap-2">
        <input type="date" value={from} onChange={(event) => onChange({ from: event.target.value, to })} className={inputClass} />
        <span className="text-[#586174]">—</span>
        <input type="date" value={to} onChange={(event) => onChange({ from, to: event.target.value })} className={inputClass} />
      </span>
    </Field>
  )
}

function FilterShell({ onClose, onApply, children }: { onClose: () => void; onApply: () => void; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <CashModal title={t("Фильтр")} onClose={onClose} size="md" footer={<PrimaryButton onClick={onApply}>{t("Применить")}</PrimaryButton>}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>
    </CashModal>
  )
}

const ordered = (from: string, to: string) => (from && to && from > to ? { from: to, to: from } : { from, to })

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
  const [period, setPeriod] = useState({ from: state.from, to: state.to })
  const receive = isReceiveTab(tab)
  const apply = () => {
    const dates = ordered(period.from, period.to)
    onApply({ stock: warehouses, type: type || null, acceptedBy: isHistoryTab(tab) ? doneBy : null, fromDate: dates.from || null, toDate: dates.to || null })
  }
  return (
    <FilterShell onClose={onClose} onApply={apply}>
      <Field label="Склад">
        <MultiSelect value={warehouses} options={withSelected(options.warehouses.map((warehouse) => warehouse.name), warehouses)} onChange={setWarehouses} />
      </Field>
      <Field label="Тип">
        <select value={type} onChange={(event) => setType(event.target.value)} className={inputClass}>
          <option value="">{t("Все")}</option>
          {PLAN_TAB_TYPES[tab].map((value) => (
            <option key={value} value={value}>
              {t(PLAN_TYPE_LABELS[value])}
            </option>
          ))}
        </select>
      </Field>
      {isHistoryTab(tab) && (
        <Field label={receive ? "Принял" : "Передал"} wide>
          <MultiSelect value={doneBy} options={withSelected(doneByOptions, doneBy)} onChange={setDoneBy} />
        </Field>
      )}
      <PeriodField label={receive ? "Дата приемки" : "Дата передачи"} from={period.from} to={period.to} onChange={setPeriod} />
    </FilterShell>
  )
}

export function PlanMoveFilterDialog({ state, options, onClose, onApply }: { state: PlanState; options: StockOptions; onClose: () => void; onApply: (changes: PlanFilterChanges) => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState({
    typeParents: state.typeParents,
    subcategories: state.subcategories,
    types: state.moveTypes,
    products: state.products,
    warehouses: state.warehouses,
  })
  const [period, setPeriod] = useState({ from: state.from, to: state.to })
  const productList = useCashJson<PlanOptionsResult>("/api/stock/plan/options").data?.products ?? []
  const known = new Set(productList.map((item) => item.key))
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const apply = () => {
    const dates = ordered(period.from, period.to)
    onApply({
      typeParent: draft.typeParents,
      typeChild: draft.subcategories,
      type: draft.types,
      product: draft.products,
      stock: draft.warehouses,
      fromDate: dates.from || null,
      toDate: dates.to || null,
    })
  }
  return (
    <FilterShell onClose={onClose} onApply={apply}>
      <Field label="Тип продукта">
        <MultiSelect value={draft.typeParents} options={withSelected(options.types, draft.typeParents)} onChange={(next) => set("typeParents", next)} />
      </Field>
      <Field label="Подкатегория">
        <MultiSelect value={draft.subcategories} options={withSelected(options.subcategories, draft.subcategories)} onChange={(next) => set("subcategories", next)} />
      </Field>
      <Field label="Тип">
        <MultiSelect value={draft.types} options={PLAN_MOVE_TYPES.map((type) => ({ value: type.id, label: t(type.label) }))} onChange={(next) => set("types", next)} />
      </Field>
      <Field label="Склад">
        <MultiSelect value={draft.warehouses} options={withSelected(options.warehouses.map((warehouse) => warehouse.name), draft.warehouses)} onChange={(next) => set("warehouses", next)} />
      </Field>
      <Field label="Товар" wide>
        <MultiSelect
          value={draft.products}
          options={[
            ...draft.products.filter((key) => !known.has(key)).map((key) => ({ value: key, label: key.replace(/^name:/, "") })),
            ...productList.map((item) => ({ value: item.key, label: item.name })),
          ]}
          onChange={(next) => set("products", next)}
        />
      </Field>
      <PeriodField label="Период" from={period.from} to={period.to} onChange={setPeriod} />
    </FilterShell>
  )
}
