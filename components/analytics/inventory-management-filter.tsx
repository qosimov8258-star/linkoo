"use client"

import { useEffect, useState } from "react"
import { ChevronDown, Pencil, X } from "lucide-react"

import { buildCashQuery, useCashJson } from "@/components/analytics/cash/use-cash"
import { FormField, MultiPick, SearchSelect, inputClass, useJsonList, type PickOption } from "@/components/analytics/cash-management-shared"
import { filterCount, filterGroup, type InventoryFilters } from "@/components/analytics/inventory-management-shared"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  INVENTORY_REQUEST_TYPES,
  INVENTORY_REQUEST_TYPE_LABELS,
  type InventoryItemListResult,
  type InventoryOptions,
  type InventoryStatusParam,
} from "@/lib/inventory-items-types"

// Demo InventoryManagementFilterForm (module 4398): "Показать фильтр" → 310 px
// popup whose fields depend on the tab; once applied "Фильтр: N элемента" with
// edit and clear. Items: Дата прикрепления, Тип клиента, Клиент, Организация,
// Филиалы, Тип инвентаря, Склад, Пользователи, Статус одобрено, Показать
// удаленные (+ Агент and Зона of the client). History: Дата создания, Дата
// движения, Инвентарь, Тип (Передача / Изъятие), Создал. Requests: Дата запроса,
// Дата обработки, Тип, Запросил, Обработал, Тип инвентаря, Клиент.

type Range = { from: keyof InventoryFilters; to: keyof InventoryFilters }

export function InventoryFilterBar({
  status,
  filters,
  options,
  open,
  onOpen,
  onClose,
  onClear,
  onApply,
}: {
  status: InventoryStatusParam
  filters: InventoryFilters
  options: InventoryOptions | null
  open: boolean
  onOpen: () => void
  onClose: () => void
  onClear: () => void
  onApply: (filters: InventoryFilters) => void
}) {
  const { t } = useLanguage()
  const count = filterCount(filters)
  return (
    <div className="relative">
      {count > 0 ? (
        <div className="flex items-center gap-2 rounded-md bg-[#efefef] px-4 py-1.5 text-[#666]">
          <span className="whitespace-nowrap">
            {t("Фильтр")}: {count} {t("элемента")}
          </span>
          <button type="button" onClick={onOpen} aria-label={t("Изменить фильтр")} title={t("Изменить фильтр")} className="border-l border-white pl-2 text-[#8f8f8f] hover:text-[#17233b]">
            <Pencil className="h-4 w-4" />
          </button>
          <button type="button" onClick={onClear} aria-label={t("Очистить фильтр")} title={t("Очистить фильтр")} className="border-l border-white pl-2 text-[#8f8f8f] hover:text-[#17233b]">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button type="button" onClick={open ? onClose : onOpen} className="flex items-center gap-1 whitespace-nowrap font-medium text-[rgb(79,113,220)]">
          {t("Показать фильтр")} <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
        </button>
      )}
      {open && <FilterPopup status={status} filters={filters} options={options} onClose={onClose} onApply={onApply} />}
    </div>
  )
}

