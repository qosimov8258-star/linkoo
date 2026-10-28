"use client"

import { ShoppingBag, X } from "lucide-react"
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { CashModal, ConfirmDialog, FormField, SearchSelect, inputClass, type PickOption } from "@/components/analytics/cash-management-shared"
import { MaterialDate } from "@/components/analytics/cash-material"
import { FilterToggle } from "@/components/analytics/internal-transfers-filter"
import { formatUnitTotals } from "@/components/analytics/internal-transfers-picker"
import { FilterDate, FilterSelect, RI, RefButton, RefCard, RefFilterPanel, RefHeader, RefPage, RefTable, RefToolbar, usePaging } from "@/components/ref/list-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { formatMoney as formatAmount, roundMoney } from "@/lib/finance/currency"
import { formatStatementDate, parseAnyDay, todayIso } from "@/lib/finance/dates"
import { formatDateText } from "@/lib/i18n/format-date"
import { useLanguage } from "@/lib/i18n/language-context"
import { OrganizationFormModal } from "./organization-form-modal"
import { currencyChoices, useCurrencyCodes } from "./supplier-incoming-dialogs"
import { returnPaymentTypes as paymentTypes, type ReturnStatus as Status, type SupplierReturn } from "./supplier-returns-data"
import { SupplierFormModal } from "./supplier-form-modal"
import { WarehouseFormModal } from "./warehouse-form-modal"
import { notify } from "@/lib/notify"

const ITEM_IMPORT_HEADER_ALIASES: Record<string, string> = {
  "товар": "product", "наименование": "product", "название": "product", "product": "product", "name": "product",
  "количество": "qty", "кол во": "qty", "qty": "qty", "quantity": "qty",
  "серия": "series", "номер серии": "series", "series": "series",
  "цена": "cost", "стоимость": "cost", "сумма": "cost", "сумма за единицу": "cost", "цена за единицу": "cost", "cost": "cost", "price": "cost", "unit price": "cost",
}

/** Money as everywhere in the app: ru grouping, at most 2 decimals ("2 567,14 SUM"). */
function formatMoney(value: number, currency: string) {
  return `${formatAmount(value, 2)} ${currency}`
}

const DONE_ALL = "M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z"
const CANCEL = "M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"

const STATUS_LABEL: Record<Status, string> = { завершен: "Завершен", "в процессе": "Ожидает", отменен: "Отменен" }
const STATUS_COLOR: Record<Status, string> = { завершен: "#71ce87", "в процессе": "#f5a623", отменен: "#e57373" }

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

function InfoRow({ label, value, valueClass = "" }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="font-normal">{label}</dt>
      <dd className={`font-semibold ${valueClass}`}>{value}</dd>
    </div>
  )
}

