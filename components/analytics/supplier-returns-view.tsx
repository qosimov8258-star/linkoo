"use client"

import { usePathname, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"

import { ConfirmDialog } from "@/components/analytics/cash-management-shared"
import { FilterToggle } from "@/components/analytics/internal-transfers-filter"
import { AcceptReturnDialog } from "@/components/orders/return-card-dialogs"
import { RI, RefButton, RefHeader, RefIconButton, RefPage, RefToolbar } from "@/components/ref/list-kit"
import { SplitDetailList } from "@/components/ref/split-detail"
import { downloadExcelTable } from "@/lib/excel-export"
import { formatMoney as formatAmount, roundMoney } from "@/lib/finance/currency"
import { parseAnyDay } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

import { STATUS_LABEL, SupplierReturnCard, formatDay } from "./supplier-return-card"
import { SupplierReturnForm, closePickerParams } from "./supplier-return-form"
import { useCurrencyCodes } from "./supplier-incoming-dialogs"
import { type ReturnStatus as Status, type SupplierReturn } from "./supplier-returns-data"
import { SupplierReturnsFilter, type FilterOption, type ReturnsFilterOptions } from "./supplier-returns-filter"
import {
  DEFAULT_LIST_QUERY,
  applyPatch,
  cardIdOf,
  filterPatch,
  hasListState,
  pushCard,
  pushParams,
  pushQuery,
  queryText,
  readListQuery,
  type ListFilter,
} from "./supplier-returns-url"

// Склад → Возврат поставщиков (Linko's #/provider-return): the list with its filter, page and search in the address
// (supplier-returns-url.ts), the card of a return opened in place of its row (the address names it:
// /analytics/supplier-returns/22, like Linko's #/provider-return/22; a return the list does not show opens no card),
// the create / edit form (?openCreateDialog / ?openUpdateDialog), «Принять» (?transferDialog) and the trash's
// «ПОДТВЕРЖДЕНИЕ ОТМЕНЫ». Card: supplier-return-card.tsx; form: supplier-return-form.tsx; filter:
// supplier-returns-filter.tsx.

/** Money as everywhere in the app: ru grouping, at most 2 decimals ("2 567,14 SUM"). */
function formatMoney(value: number, currency: string) {
  return `${formatAmount(value, 2)} ${currency}`
}

const DONE_ALL = "M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"
const CANCEL = "M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"

// Material icons of Linko's checkbox column and its «Снять выделение».
const SELECT_ALL = "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z"
const BOX_EMPTY = "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"
const BOX_CHECKED = "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
const MINUS_BOX = "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2z"

const STATUS_COLOR: Record<Status, string> = { завершен: "#71ce87", "в процессе": "#f5a623", отменен: "#e57373" }
const PAYMENT_OF: Record<string, string> = { bank: "банковский счет", cash: "наличный" }

function StatusIcon({ status }: { status: Status }) {
  return (
    <span className="block text-center">
      <svg viewBox="0 0 24 24" className="inline-block h-6 w-6" style={{ fill: STATUS_COLOR[status] }}>
        <path d={status === "завершен" ? DONE_ALL : status === "в процессе" ? RI.clock : CANCEL} />
      </svg>
    </span>
  )
}

/** Any stored day or stamp (YYYY-MM-DD, "19.10.2026", "21 окт. 2026, 00:22") → "2026-10-21" ("" when unreadable). */
function toIsoDate(value: string): string {
  return parseAnyDay(value) ?? ""
}

const inPeriod = (day: string, from: string, to: string) => !from || (Boolean(day) && day >= from && day <= (to || from))

type Named = { id: number | string; name: string; deleted?: boolean }
const named = (rows: Named[]): FilterOption[] => rows.filter((row) => !row.deleted && row.name).map((row) => ({ id: String(row.id), name: row.name }))

export function SupplierReturnsView({ embedded = false, initialId }: { embedded?: boolean; initialId?: number }) {
  const { t, language } = useLanguage()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [rows, setRows] = useState<SupplierReturn[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  // The embedded list (no address of its own) keeps its query, the opened card and its dialogs here.
  const [localQuery, setLocalQuery] = useState(DEFAULT_LIST_QUERY)
  const [localCard, setLocalCard] = useState<number | null>(null)
  const [localForm, setLocalForm] = useState<"create" | "edit" | null>(null)
  const [localPicker, setLocalPicker] = useState(false)
  const [localAccept, setLocalAccept] = useState(false)
  const currencies = useCurrencyCodes()
  /** The filter's lists (Linko writes their ids in the address); null until loaded. */
  const [filterOptions, setFilterOptions] = useState<ReturnsFilterOptions | null>(null)
  const [formLists, setFormLists] = useState({ suppliers: [] as string[], warehouses: [] as string[], organizations: [] as string[], branches: [] as string[], priceLists: [] as string[] })
  const [busy, setBusy] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<SupplierReturn | null>(null)
  const [actionError, setActionError] = useState("")
  const [notice, setNotice] = useState<{ text: string; serial: number } | null>(null)

  // The address: /analytics/supplier-returns/<id> = the opened card; the list state and the dialogs are query parameters.
  const routeId = embedded ? localCard : pathname ? cardIdOf(pathname) : (initialId ?? null)
  const expandedId = routeId
  const addressQuery = embedded ? localQuery : searchParams.toString()
  // A fresh address (no list state: the menu link) lists as Linko's menu query does; it is written below.
  const listParams = useMemo(() => {
    const params = new URLSearchParams(addressQuery)
    return hasListState(params) ? params : applyPatch(params, Object.fromEntries(new URLSearchParams(DEFAULT_LIST_QUERY)))
  }, [addressQuery])
  const list = useMemo(() => readListQuery(listParams), [listParams])
  const formMode: "create" | "edit" | null = embedded ? localForm : searchParams.get("openCreateDialog") === "true" ? "create" : searchParams.get("openUpdateDialog") === "true" && expandedId !== null ? "edit" : null
  const pickerOpen = embedded ? localPicker : Boolean(searchParams.get("pdPageSize"))
  const acceptOpen = embedded ? localAccept : searchParams.get("transferDialog") === "true"

  useEffect(() => {
    if (embedded || hasListState(new URLSearchParams(window.location.search))) return
    pushParams(Object.fromEntries(new URLSearchParams(DEFAULT_LIST_QUERY)), true)
  }, [embedded, addressQuery])

  /** Changes list parameters (null removes one); typing in the search replaces the history entry. */
  const setList = useCallback(
    (patch: Record<string, string | null>, replace = false) => {
      if (embedded) setLocalQuery((current) => queryText(applyPatch(new URLSearchParams(current), patch)))
      else pushParams(patch, replace)
    },
    [embedded],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/supplier-returns")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed")
        return (await response.json()) as SupplierReturn[]
      })
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить возвраты с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const json = async <T,>(url: string, fallback: T): Promise<T> => {
      try {
        const response = await fetch(url)
        return response.ok ? ((await response.json()) as T) : fallback
      } catch {
        return fallback
      }
    }
    async function loadOptions() {
      const [suppliers, warehouses, organizations, branches, products, rawMaterials, formOptions, priceLists] = await Promise.all([
        json<Named[]>("/api/suppliers", []),
        json<Named[]>("/api/warehouses", []),
        json<Named[]>("/api/organizations", []),
        json<Named[]>("/api/branches", []),
        json<Named[]>("/api/products", []),
        json<Named[]>("/api/raw-materials", []),
        // «Прайс лист» of the form: the signed-in user's own lists, as Linko's authConfirm.priceLists.
        json<{ priceLists?: string[] }>("/api/orders/form-options", {}),
        json<Named[]>("/api/price-lists", []),
      ])
      if (cancelled) return
      const productOptions = named(products)
      const productNames = new Set(productOptions.map((option) => option.name))
      const rawOptions = named(rawMaterials)
        .filter((option) => !productNames.has(option.name))
        .map((option) => ({ id: `r${option.id}`, name: option.name }))
      setFilterOptions({
        branches: named(branches),
        suppliers: named(suppliers),
        warehouses: named(warehouses),
        organizations: named(organizations),
        products: [...productOptions, ...rawOptions].sort((a, b) => a.name.localeCompare(b.name, "ru")),
      })
      setFormLists({
        suppliers: named(suppliers).map((option) => option.name),
        warehouses: named(warehouses).map((option) => option.name),
        organizations: named(organizations).map((option) => option.name),
        branches: named(branches).map((option) => option.name),
        priceLists: formOptions.priceLists?.length ? formOptions.priceLists : named(priceLists).map((option) => option.name),
      })
    }
    void loadOptions()
    return () => {
      cancelled = true
    }
  }, [])

  // A snackbar stays 4 s; a new one restarts the timer.
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])
  const flash = (text: string) => setNotice((current) => ({ text, serial: (current?.serial ?? 0) + 1 }))

  // The address names ids; the rows carry names. An id filter waits for its list to load (null = no filter).
  const filterNames = useMemo(() => {
    const namesOf = (options: FilterOption[] | undefined, ids: string[]) => (ids.length ? new Set(ids.map((id) => options?.find((option) => option.id === id)?.name ?? `#${id}`)) : null)
    return {
      branch: namesOf(filterOptions?.branches, list.branch),
      provider: namesOf(filterOptions?.suppliers, list.provider),
      stock: namesOf(filterOptions?.warehouses, list.stock),
      division: namesOf(filterOptions?.organizations, list.division),
      product: namesOf(filterOptions?.products, list.product),
    }
  }, [filterOptions, list])
  const filterPending = filterOptions === null && [list.branch, list.provider, list.stock, list.division, list.product].some((ids) => ids.length > 0)

  const filtered = useMemo(() => {
    const term = list.search.trim().toLowerCase()
    const productKeys = new Set(list.product.map((id) => (id.startsWith("r") ? `raw_material:${id.slice(1)}` : `product:${id}`)))
    return rows.filter((row) => {
      if (term && !row.fromWhom.toLowerCase().includes(term) && !String(row.id).includes(term)) return false
      if (list.statuses.length && !list.statuses.includes(row.status)) return false
      if (filterNames.branch && !filterNames.branch.has(row.branch)) return false
      if (filterNames.provider && !filterNames.provider.has(row.fromWhom)) return false
      if (filterNames.stock && !filterNames.stock.has(row.warehouse)) return false
      if (filterNames.division && !filterNames.division.has(row.organization)) return false
      if (list.paymentType && row.paymentType !== PAYMENT_OF[list.paymentType]) return false
      if (filterNames.product && !row.items.some((item) => (item.key && productKeys.has(item.key)) || filterNames.product!.has(item.product))) return false
      if (!inPeriod(toIsoDate(row.date), list.createdFrom, list.createdTo)) return false
      if (!inPeriod(toIsoDate(row.transferTime), list.transferFrom, list.transferTo)) return false
      return true
    })
  }, [rows, list, filterNames])

  const pageCount = Math.max(1, Math.ceil(filtered.length / list.pageSize))
  const page = Math.min(list.page, pageCount)
  const start = (page - 1) * list.pageSize
  const end = Math.min(start + list.pageSize, filtered.length)
  const visible = filterPending ? [] : filtered.slice(start, end)
  const filterCount = [list.statuses, list.branch, list.provider, list.stock, list.product, list.division].filter((ids) => ids.length > 0).length + [list.paymentType, list.transferFrom, list.createdFrom].filter(Boolean).length
  const opened = expandedId !== null ? (rows.find((row) => row.id === expandedId) ?? null) : null

  function applyFilter(filter: ListFilter) {
    setList({ ...filterPatch(filter), openFilterDialog: "false", page: null })
  }

  /** «Очистить»: no filter at all (Linko drops the whole query). */
  function clearFilters() {
    if (embedded) setLocalQuery("pageSize=25")
    else pushQuery("pageSize=25")
  }

  function openCard(id: number | null) {
    if (embedded) setLocalCard(id)
    else pushCard(id)
  }

  function openForm(mode: "create" | "edit") {
    setActionError("")
    if (embedded) setLocalForm(mode)
    else pushParams(mode === "create" ? { openCreateDialog: "true" } : { openUpdateDialog: "true" })
  }

  const closeForm = useCallback(() => {
    if (embedded) {
      setLocalForm(null)
      setLocalPicker(false)
      return
    }
    const params = new URLSearchParams(window.location.search)
    pushParams({
      ...(params.get("openCreateDialog") === "true" ? { openCreateDialog: "false" } : {}),
      ...(params.get("openUpdateDialog") === "true" ? { openUpdateDialog: "false" } : {}),
    })
  }, [embedded])

  const setPicker = useCallback(
    (open: boolean) => {
      if (embedded) setLocalPicker(open)
      else if (open) pushParams({ pdPageSize: "25" })
      else closePickerParams()
    },
    [embedded],
  )

  function setAccept(open: boolean) {
    setActionError("")
    if (embedded) setLocalAccept(open)
    else pushParams({ transferDialog: open ? "true" : "false" })
  }

  /** PATCH give / cancel; answers whether it worked (a refusal is shown in the open dialog). */
  async function changeStatus(row: SupplierReturn, action: "give" | "cancel", date?: string): Promise<boolean> {
    if (busy) return false
    setBusy(true)
    setActionError("")
    try {
      const response = await fetch(`/api/supplier-returns/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(date ? { action, date } : { action }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setActionError(data.error ? t(data.error) : t("Не удалось изменить статус возврата"))
        return false
      }
      setRows((current) => current.map((item) => (item.id === row.id ? (data as SupplierReturn) : item)))
      return true
    } catch {
      setActionError(t("Сервер недоступен, попробуйте ещё раз"))
      return false
    } finally {
      setBusy(false)
    }
  }

  function downloadList(list: SupplierReturn[]) {
    downloadExcelTable("vozvrat-postavshikam", [
      [t("№"), t("От кого"), t("Склад"), t("Добавил"), t("Дата возврата"), t("Сумма возврата"), t("Статус")],
      ...list.map((row) => [row.id, row.fromWhom, row.warehouse, row.addedBy, `${formatDay(row.date, language)}, ${row.time}`, roundMoney(row.amount, 2), t(STATUS_LABEL[row.status])]),
    ])
  }

  const filterPanel = list.filterOpen ? (
    <SupplierReturnsFilter
      initial={list}
      options={filterOptions}
      onClose={() => setList({ openFilterDialog: "false" })}
      onApply={applyFilter}
    />
  ) : null

  // Linko's checkbox column (?showCheckboxes=true) and the ticked rows (?select=22-19, kept across pages).
  const selectMode = list.showCheckboxes
  const selectedIds = list.select
  const setSelected = (ids: number[]) => setList({ select: ids.length ? ids.join("-") : null })
  const allSelected = visible.length > 0 && visible.every((row) => selectedIds.includes(row.id))
  const heads = [
    ...(selectMode
      ? [
          <button
            key="all"
            type="button"
            aria-label={t("Выбрать все")}
            className="-ml-[18px] flex"
            onClick={() => setSelected(allSelected ? selectedIds.filter((id) => !visible.some((row) => row.id === id)) : [...new Set([...selectedIds, ...visible.map((row) => row.id)])])}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white" aria-hidden>
              <path d={SELECT_ALL} />
            </svg>
          </button>,
        ]
      : []),
    <span key="n">{t("№")}</span>,
    t("От кого"),
    t("Склад"),
    t("Добавил"),
    t("Дата возврата"),
    t("Сумма возврата"),
    <span key="s" className="block text-center">{t("Статус")}</span>,
  ]

  const formRow = formMode === "edit" ? opened : null
  const formOptions = { ...formLists, currencies: currencies.codes, baseCurrency: currencies.base }
  const selecting = selectedIds.length > 0

  const toolbar = (
    // Ticked rows turn the bar into Linko's grey «Выбрано: N» bar (no filter, no search) with «Скачать Excel» and
    // «Снять выделение».
    <div className={selecting ? "bg-[#f2f5f8]" : ""}>
      <RefToolbar
        plain={selecting}
        linkFilter="flush"
        filterWidth={selecting ? undefined : filterCount > 0 ? 354 : undefined}
        searchWidth={filterCount > 0 ? 301 : undefined}
        filterOpen={list.filterOpen}
        onToggleFilter={() => setList({ openFilterDialog: list.filterOpen ? "false" : "true" })}
        filterPanel={filterPanel}
        leftSlot={
          selecting ? (
            <strong className="text-[13px] font-semibold text-[#333]">
              {t("Выбрано")}: {selectedIds.length}
            </strong>
          ) : list.filterOpen ? (
            // Linko's open panel takes the place of the filter bar.
            <span />
          ) : (
            <FilterToggle count={filterCount} open={list.filterOpen} onOpen={() => setList({ openFilterDialog: "true" })} onClose={() => setList({ openFilterDialog: "false" })} onClear={clearFilters} />
          )
        }
        hideSearch={selecting}
        query={list.search}
        onQuery={(value) => setList({ search: value || null, page: null }, true)}
        pageSize={list.pageSize}
        onPageSize={(size) => setList({ pageSize: String(size), page: null })}
        from={filtered.length ? start + 1 : 0}
        to={end}
        total={filtered.length}
        page={page}
        pageCount={pageCount}
        onPage={(next) => setList({ page: next > 1 ? String(next) : null })}
        icons={
          selecting ? undefined : (
            <>
              <RefIconButton
                path={selectMode ? RI.eyeOff : RI.checklist}
                label={selectMode ? "Спрятать флажки" : "Выбрать из списка"}
                color="#5d6474"
                onClick={() => setList(selectMode ? { showCheckboxes: null, select: null } : { showCheckboxes: "true" })}
              />
              <RefIconButton path={RI.download} label="Скачать Excel" color="#333" onClick={() => downloadList(filtered)} />
            </>
          )
        }
        extra={
          selecting ? (
            // Linko: 20 px after the pager, 8 px before «Снять выделение».
            <span className="ml-[10px] flex items-center gap-[8px]">
              <RefButton green icon={RI.download} label={t("Скачать Excel")} onClick={() => downloadList(rows.filter((row) => selectedIds.includes(row.id)))} />
              <RefIconButton path={MINUS_BOX} label="Снять выделение" color="#666" onClick={() => setSelected([])} />
            </span>
          ) : embedded ? (
            <RefButton green icon={RI.add} label={t("Добавить")} onClick={() => openForm("create")} />
          ) : undefined
        }
      />
    </div>
  )

  const content = (
    <>
      {!embedded && (
        <RefHeader title={t("Возврат поставщиков")}>
          <RefButton green icon={RI.add} label={t("Добавить")} onClick={() => openForm("create")} />
        </RefHeader>
      )}
      {/* The opened card takes its row's place between two cards of the list, as Linko's (20 px gaps, its shadow). */}
      <SplitDetailList
        rows={visible}
        selectedKey={expandedId}
        rowKey={(row) => row.id}
        toolbar={toolbar}
        detailClassName="-mx-[15px] my-[20px] bg-white shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]"
        detail={(row) => (
          <SupplierReturnCard
            row={row}
            baseCurrency={currencies.base}
            busy={busy}
            onClose={() => openCard(null)}
            onAccept={() => setAccept(true)}
            onEdit={() => !row.fromOldBase && openForm("edit")}
            onCancel={() => {
              setActionError("")
              setCancelTarget(row)
            }}
          />
        )}
        tableProps={{
          // The checkbox column is Linko's 20 px in front (its 24 px boxes start 10 px before the row's text).
          cols: `${selectMode ? "20px " : ""}107fr 213fr 213fr 266fr 213fr 213fr 159fr`,
          heads,
          rowKey: (row) => row.id,
          onRowClick: (row) => openCard(row.id),
          // A ticked row is shaded like Linko's.
          rowClass: (row) => (selectedIds.includes(row.id) ? "!bg-[#f2f5f8]" : ""),
          empty: loading || filterPending ? t("Загрузка...") : t(loadError) || t("По вашему запросу ничего не найдено"),
          render: (row) => [
            ...(selectMode
              ? [
                  <button
                    key="check"
                    type="button"
                    aria-label={t("Выбрать")}
                    className="relative -top-px -ml-[18px] flex"
                    onClick={(event) => {
                      event.stopPropagation()
                      setSelected(selectedIds.includes(row.id) ? selectedIds.filter((id) => id !== row.id) : [...selectedIds, row.id])
                    }}
                  >
                    <svg viewBox="0 0 24 24" className={`h-6 w-6 ${selectedIds.includes(row.id) ? "fill-[#5d6474]" : "fill-[#333]"}`} aria-hidden>
                      <path d={selectedIds.includes(row.id) ? BOX_CHECKED : BOX_EMPTY} />
                    </svg>
                  </button>,
                ]
              : []),
            <span key="n">
              {row.id}
              {/* A return with a comment: «(ком.)» under its number, the comment on hover (as the reference). */}
              {row.reason ? (
                <span title={row.reason} className="block text-[12px] text-[#1E4A9A]">
                  ({t("ком.")})
                </span>
              ) : null}
            </span>,
            row.fromWhom,
            row.warehouse,
            row.addedBy,
            <span key="d" data-no-translate>{`${formatDay(row.date, language)}, ${row.time}`}</span>,
            formatMoney(row.amount, row.currency || currencies.base),
            <StatusIcon key="s" status={row.status} />,
          ],
        }}
      />

      {formMode !== null && (formMode === "create" || formRow) && (
        <SupplierReturnForm
          key={formMode === "edit" && formRow ? `edit-${formRow.id}` : "create"}
          row={formMode === "edit" ? formRow : null}
          options={formOptions}
          pickerOpen={pickerOpen}
          onPicker={setPicker}
          onClose={closeForm}
          onSaved={(saved) => {
            setRows((current) => (current.some((row) => row.id === saved.id) ? current.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...current]))
            closeForm()
            flash(t("Успешно сохранено"))
          }}
        />
      )}

      {acceptOpen && opened && (
        <>
          <AcceptReturnDialog
            returnId={opened.id}
            emptyDate
            busy={busy}
            onClose={() => setAccept(false)}
            onConfirm={(date) =>
              void changeStatus(opened, "give", date).then((done) => {
                if (!done) return
                setAccept(false)
                flash(t("Успешно передан"))
              })
            }
          />
          {actionError && createPortal(<div className="fixed bottom-6 left-1/2 z-[1500] -translate-x-1/2 rounded-[2px] bg-[#c62828] px-6 py-3 text-[14px] text-white shadow-lg">{actionError}</div>, document.body)}
        </>
      )}

      {cancelTarget && (
        <ConfirmDialog
          title={t("Подтверждение отмены")}
          kind="cancel"
          item={`${t("Возврат")} №${cancelTarget.id}`}
          confirmLabel="Да"
          tone="blue"
          busy={busy}
          error={actionError}
          onConfirm={() =>
            void changeStatus(cancelTarget, "cancel").then((done) => {
              if (!done) return
              setCancelTarget(null)
              flash(t("Успешно удалено"))
            })
          }
          onClose={() => setCancelTarget(null)}
        />
      )}

      {notice && (
        <div key={notice.serial} role="status" className="fixed bottom-6 left-1/2 z-[1600] -translate-x-1/2 rounded-[2px] bg-[#323232] px-6 py-[14px] text-[14px] text-white shadow-lg">
          {notice.text}
        </div>
      )}
    </>
  )

  return embedded ? <main className="min-w-0 flex-1">{content}</main> : <RefPage>{content}</RefPage>
}
