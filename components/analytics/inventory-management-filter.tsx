"use client"

import { useEffect, useMemo, useState } from "react"

import { filterCount, filterGroup, type InventoryFilters } from "@/components/analytics/inventory-management-shared"
import { FilterCheck, FilterDate, RefAppliedFilter, RefFilterPanel } from "@/components/ref/list-kit"
import { LinkoMultiField, LinkoSingleField, type LinkoOption } from "@/components/ref/linko-select-fields"
import { useLanguage } from "@/lib/i18n/language-context"
import {
  INVENTORY_REQUEST_STATUSES,
  INVENTORY_REQUEST_STATUS_LABELS,
  INVENTORY_REQUEST_TYPES,
  INVENTORY_REQUEST_TYPE_LABELS,
  type InventoryItemListResult,
  type InventoryOptions,
  type InventoryStatusParam,
} from "@/lib/inventory-items-types"

// Linko's InventoryManagementFilterForm (#/inventory-management?openFilterDialog=true): «Показать фильтр ⌄» opens the
// 310 px «Фильтр» panel over the list's top-left corner; once applied the toolbar shows «Фильтр: N элемента» with edit
// and clear. Its fields depend on the tab, in Linko's order:
// - items: Тип клиента, (Подкатегория once a type is picked), Клиент, Организация, Филиалы, Тип инвентаря, Склад,
//   Пользователи, Статус одобрено, Показать удаленные (Linko's «Дата прикрепления» needs its API 160, the server
//   runs 147, so it is not shown);
// - История движений: Дата создания, Дата движения, Тип клиента, (Подкатегория), Клиент, Организация, Инвентарь,
//   Тип инвентаря, Тип (Передача / Изъятие), Склад, Создал, Показать удаленные;
// - История проверки: Дата создания, Клиент, Организация, Инвентарь, Тип инвентаря, Создал, Показать удаленные;
// - Запросы: Дата запроса, Дата обработки, Статус, Тип, Запросил, Обработал, Тип инвентаря, Клиент.
// Every select but Статус одобрено and Тип (single) takes several entries; the values are Linko's ids.

type Row = Record<string, unknown>

async function getRows(url: string): Promise<Row[]> {
  try {
    const response = await fetch(url, { cache: "no-store" })
    const body = (await response.json().catch(() => null)) as unknown
    return response.ok && Array.isArray(body) ? (body as Row[]) : []
  } catch {
    return []
  }
}

const toOptions = (rows: Row[], name: (row: Row) => string = (row) => String(row.name ?? "")) =>
  rows.filter((row) => row.id !== undefined && row.id !== null && name(row)).map((row) => ({ value: String(row.id), label: name(row) }))

type Directories = { clients: LinkoOption[]; organizations: LinkoOption[]; branches: LinkoOption[]; warehouses: LinkoOption[]; employees: LinkoOption[]; clientTypes: Array<LinkoOption & { parentId: number | null }> }

let directories: Promise<Directories> | null = null

/** The selects' lists, loaded the first time the panel opens and kept for the page. */
function useDirectories(): Directories | null {
  const [loaded, setLoaded] = useState<Directories | null>(null)
  useEffect(() => {
    let alive = true
    directories ??= Promise.all([
      getRows("/api/clients?balances=0"),
      getRows("/api/organizations"),
      getRows("/api/branches"),
      getRows("/api/warehouses"),
      getRows("/api/employees"),
      getRows("/api/client-types"),
    ]).then(([clients, organizations, branches, warehouses, employees, clientTypes]) => {
      // A failed load is tried again on the next opening.
      if (!clients.length || !employees.length) directories = null
      return {
        clients: toOptions(clients),
        organizations: toOptions(organizations),
        branches: toOptions(branches),
        // Linko's Склад select lists the warehouses newest first (saas/for_select m=Stock), as /api/warehouses does.
        warehouses: toOptions(warehouses),
        employees: toOptions(employees, (row) => `${String(row.firstName ?? "")} ${String(row.lastName ?? "")}`.trim() || String(row.name ?? "")),
        clientTypes: clientTypes
          .filter((row) => row.id !== undefined && row.name)
          .map((row) => ({ value: String(row.id), label: String(row.name), parentId: typeof row.parentId === "number" ? row.parentId : null })),
      }
    })
    void directories.then((value) => alive && setLoaded(value))
    return () => {
      alive = false
    }
  }, [])
  return loaded
}

