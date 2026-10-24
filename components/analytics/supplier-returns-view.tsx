"use client"

import { askAction, askCancel, askDelete } from "@/lib/ask-confirm"
import { FileSpreadsheet, ListPlus, Plus, Upload, X } from "lucide-react"
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { FilterToggle } from "@/components/analytics/internal-transfers-filter"
import { FilterDate, FilterSelect, RI, RefButton, RefCard, RefFilterPanel, RefHeader, RefPage, RefTable, RefToolbar, usePaging } from "@/components/ref/list-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import { OrganizationFormModal } from "./organization-form-modal"
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

function formatMoney(value: number, currency = "SUM") {
  return `${(Math.round(value * 1000) / 1000).toLocaleString("ru-RU")} ${currency || "SUM"}`
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

const RU_MONTH_PREFIX = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]

/** "29 дек. 2025" / "29 декабря 2025" → "2025-12-29" ("" when unreadable). */
function toIsoDate(value: string): string {
  const match = value.trim().toLowerCase().match(/^(\d{1,2})\s+([а-я]+)\.?\s+(\d{4})/)
  if (!match) return ""
  const token = match[2].slice(0, 3)
  let month = RU_MONTH_PREFIX.findIndex((prefix) => prefix.startsWith(token) || token.startsWith(prefix.slice(0, 3)))
  if (token === "мар" && match[2].startsWith("мая")) month = 4
  if (month < 0) return ""
  return `${match[3]}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`
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

function formatToday() {
  const date = new Date()
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })
}

function emptyDraft() {
  return {
    supplier: "",
    warehouse: "",
    organization: "",
    branch: "",
    currency: "SUM",
    priceList: "",
    paymentType: paymentTypes[0],
    date: formatToday(),
    comment: "",
  }
}