/** The reference's multi-select "Статус" field: blue chips with a × each, a clear-all × and a caret. */
function StatusChips({ value, onChange }: { value: Status[]; onChange: (next: Status[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative mt-[2px] h-[62px]">
      <div className="absolute inset-x-0 top-[10px] border-b border-[#e8e8e8] pb-[6px]">
        <span className="block text-[10px] font-bold leading-3 text-black">{t("Статус")}</span>
        <div className="flex min-h-[24px] flex-wrap items-center gap-[6px] pr-[40px] pt-[4px]">
          {value.map((status) => (
            <span key={status} className="inline-flex h-[20px] items-center bg-[#5c6bf5] text-[11px] font-bold text-white">
              <button type="button" aria-label={t("Убрать")} onClick={() => onChange(value.filter((item) => item !== status))} className="h-full border-r border-white/30 px-[6px]">×</button>
              <span className="px-[6px]">{t(STATUS_LABEL[status])}</span>
            </span>
          ))}
        </div>
        {value.length > 0 && <button type="button" aria-label={t("Сбросить")} onClick={() => onChange([])} className="absolute right-[24px] top-[30px] text-[15px] text-[#999]">×</button>}
        <button type="button" aria-label={t("Статус")} onClick={() => setOpen((current) => !current)} className="absolute inset-0" />
        <svg viewBox="0 0 10 7" className="pointer-events-none absolute right-[8px] top-[36px] h-[7px] w-[10px] fill-[#888]"><path d="M0 0l5 5.5L10 0z" /></svg>
      </div>
      {open && (
        <>
          <button type="button" aria-label={t("Закрыть")} className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 top-[62px] z-50 bg-white py-1 shadow-[0_1px_6px_rgba(0,0,0,0.2),0_1px_4px_rgba(0,0,0,0.2)]">
            {(["в процессе", "завершен", "отменен"] as Status[]).map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => onChange(value.includes(status) ? value.filter((item) => item !== status) : [...value, status])}
                className={`block h-9 w-full px-[10px] text-left text-[13px] font-semibold hover:bg-[#f2f5f8] ${value.includes(status) ? "text-[#4f71dc]" : ""}`}
              >
                {t(STATUS_LABEL[status])}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

type DraftItem = { id: number; product: string; qty: number; series: string; price: number }
/** "Передать" / "Отменить" / delete waiting for the confirm dialog (the reference's ПОДТВЕРЖДЕНИЕ dialogs);
 * it stays open (busy) until the server answers and shows a refusal. */
type PendingAction = { title: string; text?: string; kind?: "cancel"; item?: string; confirmLabel?: string; run: () => Promise<string> }

/** A stored return day (YYYY-MM-DD; older rows "19.10.2026", "20 октября 2026") in the page language. */
function formatDay(value: string, language: string) {
  const day = parseAnyDay(value)
  return day ? formatStatementDate(day, language, false).replace(/\s*г\.$/, "") : value
}

const pickOptions = (values: string[]): PickOption[] => values.map((value) => ({ value, label: value }))

/** Empty like the reference's form: the server resolves an empty currency to the base one and an empty date to today. */
function emptyDraft() {
  return {
    supplier: "",
    warehouse: "",
    organization: "",
    branch: "",
    currency: "",
    priceList: "",
    paymentType: "",
    date: "",
    comment: "",
  }
}

export function SupplierReturnsView({ embedded = false }: { embedded?: boolean }) {
  const { t, language } = useLanguage()
  const [rows, setRows] = useState<SupplierReturn[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [filterActive, setFilterActive] = useState(true)
  const [filterOpen, setFilterOpen] = useState(false)
  const [includedStatuses, setIncludedStatuses] = useState<Status[]>(["завершен", "в процессе"])
  const [branchFilter, setBranchFilter] = useState("")
  const [supplierFilter, setSupplierFilter] = useState("")
  const [warehouseFilter, setWarehouseFilter] = useState("")
  const [productFilter, setProductFilter] = useState("")
  const [organizationFilter, setOrganizationFilter] = useState("")
  const [paymentFilter, setPaymentFilter] = useState("")
  const [transferPeriod, setTransferPeriod] = useState({ begin: "", end: "" })
  const [createdPeriod, setCreatedPeriod] = useState({ begin: "", end: "" })
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [tried, setTried] = useState(false)
  const currencies = useCurrencyCodes()
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState("")
  const [supplierOptions, setSupplierOptions] = useState<string[]>([])
  const [warehouseOptions, setWarehouseOptions] = useState<string[]>([])
  const [organizationOptions, setOrganizationOptions] = useState<string[]>([])
  const [priceListOptions, setPriceListOptions] = useState<string[]>([])
  const [productOptions, setProductOptions] = useState<string[]>([])
  const [branchOptions, setBranchOptions] = useState<string[]>([])
  // Return price defaults to the product's current net cost.
  const [productCosts, setProductCosts] = useState<Record<string, number>>({})
  /** Unit of each product / raw material by name (per-unit totals). */
  const [productUnits, setProductUnits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [pendingError, setPendingError] = useState("")
  const [quickAddSupplierOpen, setQuickAddSupplierOpen] = useState(false)
  const [quickAddWarehouseOpen, setQuickAddWarehouseOpen] = useState(false)
  const [quickAddOrganizationOpen, setQuickAddOrganizationOpen] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

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
    async function loadOptions() {
      const [suppliersRes, warehousesRes, organizationsRes, priceListsRes, productsRes, rawMaterialsRes, branchesRes] = await Promise.all([
        fetch("/api/suppliers").catch(() => null),
        fetch("/api/warehouses").catch(() => null),
        fetch("/api/organizations").catch(() => null),
        fetch("/api/price-lists").catch(() => null),
        fetch("/api/products").catch(() => null),
        fetch("/api/raw-materials").catch(() => null),
        fetch("/api/branches").catch(() => null),
      ])
      if (cancelled) return
      if (suppliersRes?.ok) setSupplierOptions(((await suppliersRes.json()) as { name: string }[]).map((item) => item.name))
      if (warehousesRes?.ok) setWarehouseOptions(((await warehousesRes.json()) as { name: string }[]).map((item) => item.name))
      if (organizationsRes?.ok) setOrganizationOptions(((await organizationsRes.json()) as { name: string }[]).map((item) => item.name))
      if (priceListsRes?.ok) setPriceListOptions(((await priceListsRes.json()) as { name: string }[]).map((item) => item.name))
      if (branchesRes?.ok) setBranchOptions(((await branchesRes.json()) as { name: string }[]).map((item) => item.name))
      const catalog: { name: string; cost?: number; unit?: string }[] = []
      if (productsRes?.ok) catalog.push(...((await productsRes.json()) as { name: string; cost: number; unit?: string; deleted?: boolean }[]).filter((item) => !item.deleted))
      if (rawMaterialsRes?.ok) catalog.push(...((await rawMaterialsRes.json()) as { name: string; unit?: string }[]))
      setProductOptions(Array.from(new Set(catalog.map((item) => item.name))).sort((a, b) => a.localeCompare(b, "ru")))
      setProductCosts(Object.fromEntries(catalog.filter((item) => item.cost).map((item) => [item.name, Number(item.cost)])))
      setProductUnits(Object.fromEntries(catalog.map((item) => [item.name, String(item.unit ?? "")])))
    }
    void loadOptions()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (query && !row.fromWhom.toLowerCase().includes(query.toLowerCase()) && !String(row.id).includes(query)) return false
      if (filterActive) {
        if (includedStatuses.length && !includedStatuses.includes(row.status)) return false
        if (branchFilter && row.branch !== branchFilter) return false
        if (supplierFilter && row.fromWhom !== supplierFilter) return false
        if (warehouseFilter && row.warehouse !== warehouseFilter) return false
        if (organizationFilter && row.organization !== organizationFilter) return false
        if (paymentFilter && row.paymentType !== paymentFilter) return false
        if (productFilter && !row.items.some((item) => item.product === productFilter)) return false
        const created = toIsoDate(row.date)
        if (createdPeriod.begin && (!created || created < createdPeriod.begin || created > (createdPeriod.end || createdPeriod.begin))) return false
        const transferred = toIsoDate(row.transferTime)
        if (transferPeriod.begin && (!transferred || transferred < transferPeriod.begin || transferred > (transferPeriod.end || transferPeriod.begin))) return false
      }
      return true
    })
  }, [rows, query, filterActive, includedStatuses, branchFilter, supplierFilter, warehouseFilter, organizationFilter, paymentFilter, productFilter, createdPeriod, transferPeriod])

  const paging = usePaging(filtered.length)
  const visible = filtered.slice(paging.start, paging.end)
  const filterCount = filterActive
    ? [includedStatuses.length > 0, branchFilter, supplierFilter, warehouseFilter, productFilter, organizationFilter, paymentFilter, transferPeriod.begin, createdPeriod.begin].filter(Boolean).length
    : 0

  function clearFilters() {
    setFilterActive(false)
    setIncludedStatuses([])
    setBranchFilter("")
    setSupplierFilter("")
    setWarehouseFilter("")
    setProductFilter("")
    setOrganizationFilter("")
    setPaymentFilter("")
    setTransferPeriod({ begin: "", end: "" })
    setCreatedPeriod({ begin: "", end: "" })
    paging.setPage(1)
  }

  function toggleExpand(row: SupplierReturn) {
    setExpandedId((current) => (current === row.id ? null : row.id))
  }

  function openCreate() {
    setTried(false)
    setDraft(emptyDraft())
    setDraftItems([])
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(row: SupplierReturn) {
    setTried(false)
    setDraft({
      supplier: row.fromWhom,
      warehouse: row.warehouse,
      organization: row.organization,
      branch: row.branch,
      currency: row.currency || currencies.base,
      priceList: row.priceList,
      paymentType: row.paymentType,
      date: parseAnyDay(row.date) ?? row.date,
      comment: row.reason,
    })
    setDraftItems(row.items.map((item) => ({ id: item.id, product: item.product, qty: item.qty, series: item.series, price: item.price })))
    setEditingId(row.id)
    setModalOpen(true)
  }

  /** Asks in the app's confirm dialog; a refusal is shown there ("" = done). */
  function ask(action: PendingAction) {
    setPendingError("")
    setPending(action)
  }

  async function runPending() {
    if (!pending || busy) return
    setBusy(true)
    try {
      const error = await pending.run()
      if (error) setPendingError(error)
      else setPending(null)
    } catch {
      setPendingError(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setBusy(false)
    }
  }

  function changeStatus(row: SupplierReturn, action: "give" | "cancel") {
    ask({
      ...(action === "give"
        ? { title: t("Передать возврат"), text: `${t("Передать возврат №")} ${row.id} ${t("поставщику?")}`, confirmLabel: "Да" }
        : { title: t("Подтверждение отмены"), kind: "cancel" as const, item: `${t("Возврат")}№ ${row.id}`, confirmLabel: "Да" }),
      run: async () => {
        const response = await fetch(`/api/supplier-returns/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) return data.error ? t(data.error) : t("Не удалось изменить статус возврата")
        setRows((current) => current.map((item) => (item.id === row.id ? (data as SupplierReturn) : item)))
        return ""
      },
    })
  }

  function removeRow(row: SupplierReturn) {
    ask({
      title: `№ ${row.id}`,
      run: async () => {
        const response = await fetch(`/api/supplier-returns/${row.id}`, { method: "DELETE" })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          return data.error ? t(data.error) : t("Не удалось удалить возврат")
        }
        setRows((current) => current.filter((item) => item.id !== row.id))
        if (expandedId === row.id) setExpandedId(null)
        return ""
      },
    })
  }

  // Escape closes the top layer: the product list, else the filter panel (the return dialog closes itself,
  // see its onClose); a quick-add form on top keeps them.
  useEffect(() => {
    if (!pickerOpen && !filterOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || quickAddSupplierOpen || quickAddWarehouseOpen || quickAddOrganizationOpen) return
      if (pickerOpen) setPickerOpen(false)
      else setFilterOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [pickerOpen, filterOpen, quickAddSupplierOpen, quickAddWarehouseOpen, quickAddOrganizationOpen])

  function addBlankItem() {
    setDraftItems((current) => [...current, { id: Math.max(0, ...current.map((item) => item.id)) + 1, product: productOptions[0] ?? "", qty: 1, series: "", price: productCosts[productOptions[0] ?? ""] ?? 0 }])
  }

  function addFromList(product: string) {
    setDraftItems((current) => {
      if (current.some((item) => item.product === product)) return current
      return [...current, { id: Math.max(0, ...current.map((item) => item.id)) + 1, product, qty: 1, series: "", price: productCosts[product] ?? 0 }]
    })
  }

  function updateDraftItem(id: number, patch: Partial<DraftItem>) {
    setDraftItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function removeDraftItem(id: number) {
    setDraftItems((current) => current.filter((item) => item.id !== id))
  }

  function importFromExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    void (async () => {
      const rows = await readExcelRows(file)
      if (!rows.length) return

      const fieldByIndex = mapHeaderColumns(rows[0], ITEM_IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("product")
      const dataRows = hasHeader ? rows.slice(1) : rows

      const parsed: DraftItem[] = []
      let nextId = Math.max(0, ...draftItems.map((item) => item.id)) + 1
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.product = row[0] ?? ""
          record.qty = row[1] ?? ""
          record.cost = row[3] ?? ""
        }
        const product = record.product
        if (!product || /^(товар|product|наименование|название)$/i.test(product)) continue
        parsed.push({ id: nextId++, product, qty: Number(record.qty) || 1, series: record.series || "", price: Number(record.cost) || 0 })
      }
      if (parsed.length) setDraftItems((current) => [...current, ...parsed])
    })()
  }

  const draftTotalCost = draftItems.reduce((sum, item) => sum + item.qty * item.price, 0)
  // One total per unit (kg and pieces are never added up).
  const draftTotalQty = formatUnitTotals(
    draftItems.filter((item) => item.product).map((item) => ({ qty: item.qty, unit: productUnits[item.product] ?? "" })),
    t,
  )

  async function save(event?: FormEvent) {
    event?.preventDefault()
    if (saving) return
    setTried(true)
    if (!draft.supplier || !draft.warehouse) return
    if (!draftItems.length) {
      notify(t("Вы еще не выбрали ни одного товара."))
      return
    }
    const items = draftItems.map((item) => ({
      id: item.id,
      product: item.product,
      qty: item.qty,
      series: item.series,
      price: item.price,
    }))
    const body = {
      fromWhom: draft.supplier,
      warehouse: draft.warehouse,
      organization: draft.organization,
      branch: draft.branch,
      currency: draft.currency,
      priceList: draft.priceList,
      paymentType: draft.paymentType || paymentTypes[0],
      date: draft.date,
      comment: draft.comment,
      items,
    }
    setSaving(true)
    try {
      const isEdit = editingId !== null
      const response = await fetch(isEdit ? `/api/supplier-returns/${editingId}` : "/api/supplier-returns", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        notify(data.error ? t(data.error) : t("Не удалось сохранить возврат"))
        return
      }
      const saved = (await response.json()) as SupplierReturn
      setRows((current) => (isEdit ? current.map((row) => (row.id === editingId ? saved : row)) : [saved, ...current]))
      setModalOpen(false)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  function downloadList() {
    downloadExcelTable("vozvrat-postavshikam", [
      [t("№"), t("От кого"), t("Склад"), t("Добавил"), t("Дата возврата"), t("Сумма возврата"), t("Статус")],
      ...filtered.map((row) => [row.id, row.fromWhom, row.warehouse, row.addedBy, `${formatDay(row.date, language)}, ${row.time}`, roundMoney(row.amount, 2), t(STATUS_LABEL[row.status])]),
    ])
  }

  const filterPanel = (
    <RefFilterPanel narrow onClose={() => setFilterOpen(false)} onApply={() => { setFilterActive(true); setFilterOpen(false); paging.setPage(1) }} className="!w-[310px] max-h-[calc(100vh-120px)] overflow-y-auto">
      <FilterSelect label={t("Филиалы")} value={branchFilter} onChange={setBranchFilter} options={branchOptions} />
      <FilterSelect label={t("Поставщик")} value={supplierFilter} onChange={setSupplierFilter} options={supplierOptions} />
      <FilterSelect label={t("Склад")} value={warehouseFilter} onChange={setWarehouseFilter} options={warehouseOptions} />
      <FilterSelect label={t("Товар")} value={productFilter} onChange={setProductFilter} options={productOptions} />
      <FilterSelect label={t("Организация")} value={organizationFilter} onChange={setOrganizationFilter} options={organizationOptions} />
      <FilterSelect label={t("Тип оплаты")} value={paymentFilter} onChange={setPaymentFilter} options={[...paymentTypes]} />
      <StatusChips value={includedStatuses} onChange={setIncludedStatuses} />
      <FilterDate label={t("Период передачи со склада")} begin={transferPeriod.begin} end={transferPeriod.end} onChange={(begin, end) => setTransferPeriod({ begin, end })} />
      <FilterDate label={t("Дата создания")} begin={createdPeriod.begin} end={createdPeriod.end} onChange={(begin, end) => setCreatedPeriod({ begin, end })} />
    </RefFilterPanel>
  )

  const allSelected = visible.length > 0 && visible.every((row) => selectedIds.includes(row.id))
  const heads = [
    selectMode ? (
      <span key="n" className="-ml-1 flex items-center gap-[14px]">
        <input type="checkbox" checked={allSelected} onChange={() => setSelectedIds(allSelected ? [] : visible.map((row) => row.id))} aria-label={t("Выбрать все")} className="h-[18px] w-[18px] cursor-pointer accent-[#5d6474]" />
        {t("№")}
      </span>
    ) : (
      <span key="n" className="-ml-2 block">{t("№")}</span>
    ),
    t("От кого"),
    t("Склад"),
    t("Добавил"),
    t("Дата возврата"),
    t("Сумма возврата"),
    <span key="s" className="block text-center">{t("Статус")}</span>,
  ]

  const content = (
    <>
      {!embedded && (
        <RefHeader title={t("Возврат поставщиков")}>
          <RefButton green icon={RI.add} label={t("Добавить")} onClick={openCreate} />
        </RefHeader>
      )}
      <RefCard>
        <RefToolbar
          linkFilter="flush"
          filterWidth={filterCount > 0 ? 354 : undefined}
          searchWidth={filterCount > 0 ? 301 : undefined}
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={filterPanel}
          leftSlot={<FilterToggle count={filterCount} open={filterOpen} onOpen={() => { setFilterActive(true); setFilterOpen(true) }} onClose={() => setFilterOpen(false)} onClear={clearFilters} />}
          query={query}
          onQuery={(value) => {
            setQuery(value)
            paging.setPage(1)
          }}
          pageSize={paging.pageSize}
          onPageSize={paging.setPageSize}
          from={filtered.length ? paging.start + 1 : 0}
          to={paging.end}
          total={filtered.length}
          page={paging.page}
          pageCount={paging.pageCount}
          onPage={paging.setPage}
          icons={
            <>
              <button
                type="button"
                title={selectMode ? t("Скрыть выбор") : t("Выбрать из списка")}
                aria-label={t("Выбрать из списка")}
                onClick={() => {
                  setSelectMode((value) => !value)
                  setSelectedIds([])
                }}
                className="flex h-12 w-12 items-center justify-center"
              >
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={selectMode ? "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z" : RI.checklist} /></svg>
              </button>
              <button type="button" title={t("Скачать Excel")} aria-label={t("Скачать")} onClick={downloadList} className="flex h-12 w-12 items-center justify-center">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={RI.download} /></svg>
              </button>
            </>
          }
          extra={embedded ? <RefButton green icon={RI.add} label={t("Добавить")} onClick={openCreate} /> : undefined}
        />
        <RefTable
          cols="107fr 213fr 213fr 266fr 213fr 213fr 159fr"
          heads={heads}
          rows={visible}
          rowKey={(row) => row.id}
          onRowClick={toggleExpand}
          rowClass={(row) => (expandedId === row.id ? "hidden" : "")}
          empty={loading ? t("Загрузка...") : t(loadError) || t("По вашему запросу ничего не найдено")}
          render={(row) => [
            selectMode ? (
              <span key="n" className="-ml-1 flex items-center gap-[14px]" onClick={(event) => event.stopPropagation()}>
                <input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => setSelectedIds((current) => (current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id]))} className="h-[18px] w-[18px] cursor-pointer accent-[#5d6474]" />
                {row.id}
              </span>
            ) : (
              row.id
            ),
            row.fromWhom,
            row.warehouse,
            row.addedBy,
            <span key="d" data-no-translate>{`${formatDay(row.date, language)}, ${row.time}`}</span>,
            formatMoney(row.amount, row.currency || currencies.base),
            <StatusIcon key="s" status={row.status} />,
          ]}
          expanded={(row) => {
            if (expandedId !== row.id) return null
            const total = row.items.reduce((sum, item) => sum + item.total, 0)
            return (
              <div className="-mx-[15px] mb-[14px] mt-[20px] bg-white text-[13px] text-[#333] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
                <div className="flex h-[65px] items-center justify-between border-b border-[#e0e0e0] pl-[30px] pr-[43px]">
                  <h2 className="text-[18px] font-normal leading-[24px] text-[#333]">{t("Возврат поставщику №")}{row.id}</h2>
                  <div className="flex items-center gap-[10px]">
                    {row.status === "в процессе" && (
                      <button type="button" disabled={busy} onClick={() => changeStatus(row, "give")} className="flex h-[30px] items-center rounded-[5px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-50">{t("Передать")}</button>
                    )}
                    {row.status === "в процессе" && (
                      <button type="button" disabled={busy} onClick={() => changeStatus(row, "cancel")} className="flex h-[30px] items-center rounded-[5px] bg-[#fa8072] px-4 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-50">{t("Отменить")}</button>
                    )}
                    <button type="button" onClick={() => window.print()} aria-label={t("Печать")} className="flex h-6 w-6 items-center justify-center">
                      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={RI.print} /></svg>
                    </button>
                    {row.status === "в процессе" && (
                      <button type="button" onClick={() => openEdit(row)} aria-label={t("Изменить")} className="ml-[24px] flex h-6 w-6 items-center justify-center">
                        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={RI.edit} /></svg>
                      </button>
                    )}
                    {row.status !== "отменен" && (
                      <button type="button" onClick={() => (row.status === "завершен" ? changeStatus(row, "cancel") : removeRow(row))} aria-label={t("Удалить")} className="ml-[24px] flex h-6 w-6 items-center justify-center">
                        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#5d6474]"><path d={RI.trash} /></svg>
                      </button>
                    )}
                    <button type="button" onClick={() => toggleExpand(row)} aria-label={t("Свернуть")} className="ml-[10px] flex h-6 w-6 items-center justify-center">
                      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-[#5d6474]"><path d={RI.close} /></svg>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-[348px_1fr]">
                  <div className="border-r border-[#e0e0e0]">
                    <dl className="px-[30px] pb-[14px] pt-[15px] leading-[25px]">
                      <InfoRow label={`${t("Добавил")}:`} value={row.addedBy || t("Не указано")} />
                      <InfoRow label={`${t("Поставщик")}:`} value={row.fromWhom || t("Не указано")} />
                      <InfoRow label={`${t("Организация")}:`} value={row.organization || t("Не указано")} />
                      <InfoRow label={`${t("Валюта")}:`} value={row.currency || t("Не указано")} />
                      <InfoRow label={`${t("Тип оплаты")}:`} value={row.paymentType ? t(row.paymentType) : t("Не указано")} />
                      <InfoRow label={`${t("Прайс лист")}:`} value={row.priceList || t("Не указано")} />
                      <InfoRow label={`${t("Дата возврата")}:`} value={`${formatDay(row.date, language)}, ${row.time}`} />
                      <InfoRow label={`${t("Филиал")}:`} value={row.branch || t("Не указано")} />
                    </dl>
                    <div className="border-t border-[#e0e0e0] px-[30px] pb-[14px] pt-[11px]">
                      <p className="uppercase leading-[25px]">{t("Склад")}</p>
                      <dl className="mt-[5px] leading-[25px]">
                        <InfoRow label={`${t("Склад")}:`} value={row.warehouse || t("Не указано")} />
                        <InfoRow label={`${t("Время передачи")}:`} value={row.transferTime ? formatDateText(row.transferTime, language) : t("Не передано")} />
                        <InfoRow label={`${t("Передал")}:`} value={row.transferredBy || "—"} />
                        <InfoRow label={`${t("Статус")}:`} value={t(STATUS_LABEL[row.status])} valueClass={row.status === "завершен" ? "text-[#81c784]" : row.status === "в процессе" ? "text-[#f5a623]" : "text-[#e57373]"} />
                        {row.status === "отменен" && row.cancelledBy && <InfoRow label={`${t("Отменил")}:`} value={`${row.cancelledBy}, ${formatDateText(row.cancelledAt, language)}`} />}
                      </dl>
                    </div>
                    <div className="border-t border-[#e0e0e0] px-[30px] pb-[20px] pt-[18px]">
                      <p className="leading-[25px]">{t("Причина возврата:")}</p>
                      <p className="leading-[25px] text-[#666]">{row.reason}</p>
                    </div>
                  </div>

                  <div className="px-[30px] pt-[14px]">
                    <div className="border-b border-[#e0e0e0]">
                      <span className="flex h-[46px] w-[450px] items-center justify-center border-b-2 border-[#4f71dc] text-[13px] text-black">{t("Список товаров")}</span>
                    </div>
                    <div className="mt-[18px] grid grid-cols-[34px_minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.3fr)] items-center pb-[12px] font-semibold">
                      <span>{t("№")}</span><span>{t("Товар")}</span><span className="text-right">{t("Количество")}</span><span className="pl-[40px]">{t("Серия")}</span><span className="text-right">{`${t("Цена")} (${row.currency || currencies.base})`}</span><span className="text-right">{`${t("Сумма")} (${row.currency || currencies.base})`}</span>
                    </div>
                    <div className="border-t border-dotted border-[#cfd6dc]">
                      {row.items.map((item) => (
                        <div key={item.id} className="grid min-h-[60px] grid-cols-[34px_minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.3fr)] items-center border-b border-dotted border-[#cfd6dc]">
                          <span>{item.id}</span><span>{item.product}</span><span className="text-right">{item.qty.toLocaleString("ru-RU")} {productUnits[item.product] ? t(productUnits[item.product]) : ""}</span><span className="pl-[40px]">{item.series}</span><span className="text-right">{formatAmount(item.price, 2)}</span><span className="text-right">{formatAmount(item.total, 2)}</span>
                        </div>
                      ))}
                      <div className="grid min-h-[50px] grid-cols-[34px_minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.3fr)] items-center font-bold">
                        <span className="col-span-2">{t("Итого")}:</span><span className="text-right">{formatUnitTotals(row.items.map((item) => ({ qty: item.qty, unit: productUnits[item.product] ?? "" })), t)}</span><span /><span /><span className="text-right">{formatAmount(total, 2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          }}
        />
      </RefCard>

      {modalOpen && (
        <CashModal
          size="screen"
          zIndex={110}
          title={editingId !== null ? `${t("Изменить возврат №")}${editingId}` : t("Возврат поставщика")}
          onClose={() => {
            // Escape inside the product list / a quick-add form closes only that layer.
            if (!pickerOpen && !quickAddSupplierOpen && !quickAddWarehouseOpen && !quickAddOrganizationOpen) setModalOpen(false)
          }}
          footer={
            <>
              <span className="flex items-center gap-[26px] pl-[20px] text-[13px] text-black">
                <span>{t("Общая стоимость:")} <b className="font-bold text-[#129fdd]">{formatMoney(draftTotalCost, draft.currency || currencies.base)}</b></span>
                <span>{t("Общее кол-во:")} <b className="font-bold text-[#129fdd]">{draftTotalQty}</b></span>
              </span>
              <button type="button" disabled={saving} onClick={() => void save()} className="h-9 min-w-[56px] disabled:opacity-50 px-4 text-[13px] font-semibold uppercase text-[#129fdd] hover:underline">
                {t("Оформить возврат")}
              </button>
            </>
          }
        >
          <div className="w-[449px] shrink-0 overflow-y-auto border-r border-[#efefef] px-[30px] pb-6 pt-[18px]">
            <div className="grid content-start gap-[12px]">
              <FormField label={t("Поставщик")} required showRequired error={tried && !draft.supplier ? t("Обязательное поле") : undefined}>
                <SearchSelect variant="underline" value={draft.supplier} options={pickOptions(supplierOptions)} invalid={tried && !draft.supplier} onChange={(supplier) => setDraft((value) => ({ ...value, supplier }))} />
              </FormField>
              <FormField label={t("Склад назначения")} required showRequired error={tried && !draft.warehouse ? t("Обязательное поле") : undefined}>
                <SearchSelect variant="underline" value={draft.warehouse} options={pickOptions(warehouseOptions)} invalid={tried && !draft.warehouse} onChange={(warehouse) => setDraft((value) => ({ ...value, warehouse }))} />
              </FormField>
              <FormField label={t("Организация")} required showRequired>
                <SearchSelect variant="underline" value={draft.organization} options={pickOptions(organizationOptions)} onChange={(organization) => setDraft((value) => ({ ...value, organization }))} />
              </FormField>
              <FormField label={t("Филиал")} required showRequired>
                <SearchSelect variant="underline" value={draft.branch} options={pickOptions(draft.branch && !branchOptions.includes(draft.branch) ? [draft.branch, ...branchOptions] : branchOptions)} onChange={(branch) => setDraft((value) => ({ ...value, branch }))} />
              </FormField>
              <FormField label={t("Валюта")} required showRequired>
                <SearchSelect variant="underline" value={draft.currency} options={pickOptions(currencyChoices(currencies.codes, currencies.base, draft.currency))} onChange={(currency) => setDraft((value) => ({ ...value, currency }))} />
              </FormField>
              <FormField label={t("Прайс лист")} required showRequired>
                <SearchSelect variant="underline" value={draft.priceList} options={pickOptions(priceListOptions)} onChange={(priceList) => setDraft((value) => ({ ...value, priceList }))} />
              </FormField>
              <FormField label={t("Тип оплаты")} required showRequired>
                <SearchSelect variant="underline" value={draft.paymentType} options={paymentTypes.map((item) => ({ value: item, label: t(item) }))} onChange={(paymentType) => setDraft((value) => ({ ...value, paymentType }))} />
              </FormField>
              <MaterialDate label={t("Дата создания")} required value={draft.date} max={todayIso()} display={draft.date ? formatDay(draft.date, language) : undefined} onChange={(date) => setDraft((value) => ({ ...value, date }))} />
              <FormField label={t("Оставить комментарий...")} className="!min-h-[40px]">
                <input value={draft.comment} onChange={(event) => setDraft((value) => ({ ...value, comment: event.target.value }))} className={inputClass} />
              </FormField>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            <div className="flex shrink-0 items-center justify-between px-[30px] pt-[14px]">
              <p className="text-[13px] font-semibold text-[#333]">{t("Список товаров")}</p>
              <div className="flex items-center gap-[10px] text-[13px] text-[#333]">
                <button type="button" disabled={!draft.supplier} onClick={addBlankItem} className="h-9 px-[10px] hover:underline">+ {t("Добавить товар").toLowerCase()}</button>
                <button type="button" disabled={!draft.supplier} onClick={() => { setPickerQuery(""); setPickerOpen(true) }} className="h-9 px-[10px] hover:underline">+ {t("добавить из списка")}</button>
                <button type="button" disabled={!draft.supplier} onClick={() => importInputRef.current?.click()} className="h-9 bg-[rgba(153,153,153,0.2)] px-[10px] hover:bg-[rgba(153,153,153,0.3)]">+ <span data-no-translate>импортировать с excel</span></button>
                <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={importFromExcel} className="hidden" />
              </div>
            </div>
            {draftItems.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 pb-24 text-center text-[#bdbdbd]">
                <ShoppingBag className="h-[72px] w-[72px]" strokeWidth={1} />
                <p className="max-w-[160px] text-[12px] leading-[15px]">{draft.supplier ? t("Вы еще не выбрали ни одного товара.") : t("Для добавления товаров выберите клиента.")}</p>
              </div>
            ) : (
              <div className="px-[30px] pt-3">
                <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="text-slate-500">
                          <th className="py-2 pr-4">{t("Товар")}</th>
                          <th className="py-2 pr-4">{t("Кол-во")}</th>
                          <th className="py-2 pr-4">{t("Серия")}</th>
                          <th className="py-2 pr-4">{t("Цена")}</th>
                          <th className="py-2 pr-4">{t("Сумма")}</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {draftItems.map((item) => (
                          <tr key={item.id} className="border-t border-slate-100">
                            <td className="py-2 pr-4">
                              <select value={item.product} onChange={(event) => updateDraftItem(item.id, { product: event.target.value, price: productCosts[event.target.value] ?? item.price })} className="bg-white outline-none">
                                {(productOptions.includes(item.product) ? productOptions : [item.product, ...productOptions]).map((product) => (
                                  <option key={product}>{product}</option>
                                ))}
                              </select>
                            </td>
                            <td className="py-2 pr-4">
                              <input type="number" min={0} step="any" value={item.qty} onChange={(event) => updateDraftItem(item.id, { qty: Number(event.target.value) })} className="w-16 border-b border-slate-200 outline-none" />
                              {item.product && productUnits[item.product] && <span className="ml-1 text-slate-500">{t(productUnits[item.product])}</span>}
                            </td>
                            <td className="py-2 pr-4">
                              <input value={item.series} onChange={(event) => updateDraftItem(item.id, { series: event.target.value })} className="w-24 border-b border-slate-200 outline-none" />
                            </td>
                            <td className="py-2 pr-4">
                              <input type="number" min={0} step="any" value={item.price} onChange={(event) => updateDraftItem(item.id, { price: Number(event.target.value) })} className="w-24 border-b border-slate-200 outline-none" />
                            </td>
                            <td className="py-2 pr-4">{formatAmount(item.qty * item.price, 2)}</td>
                            <td className="py-2 pr-4 text-right">
                              <button type="button" onClick={() => removeDraftItem(item.id)} aria-label={t("Удалить")} className="text-slate-400 hover:text-rose-500">
                                <X className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
              </div>
            )}
          </div>
        </CashModal>
      )}

      {pending && (
        <ConfirmDialog
          title={pending.title}
          text={pending.text}
          kind={pending.kind}
          item={pending.item}
          confirmLabel={pending.confirmLabel}
          busy={busy}
          error={pendingError}
          onConfirm={() => void runPending()}
          onClose={() => setPending(null)}
        />
      )}

      {pickerOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[80vh] w-full max-w-sm flex-col rounded bg-white p-6">
            <div className="mb-4 flex items-center justify-between">
              <b className="uppercase">{t("Добавить из списка")}</b>
              <button type="button" onClick={() => setPickerOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </div>
            <input
              value={pickerQuery}
              onChange={(event) => setPickerQuery(event.target.value)}
              placeholder={t("Поиск товара...")}
              className="mb-3 w-full border-b border-slate-300 py-2 outline-none focus:border-[#4f70e7]"
            />
            <div className="space-y-2 overflow-y-auto">
              {productOptions.length === 0 && <p className="text-sm text-slate-400">{t("Каталог продуктов пуст")}</p>}
              {productOptions
                .filter((product) => !pickerQuery.trim() || product.toLowerCase().includes(pickerQuery.trim().toLowerCase()))
                .slice(0, 200)
                .map((product) => (
                  <label key={product} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={draftItems.some((item) => item.product === product)} onChange={() => addFromList(product)} />
                    {product}
                  </label>
                ))}
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => setPickerOpen(false)} className="rounded bg-[#4f70e7] px-4 py-2 font-semibold text-white">{t("Готово")}</button>
            </div>
          </div>
        </div>
      )}

      {quickAddSupplierOpen && (
        <SupplierFormModal
          onClose={() => setQuickAddSupplierOpen(false)}
          onSaved={(created) => {
            setSupplierOptions((current) => (current.includes(created.name) ? current : [created.name, ...current]))
            setDraft((value) => ({ ...value, supplier: created.name }))
            setQuickAddSupplierOpen(false)
          }}
        />
      )}

      {quickAddWarehouseOpen && (
        <WarehouseFormModal
          onClose={() => setQuickAddWarehouseOpen(false)}
          onSaved={(created) => {
            setWarehouseOptions((current) => (current.includes(created.name) ? current : [created.name, ...current]))
            setDraft((value) => ({ ...value, warehouse: created.name }))
            setQuickAddWarehouseOpen(false)
          }}
        />
      )}

      {quickAddOrganizationOpen && (
        <OrganizationFormModal
          onClose={() => setQuickAddOrganizationOpen(false)}
          onSaved={(created) => {
            setOrganizationOptions((current) => (current.includes(created.name) ? current : [created.name, ...current]))
            setDraft((value) => ({ ...value, organization: created.name }))
            setQuickAddOrganizationOpen(false)
          }}
        />
      )}
    </>
  )

  return embedded ? <main className="min-w-0 flex-1">{content}</main> : <RefPage>{content}</RefPage>
}