function FilterPopup({
  status,
  filters,
  options,
  onClose,
  onApply,
}: {
  status: InventoryStatusParam
  filters: InventoryFilters
  options: InventoryOptions | null
  onClose: () => void
  onApply: (filters: InventoryFilters) => void
}) {
  const { t } = useLanguage()
  const [draft, setDraft] = useState<InventoryFilters>(filters)
  const group = filterGroup(status)
  const history = group === "history"
  const checks = group === "history_check"
  const requests = group === "request"
  const items = group === "items"
  const clients = useJsonList<{ id: number; name: string }>("/api/clients")
  const gear = useCashJson<InventoryItemListResult>(history || checks ? `/api/inventory-items?${buildCashQuery({ status: "all", showDeleted: "1", pageSize: 1000 })}` : null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const set = (patch: Partial<InventoryFilters>) => setDraft((current) => ({ ...current, ...patch }))
  const named = (values: string[]): PickOption[] => values.map((value) => ({ value, label: value }))
  const multi = (label: string, key: keyof InventoryFilters, list: PickOption[]) => (
    <MultiPick label={label} options={list} value={draft[key] as string[]} onChange={(value) => set({ [key]: value } as Partial<InventoryFilters>)} />
  )
  const range = (label: string, { from, to }: Range) => (
    <FormField label={label}>
      <span className="flex items-center gap-2">
        <input type="date" value={draft[from] as string} onChange={(event) => set({ [from]: event.target.value } as Partial<InventoryFilters>)} aria-label={t("С")} className={`${inputClass} px-2`} />
        <span>—</span>
        <input type="date" value={draft[to] as string} onChange={(event) => set({ [to]: event.target.value } as Partial<InventoryFilters>)} aria-label={t("По")} className={`${inputClass} px-2`} />
      </span>
    </FormField>
  )
  const clientOptions = clients.items.map((client) => ({ value: String(client.id), label: client.name }))
  const productOptions = (options?.products ?? []).map((product) => ({ value: String(product.id), label: product.name }))
  const gearOptions = (gear.data?.results ?? []).map((item) => ({ value: String(item.id), label: `${item.product.name} (№${item.stockNumber || item.id})` }))
  const users = named(options?.users ?? [])

  const apply = () => {
    const next = { ...draft }
    for (const [from, to] of [["attachFrom", "attachTo"], ["createdFrom", "createdTo"], ["moveFrom", "moveTo"], ["updatedFrom", "updatedTo"]] as const) {
      if (next[from] && next[to] && next[from] > next[to]) [next[from], next[to]] = [next[to], next[from]]
    }
    onApply(next)
  }

  return (
    <>
      <div className="fixed inset-0 z-[55]" onMouseDown={onClose} aria-hidden />
      <form
        className="absolute left-0 top-0 z-[60] max-h-[80vh] w-[min(310px,calc(100vw-2rem))] overflow-y-auto bg-white px-5 py-3 shadow-[0_2px_10px_rgba(0,0,0,0.2)]"
        onSubmit={(event) => {
          event.preventDefault()
          apply()
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[15px] text-[#5d6474]">{t("Фильтр")}</span>
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="text-[#8f8f8f] hover:text-[#17233b]">
            <X className="h-5 w-5" />
          </button>
        </div>
        {requests ? (
          <div className="flex flex-col gap-3">
            {range(t("Дата запроса"), { from: "createdFrom", to: "createdTo" })}
            {range(t("Дата обработки"), { from: "updatedFrom", to: "updatedTo" })}
            {multi(t("Тип"), "requestTypes", INVENTORY_REQUEST_TYPES.map((type) => ({ value: type, label: t(INVENTORY_REQUEST_TYPE_LABELS[type]) })))}
            {multi(t("Запросил"), "requestedBy", users)}
            {multi(t("Обработал"), "processedBy", users)}
            {multi(t("Тип инвентаря"), "products", productOptions)}
            {multi(t("Клиент"), "clients", clientOptions)}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {items && range(t("Дата прикрепления"), { from: "attachFrom", to: "attachTo" })}
            {(history || checks) && range(t("Дата создания"), { from: "createdFrom", to: "createdTo" })}
            {history && range(t("Дата движения"), { from: "moveFrom", to: "moveTo" })}
            {!checks && multi(t("Тип клиента"), "clientTypes", named(options?.clientTypes ?? []))}
            {multi(t("Клиент"), "clients", clientOptions)}
            {items && multi(t("Агент"), "agents", named(options?.agents ?? []))}
            {items && multi(t("Зона"), "zones", named(options?.zones ?? []))}
            {multi(t("Организация"), "organizations", named(options?.organizations ?? []))}
            {items && multi(t("Филиалы"), "branches", named(options?.branches ?? []))}
            {(history || checks) && multi(t("Инвентарь"), "gear", gearOptions)}
            {multi(t("Тип инвентаря"), "products", productOptions)}
            {history && (
              <FormField label={t("Тип")}>
                <SearchSelect
                  value={draft.logType}
                  options={[
                    { value: "give", label: t("Передача") },
                    { value: "take", label: t("Изъятие") },
                  ]}
                  placeholder={t("Все")}
                  onChange={(value) => set({ logType: value as InventoryFilters["logType"] })}
                />
              </FormField>
            )}
            {!checks && multi(t("Склад"), "warehouses", (options?.warehouses ?? []).map((row) => ({ value: row.name, label: row.name })))}
            {multi(history || checks ? t("Создал") : t("Пользователи"), "users", users)}
            {items && (
              <FormField label={t("Статус одобрено")}>
                <SearchSelect
                  value={draft.isReviewed}
                  options={[
                    { value: "true", label: t("Да") },
                    { value: "false", label: t("Нет") },
                  ]}
                  placeholder={t("Все")}
                  onChange={(value) => set({ isReviewed: value as InventoryFilters["isReviewed"] })}
                />
              </FormField>
            )}
            <label className="flex items-center gap-2 text-[14px] text-[#17233b]">
              <input type="checkbox" checked={draft.showDeleted} onChange={(event) => set({ showDeleted: event.target.checked })} className="h-4 w-4 accent-[#4f70e7]" />
              {t("Показать удаленные")}
            </label>
          </div>
        )}
        <button type="submit" className="mt-4 h-9 rounded-sm bg-[rgb(79,113,220)] px-5 text-[13px] font-semibold uppercase text-white shadow hover:brightness-95">
          {t("Применить")}
        </button>
      </form>
    </>
  )
}