export function SupplierReturnsView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
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
  const [busy, setBusy] = useState(false)
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
      const catalog: { name: string; cost?: number }[] = []
      if (productsRes?.ok) catalog.push(...((await productsRes.json()) as { name: string; cost: number; deleted?: boolean }[]).filter((item) => !item.deleted))
      if (rawMaterialsRes?.ok) catalog.push(...((await rawMaterialsRes.json()) as { name: string }[]))
      setProductOptions(Array.from(new Set(catalog.map((item) => item.name))).sort((a, b) => a.localeCompare(b, "ru")))
      setProductCosts(Object.fromEntries(catalog.filter((item) => item.cost).map((item) => [item.name, Number(item.cost)])))
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
    setDraft(emptyDraft())
    setDraftItems([])
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(row: SupplierReturn) {
    setDraft({
      supplier: row.fromWhom,
      warehouse: row.warehouse,
      organization: row.organization,
      branch: row.branch,
      currency: row.currency || "SUM",
      priceList: row.priceList,
      paymentType: row.paymentType,
      date: row.date,
      comment: row.reason,
    })
    setDraftItems(row.items.map((item) => ({ id: item.id, product: item.product, qty: item.qty, series: item.series, price: item.price })))
    setEditingId(row.id)
    setModalOpen(true)
  }

  async function changeStatus(row: SupplierReturn, action: "give" | "cancel") {
    const confirmed = action === "give"
      ? await askAction(t("Передать возврат"), `${t("Передать возврат №")} ${row.id} ${t("поставщику?")}`)
      : await askCancel(`${t("Возврат")}№ ${row.id}`)
    if (!confirmed) return
    setBusy(true)
    try {
      const response = await fetch(`/api/supplier-returns/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        notify(data.error ? t(data.error) : t("Не удалось изменить статус возврата"))
        return
      }
      setRows((current) => current.map((item) => (item.id === row.id ? (data as SupplierReturn) : item)))
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setBusy(false)
    }
  }

  async function removeRow(row: SupplierReturn) {
    if (!(await askDelete(`№ ${row.id}`))) return
    try {
      const response = await fetch(`/api/supplier-returns/${row.id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        notify(data.error ? t(data.error) : t("Не удалось удалить возврат"))
        return
      }
      setRows((current) => current.filter((item) => item.id !== row.id))
      if (expandedId === row.id) setExpandedId(null)
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

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
  const draftTotalQty = draftItems.reduce((sum, item) => sum + item.qty, 0)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.supplier || !draft.warehouse || !draftItems.length) return
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
      paymentType: draft.paymentType,
      date: draft.date,
      comment: draft.comment,
      items,
    }
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
    }
  }

  function downloadList() {
    downloadExcelTable("vozvrat-postavshikam", [
      [t("№"), t("От кого"), t("Склад"), t("Добавил"), t("Дата возврата"), t("Сумма возврата"), t("Статус")],
      ...filtered.map((row) => [row.id, row.fromWhom, row.warehouse, row.addedBy, `${row.date}, ${row.time}`, row.amount, row.status]),
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
          cols="99fr 213fr 213fr 266fr 213fr 213fr 167fr"
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
            `${row.date}, ${row.time}`,
            formatMoney(row.amount, row.currency),
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
                      <InfoRow label={`${t("Добавил")}:`} value={row.addedBy} />
                      <InfoRow label={`${t("Поставщик")}:`} value={row.fromWhom} />
                      <InfoRow label={`${t("Организация")}:`} value={row.organization} />
                      <InfoRow label={`${t("Валюта")}:`} value={row.currency} />
                      <InfoRow label={`${t("Тип оплаты")}:`} value={t(row.paymentType)} />
                      <InfoRow label={`${t("Прайс лист")}:`} value={row.priceList} />
                      <InfoRow label={`${t("Дата возврата")}:`} value={`${row.date}, ${row.time}`} />
                      <InfoRow label={`${t("Филиал")}:`} value={row.branch} />
                    </dl>
                    <div className="border-t border-[#e0e0e0] px-[30px] pb-[14px] pt-[11px]">
                      <p className="uppercase leading-[25px]">{t("Склад")}</p>
                      <dl className="mt-[5px] leading-[25px]">
                        <InfoRow label={`${t("Склад")}:`} value={row.warehouse} />
                        <InfoRow label={`${t("Время передачи")}:`} value={row.transferTime || t("Не передано")} />
                        <InfoRow label={`${t("Передал")}:`} value={row.transferredBy || "—"} />
                        <InfoRow label={`${t("Статус")}:`} value={t(STATUS_LABEL[row.status])} valueClass={row.status === "завершен" ? "text-[#81c784]" : row.status === "в процессе" ? "text-[#f5a623]" : "text-[#e57373]"} />
                        {row.status === "отменен" && row.cancelledBy && <InfoRow label={`${t("Отменил")}:`} value={`${row.cancelledBy}, ${row.cancelledAt}`} />}
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
                      <span>{t("№")}</span><span>{t("Товар")}</span><span className="text-right">{t("Количество")}</span><span className="pl-[40px]">{t("Серия")}</span><span className="text-right">{t("Цена (SUM)")}</span><span className="text-right">{t("Сумма (SUM)")}</span>
                    </div>
                    <div className="border-t border-dotted border-[#cfd6dc]">
                      {row.items.map((item) => (
                        <div key={item.id} className="grid min-h-[60px] grid-cols-[34px_minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.3fr)] items-center border-b border-dotted border-[#cfd6dc]">
                          <span>{item.id}</span><span>{item.product}</span><span className="text-right">{item.qty.toLocaleString("ru-RU")}</span><span className="pl-[40px]">{item.series}</span><span className="text-right">{item.price.toLocaleString("ru-RU")}</span><span className="text-right">{item.total.toLocaleString("ru-RU")}</span>
                        </div>
                      ))}
                      <div className="grid min-h-[50px] grid-cols-[34px_minmax(0,2.2fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1.3fr)] items-center font-bold">
                        <span className="col-span-2">{t("Итого")}:</span><span className="text-right">{row.items.reduce((sum, item) => sum + item.qty, 0).toLocaleString("ru-RU")}</span><span /><span /><span className="text-right">{total.toLocaleString("ru-RU")}</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editingId !== null ? `${t("Изменить возврат №")}${editingId}` : t("Возврат поставщика")}</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
            </header>

            <div className="flex-1 overflow-y-auto p-8">
              <div className="grid gap-8 sm:grid-cols-[1fr_1.4fr]">
                <div className="space-y-4">
                  <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-2">
                    <label className="block flex-1 font-medium">
                      {t("Поставщик")} *
                      <select value={draft.supplier} onChange={(event) => setDraft((value) => ({ ...value, supplier: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                        <option value="">{t("Выберите...")}</option>
                        {supplierOptions.map((item, optIndex) => <option key={`${item}-${optIndex}`}>{item}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => setQuickAddSupplierOpen(true)} className="whitespace-nowrap pb-2 text-sm font-semibold text-[#4f70e7] hover:underline">
                      {t("+добавить")}
                    </button>
                  </div>
                  {supplierOptions.length === 0 && <p className="text-xs text-amber-600">{t("Нет поставщиков — нажмите «+добавить»")}</p>}
                  <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-2">
                    <label className="block flex-1 font-medium">
                      {t("Склад назначения")} *
                      <select value={draft.warehouse} onChange={(event) => setDraft((value) => ({ ...value, warehouse: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                        <option value="">{t("Выберите...")}</option>
                        {warehouseOptions.map((item, optIndex) => <option key={`${item}-${optIndex}`}>{item}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => setQuickAddWarehouseOpen(true)} className="whitespace-nowrap pb-2 text-sm font-semibold text-[#4f70e7] hover:underline">
                      {t("+добавить")}
                    </button>
                  </div>
                  {warehouseOptions.length === 0 && <p className="text-xs text-amber-600">{t("Нет складов — нажмите «+добавить»")}</p>}
                  <div className="flex items-end justify-between gap-3 border-b border-slate-200 pb-2">
                    <label className="block flex-1 font-medium">
                      {t("Организация")} *
                      <select value={draft.organization} onChange={(event) => setDraft((value) => ({ ...value, organization: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                        <option value="">{t("Выберите...")}</option>
                        {organizationOptions.map((item, optIndex) => <option key={`${item}-${optIndex}`}>{item}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => setQuickAddOrganizationOpen(true)} className="whitespace-nowrap pb-2 text-sm font-semibold text-[#4f70e7] hover:underline">
                      {t("+добавить")}
                    </button>
                  </div>
                  {organizationOptions.length === 0 && <p className="text-xs text-amber-600">{t("Нет организаций — нажмите «+добавить»")}</p>}
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Филиал")} *
                    <select value={draft.branch} onChange={(event) => setDraft((value) => ({ ...value, branch: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      <option value="">{t("Не указано")}</option>
                      {draft.branch && !branchOptions.includes(draft.branch) && <option>{draft.branch}</option>}
                      {branchOptions.map((item, optIndex) => <option key={`${item}-${optIndex}`}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Валюта")} *
                    <select value={draft.currency} onChange={(event) => setDraft((value) => ({ ...value, currency: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      <option>SUM</option>
                      <option>USD</option>
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Прайс лист")}
                    <select value={draft.priceList} onChange={(event) => setDraft((value) => ({ ...value, priceList: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      <option value="">{t("Выберите...")}</option>
                      {priceListOptions.map((item, optIndex) => <option key={`${item}-${optIndex}`}>{item}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Тип оплаты")} *
                    <select value={draft.paymentType} onChange={(event) => setDraft((value) => ({ ...value, paymentType: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                      {paymentTypes.map((item, optIndex) => <option key={`${item}-${optIndex}`} value={item}>{t(item)}</option>)}
                    </select>
                  </label>
                  <label className="block border-b border-slate-200 pb-2 font-medium">
                    {t("Дата создания")} *
                    <input value={draft.date} onChange={(event) => setDraft((value) => ({ ...value, date: event.target.value }))} className="mt-2 block w-full outline-none" />
                  </label>
                  <label className="block font-medium">
                    {t("Оставить комментарий...")}
                    <textarea value={draft.comment} onChange={(event) => setDraft((value) => ({ ...value, comment: event.target.value }))} rows={2} className="mt-2 block w-full resize-none border-b border-slate-200 outline-none" />
                  </label>
                </div>

                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="font-medium text-slate-800">{t("Список товаров")}</p>
                    {draft.supplier && (
                      <div className="flex items-center gap-4 text-sm">
                        <button type="button" onClick={addBlankItem} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
                          <Plus className="h-4 w-4" /> {t("добавить товар")}
                        </button>
                        <button type="button" onClick={() => { setPickerQuery(""); setPickerOpen(true) }} className="inline-flex items-center gap-1 text-[#4f70e7] hover:underline">
                          <ListPlus className="h-4 w-4" /> {t("добавить из списка")}
                        </button>
                        <button type="button" onClick={() => importInputRef.current?.click()} className="inline-flex items-center gap-1 rounded bg-slate-100 px-3 py-1.5 text-[#4f70e7] hover:bg-slate-200">
                          <Upload className="h-4 w-4" /> {t("импортировать с excel")}
                        </button>
                        <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={importFromExcel} className="hidden" />
                      </div>
                    )}
                  </div>

                  {!draft.supplier ? (
                    <div className="flex flex-col items-center justify-center gap-3 rounded border border-dashed border-slate-200 py-16 text-slate-400">
                      <FileSpreadsheet className="h-12 w-12" />
                      <p>{t("Для добавления товаров выберите клиента.")}</p>
                    </div>
                  ) : draftItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 rounded border border-dashed border-slate-200 py-16 text-slate-400">
                      <FileSpreadsheet className="h-12 w-12" />
                      <p>
                        {t("Вы еще не выбрали ни одного товара.")}{" "}
                        <button type="button" onClick={addBlankItem} className="text-[#4f70e7] hover:underline">
                          {t("Добавить товар?")}
                        </button>
                      </p>
                    </div>
                  ) : (
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
                            </td>
                            <td className="py-2 pr-4">
                              <input value={item.series} onChange={(event) => updateDraftItem(item.id, { series: event.target.value })} className="w-24 border-b border-slate-200 outline-none" />
                            </td>
                            <td className="py-2 pr-4">
                              <input type="number" min={0} step="any" value={item.price} onChange={(event) => updateDraftItem(item.id, { price: Number(event.target.value) })} className="w-24 border-b border-slate-200 outline-none" />
                            </td>
                            <td className="py-2 pr-4">{(item.qty * item.price).toLocaleString("ru-RU")}</td>
                            <td className="py-2 pr-4 text-right">
                              <button type="button" onClick={() => removeDraftItem(item.id)} aria-label={t("Удалить")} className="text-slate-400 hover:text-rose-500">
                                <X className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            <footer className="flex items-center justify-between border-t p-5">
              <div className="text-sm text-slate-600">
                {t("Общая стоимость:")} <b>{draftTotalCost.toLocaleString("ru-RU")}</b> &nbsp; {t("Общее кол-во:")} <b>{draftTotalQty} {t("ед")}</b>
              </div>
              <button type="submit" className="font-bold uppercase text-sky-500">
                {t("Оформить")}
              </button>
            </footer>
          </form>
        </div>
      )}

      {pickerOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
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