/** The toolbar's left slot: «Показать фильтр ⌄», or Linko's applied-filter bar. */
export function InventoryFilterBar({ filters, open, onOpen, onClose, onClear }: { filters: InventoryFilters; open: boolean; onOpen: () => void; onClose: () => void; onClear: () => void }) {
  const { t } = useLanguage()
  const count = filterCount(filters)
  // Linko's afterFilter: 5 px left of the toolbar's content, as wide as the space before the search field.
  if (count > 0) return <RefAppliedFilter count={count} onEdit={onOpen} onClear={onClear} width={372} shift={5} />
  return (
    <button type="button" onClick={open ? onClose : onOpen} className="flex items-center whitespace-nowrap text-[13px] text-[rgb(79,113,220)]">
      {t("Показать фильтр")}&nbsp;
      {/* Linko's expand-more icon squeezed into 13 × 20 px after a space. */}
      <svg viewBox="0 0 24 24" className="-ml-[2px] h-5 w-[13px] translate-y-px fill-[rgb(79,113,220)]" aria-hidden>
        <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" />
      </svg>
    </button>
  )
}

/** The «Фильтр» panel (mounted only while open: the draft starts from the applied filters). */
export function InventoryFilterPanel({
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
  const dirs = useDirectories()
  const gear = useGearOptions(history || checks)
  const set =
    <K extends keyof InventoryFilters>(key: K) =>
    (value: InventoryFilters[K]) =>
      setDraft((current) => ({ ...current, [key]: value }))
  const parents = useMemo(() => dirs?.clientTypes.filter((type) => type.parentId === null) ?? null, [dirs])
  const children = useMemo(() => {
    const chosen = new Set(draft.marketTypeParent.map(Number))
    return dirs?.clientTypes.filter((type) => type.parentId !== null && chosen.has(type.parentId)) ?? null
  }, [dirs, draft.marketTypeParent])
  const products = options ? options.products.map((product) => ({ value: String(product.id), label: product.name })) : null
  const yesNo = [
    { value: "true", label: t("Да") },
    { value: "false", label: t("Нет") },
  ]

  const apply = () => {
    const next = { ...draft }
    for (const [from, to] of [["fromDate", "toDate"], ["fromDateSecond", "toDateSecond"], ["fromDateThird", "toDateThird"], ["fromDateFourth", "toDateFourth"]] as const) {
      if (next[from] && next[to] && next[from] > next[to]) [next[from], next[to]] = [next[to], next[from]]
    }
    onApply(next)
  }
  const period = (label: string, from: keyof InventoryFilters, to: keyof InventoryFilters) => (
    <FilterDate iconEnd className="!h-[67px]" label={label} begin={draft[from] as string} end={draft[to] as string} onChange={(begin, end) => setDraft((current) => ({ ...current, [from]: begin, [to]: end }))} />
  )
  const clientType = (
    <>
      <LinkoMultiField
        label="Тип клиента"
        options={parents}
        value={draft.marketTypeParent}
        // Linko's Подкатегория belongs to the picked types: it empties with them.
        onChange={(next) => setDraft((current) => ({ ...current, marketTypeParent: next, marketType: next.length ? current.marketType : [] }))}
      />
      {draft.marketTypeParent.length > 0 && <LinkoMultiField label="Подкатегория" options={children} value={draft.marketType} onChange={set("marketType")} />}
    </>
  )
  const clients = <LinkoMultiField label="Клиент" options={dirs?.clients ?? null} value={draft.market} onChange={set("market")} />
  const organizations = <LinkoMultiField label="Организация" options={dirs?.organizations ?? null} value={draft.division} onChange={set("division")} />
  const inventoryTypes = <LinkoMultiField label="Тип инвентаря" options={products} value={draft.product} onChange={set("product")} limit={25} />
  const gearField = <LinkoMultiField label="Инвентарь" options={gear} value={draft.gear} onChange={set("gear")} />
  const deleted = <FilterCheck compact label="Показать удаленные" checked={draft.showDeleted} onChange={set("showDeleted")} className="mt-[2px] pb-[11px]" />

  return (
    <RefFilterPanel narrow onClose={onClose} onApply={apply} applyClassName="mt-[15px]">
      {group === "request" ? (
        <>
          {period("Дата запроса", "fromDate", "toDate")}
          {period("Дата обработки", "fromDateThird", "toDateThird")}
          <LinkoMultiField
            label="Статус"
            options={INVENTORY_REQUEST_STATUSES.map((value) => ({ value, label: t(INVENTORY_REQUEST_STATUS_LABELS[value]) }))}
            value={draft.statusRequest}
            onChange={set("statusRequest")}
          />
          <LinkoMultiField label="Тип" options={INVENTORY_REQUEST_TYPES.map((value) => ({ value, label: t(INVENTORY_REQUEST_TYPE_LABELS[value]) }))} value={draft.type} onChange={set("type")} />
          <LinkoMultiField label="Запросил" options={dirs?.employees ?? null} value={draft.requestedBy} onChange={set("requestedBy")} />
          <LinkoMultiField label="Обработал" options={dirs?.employees ?? null} value={draft.userBy} onChange={set("userBy")} />
          {inventoryTypes}
          {clients}
        </>
      ) : (
        <>
          {(history || checks) && period("Дата создания", "fromDate", "toDate")}
          {history && period("Дата движения", "fromDateSecond", "toDateSecond")}
          {!checks && clientType}
          {clients}
          {organizations}
          {!history && !checks && <LinkoMultiField label="Филиалы" options={dirs?.branches ?? null} value={draft.branch} onChange={set("branch")} />}
          {(history || checks) && gearField}
          {inventoryTypes}
          {history && (
            <LinkoSingleField
              label="Тип"
              options={[
                { value: "give", label: t("Передача") },
                { value: "take", label: t("Изъятие") },
              ]}
              value={draft.statusHistory}
              onChange={(value) => set("statusHistory")(value as InventoryFilters["statusHistory"])}
            />
          )}
          {!checks && <LinkoMultiField label="Склад" options={dirs?.warehouses ?? null} value={draft.stock} onChange={set("stock")} />}
          <LinkoMultiField label={history || checks ? "Создал" : "Пользователи"} options={dirs?.employees ?? null} value={draft.user} onChange={set("user")} />
          {!history && !checks && <LinkoSingleField label="Статус одобрено" options={yesNo} value={draft.isReviewed} onChange={(value) => set("isReviewed")(value as InventoryFilters["isReviewed"])} />}
          {deleted}
        </>
      )}
    </RefFilterPanel>
  )
}

/** Инвентарь of the history filters: every item, «product  (№stock number)» like Linko's list. */
function useGearOptions(enabled: boolean): LinkoOption[] | null {
  const [items, setItems] = useState<LinkoOption[] | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    fetch("/api/inventory-items?status=all&showDeleted=1&pageSize=1000", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<InventoryItemListResult>) : null))
      .catch(() => null)
      .then((body) => {
        if (alive) setItems((body?.results ?? []).map((item) => ({ value: String(item.id), label: `${item.product.name}  (№${item.stockNumber})` })))
      })
    return () => {
      alive = false
    }
  }, [enabled])
  return enabled ? items : null
}
