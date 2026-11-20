"use client"

import { useState } from "react"

import { RefFilterPanel } from "@/components/ref/list-kit"
import { LinkoMultiField, LinkoSingleField, type LinkoOption } from "@/components/ref/linko-select-fields"
import { useLanguage } from "@/lib/i18n/language-context"

import { SupplyDateField } from "./supplier-incomings-filter"
import { STATUS_LABEL } from "./supplier-return-card"
import type { ReturnStatus } from "./supplier-returns-data"
import { STATUS_PARAM, type ListFilter } from "./supplier-returns-url"

// The filter of «Возврат поставщиков» (Linko's ReturnFilterForm of #/provider-return): Филиалы, Поставщик, Склад, Товар,
// Организация (multi-search fields: several ids, joined by "-" in the address), Тип оплаты (one), Статус (Ожидает /
// Завершен / Отменен), Период передачи со склада and Дата создания. It edits a draft of the address's filter;
// «Применить» writes it to the address (Linko's filterBy), the X closes the panel and keeps the applied filter.

/** An option of a filter select: the id Linko writes in the address and the name the list shows. */
export type FilterOption = { id: string; name: string }

export type ReturnsFilterOptions = {
  branches: FilterOption[]
  suppliers: FilterOption[]
  warehouses: FilterOption[]
  products: FilterOption[]
  organizations: FilterOption[]
}

/** Linko's PaymentTypeSearchField. */
const PAYMENT_OPTIONS: LinkoOption[] = [
  { value: "bank", label: "Банковский счет" },
  { value: "cash", label: "Наличный" },
]

/** Linko's «Статус» items, in its order. */
const STATUS_ORDER: ReturnStatus[] = ["в процессе", "завершен", "отменен"]
const STATUS_BY_PARAM = new Map(STATUS_ORDER.map((status) => [STATUS_PARAM[status], status]))

const linko = (options: FilterOption[] | undefined): LinkoOption[] | null => (options ? options.map((option) => ({ value: option.id, label: option.name })) : null)

export function SupplierReturnsFilter({ initial, options, onApply, onClose }: { initial: ListFilter; options: ReturnsFilterOptions | null; onApply: (filter: ListFilter) => void; onClose: () => void }) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<ListFilter>(initial)
  const set = (patch: Partial<ListFilter>) => setDraft((current) => ({ ...current, ...patch }))
  const statusOptions = STATUS_ORDER.map((status) => ({ value: STATUS_PARAM[status], label: t(STATUS_LABEL[status]) }))
  return (
    <RefFilterPanel narrow applyClassName="mt-[15px]" onClose={onClose} onApply={() => onApply(draft)} className="!w-[310px] max-h-[calc(100vh-120px)] overflow-y-auto">
      <LinkoMultiField label={t("Филиалы")} options={linko(options?.branches)} value={draft.branch} onChange={(branch) => set({ branch })} />
      {/* Linko's supplier and product lists show their first 50 until a name is typed. */}
      <LinkoMultiField label={t("Поставщик")} options={linko(options?.suppliers)} limit={50} value={draft.provider} onChange={(provider) => set({ provider })} />
      <LinkoMultiField label={t("Склад")} options={linko(options?.warehouses)} value={draft.stock} onChange={(stock) => set({ stock })} />
      <LinkoMultiField label={t("Товар")} options={linko(options?.products)} limit={50} value={draft.product} onChange={(product) => set({ product })} />
      <LinkoMultiField label={t("Организация")} options={linko(options?.organizations)} value={draft.division} onChange={(division) => set({ division })} />
      <LinkoSingleField label={t("Тип оплаты")} options={PAYMENT_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))} value={draft.paymentType} onChange={(paymentType) => set({ paymentType })} />
      <LinkoMultiField
        label={t("Статус")}
        options={statusOptions}
        value={STATUS_ORDER.filter((status) => draft.statuses.includes(status)).map((status) => STATUS_PARAM[status])}
        onChange={(values) => set({ statuses: values.map((value) => STATUS_BY_PARAM.get(value)).filter((status): status is ReturnStatus => Boolean(status)) })}
      />
      <SupplyDateField label="Период передачи со склада" begin={draft.transferFrom} end={draft.transferTo} onChange={(transferFrom, transferTo) => set({ transferFrom, transferTo })} />
      <SupplyDateField label="Дата создания" begin={draft.createdFrom} end={draft.createdTo} onChange={(createdFrom, createdTo) => set({ createdFrom, createdTo })} />
    </RefFilterPanel>
  )
}
